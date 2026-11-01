import type L from 'leaflet';
import type { SoilInfo } from '../../shared/contracts.js';
import type { MessageKey } from '../i18n.js';

export const SOIL_TEXTURE_STYLES: Readonly<Record<string, L.PathOptions>> = {
  'ดินเหนียว': { color: '#76513f', fillColor: '#c6a08b' },
  'ดินเหนียวปนทรายแป้ง': {
    color: '#6e604a',
    fillColor: '#d4c09a',
    dashArray: '7 4',
  },
  'ดินร่วนปนทรายแป้ง': {
    color: '#5b5c59',
    fillColor: '#b3aaa0',
    dashArray: '2 4',
  },
  water: { color: '#4d6570', fillColor: '#9eb4be', dashArray: '1 4' },
};

export const SOIL_LEGEND_ITEMS: ReadonlyArray<{ label: MessageKey; texture: string }> = [
  { label: 'soilLegendClay', texture: 'ดินเหนียว' },
  { label: 'soilLegendClaySilt', texture: 'ดินเหนียวปนทรายแป้ง' },
  { label: 'soilLegendSiltLoam', texture: 'ดินร่วนปนทรายแป้ง' },
  { label: 'soilLegendWater', texture: 'water' },
];

export function soilPathStyle(
  feature: { properties: SoilInfo } | undefined,
  selected = false
): L.PathOptions {
  if (selected) {
    return {
      color: '#ffffff',
      fillColor: '#d8c6b5',
      weight: 4,
      opacity: 1,
      fillOpacity: 0.25,
    };
  }
  const style = SOIL_TEXTURE_STYLES[feature?.properties.textureTh ?? ''] ?? SOIL_TEXTURE_STYLES.water;
  return {
    ...style,
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0.25,
  };
}
