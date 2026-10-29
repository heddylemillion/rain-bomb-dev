import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { PointQuerySchema, GeocodeQuerySchema } from '../routes/api.js';
import type { GeocodingProvider } from '../services/geocodingProvider.js';

describe('location search and arbitrary-point risk', () => {
  it('validates geocoding input and Thailand coordinate bounds', () => {
    expect(GeocodeQuerySchema.safeParse({ q: 'ตลาด', lang: 'th' }).success).toBe(true);
    expect(GeocodeQuerySchema.safeParse({ q: 'ab', lang: 'th' }).success).toBe(false);
    expect(PointQuerySchema.safeParse({ lat: '14.06', lon: '100.62' }).success).toBe(true);
    expect(PointQuerySchema.safeParse({ lat: '40.7', lon: '-74' }).success).toBe(false);
    expect(PointQuerySchema.safeParse({ lat: 'not-a-number', lon: '100' }).success).toBe(false);
  });

  it('returns an insufficient-data response rather than a fabricated result when sources are unavailable', async () => {
    const failingProvider: GeocodingProvider = {
      search: async () => { throw new Error('upstream unavailable'); },
      reverse: async () => { throw new Error('upstream unavailable'); },
    };
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      geocodingProvider: failingProvider,
    });

    const badPoint = await request(app).get('/api/risk?lat=40.7&lon=-74');
    expect(badPoint.status).toBe(400);

    const failedSearch = await request(app).get('/api/geocode?q=Bangkok');
    expect(failedSearch.status).toBe(502);
    expect(failedSearch.body.error.messageTh).toContain('ค้นหาตำแหน่ง');

    const riskResponse = await request(app).get('/api/risk?lat=14.06&lon=100.62');
    expect(riskResponse.status).toBe(200);
    expect(riskResponse.body).toMatchObject({
      score: null,
      level: 'INSUFFICIENT',
      isMock: false,
      fetchedAt: null,
    });
  });

  it('passes the requested language to reverse geocoding', async () => {
    const reverse = vi.fn(async (_lat: number, _lon: number, _language: string) => null);
    const provider: GeocodingProvider = {
      search: async () => [],
      reverse,
    };
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      geocodingProvider: provider,
    });

    const response = await request(app).get('/api/reverse-geocode?lat=14&lon=100.5&lang=en');

    expect(response.status).toBe(200);
    expect(reverse).toHaveBeenCalledWith(14, 100.5, 'en');
  });
});
