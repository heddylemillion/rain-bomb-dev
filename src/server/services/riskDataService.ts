import { calculateRisk, haversineDistanceKm, type RiskInput } from './riskService.js';
import { classifyProbeError } from './capabilityService.js';
import { XweatherClient, XweatherClientError } from './xweatherClient.js';
import { logger, redactSecretsInText } from '../logger.js';
import type { RiskDataReason, RiskResult } from '../../shared/contracts.js';
import type {
  XweatherConditionEnvelope,
  XweatherForecastEnvelope,
  XweatherObservationEnvelope,
} from '../schemas/xweather.schema.js';
import {
  createMockScenario,
  getMockRiskInputs,
  nearestApproachingCell,
  scenarioLightningStrikes,
  type MockScenarioName,
} from '../../shared/mockWeatherScenario.js';
import type { DataMode } from './environmentDataService.js';

interface SourceResult<T> {
  value: T | null;
  reason: RiskDataReason;
  observedAt: string | null;
  fetchedAt: string | null;
  stale: boolean;
}

interface SourceCacheEntry {
  value: unknown | null;
  reason: RiskDataReason;
  storedAt: number;
  expiresAt: number;
}

const STALE_LIMIT_MS = 30 * 60 * 1000;

function firstPeriod<T extends { response: Array<{ periods: unknown[] }> }>(envelope: T): unknown[] {
  return envelope.response[0]?.periods ?? [];
}

function rawRecords(envelope: { response: unknown[] | Record<string, unknown> }): Record<string, unknown>[] {
  const records = Array.isArray(envelope.response) ? envelope.response : [envelope.response];
  return records.flatMap((record) => {
    const item = asRecord(record);
    if (!item) return [];
    const periods = item['periods'];
    return Array.isArray(periods)
      ? periods.filter((period): period is Record<string, unknown> => typeof period === 'object' && period !== null)
      : [item];
  });
}

function numeric(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function errorReason(error: unknown): RiskDataReason {
  if (error instanceof XweatherClientError) return classifyProbeError(error);
  return 'error';
}

function currentObservation(envelope: XweatherObservationEnvelope | null): Record<string, unknown> | null {
  const observation = envelope?.response[0];
  return observation ? observation.ob as Record<string, unknown> : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function pressureAt(records: Record<string, unknown>[], targetTime: number): number | null {
  const candidates = records
    .map((record) => ({
      time: Date.parse(String(record['dateTimeISO'] ?? '')),
      pressure: numeric(asRecord(record['ob']) ?? record, 'pressureMB'),
    }))
    .filter((record) => Number.isFinite(record.time) && record.pressure !== null)
    .sort((a, b) => Math.abs(a.time - targetTime) - Math.abs(b.time - targetTime));
  const nearest = candidates[0];
  return nearest && Math.abs(nearest.time - targetTime) <= 90 * 60 * 1000 ? nearest.pressure : null;
}

function alertSeverity(envelope: { response: unknown[] | Record<string, unknown> } | null): 'moderate' | 'severe' | 'extreme' | null {
  if (!envelope) return null;
  const records = Array.isArray(envelope.response) ? envelope.response : [envelope.response];
  const severities = records.map((record) => {
    const item = asRecord(record);
    const severity = String(item?.['severity'] ?? item?.['level'] ?? '').toLowerCase();
    return severity.includes('extreme') ? 'extreme' : severity.includes('severe') ? 'severe' :
      severity.includes('moderate') ? 'moderate' : null;
  });
  if (severities.includes('extreme')) return 'extreme';
  if (severities.includes('severe')) return 'severe';
  if (severities.includes('moderate')) return 'moderate';
  return null;
}

function lightningMetrics(
  envelope: { response: unknown[] | Record<string, unknown> },
  lat: number,
  lon: number,
  now: number
): { count30m: number; nearestKm: number | null; within5km15m: number } {
  const strikes = Array.isArray(envelope.response) ? envelope.response : [envelope.response];
  const recent = strikes.flatMap((strike) => {
    const item = asRecord(strike);
    const location = asRecord(item?.['loc']);
    const observation = asRecord(item?.['ob']);
    const strikeLat = numeric(location ?? undefined, 'lat');
    const strikeLon = numeric(location ?? undefined, 'long');
    const strikeTime = numeric(observation ?? undefined, 'timestamp');
    if (strikeLat === null || strikeLon === null || strikeTime === null) return [];
    const ageSeconds = now / 1000 - strikeTime;
    if (ageSeconds < 0 || ageSeconds > 30 * 60) return [];
    const distanceKm = haversineDistanceKm(lat, lon, strikeLat, strikeLon);
    return distanceKm <= 20 ? [{ ageSeconds, distanceKm }] : [];
  });
  return {
    count30m: recent.length,
    nearestKm: recent.length ? Math.min(...recent.map((strike) => strike.distanceKm)) : null,
    within5km15m: recent.filter((strike) => strike.distanceKm <= 5 && strike.ageSeconds <= 15 * 60).length,
  };
}

function responseObservedAt(value: unknown): string | null {
  const record = asRecord(value);
  const response = record?.['response'];
  const first = Array.isArray(response) ? asRecord(response[0]) : asRecord(response);
  const periods = first?.['periods'];
  const firstPeriod = Array.isArray(periods) ? asRecord(periods[0]) : null;
  const observation = asRecord(first?.['ob']);
  const date = firstPeriod?.['dateTimeISO'] ?? observation?.['dateTimeISO'] ??
    first?.['obDateTime'] ?? first?.['dateTimeISO'];
  return typeof date === 'string' && !Number.isNaN(Date.parse(date))
    ? date
    : null;
}

export class RiskDataService {
  private readonly client: XweatherClient;
  private readonly dataMode: DataMode;
  private readonly sourceCache = new Map<string, SourceCacheEntry>();
  private readonly failureCache = new Map<string, { reason: RiskDataReason; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<SourceResult<unknown>>>();

  constructor(client: XweatherClient, dataMode: DataMode = 'live') {
    this.client = client;
    this.dataMode = dataMode;
  }

  public async getPointRisk(
    lat: number,
    lon: number,
    mockOptions: { scenario?: MockScenarioName; date?: string; offsetMin?: number } = {}
  ): Promise<RiskResult> {
    if (this.dataMode === 'mock') {
      return this.getMockPointRisk(lat, lon, mockOptions);
    }
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const [conditions, observations, forecast, archive, lightningSource, alerts] = await Promise.all([
      this.source(`conditions:${key}`, 5 * 60 * 1000, () => this.client.fetchConditions(lat, lon)),
      this.source(`observations:${key}`, 5 * 60 * 1000, () => this.client.fetchObservations(lat, lon)),
      this.source(`forecast:${key}`, 15 * 60 * 1000, () => this.client.fetchHourlyForecast(lat, lon, 24)),
      this.source(`archive:${key}`, 5 * 60 * 1000, () => this.client.fetchObservationsArchive(lat, lon)),
      this.source(`lightning:${key}`, 2 * 60 * 1000, () => this.client.fetchLightningWithin(lat, lon)),
      this.source(`alerts:${key}`, 5 * 60 * 1000, () =>
        this.client.fetchRawEndpoint(`/alerts/${lat},${lon}`, {}, true)),
    ]);

    const now = Date.now();
    const cond = conditions.value as XweatherConditionEnvelope | null;
    const obs = observations.value as XweatherObservationEnvelope | null;
    const forecastEnvelope = forecast.value as XweatherForecastEnvelope | null;
    const condition = cond?.response[0]?.periods[0];
    const observation = currentObservation(obs);
    const forecastPeriods = forecastEnvelope ? firstPeriod(forecastEnvelope) : [];
    const firstThree = forecastPeriods.slice(0, 3).map((period) => asRecord(period));
    const rainValues = firstThree.map((period) => numeric(period ?? undefined, 'precipMM'));
    const popValues = firstThree.map((period) => numeric(period ?? undefined, 'pop'));
    const forecastAll24 = forecastPeriods.slice(0, 24).map((period) => asRecord(period));
    const forecastRain24 = forecastAll24.map((period) => numeric(period ?? undefined, 'precipMM'));
    const archiveRecords = archive.value ? rawRecords(archive.value as { response: unknown[] | Record<string, unknown> }) : [];
    const pressureNow = numeric(observation ?? undefined, 'pressureMB');
    const pressureThreeHoursAgo = pressureAt(archiveRecords, now - 3 * 60 * 60 * 1000);
    const lightning = lightningSource.value
      ? lightningMetrics(lightningSource.value as { response: unknown[] | Record<string, unknown> }, lat, lon, now)
      : null;

    const sources: Record<string, SourceResult<unknown>> = {
      conditions,
      observations,
      forecast,
      archive,
      lightning: lightningSource,
      alerts,
    };
    const input = (
      id: RiskInput['id'],
      rawValue: number | null,
      sourceNames: Array<keyof typeof sources>
    ): RiskInput => {
      const sourceResults = sourceNames.map((name) => sources[name]);
      const sourceResult = rawValue === null
        ? sourceResults.find((result) => result.value === null && result.reason !== 'ok') ??
          sourceResults.find((result) => result.value !== null)
        : sourceResults.find((result) => result.value !== null);
      return {
        id,
        rawValue,
        source: sourceNames.join(' + '),
        observedAt: sourceResult?.observedAt ?? null,
        reason: sourceResult?.reason ?? 'error',
      };
    };
    const rainNow = numeric(condition as Record<string, unknown> | undefined, 'precipRateMM');
    const humidity = numeric(condition as Record<string, unknown> | undefined, 'humidity') ??
      numeric(observation ?? undefined, 'humidity');
    const inputs: RiskInput[] = [
      input('rainNowMmHr', rainNow, ['conditions']),
      input('peakRain3hMmHr', rainValues.length === 3 && rainValues.every((value) => value !== null)
        ? Math.max(...rainValues as number[])
        : null, ['forecast']),
      input('accum3hMm', rainValues.length === 3 && rainValues.every((value) => value !== null)
        ? rainValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null, ['forecast']),
      input('accum24hMm', forecastRain24.length === 24 && forecastRain24.every((value) => value !== null)
        ? forecastRain24.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null, ['forecast']),
      input('popMax3hPct', popValues.length === 3 && popValues.every((value) => value !== null)
        ? Math.max(...popValues as number[])
        : null, ['forecast']),
      input('lightning30minCount', lightning?.count30m ?? null, ['lightning']),
      input('pressureDrop3hHpa', pressureNow !== null && pressureThreeHoursAgo !== null
        ? pressureThreeHoursAgo - pressureNow
        : null, ['observations', 'archive']),
      input('humidityPct', humidity, ['conditions', 'observations']),
    ];

    const successfulTimes = Object.values(sources)
      .filter((result) => result.fetchedAt !== null)
      .map((result) => result.fetchedAt as string);
    const result = calculateRisk({
      communityId: `point-${key}`,
      inputs,
      lightningWithin5km15minCount: lightning?.within5km15m ?? null,
      severeAlert: alertSeverity(alerts.value as { response: unknown[] | Record<string, unknown> } | null),
      fetchedAt: successfulTimes.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
      lightningSummary: {
        count30min: lightning?.count30m ?? null,
        nearestStrikeKm: lightning?.nearestKm ?? null,
      },
    });
    result.factors = result.factors.map((factor) => {
      const sourceResult = factor.id === 'rainNowMmHr' ? conditions
        : ['peakRain3hMmHr', 'accum3hMm', 'accum24hMm', 'popMax3hPct'].includes(factor.id) ? forecast
          : factor.id === 'lightning30minCount' ? lightningSource
            : factor.id === 'pressureDrop3hHpa' ? (observations.stale || archive.stale ? observations : archive)
              : (conditions.value !== null ? conditions : observations);
      return {
        ...factor,
        isStale: sourceResult?.stale ?? false,
        ...(sourceResult?.stale ? { source: `${factor.source} · ข้อมูลเก่า` } : {}),
      };
    });
    return result;
  }

  private getMockPointRisk(
    lat: number,
    lon: number,
    options: { scenario?: MockScenarioName; date?: string; offsetMin?: number }
  ): RiskResult {
    const scenarioName = options.scenario ?? 'moderate';
    const date = options.date ?? new Date().toISOString().slice(0, 10);
    const offsetMin = options.offsetMin ?? 0;
    const scenario = createMockScenario(scenarioName, date);
    const values = getMockRiskInputs(scenario, lat, lon, offsetMin);
    const source = `จำลอง (scenario: ${scenarioName})`;
    const observedAt = new Date(Date.now() + offsetMin * 60_000).toISOString();
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
          ? Math.min(...strikes.map((strike) =>
            haversineDistanceKm(lat, lon, strike.lat, strike.lon)))
          : null,
      },
      fetchedAt: observedAt,
      isMock: true,
    });
    result.noticeTh = nearest
      ? `ฝนกำลังเข้าใกล้ ประมาณ ${nearest.etaMin} นาที · ข้อมูลจำลองจาก scenario: ${scenarioName}`
      : `ไม่มีฝนใกล้พื้นที่ · ข้อมูลจำลองจาก scenario: ${scenarioName}`;
    return result;
  }

  private async source<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>
  ): Promise<SourceResult<T>> {
    const now = Date.now();
    const cached = this.sourceCache.get(key);
    if (cached && cached.expiresAt > now) {
      return {
        value: cached.value as T | null,
        reason: cached.reason,
        observedAt: cached.value === null ? null : responseObservedAt(cached.value),
        fetchedAt: cached.value === null ? null : new Date(cached.storedAt).toISOString(),
        stale: false,
      };
    }
    const recentFailure = this.failureCache.get(key);
    if (recentFailure && recentFailure.expiresAt > now) {
      if (cached?.value !== null && cached !== undefined && now - cached.storedAt <= STALE_LIMIT_MS) {
        return {
          value: cached.value as T,
          reason: 'ok',
          observedAt: responseObservedAt(cached.value),
          fetchedAt: new Date(cached.storedAt).toISOString(),
          stale: true,
        };
      }
      return {
        value: null,
        reason: recentFailure.reason,
        observedAt: cached?.value !== null && cached !== undefined
          ? responseObservedAt(cached.value)
          : null,
        fetchedAt: cached?.value !== null && cached !== undefined
          ? new Date(cached.storedAt).toISOString()
          : null,
        stale: false,
      };
    }
    const active = this.inFlight.get(key);
    if (active) return active as Promise<SourceResult<T>>;
    const request = fetcher().then((value): SourceResult<T> => {
      const storedAt = Date.now();
      this.sourceCache.set(key, { value, reason: 'ok', storedAt, expiresAt: storedAt + ttlMs });
      this.failureCache.delete(key);
      return {
        value,
        reason: 'ok',
        observedAt: responseObservedAt(value),
        fetchedAt: new Date(storedAt).toISOString(),
        stale: false,
      };
    }).catch((error: unknown): SourceResult<T> => {
      const reason = errorReason(error);
      this.failureCache.set(key, { reason, expiresAt: now + Math.min(ttlMs, 60 * 1000) });
      const previous = this.sourceCache.get(key);
      if (previous?.value !== null && previous !== undefined &&
          Date.now() - previous.storedAt <= STALE_LIMIT_MS) {
        logger.warn(
          { source: key.split(':')[0], reason, error: redactSecretsInText(error instanceof Error ? error.message : String(error)) },
          'Serving stale Xweather factor data within the 30-minute limit'
        );
        return {
          value: previous.value as T,
          reason: 'ok',
          observedAt: responseObservedAt(previous.value),
          fetchedAt: new Date(previous.storedAt).toISOString(),
          stale: true,
        };
      }
      return {
        value: null,
        reason,
        observedAt: previous?.value !== null && previous !== undefined
          ? responseObservedAt(previous.value)
          : null,
        fetchedAt: previous?.value !== null && previous !== undefined
          ? new Date(previous.storedAt).toISOString()
          : null,
        stale: false,
      };
    }).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, request as Promise<SourceResult<unknown>>);
    return request;
  }
}
