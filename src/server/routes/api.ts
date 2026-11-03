import { Router, type Request, type Response } from 'express';
import NodeCache from 'node-cache';
import { z } from 'zod';
import { logger, redactSecretsInText } from '../logger.js';
import { findCommunityById, loadCommunities } from '../services/communityService.js';
import { RiskDataService } from '../services/riskDataService.js';
import { getSoilLayer, lookupSoil } from '../services/soilService.js';
import type { DataMode, EnvironmentDataService } from '../services/environmentDataService.js';
import type { GeocodingProvider } from '../services/geocodingProvider.js';
import type {
  LightningProvider,
  RadarProvider,
  StormTrackProvider,
} from '../services/weatherProviders.js';
import { ProviderStatusResponseSchema } from '../../shared/providerContracts.js';
import type { MockScenarioName } from '../../shared/mockWeatherScenario.js';

const CommunityIdParamSchema = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/i);
export const PointQuerySchema = z.object({
  lat: z.coerce.number().finite().min(5.5).max(20.5),
  lon: z.coerce.number().finite().min(97).max(106),
});
const RiskQuerySchema = PointQuerySchema.extend({
  scenario: z.enum(['calm', 'moderate', 'burst']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  offsetMin: z.coerce.number().int().min(-180).max(180).multipleOf(10).optional(),
});
export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
  lang: z.enum(['th', 'en']).default('th'),
});
const TileCoordinateSchema = z.object({
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().nonnegative(),
  y: z.coerce.number().int().nonnegative(),
});

export interface ApiRouterDeps {
  riskDataService: RiskDataService;
  dataMode: DataMode;
  stormConeKmPer30Min: number;
  environmentDataService: EnvironmentDataService;
  geocodingProvider: GeocodingProvider;
  radarProvider: RadarProvider;
  lightningProvider: LightningProvider;
  stormTrackProvider: StormTrackProvider;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();
  const radarTileCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });
  const requestTimes: Record<'radar' | 'lightning' | 'storm-track', number[]> = {
    radar: [],
    lightning: [],
    'storm-track': [],
  };
  const lastSuccess: Record<'radar' | 'lightning' | 'storm-track', string | null> = {
    radar: null,
    lightning: null,
    'storm-track': null,
  };
  let radarCoverage: 'available' | 'none' | 'unknown' | 'not-tested' = 'not-tested';
  let lightningCoverage: 'available' | 'none' | 'unknown' | 'not-tested' = 'not-tested';
  let stormCoverage: 'available' | 'none' | 'unknown' | 'not-tested' = 'not-tested';

  const recordRequest = (provider: keyof typeof requestTimes): number => {
    const now = Date.now();
    const recent = requestTimes[provider].filter((time) => now - time < 60_000);
    recent.push(now);
    requestTimes[provider] = recent;
    return recent.length;
  };
  const requestCount = (provider: keyof typeof requestTimes): number => {
    const now = Date.now();
    requestTimes[provider] = requestTimes[provider].filter((time) => now - time < 60_000);
    return requestTimes[provider].length;
  };

  router.get('/runtime-config', (_req: Request, res: Response) => {
    res.status(200).json({
      dataMode: deps.dataMode,
      stormConeKmPer30Min: deps.stormConeKmPer30Min,
      radarProvider: { id: deps.radarProvider.id, mode: deps.radarProvider.mode },
      lightningProvider: { id: deps.lightningProvider.id, mode: deps.lightningProvider.mode, display: 'counts-only' },
      stormTrackProvider: { id: deps.stormTrackProvider.id, mode: deps.stormTrackProvider.mode },
    });
  });

  router.get('/providers/status', (_req: Request, res: Response) => {
    res.status(200).json(ProviderStatusResponseSchema.parse({
      providers: [
        {
          id: 'radar',
          provider: deps.radarProvider.id,
          mode: deps.radarProvider.mode,
          coverage: radarCoverage,
          lastSuccess: lastSuccess.radar,
          quotaUsed: requestCount('radar'),
          quotaLimit: 100,
          attribution: deps.radarProvider.attribution,
          attributionUrl: deps.radarProvider.attributionUrl,
          licenceLimits: deps.radarProvider.id === 'rainviewer'
            ? 'Personal/community use only; historical frames, max zoom 7, no nowcast or satellite.'
            : deps.radarProvider.id === 'tmd'
              ? 'Feed and redistribution terms pending written TMD approval.'
              : 'Synthetic demonstration only; not observed radar data.',
        },
        {
          id: 'lightning',
          provider: deps.lightningProvider.id,
          mode: deps.lightningProvider.mode,
          coverage: lightningCoverage,
          lastSuccess: lastSuccess.lightning,
          quotaUsed: requestCount('lightning'),
          quotaLimit: deps.lightningProvider.id === 'none' ? null : 100,
          attribution: deps.lightningProvider.attribution,
          attributionUrl: deps.lightningProvider.attributionUrl,
          licenceLimits: deps.lightningProvider.licenceLimits,
        },
        {
          id: 'storm-track',
          provider: deps.stormTrackProvider.id,
          mode: deps.stormTrackProvider.mode,
          coverage: stormCoverage,
          lastSuccess: lastSuccess['storm-track'],
          quotaUsed: requestCount('storm-track'),
          quotaLimit: null,
          attribution: deps.stormTrackProvider.attribution,
          attributionUrl: deps.stormTrackProvider.attributionUrl,
          licenceLimits: deps.stormTrackProvider.licenceLimits,
        },
      ],
      checkedAt: new Date().toISOString(),
    }));
  });

  router.get('/radar/frames', async (req: Request, res: Response) => {
    const point = PointQuerySchema.safeParse(req.query);
    if (!point.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    try {
      const result = await deps.radarProvider.getFrames(point.data.lat, point.data.lon);
      radarCoverage = result.coverage;
      if (result.coverage === 'available') lastSuccess.radar = new Date().toISOString();
      res.status(200).json({
        ...result,
        noticeTh: result.coverage === 'none' ? 'ไม่มีข้อมูลเรดาร์ในพื้นที่นี้' : null,
        attribution: deps.radarProvider.attribution,
        attributionUrl: deps.radarProvider.attributionUrl,
        maxZoom: deps.radarProvider.maxZoom,
      });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.warn({ err: message }, 'Failed to load radar frames');
      res.status(503).json({ error: { code: 'RADAR_UNAVAILABLE', messageTh: 'โหลดข้อมูลเรดาร์ไม่สำเร็จ' } });
    }
  });

  router.get('/radar/tiles/:z/:x/:y/:time.png', async (req: Request, res: Response) => {
    const coordinates = TileCoordinateSchema.safeParse(req.params);
    const time = z.coerce.number().int().positive().safeParse(req.params['time']);
    if (!coordinates.success || !time.success) {
      res.status(400).json({ error: { code: 'INVALID_TILE', messageTh: 'พิกัดแผนที่ไม่ถูกต้อง' } });
      return;
    }
    const { z: zoom, x, y } = coordinates.data;
    if (zoom > deps.radarProvider.maxZoom || x >= 2 ** zoom || y >= 2 ** zoom) {
      res.status(400).json({ error: { code: 'INVALID_TILE', messageTh: 'พิกัดแผนที่ไม่ถูกต้อง' } });
      return;
    }
    recordRequest('radar');
    const cacheKey = `${deps.radarProvider.id}:${zoom}:${x}:${y}:${time.data}`;
    const cached = radarTileCache.get<Buffer>(cacheKey);
    if (cached) {
      res.status(200).set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=300').send(cached);
      return;
    }
    try {
      const tile = await deps.radarProvider.getTile({ z: zoom, x, y }, time.data);
      if (!tile) {
        res.status(404).json({
          error: {
            code: 'RADAR_TILE_UNAVAILABLE',
            messageTh: radarCoverage === 'none' ? 'ไม่มีข้อมูลเรดาร์ในพื้นที่นี้' : 'ไม่มีภาพเรดาร์สำหรับช่วงเวลานี้',
          },
        });
        return;
      }
      radarTileCache.set(cacheKey, tile, 300);
      lastSuccess.radar = new Date().toISOString();
      res.status(200)
        .set('Content-Type', 'image/png')
        .set('Cache-Control', 'public, max-age=300')
        .set('X-Content-Type-Options', 'nosniff')
        .send(tile);
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.warn({ err: message }, 'Failed to load radar tile');
      res.status(502).json({ error: { code: 'RADAR_TILE_UNAVAILABLE', messageTh: 'โหลดภาพเรดาร์ไม่สำเร็จ' } });
    }
  });

  router.get('/lightning/summary', async (req: Request, res: Response) => {
    const point = PointQuerySchema.safeParse(req.query);
    if (!point.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    recordRequest('lightning');
    try {
      const summary = await deps.lightningProvider.getSummary(point.data.lat, point.data.lon);
      lightningCoverage = summary.count30min === null ? 'none' : 'available';
      if (summary.count30min !== null) lastSuccess.lightning = summary.observedAt;
      res.status(200).set('Cache-Control', 'private, max-age=120').json({
        ...summary,
        display: 'counts-only',
        noticeTh: deps.lightningProvider.id === 'none' ? 'ไม่มีผู้ให้บริการฟ้าผ่า' : null,
      });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.warn({ err: message }, 'Failed to load lightning summary');
      res.status(503).json({ error: { code: 'LIGHTNING_UNAVAILABLE', messageTh: 'โหลดข้อมูลฟ้าผ่าไม่สำเร็จ' } });
    }
  });

  router.get('/storm-tracks', async (_req: Request, res: Response) => {
    recordRequest('storm-track');
    try {
      const tracks = await deps.stormTrackProvider.getTracks();
      stormCoverage = tracks.features.length > 0 ? 'available' : 'none';
      lastSuccess['storm-track'] = new Date().toISOString();
      res.status(200).set('Cache-Control', 'public, max-age=1800').json({
        ...tracks,
        attribution: deps.stormTrackProvider.attribution,
        attributionUrl: deps.stormTrackProvider.attributionUrl,
      });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.warn({ err: message }, 'Failed to load GDACS storm tracks');
      res.status(503).json({ error: { code: 'STORM_TRACKS_UNAVAILABLE', messageTh: 'โหลดเส้นทางพายุไม่สำเร็จ' } });
    }
  });

  router.get('/environment', async (req: Request, res: Response) => {
    const point = PointQuerySchema.safeParse(req.query);
    const communityId = z.string().max(80).optional().safeParse(req.query['communityId']);
    if (!point.success || !communityId.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    try {
      const result = await deps.environmentDataService.getAreaEnvironment(
        point.data.lat,
        point.data.lon,
        communityId.data
      );
      res.status(200).json(result);
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.error({ error: message }, 'Failed to load area elevation and marine context');
      res.status(503).json({ error: { code: 'ENVIRONMENT_UNAVAILABLE', messageTh: 'โหลดข้อมูลความสูงและพยากรณ์ระดับน้ำทะเลไม่สำเร็จ' } });
    }
  });

  router.get('/geocode', async (req: Request, res: Response) => {
    const query = GeocodeQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', messageTh: 'กรุณาค้นหาด้วยคำอย่างน้อย 3 ตัวอักษร' } });
      return;
    }
    if (deps.dataMode === 'mock') {
      try {
        const search = query.data.q.toLocaleLowerCase(query.data.lang === 'th' ? 'th-TH' : 'en');
        const communities = await loadCommunities();
        const results = communities
          .filter((community) =>
            community.name_th.toLocaleLowerCase('th-TH').includes(search) ||
            community.name_en.toLocaleLowerCase('en').includes(search)
          )
          .slice(0, 5)
          .map((community) => ({
            lat: community.lat,
            lon: community.lon,
            name: query.data.lang === 'th' ? community.name_th : community.name_en,
            district: '',
            province: '',
            displayName: query.data.lang === 'th' ? community.name_th : community.name_en,
          }));
        res.status(200).json({ results });
      } catch (error: unknown) {
        const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
        logger.error({ error: message }, 'Failed to load local mock search candidates');
        res.status(500).json({ error: { code: 'COMMUNITIES_CONFIG_ERROR', messageTh: 'โหลดรายการค้นหาในโหมดสาธิตไม่สำเร็จ' } });
      }
      return;
    }
    try {
      res.status(200).json({ results: await deps.geocodingProvider.search(query.data.q, query.data.lang) });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.warn({ error: message }, 'Geocoding request failed');
      res.status(502).json({ error: { code: 'GEOCODING_UNAVAILABLE', messageTh: 'ค้นหาตำแหน่งไม่สำเร็จ กรุณาลองอีกครั้ง' } });
    }
  });

  router.get('/reverse-geocode', async (req: Request, res: Response) => {
    const point = PointQuerySchema.safeParse(req.query);
    if (!point.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    if (deps.dataMode === 'mock') {
      res.status(200).json({ result: null });
      return;
    }
    try {
      res.status(200).json({
        result: await deps.geocodingProvider.reverse(point.data.lat, point.data.lon, 'th'),
      });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.warn({ error: message }, 'Reverse geocoding request failed');
      res.status(502).json({ error: { code: 'GEOCODING_UNAVAILABLE', messageTh: 'ค้นหาชื่อตำแหน่งไม่สำเร็จ' } });
    }
  });

  router.get('/risk', async (req: Request, res: Response) => {
    const query = RiskQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    try {
      const { lat, lon, ...options } = query.data;
      res.status(200).json(await deps.riskDataService.getPointRisk(
        deps.dataMode === 'mock' ? lat : Number(lat.toFixed(2)),
        deps.dataMode === 'mock' ? lon : Number(lon.toFixed(2)),
        { ...options, scenario: options.scenario as MockScenarioName | undefined }
      ));
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.error({ error: message }, 'Failed to calculate point risk');
      res.status(503).json({ error: { code: 'RISK_UNAVAILABLE', messageTh: 'คำนวณข้อมูลความเสี่ยงไม่สำเร็จ กรุณาลองอีกครั้ง' } });
    }
  });

  router.get('/risk/:communityId', async (req: Request, res: Response) => {
    const id = CommunityIdParamSchema.safeParse(req.params['communityId']);
    if (!id.success) {
      res.status(400).json({ error: { code: 'INVALID_COMMUNITY_ID', messageTh: 'รหัสชุมชนไม่ถูกต้อง' } });
      return;
    }
    try {
      const community = await findCommunityById(id.data);
      if (!community) {
        res.status(404).json({ error: { code: 'COMMUNITY_NOT_FOUND', messageTh: 'ไม่พบข้อมูลชุมชน' } });
        return;
      }
      res.status(200).json({ ...(await deps.riskDataService.getPointRisk(community.lat, community.lon)), communityId: community.id });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.error({ communityId: id.data, error: message }, 'Failed to load risk data');
      res.status(500).json({ error: { code: 'RISK_RESULT_ERROR', messageTh: 'โหลดข้อมูลความเสี่ยงไม่สำเร็จ' } });
    }
  });

  router.get('/communities', async (_req: Request, res: Response) => {
    try {
      const communities = await loadCommunities();
      res.status(200).json({ communities, count: communities.length });
    } catch (error: unknown) {
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.error({ err: message }, 'Failed to load communities config');
      res.status(500).json({ error: { code: 'COMMUNITIES_CONFIG_ERROR', messageTh: 'ไม่สามารถโหลดข้อมูลรายชื่อชุมชนได้ในขณะนี้' } });
    }
  });

  router.get('/soil', (req: Request, res: Response) => {
    const point = PointQuerySchema.safeParse(req.query);
    if (!point.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    res.status(200).json({ soil: lookupSoil(point.data.lat, point.data.lon), source: 'LDD 1:25,000', coverage: 'pathum-thani' });
  });

  router.get('/soil/layer', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).json(getSoilLayer());
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'rain-bomb-api',
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Bangkok',
      dataMode: deps.dataMode,
    });
  });

  return router;
}
