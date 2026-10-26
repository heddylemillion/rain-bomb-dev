import type {
  CapabilitiesResponse,
  Capability,
  CapabilityId,
} from '../../shared/contracts.js';
import type { CommunityConfig } from '../types/weather.js';
import { XweatherClient, XweatherClientError } from './xweatherClient.js';

const MOCK_STATUS_BY_ID: ReadonlyArray<{
  id: CapabilityId;
  available: boolean;
  reason: Capability['reason'];
}> = [
  { id: 'overview-map', available: true, reason: 'ok' },
  { id: 'risk-summary', available: true, reason: 'ok' },
  { id: 'current-conditions', available: true, reason: 'ok' },
  { id: 'observations', available: true, reason: 'ok' },
  { id: 'hourly-forecast', available: true, reason: 'ok' },
  { id: 'daily-forecast', available: true, reason: 'ok' },
  { id: 'lightning', available: false, reason: 'error' },
  { id: 'lightning-strikes', available: false, reason: 'error' },
  { id: 'lightning-threats', available: false, reason: 'error' },
  { id: 'official-alerts', available: false, reason: 'error' },
  { id: 'tropical-cyclones', available: false, reason: 'error' },
  { id: 'air-quality', available: false, reason: 'error' },
  { id: 'history-calibration', available: false, reason: 'error' },
  { id: 'alert-history', available: false, reason: 'error' },
  { id: 'radar-layer', available: false, reason: 'error' },
  { id: 'satellite-layer', available: false, reason: 'error' },
  { id: 'canal-level', available: false, reason: 'error' },
  { id: 'tide', available: false, reason: 'error' },
  { id: 'dem', available: false, reason: 'error' },
];

export function getMockCapabilities(
  checkedAt = new Date().toISOString()
): CapabilitiesResponse {
  return {
    capabilities: MOCK_STATUS_BY_ID.map((status) => ({
      ...status,
      checkedAt,
    })),
    checkedAt,
    isMock: true,
  };
}

export function getErrorCapabilities(
  checkedAt = new Date().toISOString()
): CapabilitiesResponse {
  return {
    capabilities: MOCK_STATUS_BY_ID.map(({ id }) => ({
      id,
      available: false,
      reason: 'error',
      checkedAt,
    })),
    checkedAt,
    isMock: false,
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

export async function checkXweatherCapabilities(
  client: XweatherClient,
  community: CommunityConfig
): Promise<CapabilitiesResponse> {
  const checkedAt = new Date().toISOString();
  const location = `${community.lat},${community.lon}`;
  const checks = await Promise.all([
    checkEndpoint(client, 'hourly-forecast', `/forecasts/${location}?filter=1hr`, checkedAt),
    checkEndpoint(client, 'daily-forecast', `/forecasts/${location}?filter=day`, checkedAt),
    checkEndpoint(client, 'observations', `/observations/${location}`, checkedAt),
    checkEndpoint(client, 'current-conditions', `/conditions/${location}`, checkedAt),
    checkEndpoint(client, 'official-alerts', `/alerts/${location}`, checkedAt),
    checkEndpoint(client, 'lightning-strikes', `/lightning/${location}`, checkedAt),
    checkEndpoint(client, 'lightning-threats', `/lightning/threats/${location}`, checkedAt),
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

  const lightningChecks = [strikes, threats].filter(
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
    { id: 'tropical-cyclones', available: false, reason: 'error', checkedAt },
    { id: 'air-quality', available: false, reason: 'error', checkedAt },
    { id: 'history-calibration', available: false, reason: 'error', checkedAt },
    { id: 'alert-history', available: false, reason: 'error', checkedAt },
    { id: 'radar-layer', available: false, reason: 'error', checkedAt },
    { id: 'satellite-layer', available: false, reason: 'error', checkedAt },
    { id: 'canal-level', available: false, reason: 'error', checkedAt },
    { id: 'tide', available: false, reason: 'error', checkedAt },
    { id: 'dem', available: false, reason: 'error', checkedAt },
  ];

  return { capabilities, checkedAt, isMock: false };
}
