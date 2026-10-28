import { z } from 'zod';
import type { OverlayLayerId } from '../../shared/contracts.js';

export const XWEATHER_LAYER_CODE: Record<OverlayLayerId, string> = {
  radar: 'radar-global',
  lightning: 'lightning-flash',
  storm: 'tropical-cyclones',
};

export const RasterTileLayerSchema = z.enum([
  'radar',
  'radar-global',
  'lightning-flash',
  'tropical-cyclones',
]);

export const TileCoordinateSchema = z.object({
  z: z.coerce.number().int().min(0).max(12),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

export const RadarOffsetSchema = z.enum(['current', '-1hour', '-2hour', '-3hour']);

/** Availability probes test authorization, not whether a raster frame contains pixels over Thailand. */
export const PROBE_TILE = { z: 6, x: 49, y: 29 } as const;

export function isOverlayLayerId(value: string): value is OverlayLayerId {
  return value === 'radar' || value === 'lightning' || value === 'storm';
}

export function parseOverlayHours(value: string): number | null {
  if (!/^-?\d{1,2}$/.test(value)) return null;
  const hours = Number(value);
  return [-3, -2, -1, 0].includes(hours) ? hours : null;
}

export function hoursToXweatherOffset(hours: number): string {
  if (hours === 0) return 'current';
  return `${hours}hour`;
}
