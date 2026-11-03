import { describe, expect, it, vi } from 'vitest';
import { MockLightningProvider, NoLightningProvider } from '../services/weatherProviders.js';
import { RiskDataService } from '../services/riskDataService.js';

function openMeteoForecast(now: number): unknown {
  const firstHour = Math.floor(now / 3_600_000) * 3_600_000;
  return {
    hourly: {
      time: Array.from({ length: 24 }, (_, index) =>
        new Date(firstHour + index * 3_600_000).toISOString().slice(0, 16)),
      precipitation: Array.from({ length: 24 }, (_, index) => index < 3 ? 2 : 0.2),
      precipitation_probability: Array.from({ length: 24 }, (_, index) => index < 3 ? 80 : 10),
      relative_humidity_2m: Array.from({ length: 24 }, () => 85),
      pressure_msl: Array.from({ length: 24 }, (_, index) => 1008 - index * 0.1),
    },
  };
}

describe('RiskDataService', () => {
  it('uses the Open-Meteo forecast and keeps an unconfigured lightning factor unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(openMeteoForecast(Date.now())), { status: 200 })
    );
    const result = await new RiskDataService('live', new NoLightningProvider('live'), fetcher)
      .getPointRisk(13.75, 100.5);

    const lightning = result.factors.find((factor) => factor.id === 'lightning30minCount');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('api.open-meteo.com/v1/forecast');
    expect(lightning).toMatchObject({
      available: false,
      rawValue: null,
      reason: 'unavailable',
      source: 'No lightning provider configured',
    });
    expect(result.confidence).toBeLessThan(1);
    expect(result.lightningSummary).toEqual({ count30min: null, nearestStrikeKm: null });
  });

  it('does not make any outbound calls in mock mode', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await new RiskDataService('mock', new MockLightningProvider(), fetcher)
      .getPointRisk(13.75, 100.5);

    expect(result.isMock).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not make a network request in cache mode without a saved forecast', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await new RiskDataService('cache', new NoLightningProvider('cache'), fetcher)
      .getPointRisk(13.75, 100.5);

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.factors.every((factor) => !factor.available)).toBe(true);
  });
});
