import {
  CommunitySchema,
  RiskResultSchema,
  WeatherBundleSchema,
} from '../../shared/contracts.js';
import type { Community, RiskResult, WeatherBundle } from '../../shared/contracts.js';
import { z } from 'zod';

const CommunitiesResponseSchema = z.object({
  communities: z.array(CommunitySchema),
});

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const payload: unknown = await response.json();
  return payload;
}

export async function fetchMockRiskResult(
  communityId: string,
  signal: AbortSignal
): Promise<RiskResult> {
  const payload = await getJson(
    `/api/risk/${encodeURIComponent(communityId)}`,
    signal
  );
  return RiskResultSchema.parse(payload);
}

export async function fetchCommunities(signal: AbortSignal): Promise<Community[]> {
  const payload = await getJson('/api/communities', signal);
  return CommunitiesResponseSchema.parse(payload).communities;
}

export async function fetchCommunityWeather(
  communityId: string,
  signal: AbortSignal
): Promise<WeatherBundle> {
  const payload = await getJson(
    `/api/weather/${encodeURIComponent(communityId)}`,
    signal
  );
  return WeatherBundleSchema.parse(payload);
}
