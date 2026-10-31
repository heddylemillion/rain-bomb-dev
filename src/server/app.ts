import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { InMemoryWeatherCache, type WeatherCacheStore } from './cache/cacheStore.js';
import { appConfig, type AppConfig } from './config.js';
import { logger, redactSecretsInText } from './logger.js';
import { createApiRouter } from './routes/api.js';
import { WeatherService } from './services/weatherService.js';
import { NominatimGeocodingProvider } from './services/geocodingProvider.js';
import type { GeocodingProvider } from './services/geocodingProvider.js';
import { XweatherClient } from './services/xweatherClient.js';
import type { CommunityWeatherBundle } from './types/weather.js';
import { RiskDataService } from './services/riskDataService.js';
import { EnvironmentDataService } from './services/environmentDataService.js';

export interface CreateAppOptions {
  config?: AppConfig;
  xweatherClient?: XweatherClient;
  cacheStore?: WeatherCacheStore<CommunityWeatherBundle>;
  weatherService?: WeatherService;
  geocodingProvider?: GeocodingProvider;
  environmentDataService?: EnvironmentDataService;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const cfg = options.config ?? appConfig;

  const cacheStore =
    options.cacheStore ?? new InMemoryWeatherCache<CommunityWeatherBundle>(cfg.cacheTtlSeconds);

  const xweatherClient =
    options.xweatherClient ??
    new XweatherClient({
      baseUrl: cfg.xweather.baseUrl,
      clientId: cfg.xweather.clientId,
      clientSecret: cfg.xweather.clientSecret,
      namespace: cfg.xweather.namespace,
      timeoutMs: cfg.xweather.timeoutMs,
    });

  const weatherService =
    options.weatherService ??
    new WeatherService({
      xweatherClient,
      cacheStore,
    });

  const app = express();

  // Security headers
  app.use(helmet());

  // CORS allow-list
  app.use(
    cors({
      origin(requestOrigin, callback) {
        // อนุญาต request ที่ไม่มี Origin header (เช่น curl, server-to-server, mobile webview บางชนิด)
        if (!requestOrigin) {
          callback(null, true);
          return;
        }
        if (cfg.corsAllowedOrigins.includes(requestOrigin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      optionsSuccessStatus: 204,
    })
  );

  app.use(express.json({ limit: '100kb' }));

  // Rate limiting สำหรับ /api/*
  // Map tiles are many small requests per view, so they get their own (higher) limit
  // instead of exhausting the shared data-API budget below.
  const mapTileLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 4000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        messageTh: 'คุณเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      },
    },
  });
  app.use('/api/map', mapTileLimiter);
  app.use('/api/tiles', mapTileLimiter);

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 นาที
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/map/') || req.path.startsWith('/tiles/'),
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        messageTh: 'คุณเรียกใช้งานบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      },
    },
  });

  app.use('/api', apiLimiter);

  app.use(
    '/api',
    createApiRouter({
      weatherService,
      xweatherClient,
      cacheStore,
      hasXweatherCredentials: xweatherClient.hasCredentials(),
      riskDataService: new RiskDataService(xweatherClient, cfg.dataMode),
      demoMode: cfg.demoMode,
      dataMode: cfg.dataMode,
      stormConeKmPer30Min: cfg.stormConeKmPer30Min,
      allowGeocodingInMock: cfg.geocoding.allowInMock,
      environmentDataService: options.environmentDataService ?? new EnvironmentDataService({
        mode: cfg.dataMode,
        apiKey: cfg.openMeteo.apiKey,
        commercial: cfg.openMeteo.commercial,
      }),
      geocodingProvider: options.geocodingProvider ?? new NominatimGeocodingProvider({
        baseUrl: cfg.geocoding.baseUrl,
        userAgent: cfg.geocoding.userAgent,
        countryCodes: cfg.geocoding.countryCodes,
      }),
    })
  );

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        messageTh: 'ไม่พบเส้นทาง API ที่ร้องขอ',
      },
    });
  });

  // Global error handler (Ensure secrets are redacted)
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
