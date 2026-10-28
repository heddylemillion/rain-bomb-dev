import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { WeatherCacheStore } from '../cache/cacheStore.js';
import { logger, redactSecretsInText } from '../logger.js';
import { DECISION_SUPPORT_DISCLAIMER_TH } from '../normalizers/weatherNormalizer.js';
import {
  checkXweatherCapabilities,
  getErrorCapabilities,
  getMockCapabilities,
} from '../services/capabilityService.js';
import { findCommunityById, loadCommunities } from '../services/communityService.js';
import type { XweatherClient } from '../services/xweatherClient.js';
import { calculatePointRisk, getMockRiskResult } from '../services/riskService.js';
import type { WeatherService } from '../services/weatherService.js';
import { XweatherClientError } from '../services/xweatherClient.js';
import {
  hoursToXweatherOffset,
  isOverlayLayerId,
  parseOverlayHours,
  XWEATHER_LAYER_CODE,
} from '../services/overlayLayers.js';
import type { CommunityWeatherBundle } from '../types/weather.js';
import type { GeocodingProvider } from '../services/geocodingProvider.js';
import { getSoilLayer, lookupSoil } from '../services/soilService.js';

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
  geocodingProvider: GeocodingProvider;
}

export const PointQuerySchema = z.object({
  lat: z.coerce.number().finite().min(5.5).max(20.5),
  lon: z.coerce.number().finite().min(97).max(106),
});

export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
  lang: z.enum(['th', 'en']).default('th'),
});
const ReverseGeocodeQuerySchema = PointQuerySchema.extend({
  lang: z.enum(['th', 'en']).default('th'),
});

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

  router.get('/soil/layer', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).json(getSoilLayer());
  });

  router.get('/soil', (req: Request, res: Response) => {
    const parsed = PointQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' },
      });
      return;
    }

    res.status(200).json({
      soil: lookupSoil(parsed.data.lat, parsed.data.lon),
      source: 'LDD 1:25,000',
      coverage: 'pathum-thani',
    });
  });

  router.get('/geocode', async (req: Request, res: Response) => {
    const parsed = GeocodeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_QUERY', messageTh: 'กรุณาค้นหาด้วยคำอย่างน้อย 3 ตัวอักษร' } });
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
    const parsed = ReverseGeocodeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    try {
      const result = await deps.geocodingProvider.reverse(parsed.data.lat, parsed.data.lon, parsed.data.lang);
      res.status(200).json({ result });
    } catch {
      res.status(502).json({ error: { code: 'GEOCODING_UNAVAILABLE', messageTh: 'ค้นหาชื่อตำแหน่งไม่สำเร็จ' } });
    }
  });

  router.get('/risk', async (req: Request, res: Response) => {
    const parsed = PointQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_COORDINATES', messageTh: 'พิกัดอยู่นอกประเทศไทยหรือไม่ถูกต้อง' } });
      return;
    }
    const lat = Number(parsed.data.lat.toFixed(2));
    const lon = Number(parsed.data.lon.toFixed(2));
    try {
      const communities = await loadCommunities();
      const matching = communities.find((community) => {
        const distanceKm = Math.hypot(
          (community.lat - lat) * 111,
          (community.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180)
        );
        return distanceKm <= 1;
      });
      const place = matching ?? {
        id: 'selected-point',
        name_th: 'ตำแหน่งที่เลือก',
        name_en: 'Selected location',
        lat,
        lon,
        elevation_m: 0,
        soil_group: 'C' as const,
        drainage_capacity_mm_hr: 50,
        canal_station_id: null,
        calibration_status: 'DEFAULT TRAITS',
      };
      const weatherPlace = {
        ...place,
        id: `point-${lat.toFixed(2)}-${lon.toFixed(2)}`,
        lat,
        lon,
      };
      const weather = await deps.weatherService.getCommunityWeather(weatherPlace);
      const maxRain = weather.hourly.reduce((max, point) => Math.max(max, point.precipMM), 0);
      const maxPop = weather.hourly.reduce((max, point) => Math.max(max, point.pop), 0);
      const evaluated = calculatePointRisk(
        {
          forecastRain: weather.hourly.length > 0 ? maxRain : null,
          forecastProbability: weather.hourly.length > 0 ? maxPop : null,
          currentRainRate: weather.current.rainRateMmPerHr,
        },
        matching !== undefined
      );
      const level = evaluated.level;
      res.status(200).json({
        communityId: matching?.id ?? weatherPlace.id,
        score: evaluated.score,
        level,
        alertType: level === 'HIGH' ? 'URGENT' : level === 'MEDIUM' ? 'ADVANCE' : 'NONE',
        confidence: evaluated.confidence,
        factorIds: evaluated.factorIds,
        inputIds: evaluated.factorIds,
        recommendedActionId: level,
        generatedAt: new Date().toISOString(),
        isMock: weather.meta.isMock,
        calibrationStatus: matching?.calibration_status ?? 'DEFAULT TRAITS',
        inputsUsed: {
          forecastRain: weather.hourly.length > 0 ? maxRain : null,
          forecastProbability: weather.hourly.length > 0 ? maxPop : null,
          currentRainRate: weather.current.rainRateMmPerHr,
          unavailable: evaluated.unavailableInputs,
        },
        usesDefaultTraits: !matching,
        noticeTh: matching ? null : 'ผลนี้คำนวณจากพยากรณ์ฝนเป็นหลัก ยังไม่มีข้อมูลพื้นที่เฉพาะจุด ความแม่นยำจึงต่ำกว่า',
        weather,
      });
    } catch (error: unknown) {
      if (error instanceof XweatherClientError) {
        res.status(503).json({
          error: {
            code: `XWEATHER_${error.kind}`,
            messageTh: 'ดึงข้อมูลพยากรณ์อากาศของตำแหน่งนี้ไม่สำเร็จ',
          },
        });
        return;
      }
      res.status(503).json({ error: { code: 'RISK_UNAVAILABLE', messageTh: 'คำนวณความเสี่ยงของตำแหน่งนี้ไม่สำเร็จ' } });
    }
  });

  /**
   * GET /api/capabilities
   * Probes endpoints at the first configured community; mock statuses are used without credentials.
   */
  router.get('/capabilities', async (_req: Request, res: Response) => {
    if (!deps.xweatherClient.hasCredentials()) {
      res.status(200).json(getMockCapabilities());
      return;
    }

    try {
      const [community] = await loadCommunities();
      if (!community) {
        res.status(200).json(getErrorCapabilities());
        return;
      }
      const capabilities = await checkXweatherCapabilities(deps.xweatherClient, community);
      res.status(200).json(capabilities);
    } catch (error: unknown) {
      const safeMessage = redactSecretsInText(
        error instanceof Error ? error.message : String(error)
      );
      logger.error({ err: safeMessage }, 'Failed to check API capabilities');
      res.status(200).json(getErrorCapabilities());
    }
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
      res
        .status(200)
        .set('Content-Type', 'image/png')
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

  /**
   * GET /api/map/overlay/:layer/:hours/:z/:x/:y.png
   * Proxies Xweather Raster Maps tiles (radar / lightning / storm). Credentials are added here only.
   * Availability is decided by /api/capabilities; this route just fails closed with 404.
   */
  router.get('/map/overlay/:layer/:hours/:z/:x/:y.png', async (req: Request, res: Response) => {
    const layer = String(req.params['layer']);
    const hours = parseOverlayHours(String(req.params['hours']));
    const z = Number(req.params['z']);
    const x = Number(req.params['x']);
    const y = Number(req.params['y']);
    if (
      !isOverlayLayerId(layer) ||
      hours === null ||
      !Number.isInteger(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      z < 0 ||
      z > 12 ||
      x < 0 ||
      y < 0 ||
      x >= 2 ** z ||
      y >= 2 ** z
    ) {
      res.status(400).json({
        error: { code: 'INVALID_TILE', messageTh: 'พิกัดแผนที่ไม่ถูกต้อง' },
      });
      return;
    }

    const tile = await deps.xweatherClient.fetchRasterTile({
      layer: XWEATHER_LAYER_CODE[layer],
      z,
      x,
      y,
      offset: hoursToXweatherOffset(hours),
    });
    if (!tile.ok) {
      res.status(404).json({
        error: { code: 'OVERLAY_TILE_UNAVAILABLE', messageTh: 'ไม่มีข้อมูลชั้นแผนที่นี้' },
      });
      return;
    }
    res
      .status(200)
      .set('Content-Type', tile.contentType)
      .set('Cache-Control', 'public, max-age=120')
      .set('X-Content-Type-Options', 'nosniff')
      .send(tile.body);
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

      const result = await getMockRiskResult(community.id);
      if (!result) {
        res.status(404).json({
          error: { code: 'RISK_RESULT_NOT_FOUND', messageTh: 'ยังไม่มีตัวอย่างคะแนนของชุมชนนี้' },
        });
        return;
      }
      res.status(200).json(result);
    } catch (error: unknown) {
      const safeMessage = redactSecretsInText(
        error instanceof Error ? error.message : String(error)
      );
      logger.error({ communityId: parsedParam.data, err: safeMessage }, 'Failed to load mock risk result');
      res.status(500).json({
        error: { code: 'RISK_RESULT_ERROR', messageTh: 'โหลดตัวอย่างคะแนนไม่สำเร็จ' },
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
        calibrationNoticeTh:
          'ค่าความสูงระดับน้ำทะเล กลุ่มดิน และความสามารถในการระบายน้ำ เป็นค่าเริ่มต้นที่ต้องได้รับการสอบเทียบ (TO BE CALIBRATED)',
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
