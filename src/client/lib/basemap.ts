export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const OSM_RASTER_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function getBasemapStyleUrl(
  provider: string | undefined,
  styleUrl: string | undefined
): string | null {
  if (provider === 'selfhosted') {
    if (!styleUrl) return null;
    try {
      return new URL(styleUrl).toString();
    } catch {
      return null;
    }
  }
  if (styleUrl) {
    try {
      return new URL(styleUrl).toString();
    } catch {
      return OPENFREEMAP_STYLE_URL;
    }
  }
  return OPENFREEMAP_STYLE_URL;
}
