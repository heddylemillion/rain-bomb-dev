import {
  CommunitySchema,
  AreaEnvironmentSchema,
  GeocodingResultSchema,
  PointRiskResponseSchema,
  WeatherBundleSchema,
} from '../../shared/contracts.js';
import type {
  AreaEnvironment,
  Community,
  GeocodingResult,
  PointRiskResponse,
  WeatherBundle,
} from '../../shared/contracts.js';
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

export async function searchPlaces(
  query: string,
  signal: AbortSignal,
  language: 'th' | 'en' = 'th'
): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({ q: query, lang: language });
  const payload = await getJson(`/api/geocode?${params}`, signal);
  return z.object({ results: z.array(GeocodingResultSchema) }).parse(payload).results;
}

export async function reverseGeocode(
  lat: number,
  lon: number,
  signal: AbortSignal,
  language: 'th' | 'en' = 'th'
): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: language });
  const payload = await getJson(`/api/reverse-geocode?${params}`, signal);
  return z.object({ result: GeocodingResultSchema.nullable() }).parse(payload).result;
}

export async function fetchPointRisk(
  lat: number,
  lon: number,
  signal: AbortSignal,
  options: { scenario?: 'calm' | 'moderate' | 'burst'; date?: string; offsetMin?: number } = {}
): Promise<PointRiskResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (options.scenario) params.set('scenario', options.scenario);
  if (options.date) params.set('date', options.date);
  if (options.offsetMin !== undefined) params.set('offsetMin', String(options.offsetMin));
  const payload = await getJson(`/api/risk?${params}`, signal);
  return PointRiskResponseSchema.parse(payload);
}

export async function fetchAreaEnvironment(
  lat: number,
  lon: number,
  communityId: string,
  signal: AbortSignal
): Promise<AreaEnvironment> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    communityId,
  });
  const payload = await getJson(`/api/environment?${params}`, signal);
  return AreaEnvironmentSchema.parse(payload);
}
