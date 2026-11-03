export interface SelectedPlace {
  lat: number;
  lon: number;
  name: string;
  address?: string | undefined;
}

export const LAST_SELECTED_PLACE_KEY = 'rain-bomb-last-selected-place';

const THAILAND_BOUNDS = { minLat: 5.5, maxLat: 20.5, minLon: 97, maxLon: 106 };

function isInThailand(lat: number, lon: number): boolean {
  return (
    lat >= THAILAND_BOUNDS.minLat &&
    lat <= THAILAND_BOUNDS.maxLat &&
    lon >= THAILAND_BOUNDS.minLon &&
    lon <= THAILAND_BOUNDS.maxLon
  );
}

function parseSavedPlace(value: string | null): SelectedPlace | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('lat' in parsed) ||
      typeof parsed.lat !== 'number' ||
      !('lon' in parsed) ||
      typeof parsed.lon !== 'number' ||
      !('name' in parsed) ||
      typeof parsed.name !== 'string' ||
      !Number.isFinite(parsed.lat) ||
      !Number.isFinite(parsed.lon) ||
      !isInThailand(parsed.lat, parsed.lon)
    ) {
      return null;
    }
    return {
      lat: parsed.lat,
      lon: parsed.lon,
      name: parsed.name,
      ...('address' in parsed && typeof parsed.address === 'string'
        ? { address: parsed.address }
        : {}),
    };
  } catch {
    return null;
  }
}

export function initialPlace(
  params: URLSearchParams,
  defaultPlace: SelectedPlace,
  savedValue: string | null
): SelectedPlace {
  const rawLat = params.get('lat');
  const rawLon = params.get('lon');
  if (rawLat !== null && rawLon !== null) {
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && isInThailand(lat, lon)) {
      return { lat, lon, name: params.get('name') || 'ตำแหน่งที่แชร์' };
    }
  }
  return parseSavedPlace(savedValue) ?? defaultPlace;
}

export function isValidPlaceCoordinates(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && isInThailand(lat, lon);
}
