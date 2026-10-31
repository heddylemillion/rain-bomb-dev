import type { Language, MessageKey } from '../i18n.js';
import type { SoilInfo } from '../../shared/contracts.js';

type Translate = (key: MessageKey) => string;

const SERIES_KEYS: Readonly<Record<string, MessageKey>> = {
  Rs: 'soilSeriesRs',
  Ay: 'soilSeriesAy',
  Tan: 'soilSeriesTan',
  Cc: 'soilSeriesCc',
  W: 'soilSeriesWater',
  Se: 'soilSeriesSe',
  Ok: 'soilSeriesOk',
  Dm: 'soilSeriesDm',
  Tb: 'soilSeriesTb',
  Bk: 'soilSeriesBk',
  Bn: 'soilSeriesBn',
  Bp: 'soilSeriesBp',
  Cm: 'soilSeriesCm',
};

const VALUE_KEYS: Readonly<Record<string, MessageKey>> = {
  'ดินเหนียว': 'soilTextureClay',
  'ดินเหนียวปนทรายแป้ง': 'soilTextureSiltyClay',
  'ดินร่วนปนทรายแป้ง': 'soilTextureSiltLoam',
  'กรดจัดมาก': 'soilPhVeryStronglyAcidic',
  'กรดจัดถึงด่างปานกลาง': 'soilPhVeryAcidicToModeratelyAlkaline',
  'กรดปานกลางถึงกรดเล็กน้อย': 'soilPhModeratelyToSlightlyAcidic',
  'กรดจัดมากถึงกรดจัด': 'soilPhVeryStronglyToStronglyAcidic',
  'กรดจัดมากถึงเป็นกลาง': 'soilPhVeryStronglyAcidicToNeutral',
  ปานกลาง: 'soilFertilityModerate',
  คลองหลวง: 'soilDistrictKhlongLuang',
  ธัญบุรี: 'soilDistrictThanyaburi',
  เมือง: 'soilDistrictMueang',
  ลาดหลุมแก้ว: 'soilDistrictLatLumKaeo',
  ลำลูกกา: 'soilDistrictLamLukKa',
  สามโคก: 'soilDistrictSamKhok',
  หนองเสือ: 'soilDistrictNongSuea',
};

export function translateSoilName(soil: SoilInfo, language: Language, t: Translate): string {
  if (language === 'th') {
    return soil.soilNameTh;
  }
  const key = SERIES_KEYS[soil.soilCode];
  return key ? t(key) : t('soilNoData');
}

export function translateSoilValue(value: string, language: Language, t: Translate): string {
  const normalized = value.trim();
  if (!normalized || normalized === '-') {
    return t('soilNoData');
  }
  if (language === 'th') {
    return normalized;
  }
  const key = VALUE_KEYS[normalized];
  if (key) {
    return t(key);
  }
  return /[\u0E00-\u0E7F]/u.test(normalized) ? t('soilNoData') : normalized;
}
