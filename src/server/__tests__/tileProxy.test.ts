import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { XweatherClient } from '../services/xweatherClient.js';

describe('Xweather raster tile proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serves the real OSM basemap in cache mode and rejects non-image tile responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    );
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'cache' }),
    });

    const tile = await request(app).get('/api/map/tiles/6/49/30.png').expect(200);
    expect(tile.headers['content-type']).toContain('image/png');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tile.openstreetmap.org/6/49/30.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    fetchMock.mockResolvedValueOnce(
      new Response('<html>upstream error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const invalidImage = await request(app).get('/api/map/tiles/6/49/31.png').expect(502);
    expect(invalidImage.body.error.code).toBe('MAP_TILE_UNAVAILABLE');
  });

  it('streams and briefly caches images without returning credentials', async () => {
    const clientId = 'private-test-client';
    const clientSecret = 'private-test-secret';
    const requested: string[] = [];
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId,
      clientSecret,
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      },
    });
    const app = createApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATA_MODE: 'live',
        XWEATHER_CLIENT_ID: clientId,
        XWEATHER_CLIENT_SECRET: clientSecret,
      }),
      xweatherClient: client,
    });

    const first = await request(app).get('/api/tiles/radar/6/49/30/current.png');
    const second = await request(app).get('/api/tiles/radar/6/49/30/current.png');
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toContain('image/png');
    expect(first.headers['cache-control']).toContain('max-age=300');
    expect(second.status).toBe(200);
    expect(requested).toHaveLength(1);
    expect(JSON.stringify(first.headers)).not.toContain(clientId);
    expect(JSON.stringify(first.headers)).not.toContain(clientSecret);
    expect(first.body.toString('latin1')).not.toContain(clientId);
    expect(first.body.toString('latin1')).not.toContain(clientSecret);
    expect(requested[0]).toContain(`${clientId}_${clientSecret}`);
  });

  it('rejects invalid coordinates and never logs or returns embedded credentials on upstream errors', async () => {
    const clientId = 'private-client-id';
    const clientSecret = 'private-client-secret';
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId,
      clientSecret,
      fetchImpl: async () => {
        throw new Error(`upstream URL ${clientId}_${clientSecret}`);
      },
    });
    const app = createApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATA_MODE: 'live',
        XWEATHER_CLIENT_ID: clientId,
        XWEATHER_CLIENT_SECRET: clientSecret,
      }),
      xweatherClient: client,
    });

    const invalid = await request(app).get('/api/tiles/radar/3/8/0/current.png');
    expect(invalid.status).toBe(400);

    const failed = await request(app).get('/api/tiles/radar/6/49/30/current.png');
    expect(failed.status).toBe(502);
    expect(failed.text).not.toContain(clientId);
    expect(failed.text).not.toContain(clientSecret);
    expect(JSON.stringify(failed.headers)).not.toContain(clientId);
    expect(JSON.stringify(failed.headers)).not.toContain(clientSecret);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(clientId);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(clientSecret);
  });
});
