import { Router, type Request, type Response } from 'express';
import NodeCache from 'node-cache';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { WeatherCacheStore } from '../cache/cacheStore.js';
import { logger, redactSecretsInText } from '../logger.js';
import { DECISION_SUPPORT_DISCLAIMER_TH } from '../normalizers/weatherNormalizer.js';
import {
  checkXweatherCapabilities,
  getErrorCapabilities,
} from '../services/capabilityService.js';
import { findCommunityById, loadCommunities } from '../services/communityService.js';
import type { XweatherClient } from '../services/xweatherClient.js';
import { RiskDataService } from '../services/riskDataService.js';
import type { WeatherService } from '../services/weatherService.js';
import { XweatherClientError } from '../services/xweatherClient.js';
import type { CapabilitiesResponse } from '../../shared/contracts.js';
import { CAPABILITY_IDS } from '../../shared/contracts.js';
import type { MockScenarioName } from '../../shared/mockWeatherScenario.js';
import {
  RasterTileLayerSchema,
  RadarOffsetSchema,
  TileCoordinateSchema,
} from '../services/overlayLayers.js';
import type { CommunityWeatherBundle } from '../types/weather.js';
import type { GeocodingProvider } from '../services/geocodingProvider.js';
import type { EnvironmentDataService, DataMode } from '../services/environmentDataService.js';

const CommunityIdParamSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/i, 'Invalid communityId format');

export interface ApiRouterDeps {
  weatherService: WeatherService;
  xweatherClient: XweatherClient;
  cacheStore: WeatherCacheStore<CommunityWeatherBundle>;
  hasXweatherCredentials: boolean;
  riskDataService: RiskDataService;
  demoMode: boolean;
  dataMode: DataMode;
  environmentDataService: EnvironmentDataService;
  geocodingProvider: GeocodingProvider;
}

export const PointQuerySchema = z.object({
  lat: z.coerce.number().finite().min(5.5).max(20.5),
  lon: z.coerce.number().finite().min(97).max(106),
});

export const RiskQuerySchema = PointQuerySchema.extend({
  scenario: z.enum(['calm', 'moderate', 'burst']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  offsetMin: z.coerce.number().int().min(-180).max(180).multipleOf(10).optional(),
});

export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
  lang: z.enum(['th', 'en']).default('th'),
});

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();
  const rasterCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });
  const transparentTile = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  let capabilityCache: { response: CapabilitiesResponse; expiresAt: number } | null = null;
  let capabilityRequest: Promise<CapabilitiesResponse> | null = null;

  const loadCapabilities = async (): Promise<CapabilitiesResponse> => {
    if (capabilityCache && capabilityCache.expiresAt > Date.now()) return capabilityCache.response;
    if (capabilityRequest) return capabilityRequest;
    const request = (async () => {
      if (deps.dataMode === 'mock') {
        const checkedAt = new Date().toISOString();
        const mockIds = new Set(['risk-summary', 'radar-layer', 'lightning', 'tropical-cyclones']);
        return {
          capabilities: CAPABILITY_IDS.map((id) => ({
            id,
            available: mockIds.has(id),
            reason: mockIds.has(id) ? 'mock' as const : 'error' as const,
            ...(mockIds.has(id) ? { mock: true } : {}),
            checkedAt,
          })),
          checkedAt,
          isMock: true,
          demoMode: deps.demoMode,
        };
      }
      if (!deps.xweatherClient.hasCredentials()) {
        return getErrorCapabilities(new Date().toISOString(), deps.demoMode);
      }
      try {
        const [configuredPoint] = await loadCommunities();
        const probePoint = configuredPoint ?? {
          id: 'thailand-probe',
          name_th: 'ตำแหน่งตรวจสอบพื้นที่',
          name_en: 'Coverage probe point',
          lat: 14.06,
          lon: 100.62,
        };
        return await checkXweatherCapabilities(deps.xweatherClient, probePoint, deps.demoMode);
      } catch (error: unknown) {
        const safeMessage = redactSecretsInText(
          error instanceof Error ? error.message : String(error)
        );
        logger.error({ err: safeMessage }, 'Failed to check API capabilities');
        return getErrorCapabilities(new Date().toISOString(), deps.demoMode);
      }
    })();
    capabilityRequest = request;
    try {
      const response = await request;
      capabilityCache = { response, expiresAt: Date.now() + 5 * 60 * 1000 };
      return response;
    } finally {
      if (capabilityRequest === request) capabilityRequest = null;
    }
  };

  router.get('/runtime-config', (_req: Request, res: Response) => {
    res.status(200).json({ demoMode: deps.demoMode, dataMode: deps.dataMode });
  });

  router.get('/environment', async (req: Request, res: Response) => {
    const parsedPoint = PointQuerySchema.safeParse(req.query);
    const parsedCommunity = z.string().max(80).optional().safeParse(req.query['communityId']);
    if (!parsedPoint.success || !parsedCommunity.success) {
      res.status(400).json({
        error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' },
      });
      return;
    }
    try {
      const result = await deps.environmentDataService.getAreaEnvironment(
        parsedPoint.data.lat,
        parsedPoint.data.lon,
        parsedCommunity.data
      );
      res.status(200).json(result);
    } catch (error: unknown) {
      const safeMessage = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.error({ error: safeMessage }, 'Failed to load area elevation and marine context');
      res.status(503).json({
        error: { code: 'ENVIRONMENT_UNAVAILABLE', messageTh: 'โหลดข้อมูลความสูงและพยากรณ์ระดับน้ำทะเลไม่สำเร็จ' },
      });
    }
  });

  router.get('/geocode', async (req: Request, res: Response) => {
    const parsed = GeocodeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', messageTh: 'กรุณาค้นหาด้วยคำอย่างน้อย 3 ตัวอักษร' } });
      return;
    }
    if (deps.dataMode === 'mock') {
      try {
        const query = parsed.data.q.toLocaleLowerCase(parsed.data.lang === 'th' ? 'th-TH' : 'en');
        const communities = await loadCommunities();
        const results = communities
          .filter((community) =>
            community.name_th.toLocaleLowerCase('th-TH').includes(query) ||
            community.name_en.toLocaleLowerCase('en').includes(query)
          )
          .slice(0, 5)
          .map((community) => ({
            lat: community.lat,
            lon: community.lon,
            name: parsed.data.lang === 'th' ? community.name_th : community.name_en,
            district: '',
            province: '',
            displayName: parsed.data.lang === 'th' ? community.name_th : community.name_en,
          }));
        res.status(200).json({ results });
      } catch (error: unknown) {
        const safeMessage = redactSecretsInText(error instanceof Error ? error.message : String(error));
        logger.error({ error: safeMessage }, 'Failed to load local mock search candidates');
        res.status(500).json({ error: { code: 'COMMUNITIES_CONFIG_ERROR', messageTh: 'โหลดรายการค้นหาในโหมดสาธิตไม่สำเร็จ' } });
      }
      return;
    }
    try {
      const results = await deps.geocodingProvider.search(parsed.data.q, parsed.data.lang);
      res.status(200).json({ results });
    } catch {
      res.status(502).json({ error: { code: 'GEOCODING_UNAVAILABLE', messageTh: 'ค้นหาตำแหน่งไม่สำเร็จ กรุณาลองอีกครั้ง' } });
    }
  });

  router.get('/reverse-geocode', async (req: Request, res: Response) => {
    const parsed = PointQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    if (deps.dataMode === 'mock') {
      res.status(200).json({ result: null });
      return;
    }
    try {
      const result = await deps.geocodingProvider.reverse(parsed.data.lat, parsed.data.lon, 'th');
      res.status(200).json({ result });
    } catch {
      res.status(502).json({ error: { code: 'GEOCODING_UNAVAILABLE', messageTh: 'ค้นหาชื่อตำแหน่งไม่สำเร็จ' } });
    }
  });

  router.get('/risk', async (req: Request, res: Response) => {
    const parsed = RiskQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    const lat = deps.dataMode === 'mock' ? parsed.data.lat : Number(parsed.data.lat.toFixed(2));
    const lon = deps.dataMode === 'mock' ? parsed.data.lon : Number(parsed.data.lon.toFixed(2));
    try {
      const result = await deps.riskDataService.getPointRisk(lat, lon, {
        scenario: parsed.data.scenario as MockScenarioName | undefined,
        date: parsed.data.date,
        offsetMin: parsed.data.offsetMin,
      });
      res.status(200).json(result);
    } catch (error: unknown) {
      const safeMessage = redactSecretsInText(error instanceof Error ? error.message : String(error));
      logger.error({ error: safeMessage }, 'Failed to calculate point risk');
      res.status(503).json({ error: { code: 'RISK_UNAVAILABLE', messageTh: 'คำนวณข้อมูลความเสี่ยงไม่สำเร็จ กรุณาลองอีกครั้ง' } });
    }
  });

  /** GET /api/capabilities reports provider access separately from verified geographic coverage. */
  router.get('/capabilities', async (_req: Request, res: Response) => {
    res.status(200).json(await loadCapabilities());
  });

  router.get('/map/tiles/:z/:x/:y.png', async (req: Request, res: Response) => {
    const zValue = Number(req.params['z']);
    const xValue = Number(req.params['x']);
    const yValue = Number(req.params['y']);
    if (
      !Number.isInteger(zValue) ||
      !Number.isInteger(xValue) ||
      !Number.isInteger(yValue) ||
      zValue < 0 ||
      zValue > 19 ||
      xValue < 0 ||
      yValue < 0 ||
      xValue >= 2 ** zValue ||
      yValue >= 2 ** zValue
    ) {
      res.status(400).json({
        error: { code: 'INVALID_TILE', messageTh: 'พิกัดแผนที่ไม่ถูกต้อง' },
      });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const tileResponse = await fetch(
        `https://tile.openstreetmap.org/${zValue}/${xValue}/${yValue}.png`,
        {
          headers: {
            Accept: 'image/png',
            'User-Agent': 'RainBurstEarlyWarning/0.1 (community weather dashboard)',
          },
          signal: controller.signal,
        }
      );
      if (!tileResponse.ok) {
        logger.warn({ statusCode: tileResponse.status }, 'OpenStreetMap tile request failed');
        res.status(502).json({
          error: { code: 'MAP_TILE_UNAVAILABLE', messageTh: 'โหลดแผนที่ไม่สำเร็จ' },
        });
        return;
      }
      const contentType = tileResponse.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (!contentType?.startsWith('image/')) {
        logger.warn({ contentType }, 'OpenStreetMap returned a non-image tile');
        res.status(502).json({
          error: { code: 'MAP_TILE_UNAVAILABLE', messageTh: 'โหลดแผนที่ไม่สำเร็จ' },
        });
        return;
      }
      res
        .status(200)
        .set('Content-Type', contentType)
        .set('Cache-Control', 'public, max-age=3600')
        .set('X-Content-Type-Options', 'nosniff')
        .send(Buffer.from(await tileResponse.arrayBuffer()));
    } catch (error: unknown) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'OpenStreetMap tile proxy failed'
      );
      res.status(502).json({
        error: { code: 'MAP_TILE_UNAVAILABLE', messageTh: 'โหลดแผนที่ไม่สำเร็จ' },
      });
    } finally {
      clearTimeout(timer);
    }
  });

  router.get('/tiles/:layer/:z/:x/:y/:offset.png', async (req: Request, res: Response) => {
    const parsedLayer = RasterTileLayerSchema.safeParse(req.params['layer']);
    const parsedOffset = RadarOffsetSchema.safeParse(req.params['offset']);
    const coordinates = TileCoordinateSchema.safeParse({
      z: req.params['z'],
      x: req.params['x'],
      y: req.params['y'],
    });
    if (!parsedLayer.success || !parsedOffset.success || !coordinates.success) {
      res.status(400).json({ error: { code: 'INVALID_TILE', messageTh: 'พิกัดหรือชั้นแผนที่ไม่ถูกต้อง' } });
      return;
    }
    const { z, x, y } = coordinates.data;
    if (x >= 2 ** z || y >= 2 ** z) {
      res.status(400).json({ error: { code: 'INVALID_TILE', messageTh: 'พิกัดแผนที่ไม่ถูกต้อง' } });
      return;
    }
    if (deps.dataMode === 'mock') {
      res.status(200)
        .set('Content-Type', 'image/png')
        .set('Cache-Control', 'public, max-age=300')
        .set('X-Content-Type-Options', 'nosniff')
        .send(transparentTile);
      return;
    }
    if (!deps.xweatherClient.hasCredentials()) {
      res.status(503).json({ error: { code: 'TILE_SOURCE_UNAVAILABLE', reason: 'error' } });
      return;
    }

    const layer = parsedLayer.data;
    const offset = parsedOffset.data;
    const cacheKey = `${layer}:${z}:${x}:${y}:${offset}`;
    const cached = rasterCache.get<{ body: Buffer; contentType: string }>(cacheKey);
    if (cached) {
      res.status(200)
        .set('Content-Type', cached.contentType)
        .set('Cache-Control', `public, max-age=${layer === 'tropical-cyclones' ? 1800 : 300}`)
        .set('X-Content-Type-Options', 'nosniff')
        .send(cached.body);
      return;
    }

    const tile = await deps.xweatherClient.fetchRasterTile({ layer, z, x, y, offset });
    if (!tile.ok) {
      const status = tile.status === 401 || tile.status === 403 ? 403 :
        tile.status === 404 ? 404 : 502;
      const reason = status === 403 ? 'no_plan' : status === 404 ? 'no_coverage' : 'error';
      logger.warn({ layer, status, reason }, 'Xweather tile unavailable');
      res.status(status).json({ error: { code: 'TILE_SOURCE_UNAVAILABLE', reason } });
      return;
    }

    const maxAge = layer === 'tropical-cyclones' ? 1800 : 300;
    res.status(200)
      .set('Content-Type', tile.contentType)
      .set('Cache-Control', `public, max-age=${maxAge}`)
      .set('X-Content-Type-Options', 'nosniff');
    try {
      const chunks: Buffer[] = [];
      const bodyStream = tile.body;
      const stream = Readable.from((async function* () {
        const reader = bodyStream.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) return;
            const bytes = Buffer.from(chunk.value);
            chunks.push(bytes);
            yield bytes;
          }
        } finally {
          reader.releaseLock();
        }
      })());
      stream.on('end', () => rasterCache.set(cacheKey, {
        body: Buffer.concat(chunks),
        contentType: tile.contentType,
      }, maxAge));
      await pipeline(stream, res);
    } catch (error: unknown) {
      logger.warn({ layer, errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Xweather tile streaming failed');
      if (!res.headersSent) res.status(502).json({ error: { code: 'TILE_SOURCE_UNAVAILABLE', reason: 'error' } });
      else res.destroy();
    }
  });

  /**
   * GET /api/health
   * ตรวจสอบสถานะเซิร์ฟเวอร์, สถานะการตั้งค่า Xweather, และสถิติ cache
   */
  router.get('/health', (_req: Request, res: Response) => {
    const cacheStats = deps.cacheStore.stats();
    res.status(200).json({
      status: 'ok',
      service: 'rain-bomb-api',
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Bangkok',
      xweatherConfigured: deps.hasXweatherCredentials,
      demoMode: deps.demoMode,
      dataMode: deps.dataMode,
      cache: cacheStats,
      disclaimerTh: DECISION_SUPPORT_DISCLAIMER_TH,
    });
  });

  router.get('/risk/:communityId', async (req: Request, res: Response) => {
    const parsedParam = CommunityIdParamSchema.safeParse(req.params['communityId']);
    if (!parsedParam.success) {
      res.status(400).json({
        error: { code: 'INVALID_COMMUNITY_ID', messageTh: 'รหัสชุมชนไม่ถูกต้อง' },
      });
      return;
    }

    try {
      const community = await findCommunityById(parsedParam.data);
      if (!community) {
        res.status(404).json({
          error: { code: 'COMMUNITY_NOT_FOUND', messageTh: 'ไม่พบข้อมูลชุมชน' },
        });
        return;
      }

      const result = await deps.riskDataService.getPointRisk(community.lat, community.lon);
      res.status(200).json({ ...result, communityId: community.id });
    } catch (error: unknown) {
      const safeMessage = redactSecretsInText(
        error instanceof Error ? error.message : String(error)
      );
      logger.error({ communityId: parsedParam.data, err: safeMessage }, 'Failed to load risk data');
      res.status(500).json({
        error: { code: 'RISK_RESULT_ERROR', messageTh: 'โหลดข้อมูลความเสี่ยงไม่สำเร็จ' },
      });
    }
  });

  /**
   * GET /api/communities
   * คืนค่ารายชื่อชุมชนนำร่องทั้งหมดจาก config/communities.json
   */
  router.get('/communities', async (_req: Request, res: Response) => {
    try {
      const communities = await loadCommunities();
      res.status(200).json({
        communities,
        count: communities.length,
        disclaimerTh: DECISION_SUPPORT_DISCLAIMER_TH,
      });
    } catch (err: unknown) {
      const message = redactSecretsInText(err instanceof Error ? err.message : String(err));
      logger.error({ err: message }, 'Failed to load communities config');
      res.status(500).json({
        error: {
          code: 'COMMUNITIES_CONFIG_ERROR',
          messageTh: 'ไม่สามารถโหลดข้อมูลรายชื่อชุมชนได้ในขณะนี้',
          detail: message,
        },
      });
    }
  });

  /**
   * GET /api/weather/:communityId
   * คืนค่าสภาพอากาศปัจจุบัน พยากรณ์รายชั่วโมง (24 ชม.) และรายวัน (3 วัน) ที่แปลงเป็นรูปแบบมาตรฐานแล้ว
   */
  router.get('/weather/:communityId', async (req: Request, res: Response) => {
    const parsedParam = CommunityIdParamSchema.safeParse(req.params['communityId']);
    if (!parsedParam.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_COMMUNITY_ID',
          messageTh: 'รหัสชุมชนไม่ถูกต้อง',
        },
      });
      return;
    }

    const communityId = parsedParam.data;
    if (deps.dataMode === 'mock') {
      res.status(503).json({
        error: {
          code: 'MOCK_WEATHER_UNAVAILABLE',
          messageTh: 'ข้อมูลพยากรณ์รายชั่วโมงของหน้านี้ยังไม่มีในโหมดสาธิต ใช้ข้อมูลจำลองในแผนที่ได้',
        },
      });
      return;
    }
    const community = await findCommunityById(communityId);
    if (!community) {
      res.status(404).json({
        error: {
          code: 'COMMUNITY_NOT_FOUND',
          messageTh: `ไม่พบข้อมูลชุมชนรหัส "${communityId}"`,
        },
      });
      return;
    }

    try {
      const bundle = await deps.weatherService.getCommunityWeather(community);
      res.status(200).json(bundle);
    } catch (err: unknown) {
      if (err instanceof XweatherClientError) {
        const status = err.kind === 'AUTH_OR_NAMESPACE' ? 502 : 503;
        const messageTh =
          err.kind === 'AUTH_OR_NAMESPACE'
            ? 'ระบบไม่สามารถยืนยันสิทธิ์กับ Xweather API ได้ (กรุณาตรวจสอบ Client ID, Client Secret หรือ Namespace)'
            : 'ไม่สามารถเชื่อมต่อระบบข้อมูลสภาพอากาศ Xweather ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';

        res.status(status).json({
          error: {
            code: `XWEATHER_${err.kind}`,
            messageTh,
            detail: err.message,
          },
        });
        return;
      }

      const safeMessage = redactSecretsInText(err instanceof Error ? err.message : String(err));
      logger.error({ communityId, err: safeMessage }, 'Unexpected error in GET /api/weather/:communityId');
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          messageTh: 'เกิดข้อผิดพลาดภายในระบบในการดึงข้อมูลสภาพอากาศ',
          detail: safeMessage,
        },
      });
    }
  });

  return router;
}
