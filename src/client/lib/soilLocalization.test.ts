import { describe, expect, it } from 'vitest';
import type { MessageKey } from '../i18n.js';
import type { SoilInfo } from '../../shared/contracts.js';
import { translateSoilName, translateSoilValue } from './soilLocalization.js';

const english: Partial<Record<MessageKey, string>> = {
  soilSeriesAy: 'Ayutthaya',
  soilTextureClay: 'Clay',
  soilPhVeryStronglyAcidic: 'Very strongly acidic',
  soilFertilityModerate: 'Moderate',
  soilDistrictSamKhok: 'Sam Khok',
  soilNoData: 'No data',
};

const translate = (key: MessageKey): string => english[key] ?? key;

const soil: SoilInfo = {
  soilCode: 'Ay',
  soilNameTh: 'อยุธยา',
  soilGroup: '11',
  textureTh: 'ดินเหนียว',
  phTopTh: 'กรดจัดมาก',
  fertilityTh: 'ปานกลาง',
  amphoeTh: 'สามโคก',
  drainageClass: null,
};

describe('soil display localization', () => {
  it('uses English labels for soil series and properties', () => {
    expect(translateSoilName(soil, 'en', translate)).toBe('Ayutthaya');
    expect(translateSoilValue(soil.textureTh, 'en', translate)).toBe('Clay');
    expect(translateSoilValue(soil.phTopTh, 'en', translate)).toBe('Very strongly acidic');
    expect(translateSoilValue(soil.fertilityTh, 'en', translate)).toBe('Moderate');
    expect(translateSoilValue(soil.amphoeTh, 'en', translate)).toBe('Sam Khok');
  });

  it('preserves Thai values and maps empty values to localized no-data text', () => {
    expect(translateSoilName(soil, 'th', translate)).toBe('อยุธยา');
    expect(translateSoilValue(soil.textureTh, 'th', translate)).toBe('ดินเหนียว');
    expect(translateSoilValue('', 'en', translate)).toBe('No data');
    expect(translateSoilValue('-', 'en', translate)).toBe('No data');
    expect(translateSoilValue('ค่าที่ไม่รู้จัก', 'en', translate)).toBe('No data');
  });

  it('does not expose Thai text for any known soil values in English mode', () => {
    const soilCodes = ['Rs', 'Ay', 'Tan', 'Cc', 'W', 'Se', 'Ok', 'Dm', 'Tb', 'Bk', 'Bn', 'Bp', 'Cm'];
    const soilValues = [
      'ดินเหนียว',
      'ดินเหนียวปนทรายแป้ง',
      'ดินร่วนปนทรายแป้ง',
      'กรดจัดมาก',
      'กรดจัดถึงด่างปานกลาง',
      'กรดปานกลางถึงกรดเล็กน้อย',
      'กรดจัดมากถึงกรดจัด',
      'กรดจัดมากถึงเป็นกลาง',
      'ปานกลาง',
      'คลองหลวง',
      'ธัญบุรี',
      'เมือง',
      'ลาดหลุมแก้ว',
      'ลำลูกกา',
      'สามโคก',
      'หนองเสือ',
    ];

    for (const soilCode of soilCodes) {
      expect(translateSoilName({ ...soil, soilCode }, 'en', translate)).not.toMatch(/[\u0E00-\u0E7F]/u);
    }
    for (const value of soilValues) {
      expect(translateSoilValue(value, 'en', translate)).not.toMatch(/[\u0E00-\u0E7F]/u);
    }
  });
});
