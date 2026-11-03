import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { GeocodingResultSchema } from '../../shared/contracts.js';
import {
  NominatimGeocodingProvider,
  type GeocodingProvider,
} from '../services/geocodingProvider.js';

const sampleResult = {
  lat: 13.75,
  lon: 100.5,
  name: 'ถนนราชดำเนิน',
  district: 'เขตพระนคร',
  province: 'กรุงเทพมหานคร',
  displayName: 'ถนนราชดำเนิน · เขตพระนคร · กรุงเทพมหานคร',
  address: '1 ถนนราชดำเนิน แขวงพระบรมมหาราชวัง เขตพระนคร กรุงเทพมหานคร 10200 ประเทศไทย',
};

describe('geocoding address field', () => {
  it('fills address from Nominatim display_name and keeps schema valid', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      lat: '13.7500',
      lon: '100.5000',
      display_name: sampleResult.address,
      name: 'ถนนราชดำเนิน',
      address: { city_district: 'เขตพระนคร', state: 'กรุงเทพมหานคร' },
    }), { status: 200 })) as unknown as typeof fetch;
    const provider = new NominatimGeocodingProvider({
      baseUrl: 'https://nominatim.test',
      userAgent: 'test',
      fetchImpl,
    });
    const result = await provider.reverse(13.75, 100.5, 'th');
    expect(result?.address).toBe(sampleResult.address);
    expect(GeocodingResultSchema.safeParse(result).success).toBe(true);
  });

  it('keeps address optional in the shared schema', () => {
    const { address: _address, ...withoutAddress } = sampleResult;
    expect(GeocodingResultSchema.safeParse(withoutAddress).success).toBe(true);
  });
});

describe('/api/reverse-geocode', () => {
  const provider = (): { value: GeocodingProvider; reverse: ReturnType<typeof vi.fn> } => {
    const reverse = vi.fn(async () => sampleResult);
    return { value: { search: async () => [], reverse }, reverse };
  };

  it('returns null without calling the geocoder in mock mode', async () => {
    const { value, reverse } = provider();
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'mock' }),
      geocodingProvider: value,
    });
    const response = await request(app).get('/api/reverse-geocode?lat=13.75&lon=100.5');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ result: null });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('calls the geocoder in live mode and returns the address', async () => {
    const { value, reverse } = provider();
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      geocodingProvider: value,
    });
    const response = await request(app).get('/api/reverse-geocode?lat=13.75&lon=100.5');
    expect(response.status).toBe(200);
    expect(response.body.result.address).toBe(sampleResult.address);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

});
