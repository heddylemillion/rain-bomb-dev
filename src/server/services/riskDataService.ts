import { z } from 'zod';
import { logger, redactSecretsInText } from '../logger.js';
import { calculateRisk, haversineDistanceKm, type RiskInput } from './riskService.js';
import type { RiskDataReason, RiskResult } from '../../shared/contracts.js';
import {
  createMockScenario,
  getMockRiskInputs,
  nearestApproachingCell,
  scenarioLightningStrikes,
  type MockScenarioName,
} from '../../shared/mockWeatherScenario.js';
import type { DataMode } from './environmentDataService.js';
import type { LightningProvider } from './weatherProviders.js';

const ForecastSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    precipitation: z.array(z.number().nullable()),
    precipitation_probability: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()),
    pressure_msl: z.array(z.number().nullable()),
  }),
});

interface ForecastCacheEntry {
  expiresAt: number;
  value: ReturnType<typeof ForecastSchema.parse>;
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
    ? slice.reduce((sum, value) => sum + value, 0)
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
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}

  public async getPointRisk(
    lat: number,
    lon: number,
    mockOptions: { scenario?: MockScenarioName; date?: string; offsetMin?: number } = {}
  ): Promise<RiskResult> {
    if (this.dataMode === 'mock') return this.getMockPointRisk(lat, lon, mockOptions);

    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const [forecastResult, lightningResult] = await Promise.all([
      this.getForecast(lat, lon, key),
      this.lightningProvider.id !== 'none' &&
      (this.lightningProvider.mode === 'live' || this.lightningProvider.mode === 'cache')
        ? this.lightningProvider.getSummary(lat, lon).then((value) => ({ value, reason: 'ok' as const }))
          .catch((error: unknown) => {
            logger.warn({
              error: redactSecretsInText(error instanceof Error ? error.message : String(error)),
            }, 'Lightning risk input is unavailable');
            return { value: null, reason: 'error' as const };
          })
        : Promise.resolve({ value: null, reason: 'unavailable' as const }),
    ]);

    const forecast = forecastResult.value;
    const now = this.now();
    const hourIndex = forecast
      ? Math.max(0, forecast.hourly.time.findIndex((time) => Date.parse(time) >= now))
      : 0;
    const rainThreeHours = forecast ? sumComplete(forecast.hourly.precipitation, hourIndex, 3) : null;
    const rain24Hours = forecast ? sumComplete(forecast.hourly.precipitation, hourIndex, 24) : null;
    const pressureNow = forecast ? finiteValue(forecast.hourly.pressure_msl, hourIndex) : null;
    const pressureThreeHoursAgo = forecast ? finiteValue(forecast.hourly.pressure_msl, Math.max(0, hourIndex - 3)) : null;
    const observedAt = forecast?.hourly.time[hourIndex] ?? null;
    const source = forecast ? 'Open-Meteo' : 'Open-Meteo unavailable';
    const unavailableReason: RiskDataReason = forecastResult.reason;
    const inputs: RiskInput[] = [
      { id: 'rainNowMmHr', rawValue: forecast ? finiteValue(forecast.hourly.precipitation, hourIndex) : null, source, observedAt, reason: unavailableReason },
      { id: 'peakRain3hMmHr', rawValue: maxComplete(forecast?.hourly.precipitation ?? [], hourIndex, 3), source, observedAt, reason: unavailableReason },
      { id: 'accum3hMm', rawValue: rainThreeHours, source, observedAt, reason: unavailableReason },
      { id: 'accum24hMm', rawValue: rain24Hours, source, observedAt, reason: unavailableReason },
      { id: 'popMax3hPct', rawValue: maxComplete(forecast?.hourly.precipitation_probability ?? [], hourIndex, 3), source, observedAt, reason: unavailableReason },
      { id: 'lightning30minCount', rawValue: lightningResult.value?.count30min ?? null, source: this.lightningProvider.attribution, observedAt: lightningResult.value?.observedAt ?? null, reason: lightningResult.reason },
      { id: 'pressureDrop3hHpa', rawValue: pressureNow !== null && pressureThreeHoursAgo !== null ? pressureThreeHoursAgo - pressureNow : null, source, observedAt, reason: unavailableReason },
      { id: 'humidityPct', rawValue: forecast ? finiteValue(forecast.hourly.relative_humidity_2m, hourIndex) : null, source, observedAt, reason: unavailableReason },
    ];

    return calculateRisk({
      communityId: `point-${key}`,
      inputs,
      fetchedAt: forecast ? new Date(now).toISOString() : null,
      lightningWithin5km15minCount: lightningResult.value?.within5km15min ?? null,
      lightningSummary: {
        count30min: lightningResult.value?.count30min ?? null,
        nearestStrikeKm: lightningResult.value?.nearestStrikeKm ?? null,
      },
    });
  }

  private async getForecast(
    lat: number,
    lon: number,
    key: string
  ): Promise<{ value: ReturnType<typeof ForecastSchema.parse> | null; reason: RiskDataReason }> {
    const cached = this.forecastCache.get(key);
    if (cached && cached.expiresAt > this.now()) return { value: cached.value, reason: 'ok' };
    if (this.dataMode === 'cache') return { value: null, reason: 'no_coverage' };

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('hourly', 'precipitation,precipitation_probability,relative_humidity_2m,pressure_msl');
    url.searchParams.set('forecast_hours', '24');
    url.searchParams.set('timezone', 'Asia/Bangkok');
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { value: null, reason: response.status === 404 ? 'no_coverage' : 'error' };
      const value = ForecastSchema.parse(await response.json());
      this.forecastCache.set(key, { value, expiresAt: this.now() + 5 * 60_000 });
      return { value, reason: 'ok' };
    } catch (error: unknown) {
      logger.warn({
        error: redactSecretsInText(error instanceof Error ? error.message : String(error)),
      }, 'Open-Meteo risk forecast is unavailable');
      return { value: null, reason: 'error' };
    }
  }

  private getMockPointRisk(
    lat: number,
    lon: number,
    options: { scenario?: MockScenarioName; date?: string; offsetMin?: number }
  ): RiskResult {
    const scenarioName = options.scenario ?? 'moderate';
    const date = options.date ?? new Date(this.now()).toISOString().slice(0, 10);
    const offsetMin = options.offsetMin ?? 0;
    const scenario = createMockScenario(scenarioName, date);
    const values = getMockRiskInputs(scenario, lat, lon, offsetMin);
    const source = `จำลอง (scenario: ${scenarioName})`;
    const observedAt = new Date(this.now() + offsetMin * 60_000).toISOString();
    const inputs: RiskInput[] = [
      ['rainNowMmHr', values.rainNowMmHr],
      ['peakRain3hMmHr', values.peakRain3hMmHr],
      ['accum3hMm', values.accum3hMm],
      ['accum24hMm', values.accum24hMm],
      ['popMax3hPct', values.popMax3hPct],
      ['lightning30minCount', values.lightning30minCount],
      ['pressureDrop3hHpa', values.pressureDrop3hHpa],
      ['humidityPct', values.humidityPct],
    ].map(([id, rawValue]) => ({
      id: id as RiskInput['id'],
      rawValue: rawValue as number,
      source,
      observedAt,
      reason: 'ok',
    }));
    const strikes = scenarioLightningStrikes(scenario, offsetMin).filter((strike) =>
      offsetMin - strike.timeOffsetMin <= 30 &&
      haversineDistanceKm(lat, lon, strike.lat, strike.lon) <= 20
    );
    const nearest = nearestApproachingCell(scenario, lat, lon, offsetMin);
    const result = calculateRisk({
      communityId: `point-${lat.toFixed(2)},${lon.toFixed(2)}`,
      inputs,
      lightningWithin5km15minCount: values.lightningWithin5km15minCount,
      lightningSummary: {
        count30min: values.lightning30minCount,
        nearestStrikeKm: strikes.length
          ? Math.min(...strikes.map((strike) => haversineDistanceKm(lat, lon, strike.lat, strike.lon)))
          : null,
      },
      fetchedAt: observedAt,
      isMock: true,
    });
    result.noticeTh = values.rainNowMmHr >= 2
      ? `มีฝนตกในพื้นที่ตอนนี้ (${values.rainNowMmHr} มม./ชม.) · ข้อมูลจำลองจาก scenario: ${scenarioName}`
      : nearest
        ? `ฝนกำลังเข้าใกล้ ประมาณ ${nearest.etaMin} นาที · ข้อมูลจำลองจาก scenario: ${scenarioName}`
        : values.rainNowMmHr >= 0.5
          ? `มีฝนเล็กน้อยใกล้พื้นที่ (${values.rainNowMmHr} มม./ชม.) · ข้อมูลจำลองจาก scenario: ${scenarioName}`
          : `ไม่มีฝนใกล้พื้นที่ · ข้อมูลจำลองจาก scenario: ${scenarioName}`;
    return result;
  }
}
