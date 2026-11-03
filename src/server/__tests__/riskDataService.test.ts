import { describe, expect, it, vi } from 'vitest';
import {
  FORECAST_HOURLY_VARIABLES,
  OPEN_METEO_FORECAST_URL,
  type WeatherApiClient,
} from '../services/openMeteoSdk.js';
import { RiskDataService } from '../services/riskDataService.js';
import {
  NoLightningProvider,
  OpenMeteoCapeLightningProvider,
} from '../services/weatherProviders.js';
import {
  buildMockCapeResponses,
  buildMockForecastResponses,
} from './helpers/openMeteoTestHelper.js';

describe('RiskDataService', () => {
  it('uses Open-Meteo SDK forecast and Open-Meteo CAPE 5h lightning potential', async () => {
    const now = Date.parse('2026-11-04T02:15:00Z');
    const forecastApi = vi
      .fn<WeatherApiClient>()
      .mockResolvedValue(buildMockForecastResponses(now));
    const capeApi = vi
      .fn<WeatherApiClient>()
      .mockResolvedValue(
        buildMockCapeResponses(now, (h) => (h === 2 ? 1850 : 1200))
      );

    const lightningProvider = new OpenMeteoCapeLightningProvider('live', capeApi, () => now);
    const service = new RiskDataService('live', lightningProvider, forecastApi, () => now);
    const result = await service.getPointRisk(13.75, 100.5);

    expect(forecastApi).toHaveBeenCalledTimes(1);
    expect(forecastApi.mock.calls[0]?.[0]).toBe(OPEN_METEO_FORECAST_URL);
    expect(forecastApi.mock.calls[0]?.[1]).toMatchObject({
      latitude: 13.75,
      longitude: 100.5,
      hourly: FORECAST_HOURLY_VARIABLES.join(','),
      past_hours: 3,
      forecast_hours: 25,
      timezone: 'Asia/Bangkok',
    });

    expect(capeApi).toHaveBeenCalledTimes(1);
    expect(capeApi.mock.calls[0]?.[0]).toBe(OPEN_METEO_FORECAST_URL);
    expect(capeApi.mock.calls[0]?.[1]).toMatchObject({
      hourly: 'cape',
      timezone: 'Asia/Bangkok',
    });

    const capeFactor = result.factors.find((factor) => factor.id === 'capeMax5hJkg');
    expect(capeFactor).toMatchObject({
      available: true,
      rawValue: 1850,
      unit: 'J/kg',
      source: 'Open-Meteo CAPE',
    });

    const pressureDrop = result.factors.find((factor) => factor.id === 'pressureDrop3hHpa');
    expect(pressureDrop?.rawValue).toBe(1.5);

    expect(result.confidence).toBeCloseTo(1);
    expect(result.lightningSummary).toMatchObject({
      capeNowJkg: 1200,
      capeMax5hJkg: 1850,
      warning: true,
      count30min: null,
      nearestStrikeKm: null,
    });
  });

  it('keeps CAPE factor unavailable when lightning provider is set to none', async () => {
    const now = Date.parse('2026-11-04T02:15:00Z');
    const forecastApi = vi
      .fn<WeatherApiClient>()
      .mockResolvedValue(buildMockForecastResponses(now));

    const result = await new RiskDataService(
      'live',
      new NoLightningProvider('live'),
      forecastApi,
      () => now
    ).getPointRisk(13.75, 100.5);

    const capeFactor = result.factors.find((factor) => factor.id === 'capeMax5hJkg');
    expect(capeFactor).toMatchObject({
      available: false,
      rawValue: null,
      reason: 'unavailable',
      source: 'No lightning provider configured',
    });
    expect(result.confidence).toBeLessThan(1);
  });

  it('returns 24 hourly forecast entries starting from the current hour and preserves NaN as null', async () => {
    const now = Date.parse('2026-11-04T02:15:00Z');
    const forecastApi = vi.fn<WeatherApiClient>().mockResolvedValue(
      buildMockForecastResponses(now, {
        temperature: (h) => (h === 0 ? null : 30 + h * 0.1),
        cape: (h) => (h === 1 ? 1600 : 400),
      })
    );

    const service = new RiskDataService(
      'live',
      new NoLightningProvider('live'),
      forecastApi,
      () => now
    );
    const forecast = await service.getHourlyForecast(13.75, 100.5);

    expect(forecast).not.toBeNull();
    expect(forecast?.source).toBe('Open-Meteo');
    expect(forecast?.hourly).toHaveLength(24);
    expect(forecast?.hourly[0]?.temperatureC).toBeNull();
    expect(forecast?.hourly[1]?.capeJkg).toBe(1600);
  });

  it('does not make a network request in cache mode without a saved forecast', async () => {
    const forecastApi = vi.fn<WeatherApiClient>();
    const capeApi = vi.fn<WeatherApiClient>();
    const service = new RiskDataService(
      'cache',
      new OpenMeteoCapeLightningProvider('cache', capeApi),
      forecastApi
    );
    const result = await service.getPointRisk(13.75, 100.5);

    expect(forecastApi).not.toHaveBeenCalled();
    expect(capeApi).not.toHaveBeenCalled();
    expect(result.factors.every((factor) => !factor.available)).toBe(true);
    await expect(service.getHourlyForecast(13.75, 100.5)).resolves.toBeNull();
  });
});
