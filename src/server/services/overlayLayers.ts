import { RADAR_OFFSET_HOURS, type OverlayLayerId } from '../../shared/contracts.js';

/**
 * Xweather Raster Maps layer codes per map overlay.
 * UNVERIFIED: codes come from public docs summaries, not from a successful call on this plan.
 */
export const XWEATHER_LAYER_CODE: Record<OverlayLayerId, string> = {
  radar: 'radar',
  lightning: 'lightning-strikes',
  storm: 'tropical-cyclones',
};

/** z=6 tile covering central Thailand (Pathum Thani ≈ 14.06N, 100.62E). Used only for availability probes. */
export const PROBE_TILE = { z: 6, x: 49, y: 30 } as const;

export function isOverlayLayerId(value: string): value is OverlayLayerId {
  return value === 'radar' || value === 'lightning' || value === 'storm';
}

/** Parses a whitelisted hour offset from the URL; returns null for anything else. */
export function parseOverlayHours(value: string): number | null {
  if (!/^-?\d{1,2}$/.test(value)) {
    return null;
  }
  const hours = Number(value);
  return (RADAR_OFFSET_HOURS as readonly number[]).includes(hours) ? hours : null;
}

/** `current`, or a relative offset such as `+1hour` / `-2hour` (offset syntax UNVERIFIED). */
export function hoursToXweatherOffset(hours: number): string {
  if (hours === 0) {
    return 'current';
  }
  return `${hours > 0 ? '+' : '-'}${Math.abs(hours)}hour`;
}
