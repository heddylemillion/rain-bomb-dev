import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import type { ProviderMode } from '../shared/providerContracts.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const COMMUNITIES_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'communities.json');
export const SEA_REFERENCE_POINTS_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'sea-reference-points.json');
export const STORM_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'storm.json');
export const DATA_DIR_PATH = path.join(ROOT_DIR, 'data');
export const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NOMINATIM_USER_AGENT: z.string().trim().min(1).default('RainBomb/0.1.0 (community weather dashboard)'),
  NOMINATIM_COUNTRYCODES: z.string().trim().default('th'),
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  DATA_MODE: z.enum(['live', 'mock', 'cache']).default('mock'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173'),
  STORM_CONE_KM_PER_30MIN: z.coerce.number().nonnegative().default(2.5),
  RADAR_PROVIDER: z.enum(['rainviewer', 'tmd']).default('rainviewer'),
  RADAR_MODE: z.enum(['live', 'mock', 'cache']).optional(),
  LIGHTNING_PROVIDER: z.literal('none').default('none'),
  LIGHTNING_MODE: z.enum(['live', 'mock', 'cache']).optional(),
  STORM_TRACK_PROVIDER: z.literal('gdacs').default('gdacs'),
  STORM_TRACK_MODE: z.enum(['live', 'mock', 'cache']).optional(),
});

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  geocoding: {
    baseUrl: string;
    userAgent: string;
    countryCodes: string;
  };
  cacheTtlSeconds: number;
  dataMode: ProviderMode;
  corsAllowedOrigins: string[];
  stormConeKmPer30Min: number;
  providers: {
    radar: { id: 'rainviewer' | 'tmd'; mode: ProviderMode };
    lightning: { id: 'none'; mode: ProviderMode };
    stormTrack: { id: 'gdacs'; mode: ProviderMode };
  };
}

export function loadConfig(envInput: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(envInput);
  const origins = parsed.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.NODE_ENV === 'test' ? 'silent' : parsed.LOG_LEVEL,
    geocoding: {
      baseUrl: NOMINATIM_BASE_URL,
      userAgent: parsed.NOMINATIM_USER_AGENT,
      countryCodes: parsed.NOMINATIM_COUNTRYCODES,
    },
    cacheTtlSeconds: parsed.WEATHER_CACHE_TTL_SECONDS,
    dataMode: parsed.DATA_MODE,
    corsAllowedOrigins: origins,
    stormConeKmPer30Min: parsed.STORM_CONE_KM_PER_30MIN,
    providers: {
      radar: {
        id: parsed.RADAR_PROVIDER,
        mode: parsed.RADAR_MODE ?? parsed.DATA_MODE,
      },
      lightning: {
        id: parsed.LIGHTNING_PROVIDER,
        mode: parsed.LIGHTNING_MODE ?? parsed.DATA_MODE,
      },
      stormTrack: {
        id: parsed.STORM_TRACK_PROVIDER,
        mode: parsed.STORM_TRACK_MODE ?? parsed.DATA_MODE,
      },
    },
  };
}

export const appConfig = loadConfig();
