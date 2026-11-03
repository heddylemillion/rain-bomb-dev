import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';

const app = createApp({ config: loadConfig({ NODE_ENV: 'test' }) });

describe('LDD soil API', () => {
  it.each([
    ['14.0647', '100.6186', 'Rs', 'ดินเหนียว'],
    ['14.0662', '100.6385', 'Rs', 'ดินเหนียว'],
    ['14.0', '100.5', 'Ay', undefined],
    ['13.75', '100.5', 'Tb', 'ดินเหนียว'],
    ['13.819', '100.062', 'Ks', 'ดินร่วนเหนียวปนทรายแป้ง'],
    ['13.86', '100.5', 'Tb', 'ดินเหนียว'],
    ['13.59', '100.6', 'Sm', 'ดินเหนียว'],
    ['13.41', '100.0', 'Sso', 'ดินเหนียวปนทรายแป้ง'],
  ])('looks up soil at (%s, %s)', async (lat, lon, soilCode, textureTh) => {
    const response = await request(app).get(`/api/soil?lat=${lat}&lon=${lon}`);

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('LDD 1:25,000');
    expect(response.body.coverage).toBe('bangkok-region');
    expect(response.body.soil.soilCode).toBe(soilCode);
    expect(response.body.soil.drainageClass).toBeNull();
    if (textureTh) {
      expect(response.body.soil.textureTh).toBe(textureTh);
    }
  });

  it('returns null outside the dataset coverage', async () => {
    const response = await request(app).get('/api/soil?lat=18.79&lon=98.98');

    expect(response.status).toBe(200);
    expect(response.body.soil).toBeNull();
  });

  it.each([
    ['lat=50&lon=-100'],
    ['lat=invalid&lon=100.5'],
    ['lat=14.0'],
  ])('rejects invalid coordinates (%s)', async (query) => {
    const response = await request(app).get(`/api/soil?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_COORDINATES');
  });

  it('returns the cached GeoJSON soil layer', async () => {
    const response = await request(app).get('/api/soil/layer');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.body.type).toBe('FeatureCollection');
    expect(response.body.features).toHaveLength(181);
    expect(response.body.features.find((feature: { properties: { soilCode: string } }) =>
      feature.properties.soilCode === 'W'
    )?.properties).toMatchObject({
      textureTh: '',
      drainageClass: null,
    });
  });
});
