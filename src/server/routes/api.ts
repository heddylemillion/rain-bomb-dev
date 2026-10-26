import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { WeatherCacheStore } from '../cache/cacheStore.js';
import { logger, redactSecretsInText } from '../logger.js';
import { DECISION_SUPPORT_DISCLAIMER_TH } from '../normalizers/weatherNormalizer.js';
import { findCommunityById, loadCommunities } from '../services/communityService.js';
import type { WeatherService } from '../services/weatherService.js';
import { XweatherClientError } from '../services/xweatherClient.js';
import type { CommunityWeatherBundle } from '../types/weather.js';

const CommunityIdParamSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/i, 'Invalid communityId format');

export interface ApiRouterDeps {
  weatherService: WeatherService;
  cacheStore: WeatherCacheStore<CommunityWeatherBundle>;
  hasXweatherCredentials: boolean;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();

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
