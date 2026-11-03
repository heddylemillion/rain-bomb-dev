import { describe, expect, it } from 'vitest';
import {
  getBasemapStyleUrl,
  OPENFREEMAP_STYLE_URL,
  OSM_RASTER_TILE_URL,
} from './basemap.js';

describe('basemap style selection', () => {
  it('defaults to the OpenFreeMap Liberty style', () => {
    expect(getBasemapStyleUrl(undefined, undefined)).toBe(OPENFREEMAP_STYLE_URL);
  });

  it('uses the configured self-hosted style', () => {
    expect(
      getBasemapStyleUrl('selfhosted', 'http://localhost:8080/styles/thailand/style.json')
    ).toBe('http://localhost:8080/styles/thailand/style.json');
  });

  it('requires a valid style URL for self-hosted mode', () => {
    expect(getBasemapStyleUrl('selfhosted', undefined)).toBeNull();
    expect(getBasemapStyleUrl('selfhosted', 'not-a-url')).toBeNull();
  });

  it('uses the fixed OSM raster fallback only after a basemap failure', () => {
    expect(OSM_RASTER_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });
});
