import {
  SoilFeatureCollectionSchema,
  SoilResponseSchema,
  type SoilFeatureCollection,
  type SoilResponse,
} from '../../shared/contracts.js';

export function roundSoilCoordinates(lat: number, lon: number): { lat: number; lon: number } {
  const round = (coordinate: number): number => {
    const rounded = Number(coordinate.toFixed(4));
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return { lat: round(lat), lon: round(lon) };
}

export async function fetchSoil(
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<SoilResponse> {
  const coordinates = roundSoilCoordinates(lat, lon);
  const params = new URLSearchParams({
    lat: String(coordinates.lat),
    lon: String(coordinates.lon),
  });
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
