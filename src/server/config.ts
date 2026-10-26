import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const COMMUNITIES_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'communities.json');
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
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173'),
  ALLOW_MOCK_FALLBACK: z
    .string()
    .optional()
    .transform((val) => val !== 'false'),
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
  cacheTtlSeconds: number;
  corsAllowedOrigins: string[];
  allowMockFallback: boolean;
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
    cacheTtlSeconds: parsed.WEATHER_CACHE_TTL_SECONDS,
    corsAllowedOrigins: origins,
    allowMockFallback: parsed.ALLOW_MOCK_FALLBACK,
  };
}

export const appConfig = loadConfig();
