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

describe('/api/reverse-geocode in mock mode', () => {
  const provider = (): { value: GeocodingProvider; reverse: ReturnType<typeof vi.fn> } => {
    const reverse = vi.fn(async () => sampleResult);
    return { value: { search: async () => [], reverse }, reverse };
  };

  it('returns null without calling the geocoder when GEOCODING_IN_MOCK is off', async () => {
    const { value, reverse } = provider();
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'mock', GEOCODING_IN_MOCK: 'false' }),
      geocodingProvider: value,
    });
    const response = await request(app).get('/api/reverse-geocode?lat=13.75&lon=100.5');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ result: null });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('defaults to off when the flag is unset', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).geocoding.allowInMock).toBe(false);
  });

  it('calls the geocoder and returns the address when GEOCODING_IN_MOCK is on', async () => {
    const { value, reverse } = provider();
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'mock', GEOCODING_IN_MOCK: 'true' }),
      geocodingProvider: value,
    });
    const response = await request(app).get('/api/reverse-geocode?lat=13.75&lon=100.5');
    expect(response.status).toBe(200);
    expect(response.body.result.address).toBe(sampleResult.address);
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('keeps weather providers unreachable in mock mode even with the flag on', async () => {
    const { value } = provider();
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'mock', GEOCODING_IN_MOCK: 'true' }),
      geocodingProvider: value,
    });
    const weather = await request(app).get('/api/weather/any-community');
    expect(weather.status).toBe(503);
    expect(weather.body.error.code).toBe('MOCK_WEATHER_UNAVAILABLE');
  });
});
