import { z } from 'zod';
import { inflateSync } from 'node:zlib';
import type {
  ProviderMode,
  RadarFrame,
  StormTrackFeatureCollection,
} from '../../shared/providerContracts.js';
import { StormTrackFeatureCollectionSchema } from '../../shared/providerContracts.js';
import { logger, redactSecretsInText } from '../logger.js';

export interface TileCoordinates {
  z: number;
  x: number;
  y: number;
}

export interface LightningSummary {
  count30min: number | null;
  nearestStrikeKm: number | null;
  within5km15min: number | null;
  source: string;
  observedAt: string | null;
}

export interface RadarProvider {
  readonly id: string;
  readonly mode: ProviderMode;
  readonly maxZoom: number;
  readonly attribution: string;
  readonly attributionUrl: string;
  getFrames(lat: number, lon: number): Promise<{
    frames: RadarFrame[];
    coverage: 'available' | 'none' | 'unknown';
  }>;
  getTile(coords: TileCoordinates, frameTime: number): Promise<Buffer | null>;
}

export interface LightningProvider {
  readonly id: string;
  readonly mode: ProviderMode;
  readonly attribution: string;
  readonly attributionUrl: string;
  readonly licenceLimits: string;
  getSummary(lat: number, lon: number): Promise<LightningSummary>;
}

export interface StormTrackProvider {
  readonly id: string;
  readonly mode: ProviderMode;
  readonly attribution: string;
  readonly attributionUrl: string;
  readonly licenceLimits: string;
  getTracks(): Promise<StormTrackFeatureCollection>;
}

export class SlidingWindowBudget {
  private readonly timestamps = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  public consume(key: string, now = Date.now()): boolean {
    const active = (this.timestamps.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);
    if (active.length >= this.limit) {
      this.timestamps.set(key, active);
      return false;
    }
    active.push(now);
    this.timestamps.set(key, active);
    return true;
  }

  public used(key: string, now = Date.now()): number {
    const active = (this.timestamps.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);
    this.timestamps.set(key, active);
    return active.length;
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly resetMs = 60_000
  ) {}

  public isOpen(now = Date.now()): boolean {
    if (this.openUntil <= now) {
      this.openUntil = 0;
      this.failures = 0;
      return false;
    }
    return true;
  }

  public success(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  public failure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openUntil = now + this.resetMs;
  }
}

const RainViewerMetadataSchema = z.object({
  host: z.string().url(),
  radar: z.object({ past: z.array(z.object({
    time: z.number().int().positive(),
    path: z.string().startsWith('/v2/radar/'),
  })) }),
});

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

function mercatorTile(lat: number, lon: number, zoom: number): TileCoordinates & {
  pixelX: number;
  pixelY: number;
} {
  const scale = 2 ** zoom;
  const worldX = (lon + 180) / 360 * scale;
  const worldY = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale;
  return {
    z: zoom,
    x: Math.floor(worldX),
    y: Math.floor(worldY),
    pixelX: Math.min(255, Math.floor((worldX % 1) * 256)),
    pixelY: Math.min(255, Math.floor((worldY % 1) * 256)),
  };
}

function pngRgbaAt(data: Buffer, targetX: number, targetY: number): [number, number, number, number] | null {
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData: Buffer[] = [];
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (offset + 12 + length > data.length) return null;
    if (type === 'IHDR') {
      width = data.readUInt32BE(offset + 8);
      height = data.readUInt32BE(offset + 12);
      bitDepth = data[offset + 16] ?? 0;
      colorType = data[offset + 17] ?? 0;
      interlace = data[offset + 20] ?? 0;
    }
    if (type === 'IDAT') imageData.push(data.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (
    width !== 256 || height !== 256 || bitDepth !== 8 ||
    colorType !== 6 || interlace !== 0 ||
    targetX < 0 || targetX >= width || targetY < 0 || targetY >= height
  ) return null;

  const raw = inflatePng(Buffer.concat(imageData));
  if (!raw) return null;
  const stride = width * 4;
  const previous = Buffer.alloc(stride);
  let row: Buffer = previous;
  for (let y = 0; y <= targetY; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter === undefined) return null;
    const encoded = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const decoded = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? decoded[x - 4]! : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= 4 ? previous[x - 4]! : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : filter === 4 ? paethPredictor(left, above, upperLeft)
                : -1;
      if (predictor < 0) return null;
      decoded[x] = ((encoded[x] ?? 0) + predictor) & 0xff;
    }
    row = decoded;
    decoded.copy(previous);
  }
  const offset = targetX * 4;
  return [row[offset]!, row[offset + 1]!, row[offset + 2]!, row[offset + 3]!];
}

function inflatePng(data: Buffer): Buffer | null {
  try {
    return requireInflateSync(data);
  } catch {
    return null;
  }
}

function requireInflateSync(data: Buffer): Buffer {
  return inflateSync(data);
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}

export class RainViewerRadarProvider implements RadarProvider {
  public readonly id = 'rainviewer';
  public readonly maxZoom = 7;
  public readonly attribution = 'Weather data by RainViewer';
  public readonly attributionUrl = 'https://www.rainviewer.com/';
  private metadataCache: CacheEntry<z.infer<typeof RainViewerMetadataSchema>> | null = null;
  private readonly tileCache = new Map<string, CacheEntry<Buffer>>();
  private readonly coverageCache = new Map<string, CacheEntry<'available' | 'none' | 'unknown'>>();
  private readonly breaker = new CircuitBreaker();

  constructor(
    public readonly mode: ProviderMode,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  public async getFrames(lat: number, lon: number): Promise<{
    frames: RadarFrame[];
    coverage: 'available' | 'none' | 'unknown';
  }> {
    if (this.mode === 'mock') return { frames: [], coverage: 'unknown' };
    const metadata = await this.getMetadata();
    if (!metadata) {
      if (this.mode === 'cache' && this.metadataCache) {
        return { frames: this.metadataCache.value.radar.past, coverage: 'unknown' };
      }
      return { frames: [], coverage: 'unknown' };
    }
    const coverage = await this.checkCoverage(lat, lon);
    return { frames: metadata.radar.past, coverage };
  }

  public async getTile(coords: TileCoordinates, frameTime: number): Promise<Buffer | null> {
    if (this.mode === 'mock' || coords.z > this.maxZoom) return null;
    const metadata = await this.getMetadata();
    const frame = metadata?.radar.past.find((item) => item.time === frameTime);
    if (!metadata || !frame) return null;
    const key = `${frameTime}:${coords.z}:${coords.x}:${coords.y}`;
    const cached = this.tileCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (this.mode === 'cache') return null;
    if (this.breaker.isOpen(this.now())) return null;
    try {
      const url = `${metadata.host}${frame.path}/256/${coords.z}/${coords.x}/${coords.y}/2/0_0.png`;
      const response = await this.fetcher(url, {
        headers: { Accept: 'image/png' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
        this.breaker.failure(this.now());
        return null;
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length) {
        this.breaker.failure(this.now());
        return null;
      }
      this.breaker.success();
      this.tileCache.set(key, { value: body, expiresAt: this.now() + 5 * 60 * 1000 });
      return body;
    } catch (error: unknown) {
      logger.warn({ err: redactSecretsInText(error instanceof Error ? error.message : String(error)) }, 'RainViewer radar request failed');
      this.breaker.failure(this.now());
      return null;
    }
  }

  private async getMetadata(): Promise<z.infer<typeof RainViewerMetadataSchema> | null> {
    if (this.metadataCache && this.metadataCache.expiresAt > this.now()) return this.metadataCache.value;
    if (this.mode === 'cache') return null;
    if (this.breaker.isOpen(this.now())) return null;
    try {
      const response = await this.fetcher('https://api.rainviewer.com/public/weather-maps.json', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`RainViewer metadata returned HTTP ${response.status}`);
      const json: unknown = await response.json();
      const parsed = RainViewerMetadataSchema.safeParse(json);
      if (!parsed.success) throw new Error('RainViewer metadata did not match the documented schema');
      const host = new URL(parsed.data.host);
      if (host.protocol !== 'https:' || host.hostname !== 'tilecache.rainviewer.com') {
        throw new Error('RainViewer returned an unexpected tile host');
      }
      const frames = parsed.data.radar.past.filter((frame) => frame.path.startsWith('/v2/radar/'));
      const value = { ...parsed.data, radar: { past: frames } };
      this.metadataCache = { value, expiresAt: this.now() + 5 * 60 * 1000 };
      this.breaker.success();
      return value;
    } catch (error: unknown) {
      logger.warn({ err: redactSecretsInText(error instanceof Error ? error.message : String(error)) }, 'RainViewer metadata request failed');
      this.breaker.failure(this.now());
      return null;
    }
  }

  private async checkCoverage(lat: number, lon: number): Promise<'available' | 'none' | 'unknown'> {
    const tile = mercatorTile(lat, lon, 7);
    const key = `${tile.x}:${tile.y}:${tile.pixelX}:${tile.pixelY}`;
    const cached = this.coverageCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (this.mode === 'cache' || this.breaker.isOpen(this.now())) return 'unknown';
    try {
      const url = `https://tilecache.rainviewer.com/v2/coverage/0/256/7/${tile.x}/${tile.y}/0/0_0.png`;
      const response = await this.fetcher(url, {
        headers: { Accept: 'image/png' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
        this.breaker.failure(this.now());
        return 'unknown';
      }
      const pixel = pngRgbaAt(Buffer.from(await response.arrayBuffer()), tile.pixelX, tile.pixelY);
      if (!pixel) return 'unknown';
      // RainViewer's coverage mask uses transparent pixels for covered locations and opaque black for gaps.
      const coverage = pixel[3] === 0 ? 'available' : 'none';
      this.coverageCache.set(key, { value: coverage, expiresAt: this.now() + 30 * 60 * 1000 });
      this.breaker.success();
      return coverage;
    } catch (error: unknown) {
      logger.warn({ err: redactSecretsInText(error instanceof Error ? error.message : String(error)) }, 'RainViewer coverage check failed');
      this.breaker.failure(this.now());
      return 'unknown';
    }
  }
}

export class TmdRadarProvider implements RadarProvider {
  public readonly id = 'tmd';
  public readonly mode: ProviderMode;
  public readonly maxZoom = 7;
  public readonly attribution = 'Thai Meteorological Department';
  public readonly attributionUrl = 'https://www.tmd.go.th/';

  constructor(mode: ProviderMode) {
    this.mode = mode;
  }

  public async getFrames(): Promise<{ frames: RadarFrame[]; coverage: 'available' | 'none' | 'unknown' }> {
    return { frames: [], coverage: 'unknown' };
  }

  public async getTile(): Promise<Buffer | null> {
    return null;
  }
}

export class MockRadarProvider implements RadarProvider {
  public readonly id = 'mock';
  public readonly maxZoom = 7;
  public readonly attribution = 'Simulated data';
  public readonly attributionUrl = 'https://github.com/heddylemillion/rain-bomb-dev';
  public readonly mode: ProviderMode = 'mock';

  public async getFrames(): Promise<{ frames: RadarFrame[]; coverage: 'available' | 'none' | 'unknown' }> {
    return { frames: [], coverage: 'unknown' };
  }

  public async getTile(): Promise<Buffer | null> {
    return null;
  }
}

export class MockLightningProvider implements LightningProvider {
  public readonly id = 'mock';
  public readonly mode: ProviderMode = 'mock';
  public readonly attribution = 'Simulated lightning';
  public readonly attributionUrl = 'https://github.com/heddylemillion/rain-bomb-dev';
  public readonly licenceLimits = 'Synthetic demonstration only; never used in live risk inputs.';

  public async getSummary(): Promise<LightningSummary> {
    return {
      count30min: null,
      nearestStrikeKm: null,
      within5km15min: null,
      source: 'Mock lightning provider',
      observedAt: null,
    };
  }
}

export class NoLightningProvider implements LightningProvider {
  public readonly id = 'none';
  public readonly attribution = 'No lightning provider configured';
  public readonly attributionUrl = 'https://github.com/heddylemillion/rain-bomb-dev';
  public readonly licenceLimits = 'No lightning data is requested or included in live risk.';

  constructor(public readonly mode: ProviderMode) {}

  public async getSummary(): Promise<LightningSummary> {
    return {
      count30min: null,
      nearestStrikeKm: null,
      within5km15min: null,
      source: 'No lightning provider configured',
      observedAt: null,
    };
  }
}
const GdacsEventCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
    properties: z.object({
      eventtype: z.string().optional(),
      eventid: z.number(),
      episodeid: z.number(),
      eventname: z.string().optional(),
      todate: z.string().optional(),
      iscurrent: z.union([z.string(), z.boolean()]).optional(),
    }).passthrough(),
  }).passthrough()),
});
const GdacsGeometryCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
    properties: z.record(z.unknown()),
  }).passthrough()),
});
const GdacsActiveCyclonesSchema = z.array(z.object({
  eventid: z.number(),
  eventName: z.string().nullable().optional(),
  tracksdetails: z.array(z.object({
    latitude: z.number(),
    longitude: z.number(),
  })).nullable().optional(),
}).passthrough());

export class GdacsStormTrackProvider implements StormTrackProvider {
  public readonly id = 'gdacs';
  public readonly attribution = 'GDACS (EC-JRC / UN OCHA)';
  public readonly attributionUrl = 'https://www.gdacs.org/';
  public readonly licenceLimits =
    'GDACS public API; retain GDACS (EC-JRC / UN OCHA) attribution. Data are situational awareness, not an official local warning.';
  private cache: CacheEntry<StormTrackFeatureCollection> | null = null;
  private readonly breaker = new CircuitBreaker(4, 60_000);

  constructor(
    public readonly mode: ProviderMode,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  public async getTracks(): Promise<StormTrackFeatureCollection> {
    if (this.mode === 'mock') return { type: 'FeatureCollection', features: [] };
    if (this.cache && this.cache.expiresAt > this.now()) return this.cache.value;
    if (this.mode === 'cache' || this.breaker.isOpen(this.now())) {
      return this.cache?.value ?? { type: 'FeatureCollection', features: [] };
    }
    try {
      const [activeRaw, eventsRaw] = await Promise.all([
        this.fetchJson('https://www.gdacs.org/gdacsapi/api/Cyclonesurge/gettcactive4de'),
        this.fetchJson('https://www.gdacs.org/gdacsapi/api/Events/geteventlist/map?eventtype=TC'),
      ]);
      const active = GdacsActiveCyclonesSchema.parse(activeRaw);
      const events = GdacsEventCollectionSchema.parse(eventsRaw);
      const activeIds = new Set(active.map((cyclone) => cyclone.eventid));
      const eventFeatures = events.features.filter((feature) =>
        activeIds.has(feature.properties.eventid) &&
        String(feature.properties.iscurrent ?? '').toLowerCase() === 'true'
      );
      const now = this.now();
      const tracks = await Promise.all(eventFeatures.slice(0, 12).map(async (event) => {
        const url = new URL('https://www.gdacs.org/gdacsapi/api/Polygons/getgeometry');
        url.searchParams.set('eventtype', 'TC');
        url.searchParams.set('eventid', String(event.properties.eventid));
        url.searchParams.set('episodeid', String(event.properties.episodeid));
        const collection = GdacsGeometryCollectionSchema.parse(await this.fetchJson(url.toString()));
        return collection.features.filter((feature) => {
          const label = String(feature.properties['polygonlabel'] ?? '').toLowerCase();
          return feature.geometry.type === 'LineString' ||
            (feature.geometry.type === 'Polygon' && label.includes('uncertainty cone'));
        });
      }));
      const features = tracks.flat().map((feature) => ({
        type: 'Feature' as const,
        geometry: feature.geometry,
        properties: feature.properties,
      }));
      const result = StormTrackFeatureCollectionSchema.parse({
        type: 'FeatureCollection',
        features,
      });
      this.cache = { value: result, expiresAt: now + 30 * 60 * 1000 };
      this.breaker.success();
      return result;
    } catch (error: unknown) {
      logger.warn({ err: redactSecretsInText(error instanceof Error ? error.message : String(error)) }, 'GDACS storm track request failed');
      this.breaker.failure(this.now());
      if (this.cache) return this.cache.value;
      throw new Error('GDACS tropical cyclone data are unavailable', { cause: error });
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GDACS returned HTTP ${response.status}`);
    return response.json();
  }
}

export class MockStormTrackProvider implements StormTrackProvider {
  public readonly id = 'mock';
  public readonly mode: ProviderMode = 'mock';
  public readonly attribution = 'Simulated storm tracks';
  public readonly attributionUrl = 'https://github.com/heddylemillion/rain-bomb-dev';
  public readonly licenceLimits = 'Synthetic demonstration only; not observed storm data.';

  public async getTracks(): Promise<StormTrackFeatureCollection> {
    return { type: 'FeatureCollection', features: [] };
  }
}
