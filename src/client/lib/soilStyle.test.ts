import { describe, expect, it } from 'vitest';
import type { SoilInfo } from '../../shared/contracts.js';
import {
  SOIL_LEGEND_ITEMS,
  SOIL_TEXTURE_STYLES,
  soilFeatureKey,
  soilPathStyle,
} from './soilStyle.js';

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
  it('styles every legend category, including water with no texture value', () => {
    expect(SOIL_LEGEND_ITEMS).toHaveLength(4);
    for (const texture of Object.keys(SOIL_TEXTURE_STYLES)) {
      const feature = {
        properties: { ...soil, textureTh: texture === 'water' ? '' : texture },
      };
      expect(soilPathStyle(feature)).toEqual(
        expect.objectContaining({
          color: expect.any(String),
          fillColor: expect.any(String),
          weight: 2,
          fillOpacity: 0.25,
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
        weight: 4,
        fillOpacity: 0.25,
      })
    );
    expect(selected.fillColor).not.toMatch(/green|#22c55e/i);
    expect(adjacent.weight).toBe(4);
    expect(soilPathStyle({ properties: { ...soil, amphoeTh: 'สามโคก' } }, selectedKey).weight).toBe(2);
  });
});
