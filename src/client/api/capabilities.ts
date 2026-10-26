import { CapabilitiesResponseSchema } from '../../shared/contracts.js';
import type { CapabilitiesResponse } from '../../shared/contracts.js';

export async function fetchCapabilities(signal: AbortSignal): Promise<CapabilitiesResponse> {
  const response = await fetch('/api/capabilities', { signal });
  if (!response.ok) {
    throw new Error(`Capabilities request failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  return CapabilitiesResponseSchema.parse(payload);
}
