import type L from 'leaflet';
import type { SoilInfo } from '../../shared/contracts.js';
import type { MessageKey } from '../i18n.js';

export const SOIL_TEXTURE_PALETTE: Readonly<Record<string, L.PathOptions>> = {
  'ดินเหนียว': {
    color: '#6B4128',
    fillColor: '#8B5A3C',
    fillOpacity: 0.45,
  },
  'ดินเหนียวปนทรายแป้ง': {
    color: '#A8851C',
    fillColor: '#E3B833',
    fillOpacity: 0.5,
    dashArray: '7 4',
  },
  'ดินร่วนปนทรายแป้ง': {
    color: '#56685E',
    fillColor: '#8FA79A',
    fillOpacity: 0.5,
    dashArray: '2 4',
  },
  water: {
    color: '#356C8A',
    fillColor: '#7FB7D6',
    fillOpacity: 0.5,
    dashArray: '1 4',
  },
};

export const SOIL_LEGEND_ITEMS: ReadonlyArray<{ label: MessageKey; texture: string }> = [
  { label: 'soilLegendClay', texture: 'ดินเหนียว' },
  { label: 'soilLegendClaySilt', texture: 'ดินเหนียวปนทรายแป้ง' },
  { label: 'soilLegendSiltLoam', texture: 'ดินร่วนปนทรายแป้ง' },
  { label: 'soilLegendWater', texture: 'water' },
];

export function soilFeatureKey(
  soil: Pick<SoilInfo, 'soilCode' | 'soilGroup' | 'amphoeTh'>
): string {
  return JSON.stringify([soil.soilCode, soil.soilGroup, soil.amphoeTh]);
}

export function soilPathStyle(
  feature: { properties: SoilInfo } | undefined,
  selectedSoilKey: string | null = null
): L.PathOptions {
  // Matching by series, group, and district can intentionally select multiple adjacent polygons.
  if (feature && selectedSoilKey !== null && soilFeatureKey(feature.properties) === selectedSoilKey) {
    return {
      color: '#ffffff',
      fillColor: '#22C55E',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.35,
      dashArray: '',
    };
  }
  const style =
    SOIL_TEXTURE_PALETTE[feature?.properties.textureTh ?? ''] ??
    SOIL_TEXTURE_PALETTE.water;
  return {
    ...style,
    weight: 2,
    opacity: 1,
    dashArray: style.dashArray ?? '',
  };
}
