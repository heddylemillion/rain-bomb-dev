import { logger, redactSecretsInText } from '../logger.js';
import { calculateRisk, type RiskInput } from './riskService.js';
import type {
  HourlyForecastResponse,
  RiskDataReason,
  RiskResult,
} from '../../shared/contracts.js';
import type { DataMode } from './environmentDataService.js';
import type { LightningProvider } from './weatherProviders.js';
import {
  fetchOpenMeteoForecast,
  type OpenMeteoForecastData,
  type WeatherApiClient,
} from './openMeteoSdk.js';

interface ForecastCacheEntry {
  expiresAt: number;
  fetchedAtISO: string;
  value: OpenMeteoForecastData;
}

function finiteValue(values: Array<number | null>, index: number): number | null {
  const value = values[index];
  return value !== undefined && value !== null && Number.isFinite(value) ? value : null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sumComplete(values: Array<number | null>, start: number, count: number): number | null {
  const slice = values.slice(start, start + count);
  return slice.length === count && slice.every(isFiniteNumber)
    ? Math.round(slice.reduce((sum, value) => sum + value, 0) * 100) / 100
    : null;
}

function maxComplete(values: Array<number | null>, start: number, count: number): number | null {
  const slice = values.slice(start, start + count);
  if (slice.length !== count || !slice.every(isFiniteNumber)) return null;
  return Math.max(...slice.filter(isFiniteNumber));
}

export class RiskDataService {
  private readonly forecastCache = new Map<string, ForecastCacheEntry>();

  constructor(
    private readonly dataMode: DataMode,
    private readonly lightningProvider: LightningProvider,
    private readonly weatherApi?: WeatherApiClient,
    private readonly now: () => number = Date.now
  ) {}

  public async getPointRisk(lat: number, lon: number): Promise<RiskResult> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const [forecastResult, lightningResult] = await Promise.all([
      this.getForecast(lat, lon, key),
      this.lightningProvider.id !== 'none'
        ? this.lightningProvider
            .getSummary(lat, lon)
            .then((value) => ({ value, reason: 'ok' as const }))
            .catch((error: unknown) => {
              logger.warn(
                {
                  error: redactSecretsInText(
                    error instanceof Error ? error.message : String(error)
                  ),
                },
                'Lightning risk input is unavailable'
              );
              return { value: null, reason: 'error' as const };
            })
        : Promise.resolve({ value: null, reason: 'unavailable' as const }),
    ]);

    const forecast = forecastResult.value;
    const now = this.now();
    const currentHourFloor = Math.floor(now / 3_600_000) * 3_600_000;
    const foundHourIndex = forecast
      ? forecast.hourly.time.findIndex((time) => Date.parse(time) >= currentHourFloor)
      : -1;
    const hourIndex = foundHourIndex >= 0 ? foundHourIndex : 0;

    const rainThreeHours = forecast
      ? sumComplete(forecast.hourly.precipitation, hourIndex, 3)
      : null;
    const rain24Hours = forecast
      ? sumComplete(forecast.hourly.precipitation, hourIndex, 24)
      : null;
    const pressureNow = forecast ? finiteValue(forecast.hourly.pressure_msl, hourIndex) : null;
    const pressureThreeHoursAgo = forecast
      ? finiteValue(forecast.hourly.pressure_msl, Math.max(0, hourIndex - 3))
      : null;
    const observedAt = forecast?.hourly.time[hourIndex] ?? null;
    const source = forecast ? 'Open-Meteo' : 'Open-Meteo unavailable';
    const unavailableReason: RiskDataReason = forecastResult.reason;
    const inputs: RiskInput[] = [
      {
        id: 'rainNowMmHr',
        rawValue: forecast ? finiteValue(forecast.hourly.precipitation, hourIndex) : null,
        source,
        observedAt,
        reason: unavailableReason,
      },
      {
        id: 'peakRain3hMmHr',
        rawValue: maxComplete(forecast?.hourly.precipitation ?? [], hourIndex, 3),
        source,
        observedAt,
        reason: unavailableReason,
      },
      {
        id: 'accum3hMm',
        rawValue: rainThreeHours,
        source,
        observedAt,
        reason: unavailableReason,
      },
      {
        id: 'accum24hMm',
        rawValue: rain24Hours,
        source,
        observedAt,
        reason: unavailableReason,
      },
      {
        id: 'popMax3hPct',
        rawValue: maxComplete(forecast?.hourly.precipitation_probability ?? [], hourIndex, 3),
        source,
        observedAt,
        reason: unavailableReason,
      },
      {
        id: 'lightning30minCount',
        rawValue: lightningResult.value?.count30min ?? null,
        source: this.lightningProvider.attribution,
        observedAt: lightningResult.value?.observedAt ?? null,
        reason: lightningResult.reason,
      },
      {
        id: 'pressureDrop3hHpa',
        rawValue:
          pressureNow !== null && pressureThreeHoursAgo !== null
            ? Math.round((pressureThreeHoursAgo - pressureNow) * 100) / 100
            : null,
        source,
        observedAt,
        reason: unavailableReason,
      },
      {
        id: 'humidityPct',
        rawValue: forecast ? finiteValue(forecast.hourly.relative_humidity_2m, hourIndex) : null,
        source,
        observedAt,
        reason: unavailableReason,
      },
    ];

    return calculateRisk({
      communityId: `point-${key}`,
      inputs,
      fetchedAt: forecastResult.fetchedAtISO,
      lightningWithin5km15minCount: lightningResult.value?.within5km15min ?? null,
      lightningSummary: {
        count30min: lightningResult.value?.count30min ?? null,
        nearestStrikeKm: lightningResult.value?.nearestStrikeKm ?? null,
      },
    });
  }

  public async getHourlyForecast(lat: number, lon: number): Promise<HourlyForecastResponse | null> {
    const roundedLat = Number(lat.toFixed(2));
    const roundedLon = Number(lon.toFixed(2));
    const key = `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`;
    const result = await this.getForecast(roundedLat, roundedLon, key);
    if (!result.value) return null;

    const forecast = result.value;
    const currentHourFloor = Math.floor(this.now() / 3_600_000) * 3_600_000;
    const hourly = forecast.hourly.time
      .flatMap((timeISO, index) => {
        if (Date.parse(timeISO) < currentHourFloor) return [];
        return [
          {
            timeISO,
            temperatureC: finiteValue(forecast.hourly.temperature_2m, index),
            precipitationMm: finiteValue(forecast.hourly.precipitation, index),
            precipitationProbabilityPct: finiteValue(
              forecast.hourly.precipitation_probability,
              index
            ),
            humidityPct: finiteValue(forecast.hourly.relative_humidity_2m, index),
            pressureMslHpa: finiteValue(forecast.hourly.pressure_msl, index),
            windSpeedKmh: finiteValue(forecast.hourly.wind_speed_10m, index),
          },
        ];
      })
      .slice(0, 24);

    return {
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      elevationM: forecast.elevationM,
      utcOffsetSeconds: forecast.utcOffsetSeconds,
      fetchedAtISO: result.fetchedAtISO,
      source: 'Open-Meteo',
      hourly,
    };
  }

  private async getForecast(
    lat: number,
    lon: number,
    key: string
  ): Promise<{
    value: OpenMeteoForecastData | null;
    fetchedAtISO: string | null;
    reason: RiskDataReason;
  }> {
    const cached = this.forecastCache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return { value: cached.value, fetchedAtISO: cached.fetchedAtISO, reason: 'ok' };
    }
    if (this.dataMode === 'cache') {
      return { value: null, fetchedAtISO: null, reason: 'no_coverage' };
    }

    try {
      const value = await fetchOpenMeteoForecast(lat, lon, {
        ...(this.weatherApi ? { weatherApi: this.weatherApi } : {}),
        timeoutMs: 8000,
      });
      const fetchedAtISO = new Date(this.now()).toISOString();
      this.forecastCache.set(key, {
        value,
        fetchedAtISO,
        expiresAt: this.now() + 5 * 60_000,
      });
      return { value, fetchedAtISO, reason: 'ok' };
    } catch (error: unknown) {
      logger.warn(
        {
          error: redactSecretsInText(error instanceof Error ? error.message : String(error)),
        },
        'Open-Meteo risk forecast is unavailable'
      );
      return { value: null, fetchedAtISO: null, reason: 'error' };
    }
  }
}
