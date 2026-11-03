import {
  LightningSummarySchema,
  ProviderStatusResponseSchema,
  RadarFramesResponseSchema,
  StormTrackFeatureCollectionSchema,
} from '../../shared/providerContracts.js';
import type {
  LightningSummary,
  ProviderStatusResponse,
  RadarFramesResponse,
  StormTrackFeatureCollection,
} from '../../shared/providerContracts.js';

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Provider request failed with status ${response.status}`);
  return response.json();
}

export async function fetchProviderStatus(signal: AbortSignal): Promise<ProviderStatusResponse> {
  return ProviderStatusResponseSchema.parse(await getJson('/api/providers/status', signal));
}

export async function fetchRadarFrames(
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<RadarFramesResponse> {
  const query = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return RadarFramesResponseSchema.parse(await getJson(`/api/radar/frames?${query}`, signal));
}

export async function fetchLightningSummary(
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<LightningSummary> {
  const query = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return LightningSummarySchema.parse(await getJson(`/api/lightning/summary?${query}`, signal));
}

export async function fetchStormTracks(signal: AbortSignal): Promise<StormTrackFeatureCollection> {
  return StormTrackFeatureCollectionSchema.parse(await getJson('/api/storm-tracks', signal));
}
