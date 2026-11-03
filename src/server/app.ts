import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { appConfig, type AppConfig } from './config.js';
import { logger, redactSecretsInText } from './logger.js';
import { createApiRouter } from './routes/api.js';
import { NominatimGeocodingProvider } from './services/geocodingProvider.js';
import type { GeocodingProvider } from './services/geocodingProvider.js';
import { RiskDataService } from './services/riskDataService.js';
import { EnvironmentDataService } from './services/environmentDataService.js';
import {
  GdacsStormTrackProvider,
  MockLightningProvider,
  MockRadarProvider,
  MockStormTrackProvider,
  NoLightningProvider,
  RainViewerRadarProvider,
  TmdRadarProvider,
} from './services/weatherProviders.js';
import type {
  LightningProvider,
  RadarProvider,
  StormTrackProvider,
} from './services/weatherProviders.js';

export interface CreateAppOptions {
  config?: AppConfig;
  geocodingProvider?: GeocodingProvider;
  environmentDataService?: EnvironmentDataService;
  riskDataService?: RiskDataService;
  radarProvider?: RadarProvider;
  lightningProvider?: LightningProvider;
  stormTrackProvider?: StormTrackProvider;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const cfg = options.config ?? appConfig;
  const radarProvider = options.radarProvider ?? (
    cfg.providers.radar.mode === 'mock'
      ? new MockRadarProvider()
      : cfg.providers.radar.id === 'rainviewer'
        ? new RainViewerRadarProvider(cfg.providers.radar.mode)
        : new TmdRadarProvider(cfg.providers.radar.mode)
  );
  const lightningProvider = options.lightningProvider ?? (
    cfg.providers.lightning.mode === 'mock'
      ? new MockLightningProvider()
      : new NoLightningProvider(cfg.providers.lightning.mode)
  );
  const stormTrackProvider = options.stormTrackProvider ?? (
    cfg.providers.stormTrack.mode === 'mock'
      ? new MockStormTrackProvider()
      : new GdacsStormTrackProvider(cfg.providers.stormTrack.mode)
  );

  const app = express();
  app.use(helmet());
  app.use(cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin || cfg.corsAllowedOrigins.includes(requestOrigin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    optionsSuccessStatus: 204,
  }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/radar', rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        messageTh: 'เรียกข้อมูลเรดาร์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
      },
    },
  }));

  app.use('/api', rateLimit({
    windowMs: 15 * 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/radar/'),
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        messageTh: 'คุณเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      },
    },
  }));

  app.use('/api', createApiRouter({
    dataMode: cfg.dataMode,
    stormConeKmPer30Min: cfg.stormConeKmPer30Min,
    environmentDataService: options.environmentDataService ?? new EnvironmentDataService({
      mode: cfg.dataMode,
    }),
    geocodingProvider: options.geocodingProvider ?? new NominatimGeocodingProvider({
      userAgent: cfg.geocoding.userAgent,
      countryCodes: cfg.geocoding.countryCodes,
    }),
    riskDataService: options.riskDataService ?? new RiskDataService(cfg.dataMode, lightningProvider),
    radarProvider,
    lightningProvider,
    stormTrackProvider,
  }));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        messageTh: 'ไม่พบเส้นทาง API ที่ร้องขอ',
      },
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = redactSecretsInText(rawMsg);
    logger.error({ err: safeMsg }, 'Unhandled Express error');
    const isCorsError = safeMsg.includes('not allowed by CORS');
    res.status(isCorsError ? 403 : 500).json({
      error: {
        code: isCorsError ? 'CORS_FORBIDDEN' : 'INTERNAL_ERROR',
        messageTh: isCorsError
          ? 'ไม่อนุญาตให้เข้าถึงจากโดเมนต้นทางนี้'
          : 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
        detail: safeMsg,
      },
    });
  });

  return app;
}
