import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLES_DIR_PATH } from '../config.js';
import {
  XweatherConditionEnvelopeSchema,
  XweatherForecastEnvelopeSchema,
  XweatherObservationEnvelopeSchema,
} from '../schemas/xweather.schema.js';
import { RiskDataService } from '../services/riskDataService.js';
import { XweatherClient, XweatherClientError } from '../services/xweatherClient.js';

async function sample(filename: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(SAMPLES_DIR_PATH, filename), 'utf8')) as unknown;
}

function noPlanError(): XweatherClientError {
  return new XweatherClientError({
    message: 'Endpoint not included in the current plan',
    kind: 'API_ERROR',
    apiErrorCode: 'not_included',
    redactedUrl: 'https://data.api.xweather.com/unavailable',
  });
}

describe('RiskDataService', () => {
  it('calculates only from saved Xweather responses and deduplicates successful and unavailable sources', async () => {
    const conditions = XweatherConditionEnvelopeSchema.parse(await sample('conditions.json'));
    const observations = XweatherObservationEnvelopeSchema.parse(await sample('observations.json'));
    const forecast = XweatherForecastEnvelopeSchema.parse(await sample('forecasts-1hr.json'));
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: 'test_client',
      clientSecret: 'test_secret',
    });
    const conditionsSpy = vi.spyOn(client, 'fetchConditions').mockResolvedValue(conditions);
    const observationsSpy = vi.spyOn(client, 'fetchObservations').mockResolvedValue(observations);
    const forecastSpy = vi.spyOn(client, 'fetchHourlyForecast').mockResolvedValue(forecast);
    const archiveSpy = vi.spyOn(client, 'fetchObservationsArchive').mockRejectedValue(noPlanError());
    const lightningSpy = vi.spyOn(client, 'fetchLightningWithin').mockRejectedValue(noPlanError());
    const alertsSpy = vi.spyOn(client, 'fetchRawEndpoint').mockRejectedValue(noPlanError());
    const service = new RiskDataService(client);

    const [first, second] = await Promise.all([
      service.getPointRisk(14.0647, 100.6186),
      service.getPointRisk(14.0647, 100.6186),
    ]);

    expect(first.score).not.toBeNull();
    expect(first.level).not.toBe('INSUFFICIENT');
    expect(first.isMock).toBe(false);
    expect(first.factors.find((factor) => factor.id === 'rainNowMmHr')).toMatchObject({
      rawValue: 0.03,
      available: true,
    });
    expect(first.factors.find((factor) => factor.id === 'lightning30minCount')).toMatchObject({
      rawValue: null,
      available: false,
      reason: 'no_plan',
    });
    expect(first.factors.find((factor) => factor.id === 'pressureDrop3hHpa')).toMatchObject({
      rawValue: null,
      available: false,
      reason: 'no_plan',
    });
    expect(first.fetchedAt).not.toBeNull();
    expect(second.score).toBe(first.score);
    expect(conditionsSpy).toHaveBeenCalledTimes(1);
    expect(observationsSpy).toHaveBeenCalledTimes(1);
    expect(forecastSpy).toHaveBeenCalledTimes(1);
    expect(archiveSpy).toHaveBeenCalledTimes(1);
    expect(lightningSpy).toHaveBeenCalledTimes(1);
    expect(alertsSpy).toHaveBeenCalledTimes(1);
  });

  it('treats a successful empty lightning response as a real zero count', async () => {
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: 'test_client',
      clientSecret: 'test_secret',
    });
    vi.spyOn(client, 'fetchConditions').mockRejectedValue(noPlanError());
    vi.spyOn(client, 'fetchObservations').mockRejectedValue(noPlanError());
    vi.spyOn(client, 'fetchHourlyForecast').mockRejectedValue(noPlanError());
    vi.spyOn(client, 'fetchObservationsArchive').mockRejectedValue(noPlanError());
    vi.spyOn(client, 'fetchLightningWithin').mockResolvedValue({
      success: true,
      error: null,
      response: [],
    });
    vi.spyOn(client, 'fetchRawEndpoint').mockResolvedValue({
      success: true,
      error: null,
      response: [],
    });

    const result = await new RiskDataService(client).getPointRisk(14.0647, 100.6186);
    expect(result.score).toBeNull();
    expect(result.factors.find((factor) => factor.id === 'lightning30minCount')).toMatchObject({
      rawValue: 0,
      available: true,
    });
    expect(result.lightningSummary.count30min).toBe(0);
  });

  it('serves successful data stale for 30 minutes, then reports no data with the last success time', async () => {
    const start = new Date('2026-10-28T08:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const conditions = XweatherConditionEnvelopeSchema.parse(await sample('conditions.json'));
      const observations = XweatherObservationEnvelopeSchema.parse(await sample('observations.json'));
      const forecast = XweatherForecastEnvelopeSchema.parse(await sample('forecasts-1hr.json'));
      const client = new XweatherClient({
        baseUrl: 'https://data.api.xweather.com',
        clientId: 'test_client',
        clientSecret: 'test_secret',
      });
      const conditionsSpy = vi.spyOn(client, 'fetchConditions').mockResolvedValue(conditions);
      const observationsSpy = vi.spyOn(client, 'fetchObservations').mockResolvedValue(observations);
      const forecastSpy = vi.spyOn(client, 'fetchHourlyForecast').mockResolvedValue(forecast);
      vi.spyOn(client, 'fetchObservationsArchive').mockRejectedValue(noPlanError());
      vi.spyOn(client, 'fetchLightningWithin').mockRejectedValue(noPlanError());
      vi.spyOn(client, 'fetchRawEndpoint').mockRejectedValue(noPlanError());
      const service = new RiskDataService(client);
      const fresh = await service.getPointRisk(14.0647, 100.6186);

      conditionsSpy.mockRejectedValue(noPlanError());
      observationsSpy.mockRejectedValue(noPlanError());
      forecastSpy.mockRejectedValue(noPlanError());
      vi.setSystemTime(new Date(start.getTime() + 6 * 60 * 1000));
      const stale = await service.getPointRisk(14.0647, 100.6186);
      expect(stale.factors.find((factor) => factor.id === 'rainNowMmHr')).toMatchObject({
        available: true,
        isStale: true,
      });
      expect(stale.fetchedAt).toBe(fresh.fetchedAt);

      vi.setSystemTime(new Date(start.getTime() + 31 * 60 * 1000));
      const expired = await service.getPointRisk(14.0647, 100.6186);
      expect(expired.factors.find((factor) => factor.id === 'rainNowMmHr')).toMatchObject({
        available: false,
        reason: 'no_plan',
      });
      expect(expired.fetchedAt).toBe(fresh.fetchedAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
