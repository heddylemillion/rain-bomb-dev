import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AreaEnvironmentSchema, type AreaEnvironment } from '../../shared/contracts.js';
import { DATA_DIR_PATH, SEA_REFERENCE_POINTS_CONFIG_PATH } from '../config.js';
import { elevationCell, PermanentElevationCache } from './elevationCache.js';

export type DataMode = 'live' | 'mock' | 'cache';
export type Coordinates = { latitude: number; longitude: number };

const ReferencePointsSchema = z.object({
  points: z.array(z.object({
    id: z.string().min(1),
    name_th: z.string().min(1),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })),
  communities: z.record(z.object({
    referencePointId: z.string().min(1),
    distanceKm: z.number().nonnegative(),
  })),
});

export type SeaReferencePoint = z.infer<typeof ReferencePointsSchema>['points'][number];

const MarineForecastSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    sea_level_height_msl: z.array(z.number().nullable()),
    wave_height: z.array(z.number().nullable()),
  }),
});

interface MarineCacheEntry {
  expiresAt: number;
  hourly: AreaEnvironment['seaLevel']['hourly'];
  fetchedAtISO: string;
}

interface MarineCacheFile {
  forecasts: Record<string, MarineCacheEntry>;
}

export interface EnvironmentProviderOptions {
  mode: DataMode;
  apiKey?: string;
  commercial?: boolean;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  elevationCache?: PermanentElevationCache;
  elevationCachePath?: string;
  marineCachePath?: string;
  referencePointsPath?: string;
  now?: () => number;
}

export interface ElevationResult {
  valueM: number | null;
  messageTh: string | null;
}

export interface ElevationProvider {
  getMany(points: ReadonlyArray<Coordinates>): Promise<ElevationResult[]>;
}

export interface MarineProvider {
  getForecast(point: SeaReferencePoint): Promise<{
    hourly: AreaEnvironment['seaLevel']['hourly'];
    fetchedAtISO: string | null;
    messageTh: string | null;
  }>;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mockElevation(point: Coordinates): number {
  const cell = elevationCell(point.latitude, point.longitude);
  return (stableHash(cell.key) % 320) / 10;
}

function mockMarine(point: SeaReferencePoint, now: number): AreaEnvironment['seaLevel']['hourly'] {
  const firstHour = Math.floor((now + 7 * 60 * 60 * 1000) / (60 * 60 * 1000)) *
    (60 * 60 * 1000) - 7 * 60 * 60 * 1000;
  const seed = stableHash(`${point.lat.toFixed(3)},${point.lon.toFixed(3)}`);
  return Array.from({ length: 49 }, (_, index) => {
    const time = new Date(firstHour + index * 60 * 60 * 1000 + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    const phase = ((firstHour / 3_600_000 + index + seed % 24) % 24) / 24;
    return {
      timeISO: `${time}+07:00`,
      seaLevelHeightMslM: Math.round((0.3 + Math.sin(phase * Math.PI * 2) * 0.8) * 100) / 100,
      waveHeightM: Math.round((0.2 + ((seed + index * 17) % 20) / 100) * 100) / 100,
    };
  });
}

function thaiHourISO(value: string): string | null {
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}+07:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function makeApiUrl(
  base: string,
  points: ReadonlyArray<Coordinates>,
  apiKey: string | undefined,
  commercial: boolean | undefined
): URL {
  const url = new URL(base);
  url.searchParams.set('latitude', points.map((point) => point.latitude).join(','));
  url.searchParams.set('longitude', points.map((point) => point.longitude).join(','));
  if (commercial && apiKey) url.searchParams.set('apikey', apiKey);
  return url;
}

async function fetchResponse(
  url: URL,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { method: 'GET', signal: controller.signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('หมดเวลารอข้อมูลจาก Open-Meteo');
    }
    throw new Error('เชื่อมต่อ Open-Meteo ไม่สำเร็จ');
  } finally {
    clearTimeout(timeout);
  }
}

export class OpenMeteoElevationProvider implements ElevationProvider {
  private readonly mode: DataMode;
  private readonly apiKey: string | undefined;
  private readonly commercial: boolean;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly cache: PermanentElevationCache;
  private readonly inFlight = new Map<string, Promise<ElevationResult>>();

  constructor(options: EnvironmentProviderOptions) {
    this.mode = options.mode;
    this.apiKey = options.apiKey;
    this.commercial = options.commercial ?? false;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.elevationCache ??
      new PermanentElevationCache(options.elevationCachePath);
  }

  public async getMany(points: ReadonlyArray<Coordinates>): Promise<ElevationResult[]> {
    const cells = points.map((point) => elevationCell(point.latitude, point.longitude));
    const results: Array<ElevationResult | null> = Array.from({ length: points.length }, () => null);
    const requestedCells = new Map<string, typeof cells[number]>();

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      if (this.mode === 'mock') {
        results[index] = { valueM: mockElevation(points[index]!), messageTh: null };
        continue;
      }
      const cached = await this.cache.get(cell.key);
      if (cached !== null) {
        results[index] = { valueM: cached, messageTh: null };
      } else {
        requestedCells.set(cell.key, cell);
      }
    }

    if (this.mode === 'cache') {
      for (let index = 0; index < cells.length; index += 1) {
        if (results[index] === null) {
          results[index] = { valueM: null, messageTh: 'ไม่มีข้อมูลความสูงในแคช' };
        }
      }
      return results.map((result) => result!);
    }

    const missing = [...requestedCells.values()];
    const owned = missing.filter((cell) => !this.inFlight.has(cell.key));
    for (let offset = 0; offset < owned.length; offset += 100) {
      const batch = owned.slice(offset, offset + 100);
      const batchPromise = this.fetchBatch(batch);
      batch.forEach((cell, index) => {
        const cellPromise = batchPromise.then((batchResults) => batchResults[index]!);
        this.inFlight.set(cell.key, cellPromise);
      });
    }

    await Promise.all([...requestedCells.keys()].map(async (key) => {
      const cellPromise = this.inFlight.get(key);
      if (!cellPromise) return;
      const cellResult = await cellPromise;
      for (let index = 0; index < cells.length; index += 1) {
        if (cells[index]?.key === key && results[index] === null) results[index] = cellResult;
      }
    })).finally(() => {
      for (const cell of missing) this.inFlight.delete(cell.key);
    });

    return results.map((result) => result ?? {
      valueM: null,
      messageTh: 'ไม่มีข้อมูลความสูง',
    });
  }

  private async fetchBatch(
    cells: ReadonlyArray<ReturnType<typeof elevationCell>>
  ): Promise<ElevationResult[]> {
    let batchResults: ElevationResult[];
    try {
      const url = makeApiUrl(
        this.commercial
          ? 'https://customer-api.open-meteo.com/v1/elevation'
          : 'https://api.open-meteo.com/v1/elevation',
        cells.map(({ latitude, longitude }) => ({ latitude, longitude })),
        this.apiKey,
        this.commercial
      );
      const response = await fetchResponse(url, this.fetcher, this.timeoutMs);
      if (!response.ok) {
        const explanation = response.status === 429
          ? 'โควตาการเรียก Open-Meteo อาจเต็มแล้ว'
          : `Open-Meteo ตอบกลับ HTTP ${response.status}`;
        throw new Error(explanation);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('อ่านข้อมูลความสูงจาก Open-Meteo ไม่สำเร็จ');
      }
      const elevations = z.object({ elevation: z.array(z.unknown()) }).safeParse(payload);
      if (!elevations.success) {
        throw new Error('รูปแบบข้อมูลความสูงจาก Open-Meteo ไม่ถูกต้อง');
      }
      batchResults = cells.map((_, index): ElevationResult => {
        const value = elevations.data.elevation[index];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return {
            valueM: null,
            messageTh: 'ค่าความสูงจาก Open-Meteo ไม่ใช่ตัวเลขที่ใช้ได้ · ไม่มีข้อมูลความสูง',
          };
        }
        return { valueM: value, messageTh: null };
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
      return cells.map(() => ({
        valueM: null,
        messageTh: `${reason} · ไม่มีข้อมูลความสูง`,
      }));
    }
    const cacheEntries = batchResults.flatMap((result, index) =>
      result.valueM === null || !cells[index]
        ? []
        : [{ key: cells[index]!.key, value: result.valueM }]
    );
    if (cacheEntries.length > 0) await this.cache.setMany(cacheEntries);
    return batchResults;
  }
}

class MarineForecastCache {
  private readonly filePath: string;
  private records: Map<string, MarineCacheEntry> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = path.join(DATA_DIR_PATH, 'marine-cache.json')) {
    this.filePath = filePath;
  }

  public async get(key: string, now: number): Promise<MarineCacheEntry | null> {
    const records = await this.load();
    const entry = records.get(key);
    return entry && entry.expiresAt > now ? structuredClone(entry) : null;
  }

  public async set(key: string, value: MarineCacheEntry): Promise<void> {
    const records = await this.load();
    records.set(key, structuredClone(value));
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      const payload: MarineCacheFile = { forecasts: Object.fromEntries(records) };
      await fs.writeFile(temporaryPath, JSON.stringify(payload), 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }

  private async load(): Promise<Map<string, MarineCacheEntry>> {
    if (this.records) return this.records;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const result = z.object({
        forecasts: z.record(z.object({
          expiresAt: z.number(),
          hourly: AreaEnvironmentSchema.shape.seaLevel.shape.hourly,
          fetchedAtISO: z.string(),
        })),
      }).parse(parsed);
      this.records = new Map(Object.entries(result.forecasts));
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        this.records = new Map();
      } else {
        throw error;
      }
    }
    return this.records;
  }
}

export class OpenMeteoMarineProvider implements MarineProvider {
  private readonly mode: DataMode;
  private readonly apiKey: string | undefined;
  private readonly commercial: boolean;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly cache: MarineForecastCache;
  private readonly now: () => number;

  constructor(options: EnvironmentProviderOptions) {
    this.mode = options.mode;
    this.apiKey = options.apiKey;
    this.commercial = options.commercial ?? false;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetcher = options.fetcher ?? fetch;
    this.cache = new MarineForecastCache(options.marineCachePath);
    this.now = options.now ?? Date.now;
  }

  public async getForecast(point: SeaReferencePoint): Promise<{
    hourly: AreaEnvironment['seaLevel']['hourly'];
    fetchedAtISO: string | null;
    messageTh: string | null;
  }> {
    if (this.mode === 'mock') {
      return {
        hourly: mockMarine(point, this.now()).slice(0, 49),
        fetchedAtISO: new Date(this.now()).toISOString(),
        messageTh: null,
      };
    }

    const cached = await this.cache.get(point.id, this.now());
    if (cached) {
      const hasAnySeaLevel = cached.hourly.some((item) => item.seaLevelHeightMslM !== null);
      return {
        hourly: cached.hourly,
        fetchedAtISO: cached.fetchedAtISO,
        messageTh: hasAnySeaLevel ? null : 'ไม่มีข้อมูลระดับน้ำทะเลจากจุดอ้างอิงนี้',
      };
    }
    if (this.mode === 'cache') {
      return {
        hourly: [],
        fetchedAtISO: null,
        messageTh: 'ไม่มีข้อมูลพยากรณ์ระดับน้ำทะเลในแคช',
      };
    }

    try {
      const url = new URL(this.commercial
        ? 'https://customer-marine-api.open-meteo.com/v1/marine'
        : 'https://marine-api.open-meteo.com/v1/marine');
      url.searchParams.set('latitude', String(point.lat));
      url.searchParams.set('longitude', String(point.lon));
      url.searchParams.set('hourly', 'sea_level_height_msl,wave_height');
      url.searchParams.set('forecast_days', '3');
      url.searchParams.set('timezone', 'Asia/Bangkok');
      if (this.commercial && this.apiKey) url.searchParams.set('apikey', this.apiKey);

      const response = await fetchResponse(url, this.fetcher, this.timeoutMs);
      if (!response.ok) {
        const explanation = response.status === 429
          ? 'โควตาการเรียก Open-Meteo Marine อาจเต็มแล้ว'
          : `Open-Meteo Marine ตอบกลับ HTTP ${response.status}`;
        throw new Error(explanation);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('อ่านพยากรณ์จาก Open-Meteo Marine ไม่สำเร็จ');
      }
      const parsed = MarineForecastSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error('รูปแบบพยากรณ์จาก Open-Meteo Marine ไม่ถูกต้อง');
      }
      const now = this.now();
      const hourly = parsed.data.hourly.time.flatMap((time, index) => {
        const timeISO = thaiHourISO(time);
        if (!timeISO || Date.parse(timeISO) < now) return [];
        return [{
          timeISO,
          seaLevelHeightMslM: parsed.data.hourly.sea_level_height_msl[index] ?? null,
          waveHeightM: parsed.data.hourly.wave_height[index] ?? null,
        }];
      }).slice(0, 49);
      const fetchedAtISO = new Date(now).toISOString();
      await this.cache.set(point.id, {
        expiresAt: now + 45 * 60 * 1000,
        hourly,
        fetchedAtISO,
      });
      const hasAnySeaLevel = hourly.some((item) => item.seaLevelHeightMslM !== null);
      return {
        hourly,
        fetchedAtISO,
        messageTh: hasAnySeaLevel ? null : 'ไม่มีข้อมูลระดับน้ำทะเลจากจุดอ้างอิงนี้',
      };
    } catch (error: unknown) {
      return {
        hourly: [],
        fetchedAtISO: null,
        messageTh: error instanceof Error ? error.message : 'โหลดพยากรณ์ระดับน้ำทะเลไม่สำเร็จ',
      };
    }
  }
}

export function haversineDistanceKm(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number
): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const angle = 2 * Math.asin(Math.sqrt(
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) *
    Math.sin(longitudeDelta / 2) ** 2
  ));
  return 6371 * angle;
}

export function selectSeaReferencePoint(
  latitude: number,
  longitude: number,
  points: readonly SeaReferencePoint[],
  communityMap: Readonly<Record<string, { referencePointId: string; distanceKm: number }>>,
  communityId?: string
): SeaReferencePoint {
  if (points.length === 0) throw new Error('ไม่มีจุดอ้างอิงทางทะเลที่กำหนดไว้');
  const mappedId = communityId ? communityMap[communityId]?.referencePointId : undefined;
  if (mappedId) {
    const mapped = points.find((point) => point.id === mappedId);
    if (mapped) return mapped;
  }
  return points.reduce((nearest, point) =>
    haversineDistanceKm(latitude, longitude, point.lat, point.lon) <
    haversineDistanceKm(latitude, longitude, nearest.lat, nearest.lon)
      ? point
      : nearest
  );
}

export function assertMatchingDatums(
  left: { datum: string },
  right: { datum: string }
): void {
  if (left.datum !== right.datum) {
    throw new Error('ไม่สามารถคำนวณผลต่างระหว่างข้อมูลที่ใช้ datum คนละระบบได้');
  }
}

export class EnvironmentDataService {
  private readonly mode: DataMode;
  private readonly elevation: ElevationProvider;
  private readonly marine: MarineProvider;
  private readonly referencePointsPath: string;
  private referenceConfig: z.infer<typeof ReferencePointsSchema> | null = null;

  constructor(options: EnvironmentProviderOptions) {
    this.mode = options.mode;
    this.elevation = new OpenMeteoElevationProvider(options);
    this.marine = new OpenMeteoMarineProvider(options);
    this.referencePointsPath = options.referencePointsPath ?? SEA_REFERENCE_POINTS_CONFIG_PATH;
  }

  public async getAreaEnvironment(
    latitude: number,
    longitude: number,
    communityId?: string
  ): Promise<AreaEnvironment> {
    const referenceConfig = await this.loadReferencePoints();
    const reference = selectSeaReferencePoint(
      latitude,
      longitude,
      referenceConfig.points,
      referenceConfig.communities,
      communityId
    );
    const configuredDistance = communityId
      ? referenceConfig.communities[communityId]
      : undefined;
    const [elevation, marine] = await Promise.all([
      this.elevation.getMany([{ latitude, longitude }]).then((values) => values[0]!),
      this.marine.getForecast(reference),
    ]);

    return {
      isMock: this.mode === 'mock',
      elevation,
      seaLevel: {
        referencePoint: {
          id: reference.id,
          nameTh: reference.name_th,
          latitude: reference.lat,
          longitude: reference.lon,
          distanceKm: configuredDistance?.referencePointId === reference.id
            ? configuredDistance.distanceKm
            : haversineDistanceKm(latitude, longitude, reference.lat, reference.lon),
        },
        datum: 'global_mean_sea_level',
        model: 'forecast',
        hourly: marine.hourly,
        fetchedAtISO: marine.fetchedAtISO,
        messageTh: marine.messageTh,
      },
    };
  }

  private async loadReferencePoints(): Promise<z.infer<typeof ReferencePointsSchema>> {
    if (this.referenceConfig) return this.referenceConfig;
    const raw: unknown = JSON.parse(await fs.readFile(this.referencePointsPath, 'utf8'));
    this.referenceConfig = ReferencePointsSchema.parse(raw);
    return this.referenceConfig;
  }
}
