import type {
  CapabilitiesResponse,
  Capability,
  CapabilityId,
} from '../../shared/contracts.js';
import { CAPABILITY_IDS } from '../../shared/contracts.js';
import type { CommunityConfig } from '../types/weather.js';
import { PROBE_TILE, XWEATHER_LAYER_CODE } from './overlayLayers.js';
import { XweatherClient, XweatherClientError } from './xweatherClient.js';

export function getErrorCapabilities(
  checkedAt = new Date().toISOString(),
  demoMode = false
): CapabilitiesResponse {
  return {
    capabilities: CAPABILITY_IDS.map((id) => ({
      id,
      available: false,
      reason: 'error',
      checkedAt,
    })),
    checkedAt,
    isMock: false,
    demoMode,
  };
}

function classifyProbeError(error: unknown): Capability['reason'] {
  if (!(error instanceof XweatherClientError)) {
    return 'error';
  }

  const details = `${error.apiErrorCode ?? ''} ${error.message}`.toLowerCase();
  if (/no[_ -]?plan|not[_ -]?included|not[_ -]?subscribed|subscription|plan[_ -]?limit|feature[_ -]?not[_ -]?enabled/.test(details)) {
    return 'no_plan';
  }
  if (/no[_ -]?coverage|not[_ -]?covered|outside[_ -]?coverage|coverage[_ -]?unavailable|no[_ -]?data[_ -]?available/.test(details)) {
    return 'no_coverage';
  }

  return 'error';
}
export { classifyProbeError };

function unavailable(reason: Capability['reason']): Capability {
  return {
    id: 'risk-summary',
    available: false,
    reason,
    checkedAt: new Date().toISOString(),
  };
}

async function checkEndpoint(
  client: XweatherClient,
  id: CapabilityId,
  path: string,
  checkedAt: string
): Promise<Capability> {
  try {
    await client.probeEndpoint(path);
    return { id, available: true, reason: 'ok', checkedAt };
  } catch (error: unknown) {
    return {
      id,
      available: false,
      reason: classifyProbeError(error),
      checkedAt,
    };
  }
}

function combineEndpointChecks(
  id: CapabilityId,
  checks: readonly Capability[],
  checkedAt: string
): Capability {
  const unavailableCheck = checks.find((check) => !check.available);
  return unavailableCheck
    ? { ...unavailableCheck, id, checkedAt }
    : { id, available: true, reason: 'ok', checkedAt };
}

/**
 * Requests one raster tile for a Thailand-centred probe coordinate.
 * 200 + image/* => account can fetch the layer. It does NOT prove radar actually covers Thailand
 * (an empty transparent tile is also a 200), so coverage remains UNVERIFIED.
 */
async function checkRasterLayer(
  client: XweatherClient,
  id: CapabilityId,
  layer: keyof typeof XWEATHER_LAYER_CODE,
  checkedAt: string
): Promise<Capability> {
  const result = await client.fetchRasterTile({
    layer: XWEATHER_LAYER_CODE[layer],
    ...PROBE_TILE,
    offset: 'current',
  });
  if (result.ok) {
    return { id, available: true, reason: 'ok', checkedAt };
  }
  const reason: Capability['reason'] =
    result.status === 401 || result.status === 403
      ? 'no_plan'
      : result.status === 404
        ? 'no_coverage'
        : 'error';
  return { id, available: false, reason, checkedAt };
}

export async function checkXweatherCapabilities(
  client: XweatherClient,
  community: CommunityConfig,
  demoMode = false
): Promise<CapabilitiesResponse> {
  const checkedAt = new Date().toISOString();
  const location = `${community.lat},${community.lon}`;
  const [checks, radarTile, lightningTile, stormTile] = await Promise.all([
    Promise.all([
      checkEndpoint(client, 'hourly-forecast', `/forecasts/${location}?filter=1hr`, checkedAt),
      checkEndpoint(client, 'daily-forecast', `/forecasts/${location}?filter=day`, checkedAt),
      checkEndpoint(client, 'observations', `/observations/${location}`, checkedAt),
      checkEndpoint(client, 'current-conditions', `/conditions/${location}`, checkedAt),
      checkEndpoint(client, 'official-alerts', `/alerts/${location}`, checkedAt),
      checkEndpoint(client, 'lightning-strikes', `/lightning/${location}`, checkedAt),
      checkEndpoint(client, 'lightning-threats', `/lightning/threats/${location}`, checkedAt),
      checkEndpoint(client, 'history-calibration', `/observations/archive/${location}`, checkedAt),
    ]),
    checkRasterLayer(client, 'radar-layer', 'radar', checkedAt),
    checkRasterLayer(client, 'lightning', 'lightning', checkedAt),
    checkRasterLayer(client, 'tropical-cyclones', 'storm', checkedAt),
  ]);

  const byId = new Map(checks.map((check) => [check.id, check]));
  const hourly = byId.get('hourly-forecast');
  const daily = byId.get('daily-forecast');
  const observations = byId.get('observations');
  const conditions = byId.get('current-conditions');
  const strikes = byId.get('lightning-strikes');
  const threats = byId.get('lightning-threats');

  const aggregateCurrent =
    conditions?.available || observations?.available
      ? { id: 'current-conditions' as const, available: true, reason: 'ok' as const, checkedAt }
      : {
          ...(conditions ?? unavailable('error')),
          id: 'current-conditions' as const,
          checkedAt,
        };

  // The map's lightning layer needs the raster tile too, so include it in the aggregate.
  const lightningChecks = [strikes, threats, lightningTile].filter(
    (check): check is Capability => check !== undefined
  );
  const capabilities: Capability[] = [
    { id: 'overview-map', available: true, reason: 'ok', checkedAt },
    { id: 'risk-summary', available: true, reason: 'ok', checkedAt },
    aggregateCurrent,
    observations ?? { id: 'observations', available: false, reason: 'error', checkedAt },
    hourly ?? { id: 'hourly-forecast', available: false, reason: 'error', checkedAt },
    daily ?? { id: 'daily-forecast', available: false, reason: 'error', checkedAt },
    combineEndpointChecks('lightning', lightningChecks, checkedAt),
    strikes ?? { id: 'lightning-strikes', available: false, reason: 'error', checkedAt },
    threats ?? { id: 'lightning-threats', available: false, reason: 'error', checkedAt },
    byId.get('official-alerts') ?? {
      id: 'official-alerts',
      available: false,
      reason: 'error',
      checkedAt,
    },
    stormTile,
    { id: 'air-quality', available: false, reason: 'error', checkedAt },
    byId.get('history-calibration') ?? { id: 'history-calibration', available: false, reason: 'error', checkedAt },
    { id: 'alert-history', available: false, reason: 'error', checkedAt },
    radarTile,
    { id: 'satellite-layer', available: false, reason: 'error', checkedAt },
    { id: 'canal-level', available: false, reason: 'error', checkedAt },
    { id: 'tide', available: false, reason: 'error', checkedAt },
    { id: 'dem', available: false, reason: 'error', checkedAt },
  ];

  return { capabilities, checkedAt, isMock: false, demoMode };
}
