import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const COMMUNITIES_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'communities.json');
export const SEA_REFERENCE_POINTS_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'sea-reference-points.json');
export const DATA_DIR_PATH = path.join(ROOT_DIR, 'data');
export const SAMPLES_DIR_PATH = path.join(ROOT_DIR, 'samples');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  XWEATHER_CLIENT_ID: z.string().default(''),
  XWEATHER_CLIENT_SECRET: z.string().default(''),
  XWEATHER_NAMESPACE: z.string().default(''),
  XWEATHER_BASE_URL: z.string().url().default('https://data.api.xweather.com'),
  XWEATHER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  NOMINATIM_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: z.string().trim().min(1).default('RainBomb/0.1.0 (community weather dashboard)'),
  NOMINATIM_COUNTRYCODES: z.string().trim().default('th'),
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  DATA_MODE: z.enum(['live', 'mock', 'cache']).default('mock'),
  OPEN_METEO_API_KEY: z.string().default(''),
  OPEN_METEO_COMMERCIAL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173'),
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
}).superRefine((env, context) => {
  if (env.OPEN_METEO_COMMERCIAL && !env.OPEN_METEO_API_KEY.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OPEN_METEO_API_KEY'],
      message: 'OPEN_METEO_API_KEY is required when OPEN_METEO_COMMERCIAL=true',
    });
  }
});

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  xweather: {
    clientId: string;
    clientSecret: string;
    namespace: string;
    baseUrl: string;
    timeoutMs: number;
  };
  geocoding: {
    baseUrl: string;
    userAgent: string;
    countryCodes: string;
  };
  cacheTtlSeconds: number;
  dataMode: 'live' | 'mock' | 'cache';
  openMeteo: {
    apiKey: string;
    commercial: boolean;
  };
  corsAllowedOrigins: string[];
  demoMode: boolean;
}

export function loadConfig(envInput: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(envInput);
  const origins = parsed.CORS_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.NODE_ENV === 'test' ? 'silent' : parsed.LOG_LEVEL,
    xweather: {
      clientId: parsed.XWEATHER_CLIENT_ID.trim(),
      clientSecret: parsed.XWEATHER_CLIENT_SECRET.trim(),
      namespace: parsed.XWEATHER_NAMESPACE.trim(),
      baseUrl: parsed.XWEATHER_BASE_URL.replace(/\/$/, ''),
      timeoutMs: parsed.XWEATHER_TIMEOUT_MS,
    },
    geocoding: {
      baseUrl: parsed.NOMINATIM_BASE_URL.replace(/\/$/, ''),
      userAgent: parsed.NOMINATIM_USER_AGENT,
      countryCodes: parsed.NOMINATIM_COUNTRYCODES,
    },
    cacheTtlSeconds: parsed.WEATHER_CACHE_TTL_SECONDS,
    dataMode: parsed.DATA_MODE,
    openMeteo: {
      apiKey: parsed.OPEN_METEO_API_KEY.trim(),
      commercial: parsed.OPEN_METEO_COMMERCIAL,
    },
    corsAllowedOrigins: origins,
    demoMode: parsed.DEMO_MODE,
  };
}

export const appConfig = loadConfig();
