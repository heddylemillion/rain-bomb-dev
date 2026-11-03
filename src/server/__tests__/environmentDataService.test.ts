import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import dotenv from 'dotenv';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { elevationCell } from '../services/elevationCache.js';
import {
  assertMatchingDatums,
  EnvironmentDataService,
  OpenMeteoElevationProvider,
  OpenMeteoMarineProvider,
  selectSeaReferencePoint,
  type SeaReferencePoint,
} from '../services/environmentDataService.js';
import {
  OPEN_METEO_MARINE_URL,
  type WeatherApiClient,
} from '../services/openMeteoSdk.js';
import { buildMockWeatherApiResponses } from './helpers/openMeteoTestHelper.js';

const temporaryDirectories: string[] = [];

async function temporaryPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rain-burst-open-meteo-'));
  temporaryDirectories.push(directory);
  return directory;
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

const candidatePoints: SeaReferencePoint[] = [
  { id: 'upper-gulf', name_th: 'อ่าวไทยตอนบน', lat: 13.45, lon: 100.6 },
  { id: 'chonburi', name_th: 'ชายฝั่งชลบุรี', lat: 13.2, lon: 100.55 },
];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe('Open-Meteo elevation provider', () => {
  it('uses the permanent rounded-coordinate cache on later lookups', async () => {
    const directory = await temporaryPath();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ elevation: [12.5] }));
    const cachePath = path.join(directory, 'elevation.json');
    const coordinates = { latitude: 14.0647, longitude: 100.6186 };
    const firstProvider = new OpenMeteoElevationProvider({
      mode: 'live',
      fetcher,
      elevationCachePath: cachePath,
    });

    await expect(firstProvider.getMany([coordinates])).resolves.toEqual([
      { valueM: 12.5, messageTh: null },
    ]);
    const secondProvider = new OpenMeteoElevationProvider({
      mode: 'live',
      fetcher,
      elevationCachePath: cachePath,
    });
    await expect(secondProvider.getMany([coordinates])).resolves.toEqual([
      { valueM: 12.5, messageTh: null },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(elevationCell(coordinates.latitude, coordinates.longitude).key)
      .toBe(elevationCell(coordinates.latitude + 0.0001, coordinates.longitude).key);
  });

  it('batches cache misses as comma-separated coordinates in requests of at most 100', async () => {
    const directory = await temporaryPath();
    const requestedCounts: number[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const latitudes = url.searchParams.get('latitude')?.split(',') ?? [];
      requestedCounts.push(latitudes.length);
      return response({ elevation: latitudes.map((_, index) => index + 10) });
    });
    const points = Array.from({ length: 101 }, (_, index) => ({
      latitude: 10 + index * 0.003,
      longitude: 100.1 + index * 0.003,
    }));
    const provider = new OpenMeteoElevationProvider({
      mode: 'live',
      fetcher,
      elevationCachePath: path.join(directory, 'elevation.json'),
    });

    const results = await provider.getMany(points);
    expect(results).toHaveLength(101);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestedCounts).toEqual([100, 1]);
    const firstUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(firstUrl.pathname).toBe('/v1/elevation');
    expect(firstUrl.searchParams.get('latitude')).toContain(',');
    expect(firstUrl.searchParams.get('longitude')).toContain(',');
  });

  it.each([
    {
      label: 'HTTP errors',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({}, 429)),
      expected: 'โควตาการเรียก Open-Meteo อาจเต็มแล้ว',
    },
    {
      label: 'timeouts',
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' })
      ),
      expected: 'หมดเวลารอข้อมูลจาก Open-Meteo',
    },
    {
      label: 'non-numeric values',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({ elevation: [null] })),
      expected: 'ไม่มีข้อมูลความสูง',
    },
  ])('reports $label without fabricating elevation', async ({ fetcher, expected }) => {
    const directory = await temporaryPath();
    const provider = new OpenMeteoElevationProvider({
      mode: 'live',
      fetcher,
      elevationCachePath: path.join(directory, 'elevation.json'),
    });
    const [result] = await provider.getMany([{ latitude: 14, longitude: 100 }]);
    expect(result?.valueM).toBeNull();
    expect(result?.messageTh).toContain(expected);
  });

  it('does not make Open-Meteo requests in cache mode without cached data', async () => {
    const directory = await temporaryPath();
    const fetcher = vi.fn<typeof fetch>();
    const coordinate = { latitude: 14.0647, longitude: 100.6186 };

    const cacheOnly = new OpenMeteoElevationProvider({
      mode: 'cache',
      fetcher,
      elevationCachePath: path.join(directory, 'empty-cache.json'),
    });
    const missing = await cacheOnly.getMany([coordinate]);
    expect(missing[0]).toMatchObject({ valueM: null, messageTh: 'ไม่มีข้อมูลความสูงในแคช' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Open-Meteo Marine provider', () => {
  it('normalizes the Open-Meteo Marine SDK forecast window to Bangkok time and preserves nulls', async () => {
    const directory = await temporaryPath();
    const now = Date.parse('2026-10-29T04:30:00Z');
    const weatherApi = vi.fn<WeatherApiClient>().mockImplementation(async (url, params) => {
      expect(url).toBe(OPEN_METEO_MARINE_URL);
      expect(params).toMatchObject({
        hourly: 'sea_level_height_msl,wave_height',
        forecast_days: 7,
        timezone: 'Asia/Bangkok',
      });
      return buildMockWeatherApiResponses({
        startUnixSec: Date.parse('2026-10-29T05:00:00Z') / 1000,
        count: 3,
        variables: [
          [null, 1.25, 1.4],
          [0.2, 0.3, null],
        ],
      });
    });

    const provider = new OpenMeteoMarineProvider({
      mode: 'live',
      weatherApi,
      marineCachePath: path.join(directory, 'marine.json'),
      now: () => now,
    });
    const result = await provider.getForecast(candidatePoints[0]!);

    expect(result.hourly).toEqual([
      {
        timeISO: '2026-10-29T05:00:00.000Z',
        seaLevelHeightMslM: null,
        waveHeightM: 0.2,
      },
      {
        timeISO: '2026-10-29T06:00:00.000Z',
        seaLevelHeightMslM: 1.25,
        waveHeightM: 0.3,
      },
      {
        timeISO: '2026-10-29T07:00:00.000Z',
        seaLevelHeightMslM: 1.4,
        waveHeightM: null,
      },
    ]);
    const displayHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(result.hourly[1]!.timeISO));
    expect(displayHour).toBe('13:00');
    expect(result.messageTh).toBeNull();
  });

  it('keeps sea-level nulls and reports when every hourly result is null', async () => {
    const directory = await temporaryPath();
    const weatherApi = vi.fn<WeatherApiClient>().mockResolvedValue(
      buildMockWeatherApiResponses({
        startUnixSec: Date.parse('2026-10-29T05:00:00Z') / 1000,
        count: 2,
        variables: [
          [null, null],
          [null, 0.2],
        ],
      })
    );
    const provider = new OpenMeteoMarineProvider({
      mode: 'live',
      weatherApi,
      marineCachePath: path.join(directory, 'marine-null.json'),
      now: () => Date.parse('2026-10-29T05:00:00Z'),
    });
    const result = await provider.getForecast(candidatePoints[0]!);
    expect(result.hourly[0]?.seaLevelHeightMslM).toBeNull();
    expect(result.messageTh).toContain('ไม่มีข้อมูลระดับน้ำทะเล');
  });

  it('caches Marine forecasts and returns cached null data without another request', async () => {
    const directory = await temporaryPath();
    const weatherApi = vi.fn<WeatherApiClient>().mockResolvedValue(
      buildMockWeatherApiResponses({
        startUnixSec: Date.parse('2026-10-29T05:00:00Z') / 1000,
        count: 0,
        variables: [[], []],
      })
    );
    const cachePath = path.join(directory, 'marine-cache.json');
    const firstProvider = new OpenMeteoMarineProvider({
      mode: 'live',
      weatherApi,
      marineCachePath: cachePath,
    });
    const first = await firstProvider.getForecast(candidatePoints[0]!);
    const second = await new OpenMeteoMarineProvider({
      mode: 'live',
      weatherApi,
      marineCachePath: cachePath,
    }).getForecast(candidatePoints[0]!);

    expect(first.messageTh).toContain('ไม่มีข้อมูลระดับน้ำทะเล');
    expect(second.messageTh).toContain('ไม่มีข้อมูลระดับน้ำทะเล');
    expect(weatherApi).toHaveBeenCalledTimes(1);
  });

  it('never sends requests in cache mode without a saved marine cache', async () => {
    const directory = await temporaryPath();
    const weatherApi = vi.fn<WeatherApiClient>();
    const point = candidatePoints[0]!;
    const result = await new OpenMeteoMarineProvider({
      mode: 'cache',
      weatherApi,
      marineCachePath: path.join(directory, 'empty-marine.json'),
      now: () => Date.parse('2026-10-29T05:30:00Z'),
    }).getForecast(point);

    expect(result.hourly).toEqual([]);
    expect(result.messageTh).toBe('ไม่มีข้อมูลพยากรณ์ระดับน้ำทะเลในแคช');
    expect(weatherApi).not.toHaveBeenCalled();
  });

  it('returns normalized live elevation and marine data from Open-Meteo providers', async () => {
    const directory = await temporaryPath();
    const now = Date.parse('2026-10-29T05:30:00Z');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ elevation: [5.4] }));
    const weatherApi = vi.fn<WeatherApiClient>().mockResolvedValue(
      buildMockWeatherApiResponses({
        startUnixSec: Date.parse('2026-10-29T06:00:00Z') / 1000,
        count: 55,
        variables: [
          Array.from({ length: 55 }, (_, i) => 1.1 + i * 0.01),
          Array.from({ length: 55 }, () => 0.4),
        ],
      })
    );
    const referencePath = path.join(directory, 'sea-reference-points.json');
    await fs.writeFile(referencePath, JSON.stringify({
      points: candidatePoints,
      communities: {},
    }));
    const environment = new EnvironmentDataService({
      mode: 'live',
      fetcher,
      weatherApi,
      now: () => now,
      elevationCachePath: path.join(directory, 'elevation.json'),
      marineCachePath: path.join(directory, 'marine.json'),
      referencePointsPath: referencePath,
    });

    const result = await environment.getAreaEnvironment(14.06, 100.62);
    expect(result.elevation.valueM).toBe(5.4);
    expect(result.seaLevel.datum).toBe('global_mean_sea_level');
    expect(result.seaLevel.hourly).toHaveLength(49);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(weatherApi).toHaveBeenCalledTimes(1);
  });

  it('serves the environment API in cache mode with the mapped offshore reference and zero outbound calls', async () => {
    const directory = await temporaryPath();
    const fetcher = vi.fn<typeof fetch>();
    const weatherApi = vi.fn<WeatherApiClient>();
    const referencePath = path.join(directory, 'sea-reference-points.json');
    await fs.writeFile(referencePath, JSON.stringify({
      points: candidatePoints,
      communities: {
        'khlong-luang': { referencePointId: 'upper-gulf', distanceKm: 68.4 },
      },
    }));
    const environmentDataService = new EnvironmentDataService({
      mode: 'cache',
      fetcher,
      weatherApi,
      elevationCachePath: path.join(directory, 'elevation.json'),
      marineCachePath: path.join(directory, 'marine.json'),
      referencePointsPath: referencePath,
    });
    const app = createApp({
      config: loadConfig({ NODE_ENV: 'test', DATA_MODE: 'cache' }),
      environmentDataService,
    });

    const runtimeConfig = await request(app).get('/api/runtime-config').expect(200);
    expect(runtimeConfig.body.dataMode).toBe('cache');
    const result = await request(app)
      .get('/api/environment?lat=14.06&lon=100.62&communityId=khlong-luang')
      .expect(200);
    expect(result.body).toMatchObject({
      seaLevel: {
        referencePoint: {
          id: 'upper-gulf',
          distanceKm: 68.4,
        },
        datum: 'global_mean_sea_level',
        model: 'forecast',
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(weatherApi).not.toHaveBeenCalled();
  });
});

describe('reference data and data-mode safeguards', () => {
  it('uses configured community references and otherwise selects the nearest water point', () => {
    expect(selectSeaReferencePoint(
      14.06,
      100.62,
      candidatePoints,
      { 'khlong-luang': { referencePointId: 'upper-gulf', distanceKm: 68.4 } },
      'khlong-luang'
    )).toBe(candidatePoints[0]);
    expect(selectSeaReferencePoint(
      13.19,
      100.54,
      candidatePoints,
      {}
    )).toBe(candidatePoints[1]);
  });

  it('blocks comparisons between mismatched vertical datums', () => {
    expect(() => assertMatchingDatums(
      { datum: 'global_mean_sea_level' },
      { datum: 'thai_rtk' }
    )).toThrow('datum คนละระบบ');
    expect(() => assertMatchingDatums(
      { datum: 'global_mean_sea_level' },
      { datum: 'global_mean_sea_level' }
    )).not.toThrow();
  });

  it('defaults to live mode and Open-Meteo CAPE lightning provider with an empty or example environment', async () => {
    const config = loadConfig({});
    expect(config.dataMode).toBe('live');
    expect(config.providers.radar.id).toBe('rainviewer');
    expect(config.providers.lightning.id).toBe('open-meteo-cape');
    expect(config.providers.stormTrack.id).toBe('gdacs');
    expect(loadConfig({ DATA_MODE: 'cache' }).dataMode).toBe('cache');

    const emptyEnvApp = createApp({ config });
    await request(emptyEnvApp).get('/api/health').expect(200)
      .expect(({ body }) => expect(body.dataMode).toBe('live'));

    const exampleEnv = dotenv.parse(await fs.readFile(path.resolve('.env.example')));
    const exampleApp = createApp({ config: loadConfig(exampleEnv) });
    await request(exampleApp).get('/api/health').expect(200)
      .expect(({ body }) => expect(body.dataMode).toBe('live'));
  });
});
