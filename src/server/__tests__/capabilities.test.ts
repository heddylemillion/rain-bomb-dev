import { describe, expect, it } from 'vitest';
import { checkXweatherCapabilities, getMockCapabilities } from '../services/capabilityService.js';
import { XweatherClient } from '../services/xweatherClient.js';
import type { CommunityConfig } from '../types/weather.js';

const community: CommunityConfig = {
  id: 'sample-community',
  name_th: 'ชุมชนตัวอย่าง',
  name_en: 'Sample community',
  lat: 14.0647,
  lon: 100.6186,
  elevation_m: 2.5,
  soil_group: 'D',
  drainage_capacity_mm_hr: 25,
  canal_station_id: null,
  calibration_status: 'TO BE CALIBRATED',
};

describe('Xweather capability checks', () => {
  it('uses a visibly mocked capability response when credentials are unavailable', () => {
    const result = getMockCapabilities('2026-10-26T16:00:00.000Z');
    expect(result.isMock).toBe(true);
    expect(result.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'risk-summary',
          available: true,
          reason: 'ok',
          checkedAt: '2026-10-26T16:00:00.000Z',
        }),
      ])
    );
  });

  it('probes weather and alert endpoints, classifies explicit plan and coverage errors, and never returns credentials', async () => {
    const requestedPaths: string[] = [];
    const clientId = 'test-client-id';
    const clientSecret = 'test-client-secret';
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId,
      clientSecret,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        requestedPaths.push(url.pathname);
        if (url.pathname.startsWith('/alerts/')) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: 'plan_not_included', description: 'Feature not included' },
              response: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.pathname.startsWith('/lightning/threats/')) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: 'no_coverage', description: 'No coverage for location' },
              response: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, error: null, response: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const result = await checkXweatherCapabilities(client, community);
    const statusById = new Map(
      result.capabilities.map((capability) => [capability.id, capability])
    );

    expect(result.isMock).toBe(false);
    expect(statusById.get('hourly-forecast')).toMatchObject({
      available: true,
      reason: 'ok',
    });
    expect(statusById.get('official-alerts')).toMatchObject({
      available: false,
      reason: 'no_plan',
    });
    expect(statusById.get('lightning-threats')).toMatchObject({
      available: false,
      reason: 'no_coverage',
    });
    expect(requestedPaths).toEqual(
      expect.arrayContaining([
        '/forecasts/14.0647,100.6186',
        '/observations/14.0647,100.6186',
        '/conditions/14.0647,100.6186',
        '/alerts/14.0647,100.6186',
        '/lightning/14.0647,100.6186',
        '/lightning/threats/14.0647,100.6186',
      ])
    );
    expect(JSON.stringify(result)).not.toContain(clientId);
    expect(JSON.stringify(result)).not.toContain(clientSecret);
  });
});
