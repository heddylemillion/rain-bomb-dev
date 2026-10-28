import {
  SoilFeatureCollectionSchema,
  SoilResponseSchema,
  type SoilFeatureCollection,
  type SoilResponse,
} from '../../shared/contracts.js';

export async function fetchSoil(
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<SoilResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const response = await fetch(`/api/soil?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`Soil request failed with status ${response.status}`);
  }
  const payload: unknown = await response.json();
  return SoilResponseSchema.parse(payload);
}

export async function fetchSoilLayer(signal: AbortSignal): Promise<SoilFeatureCollection> {
  const response = await fetch('/api/soil/layer', { signal });
  if (!response.ok) {
    throw new Error(`Soil layer request failed with status ${response.status}`);
  }
  const payload: unknown = await response.json();
  return SoilFeatureCollectionSchema.parse(payload);
}
