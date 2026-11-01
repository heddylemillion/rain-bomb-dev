import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SoilInfo } from '../../shared/contracts.js';
import {
  SOIL_LEGEND_ITEMS,
  SOIL_TEXTURE_PALETTE,
  soilFeatureKey,
  soilPathStyle,
} from './soilStyle.js';

const soilLayer = JSON.parse(
  readFileSync(new URL('../../../data/soil-pathumthani.geojson', import.meta.url), 'utf8')
) as {
  features: Array<{ properties: { textureTh?: string | null } }>;
};

const soil: SoilInfo = {
  soilCode: 'Rs',
  soilNameTh: 'รังสิต',
  soilGroup: '11',
  textureTh: 'ดินเหนียว',
  phTopTh: 'กรดจัดมาก',
  fertilityTh: 'ปานกลาง',
  amphoeTh: 'คลองหลวง',
  drainageClass: null,
};

describe('soil map styles', () => {
  it('has a palette entry for every texture value in the source GeoJSON', () => {
    const textures = new Set(
      soilLayer.features.map((feature) => feature.properties.textureTh ?? '')
    );
    expect(textures.has('')).toBe(true);
    for (const texture of textures) {
      expect(SOIL_TEXTURE_PALETTE[texture || 'water']).toBeDefined();
    }
  });

  it('styles every legend category, including water with no texture value', () => {
    expect(SOIL_LEGEND_ITEMS).toHaveLength(4);
    for (const item of SOIL_LEGEND_ITEMS) {
      const style = SOIL_TEXTURE_PALETTE[item.texture];
      expect(style).toBeDefined();
      const feature = {
        properties: { ...soil, textureTh: item.texture === 'water' ? '' : item.texture },
      };
      expect(soilPathStyle(feature)).toEqual(
        expect.objectContaining({
          color: style.color,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
          dashArray: style.dashArray ?? '',
          weight: 2,
        })
      );
    }
  });

  it('highlights features whose series, group, and district key matches', () => {
    const selectedKey = soilFeatureKey(soil);
    const selected = soilPathStyle({ properties: soil }, selectedKey);
    const adjacent = soilPathStyle(
      { properties: { ...soil, soilNameTh: 'รังสิตอีกแปลง' } },
      selectedKey
    );

    expect(selected).toEqual(
      expect.objectContaining({
        color: '#ffffff',
        fillColor: '#22C55E',
        weight: 3,
        fillOpacity: 0.35,
        dashArray: '',
      })
    );
    expect(selected.fillOpacity).toBeLessThanOrEqual(0.4);
    expect(adjacent.fillColor).toBe('#22C55E');
    expect(adjacent.weight).toBe(3);
    expect(soilPathStyle({ properties: { ...soil, amphoeTh: 'สามโคก' } }, selectedKey)).toEqual(
      expect.objectContaining({
        fillColor: SOIL_TEXTURE_PALETTE['ดินเหนียว'].fillColor,
        weight: 2,
      })
    );
  });
});
