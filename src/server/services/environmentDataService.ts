import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AreaEnvironmentSchema, type AreaEnvironment } from '../../shared/contracts.js';
import { haversineDistanceKm } from '../../shared/geo.js';
import { DATA_DIR_PATH, SEA_REFERENCE_POINTS_CONFIG_PATH } from '../config.js';
import { elevationCell, PermanentElevationCache } from './elevationCache.js';
import { fetchOpenMeteoMarine, type WeatherApiClient } from './openMeteoSdk.js';

export { haversineDistanceKm };
export type DataMode = 'live' | 'cache';
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
  timeoutMs?: number;
  fetcher?: typeof fetch;
  weatherApi?: WeatherApiClient;
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

function makeApiUrl(
  base: string,
  points: ReadonlyArray<Coordinates>
): URL {
  const url = new URL(base);
  url.searchParams.set('latitude', points.map((point) => point.latitude).join(','));
  url.searchParams.set('longitude', points.map((point) => point.longitude).join(','));
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
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly cache: PermanentElevationCache;
  private readonly inFlight = new Map<string, Promise<ElevationResult>>();

  constructor(options: EnvironmentProviderOptions) {
    this.mode = options.mode;
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
        'https://api.open-meteo.com/v1/elevation',
        cells.map(({ latitude, longitude }) => ({ latitude, longitude }))
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
  private readonly timeoutMs: number;
  private readonly weatherApi: WeatherApiClient | undefined;
  private readonly cache: MarineForecastCache;
  private readonly now: () => number;

  constructor(options: EnvironmentProviderOptions) {
    this.mode = options.mode;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.weatherApi = options.weatherApi;
    this.cache = new MarineForecastCache(options.marineCachePath);
    this.now = options.now ?? Date.now;
  }

  public async getForecast(point: SeaReferencePoint): Promise<{
    hourly: AreaEnvironment['seaLevel']['hourly'];
    fetchedAtISO: string | null;
    messageTh: string | null;
  }> {
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
      const marineData = await fetchOpenMeteoMarine(point.lat, point.lon, {
        ...(this.weatherApi ? { weatherApi: this.weatherApi } : {}),
        timeoutMs: this.timeoutMs,
      });
      const now = this.now();
      const hourly = marineData.hourly.time
        .flatMap((timeISO, index) => {
          if (Date.parse(timeISO) < now) return [];
          return [{
            timeISO,
            seaLevelHeightMslM: marineData.hourly.sea_level_height_msl[index] ?? null,
            waveHeightM: marineData.hourly.wave_height[index] ?? null,
          }];
        })
        .slice(0, 49);
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
  private readonly elevation: ElevationProvider;
  private readonly marine: MarineProvider;
  private readonly referencePointsPath: string;
  private referenceConfig: z.infer<typeof ReferencePointsSchema> | null = null;

  constructor(options: EnvironmentProviderOptions) {
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
