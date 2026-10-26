import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { InMemoryWeatherCache } from '../cache/cacheStore.js';
import { SAMPLES_DIR_PATH, loadConfig } from '../config.js';
import { redactSecretsInText } from '../logger.js';
import {
  normalizeCurrentWeather,
  normalizeDailyForecast,
  normalizeHourlyForecast,
} from '../normalizers/weatherNormalizer.js';
import {
  XweatherConditionEnvelopeSchema,
  XweatherForecastEnvelopeSchema,
  XweatherObservationEnvelopeSchema,
} from '../schemas/xweather.schema.js';
import { WeatherService } from '../services/weatherService.js';
import { XweatherClient, XweatherClientError } from '../services/xweatherClient.js';
import type { CommunityWeatherBundle } from '../types/weather.js';

async function loadSampleJson(filename: string): Promise<unknown> {
  const filePath = path.join(SAMPLES_DIR_PATH, filename);
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

describe('Phase 1 — Backend Normalization, Cache, Redaction & API Routes', () => {
  it('validates and normalizes real Phase 0 saved samples (1hr, day, observations, conditions)', async () => {
    const raw1hr = await loadSampleJson('forecasts-1hr.json');
    const rawDay = await loadSampleJson('forecasts-day.json');
    const rawObs = await loadSampleJson('observations.json');
    const rawCond = await loadSampleJson('conditions.json');

    const hourlyEnv = XweatherForecastEnvelopeSchema.parse(raw1hr);
    const dailyEnv = XweatherForecastEnvelopeSchema.parse(rawDay);
    const obsEnv = XweatherObservationEnvelopeSchema.parse(rawObs);
    const condEnv = XweatherConditionEnvelopeSchema.parse(rawCond);

    const hourly = normalizeHourlyForecast(hourlyEnv);
    expect(hourly.length).toBeGreaterThan(0);
    expect(hourly[0]).toMatchObject({
      dateTimeISO: expect.any(String),
      pop: expect.any(Number),
      precipMM: expect.any(Number),
    });

    const daily = normalizeDailyForecast(dailyEnv);
    expect(daily.length).toBe(3);
    expect(daily[0]?.maxTempC).toBeTypeOf('number');
    expect(daily[0]?.precipMM).toBeTypeOf('number');

    const current = normalizeCurrentWeather(condEnv, obsEnv);
    expect(current.rainRateMmPerHr).toBeTypeOf('number');
    expect(current.stationObservation?.stationId).toBe('VTBD');
    expect(current.stationObservation?.distanceKM).toBeCloseTo(16.582, 2);
  });

  it('redacts client_id and client_secret from URLs and error messages', () => {
    const rawUrl =
      'https://data.api.xweather.com/forecasts/14.0647,100.6186?filter=1hr&client_id=MY_SECRET_ID_123&client_secret=MY_SECRET_KEY_456';
    const redacted = redactSecretsInText(rawUrl);

    expect(redacted).not.toContain('MY_SECRET_ID_123');
    expect(redacted).not.toContain('MY_SECRET_KEY_456');
    expect(redacted).toContain('client_id=***REDACTED***');
    expect(redacted).toContain('client_secret=***REDACTED***');
  });

  it('GET /api/health and GET /api/communities return expected shapes', async () => {
    const app = createApp();

    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('ok');
    expect(healthRes.body.timezone).toBe('Asia/Bangkok');

    const commRes = await request(app).get('/api/communities');
    expect(commRes.status).toBe(200);
    expect(commRes.body.count).toBeGreaterThanOrEqual(4);
    expect(commRes.body.communities[0]).toMatchObject({
      id: 'khlong-luang-1',
      calibration_status: 'TO BE CALIBRATED',
    });
  });

  it('GET /api/weather/:communityId caches for 10 min and falls back to stale cache when Xweather fails', async () => {
    const raw1hr = XweatherForecastEnvelopeSchema.parse(await loadSampleJson('forecasts-1hr.json'));
    const rawDay = XweatherForecastEnvelopeSchema.parse(await loadSampleJson('forecasts-day.json'));
    const rawObs = XweatherObservationEnvelopeSchema.parse(await loadSampleJson('observations.json'));
    const rawCond = XweatherConditionEnvelopeSchema.parse(await loadSampleJson('conditions.json'));

    const mockClient = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: 'test_id',
      clientSecret: 'test_secret',
    });

    const spy1hr = vi.spyOn(mockClient, 'fetchHourlyForecast').mockResolvedValue(raw1hr);
    vi.spyOn(mockClient, 'fetchDailyForecast').mockResolvedValue(rawDay);
    vi.spyOn(mockClient, 'fetchObservations').mockResolvedValue(rawObs);
    vi.spyOn(mockClient, 'fetchConditions').mockResolvedValue(rawCond);

    // ใช้ TTL สั้น 1 วินาทีเพื่อทดสอบ stale-while-error fallback
    const cacheStore = new InMemoryWeatherCache<CommunityWeatherBundle>(1);
    const weatherService = new WeatherService({
      xweatherClient: mockClient,
      cacheStore,
      allowMockFallback: false,
    });

    const app = createApp({
      config: loadConfig({
        PORT: '3001',
        NODE_ENV: 'test',
        XWEATHER_CLIENT_ID: 'test_id',
        XWEATHER_CLIENT_SECRET: 'test_secret',
      }),
      xweatherClient: mockClient,
      cacheStore,
      weatherService,
    });

    // ครั้งที่ 1: ดึงสดจาก Xweather (isMock: false, isStale: false)
    const firstRes = await request(app).get('/api/weather/khlong-luang-1');
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.meta.isMock).toBe(false);
    expect(firstRes.body.meta.isStale).toBe(false);
    expect(spy1hr).toHaveBeenCalledTimes(1);

    // ครั้งที่ 2 ทันที: ได้จาก fresh cache โดยไม่เรียก Xweather ซ้ำ
    const secondRes = await request(app).get('/api/weather/khlong-luang-1');
    expect(secondRes.status).toBe(200);
    expect(spy1hr).toHaveBeenCalledTimes(1);

    // รอให้ fresh cache หมดอายุ (1.1 วินาที) แล้วจำลองให้ Xweather ล่ม
    await new Promise((r) => setTimeout(r, 1100));
    spy1hr.mockRejectedValueOnce(
      new XweatherClientError({
        message: 'Xweather request timed out after 8000ms',
        kind: 'TIMEOUT',
        redactedUrl: 'https://data.api.xweather.com/forecasts/14.0647,100.6186',
      })
    );

    const staleRes = await request(app).get('/api/weather/khlong-luang-1');
    expect(staleRes.status).toBe(200);
    expect(staleRes.body.meta.isStale).toBe(true);
    expect(staleRes.body.meta.staleReason).toContain('ไม่สามารถดึงข้อมูลล่าสุดจาก Xweather ได้ชั่วคราว');
  });
});
