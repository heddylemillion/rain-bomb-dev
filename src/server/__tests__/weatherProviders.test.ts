import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LightningSummarySchema } from '../../shared/providerContracts.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  OPEN_METEO_FORECAST_URL,
  type WeatherApiClient,
} from '../services/openMeteoSdk.js';
import {
  GdacsStormTrackProvider,
  OpenMeteoCapeLightningProvider,
  RainViewerRadarProvider,
  SlidingWindowBudget,
  TmdRadarProvider,
} from '../services/weatherProviders.js';
import { buildMockCapeResponses } from './helpers/openMeteoTestHelper.js';

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(fixturesDirectory, name), 'utf8')) as unknown;
}

function png(alpha: number): Buffer {
  const width = 256;
  const height = 256;
  const stride = width * 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[rowStart + 1 + x * 4] = 0;
      raw[rowStart + 1 + x * 4 + 1] = 0;
      raw[rowStart + 1 + x * 4 + 2] = 0;
      raw[rowStart + 1 + x * 4 + 3] = alpha;
    }
  }
  const chunk = (type: string, value: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return Buffer.concat([length, Buffer.from(type), value, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('weather provider adapters', () => {
  afterEach(() => vi.restoreAllMocks());

  it('implements the shared sliding-window quota guard', () => {
    const budget = new SlidingWindowBudget(2, 60_000);
    expect(budget.consume('client-a', 10_000)).toBe(true);
    expect(budget.consume('client-a', 20_000)).toBe(true);
    expect(budget.consume('client-a', 30_000)).toBe(false);
    expect(budget.used('client-a', 70_001)).toBe(1);
    expect(budget.consume('client-b', 30_000)).toBe(true);
  });

  it('evaluates 5-hour CAPE lightning potential (>1,000 J/kg warning) via OpenMeteoCapeLightningProvider', async () => {
    const now = Date.parse('2026-11-04T02:10:00Z');
    const capeApi = vi.fn<WeatherApiClient>().mockResolvedValue(
      buildMockCapeResponses(now, (hourOffset, cellIdx) => {
        if (cellIdx === 4) {
          // Center cell: hours 0..4 have peak 1620 J/kg (> 1000 warning)
          return hourOffset === 2 ? 1620 : 850;
        }
        return cellIdx % 2 === 0 ? 450 : 120;
      })
    );
    const lightning = new OpenMeteoCapeLightningProvider('live', capeApi, () => now);
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      lightningProvider: lightning,
    });

    const response = await request(app)
      .get('/api/lightning/summary?lat=13.75&lon=100.5')
      .expect(200);

    const parsed = LightningSummarySchema.parse(response.body);
    expect(capeApi).toHaveBeenCalledTimes(1);
    expect(capeApi.mock.calls[0]?.[0]).toBe(OPEN_METEO_FORECAST_URL);
    expect(capeApi.mock.calls[0]?.[1]).toMatchObject({
      hourly: 'cape',
      timezone: 'Asia/Bangkok',
    });
    expect(parsed.display).toBe('cape');
    expect(parsed.capeNowJkg).toBe(850);
    expect(parsed.capeMax5hJkg).toBe(1620);
    expect(parsed.warning).toBe(true);
    expect(parsed.potentialLevel).toBe('high');
    expect(parsed.hourly5h).toHaveLength(5);
    expect(parsed.hourly5h[2]?.warning).toBe(true);
    expect(parsed.cells).toHaveLength(9);

    // Subsequent call within 5 min serves from cache
    await request(app).get('/api/lightning/summary?lat=13.75&lon=100.5').expect(200);
    expect(capeApi).toHaveBeenCalledTimes(1);

    // Concurrent calls for a new coordinate deduplicate to a single Open-Meteo request
    await Promise.all([
      request(app).get('/api/lightning/summary?lat=13.9364&lon=100.6030').expect(200),
      request(app).get('/api/lightning/summary?lat=13.9410&lon=100.5990').expect(200),
    ]);
    expect(capeApi).toHaveBeenCalledTimes(2);
  });

  it('makes no outbound calls through cache-mode weather adapters and routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const radar = new RainViewerRadarProvider('cache');
    const lightning = new OpenMeteoCapeLightningProvider('cache');
    const storm = new GdacsStormTrackProvider('cache');
    await Promise.all([
      radar.getFrames(13.75, 100.5),
      lightning.getSummary(13.75, 100.5),
      storm.getTracks(),
    ]);

    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'cache' }),
    });
    await request(app).get('/api/radar/frames?lat=13.75&lon=100.5').expect(200);
    await request(app).get('/api/lightning/summary?lat=13.75&lon=100.5').expect(200);
    await request(app).get('/api/storm-tracks').expect(200);
    await request(app).get('/api/risk?lat=13.75&lon=100.5').expect(200);
    await request(app).get('/api/environment?lat=13.75&lon=100.5').expect(200);
    const status = await request(app).get('/api/providers/status').expect(200);
    expect(status.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'radar', provider: 'rainviewer', mode: 'cache' }),
      expect.objectContaining({ id: 'lightning', provider: 'open-meteo-cape', mode: 'cache' }),
      expect.objectContaining({ id: 'storm-track', provider: 'gdacs', mode: 'cache' }),
    ]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the exact Thai no-coverage notice for an empty RainViewer coverage mask', async () => {
    const metadata = await fixture('rainviewer-weather-maps.json');
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array(png(255)), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));
    const radar = new RainViewerRadarProvider('live', fetcher);
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'live' }),
      radarProvider: radar,
    });

    const response = await request(app)
      .get('/api/radar/frames?lat=13.7563&lon=100.5018')
      .expect(200);
    expect(response.body.coverage).toBe('none');
    expect(response.body.noticeTh).toBe('ไม่มีข้อมูลเรดาร์ในพื้นที่นี้');
    expect(response.body.maxZoom).toBe(7);
    expect(response.body.attribution).toBe('Weather data by RainViewer');
    expect(response.body.attributionUrl).toBe('https://www.rainviewer.com/');
    expect(response.body.frames).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns only active GDACS tracks and uncertainty cones, then serves the 30-minute cache', async () => {
    const active = await fixture('gdacs-active-cyclones.json');
    const events = await fixture('gdacs-event-map.json');
    const geometry = await fixture('gdacs-cyclone-geometry.json');
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(active)))
      .mockResolvedValueOnce(new Response(JSON.stringify(events)))
      .mockResolvedValueOnce(new Response(JSON.stringify(geometry)));
    const provider = new GdacsStormTrackProvider('live', fetcher, () => 1_800_000);

    const result = await provider.getTracks();
    expect(result.features).toHaveLength(2);
    expect(result.features.map((feature) => feature.geometry.type)).toEqual(['LineString', 'Polygon']);
    expect(provider.attribution).toBe('GDACS (EC-JRC / UN OCHA)');
    await provider.getTracks();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not scrape TMD and never requests tiles from its stub', async () => {
    const stub = new TmdRadarProvider('live');
    expect(await stub.getFrames()).toEqual({ frames: [], coverage: 'unknown' });
    expect(await stub.getTile()).toBeNull();
  });

  it('limits RainViewer frame and tile requests to 100 per IP per minute', async () => {
    const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'cache' }) });
    for (let index = 0; index < 100; index += 1) {
      await request(app).get('/api/radar/frames?lat=13.75&lon=100.5').expect(200);
    }
    await request(app).get('/api/radar/frames?lat=13.75&lon=100.5').expect(429);
  });
});
