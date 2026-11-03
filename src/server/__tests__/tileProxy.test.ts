import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { RadarProvider } from '../services/weatherProviders.js';

function createRadarProvider(getTile: RadarProvider['getTile']): RadarProvider {
  return {
    id: 'rainviewer',
    mode: 'live',
    maxZoom: 7,
    attribution: 'Weather data by RainViewer',
    attributionUrl: 'https://www.rainviewer.com/',
    getFrames: async () => ({ frames: [], coverage: 'unknown' }),
    getTile,
  };
}

describe('radar tile proxy', () => {
  it('allow-lists the configured radar adapter and caches tiles for at least five minutes', async () => {
    const getTile = vi.fn<RadarProvider['getTile']>().mockResolvedValue(
      Buffer.from([137, 80, 78, 71])
    );
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      radarProvider: createRadarProvider(getTile),
    });

    const url = '/api/radar/tiles/6/49/30/1770000000.png';
    const first = await request(app).get(url).expect(200);
    const second = await request(app).get(url).expect(200);
    expect(first.headers['content-type']).toContain('image/png');
    expect(second.status).toBe(200);
    expect(first.headers['cache-control']).toBe('public, max-age=300');
    expect(getTile).toHaveBeenCalledTimes(1);
    await request(app).get('/api/tiles/radar/6/49/30/current.png').expect(404);
    await request(app).get('/api/map/tiles/6/49/30.png').expect(404);
  });

  it('rejects coordinates outside the selected provider zoom range', async () => {
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      radarProvider: createRadarProvider(async () => null),
    });
    await request(app).get('/api/radar/tiles/8/49/30/1770000000.png').expect(400);
    await request(app).get('/api/radar/tiles/6/49/30/0.png').expect(400);
  });

  it('does not disclose upstream errors to clients', async () => {
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      radarProvider: createRadarProvider(async () => {
        throw new Error('upstream request failed');
      }),
    });
    const result = await request(app)
      .get('/api/radar/tiles/6/49/30/1770000000.png')
      .expect(502);
    expect(result.text).not.toContain('upstream request failed');
  });
});
