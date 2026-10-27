import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { PointQuerySchema, GeocodeQuerySchema } from '../routes/api.js';
import { calculatePointRisk } from '../services/riskService.js';
import type { GeocodingProvider } from '../services/geocodingProvider.js';

describe('location search and arbitrary-point risk', () => {
  it('validates geocoding input and Thailand coordinate bounds', () => {
    expect(GeocodeQuerySchema.safeParse({ q: 'ตลาด', lang: 'th' }).success).toBe(true);
    expect(GeocodeQuerySchema.safeParse({ q: 'ab', lang: 'th' }).success).toBe(false);
    expect(PointQuerySchema.safeParse({ lat: '14.06', lon: '100.62' }).success).toBe(true);
    expect(PointQuerySchema.safeParse({ lat: '40.7', lon: '-74' }).success).toBe(false);
    expect(PointQuerySchema.safeParse({ lat: 'not-a-number', lon: '100' }).success).toBe(false);
  });

  it('uses lower confidence and reports missing local traits for arbitrary points', () => {
    const inputs = { forecastRain: 20, forecastProbability: 70, currentRainRate: null };
    const arbitrary = calculatePointRisk(inputs, false);
    const known = calculatePointRisk(inputs, true);

    expect(arbitrary.confidence).toBe('LOW');
    expect(known.confidence).toBe('MEDIUM');
    expect(arbitrary.unavailableInputs).toContain('soil');
    expect(arbitrary.unavailableInputs).toContain('current-rain-rate');
    expect(known.unavailableInputs).not.toContain('soil');
  });

  it('returns a clear provider error and rejects out-of-country risk requests', async () => {
    const failingProvider: GeocodingProvider = {
      search: async () => { throw new Error('upstream unavailable'); },
      reverse: async () => { throw new Error('upstream unavailable'); },
    };
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', ALLOW_MOCK_FALLBACK: 'false' }),
      geocodingProvider: failingProvider,
    });

    const badPoint = await request(app).get('/api/risk?lat=40.7&lon=-74');
    expect(badPoint.status).toBe(400);

    const failedSearch = await request(app).get('/api/geocode?q=Bangkok');
    expect(failedSearch.status).toBe(502);
    expect(failedSearch.body.error.messageTh).toContain('ค้นหาตำแหน่ง');

    const weatherFailure = await request(app).get('/api/risk?lat=14.06&lon=100.62');
    expect(weatherFailure.status).toBe(503);
    expect(weatherFailure.body.error.code).toContain('XWEATHER_');
  });
});
