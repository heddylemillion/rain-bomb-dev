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
  const raw = await fs.readFile(path.join(SAMPLES_DIR_PATH, filename), 'utf-8');
  return JSON.parse(raw) as unknown;
}

describe('Xweather normalization, data availability, and caching', () => {
  it('uses saved upstream responses as test fixtures and preserves missing values', async () => {
    const hourlyEnv = XweatherForecastEnvelopeSchema.parse(await loadSampleJson('forecasts-1hr.json'));
    const dailyEnv = XweatherForecastEnvelopeSchema.parse(await loadSampleJson('forecasts-day.json'));
    const obsEnv = XweatherObservationEnvelopeSchema.parse(await loadSampleJson('observations.json'));
    const condEnv = XweatherConditionEnvelopeSchema.parse(await loadSampleJson('conditions.json'));

    const hourly = normalizeHourlyForecast(hourlyEnv);
    expect(hourly.length).toBeGreaterThan(0);
    expect(hourly[0]).toMatchObject({
      dateTimeISO: expect.any(String),
      pop: expect.any(Number),
      precipMM: expect.any(Number),
    });
    expect(normalizeDailyForecast(dailyEnv)).toHaveLength(3);

    const current = normalizeCurrentWeather(condEnv, obsEnv);
    expect(current.rainRateMmPerHr).toBeTypeOf('number');
    expect(current.stationObservation?.stationId).toBe('VTBD');
  });

  it('redacts Xweather credentials from URL and error text', () => {
    const rawUrl =
      'https://data.api.xweather.com/forecasts/14.0647,100.6186?client_id=MY_SECRET_ID_123&client_secret=MY_SECRET_KEY_456';
    const redacted = redactSecretsInText(rawUrl);
    expect(redacted).not.toContain('MY_SECRET_ID_123');
    expect(redacted).not.toContain('MY_SECRET_KEY_456');
    expect(redacted).toContain('client_id=***REDACTED***');
    expect(redacted).toContain('client_secret=***REDACTED***');
  });

  it('returns real capability errors and no seeded communities when credentials are absent', async () => {
    const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }) });
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.demoMode).toBe(false);

    const communities = await request(app).get('/api/communities');
    expect(communities.body.count).toBe(0);

    const capabilities = await request(app).get('/api/capabilities');
    expect(capabilities.status).toBe(200);
    expect(capabilities.body.isMock).toBe(false);
    expect(capabilities.body.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'observations', available: false, reason: 'error' }),
        expect.objectContaining({ id: 'official-alerts', available: false, reason: 'error' }),
      ])
    );
  });

  it('deduplicates fresh weather requests and only serves stale values for 30 minutes', async () => {
    const hourly = XweatherForecastEnvelopeSchema.parse(await loadSampleJson('forecasts-1hr.json'));
    const daily = XweatherForecastEnvelopeSchema.parse(await loadSampleJson('forecasts-day.json'));
    const observations = XweatherObservationEnvelopeSchema.parse(await loadSampleJson('observations.json'));
    const conditions = XweatherConditionEnvelopeSchema.parse(await loadSampleJson('conditions.json'));
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: 'test_id',
      clientSecret: 'test_secret',
    });
    const hourlySpy = vi.spyOn(client, 'fetchHourlyForecast').mockResolvedValue(hourly);
    vi.spyOn(client, 'fetchDailyForecast').mockResolvedValue(daily);
    vi.spyOn(client, 'fetchObservations').mockResolvedValue(observations);
    vi.spyOn(client, 'fetchConditions').mockResolvedValue(conditions);
    const cache = new InMemoryWeatherCache<CommunityWeatherBundle>(300);
    const service = new WeatherService({ xweatherClient: client, cacheStore: cache });
    const community = {
      id: 'test-community',
      name_th: 'ชุมชนทดสอบ',
      name_en: 'Test community',
      lat: 14.0647,
      lon: 100.6186,
    };

    const first = await service.getCommunityWeather(community);
    const second = await service.getCommunityWeather(community);
    expect(first.meta.isMock).toBe(false);
    expect(second.meta.isStale).toBe(false);
    expect(hourlySpy).toHaveBeenCalledTimes(1);

    cache.set('weather:test-community', first, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    hourlySpy.mockRejectedValueOnce(new XweatherClientError({
      message: 'Xweather request timed out',
      kind: 'TIMEOUT',
      redactedUrl: 'https://data.api.xweather.com/forecasts/14.0647,100.6186',
    }));
    const stale = await service.getCommunityWeather(community);
    expect(stale.meta.isStale).toBe(true);
    expect(stale.meta.staleReason).toContain('ข้อมูลล่าสุดยังไม่พร้อม');
  });
});
