import type { Language, MessageKey } from '../i18n.js';
import type { SoilInfo } from '../../shared/contracts.js';

type Translate = (key: MessageKey) => string;

const SERIES_KEYS: Readonly<Record<string, MessageKey>> = {
  Rs: 'soilSeriesRs',
  Ay: 'soilSeriesAy',
  AQ: 'soilSeriesAq',
  Tan: 'soilSeriesTan',
  Cc: 'soilSeriesCc',
  W: 'soilSeriesWater',
  Bl: 'soilSeriesBl',
  Se: 'soilSeriesSe',
  Ok: 'soilSeriesOk',
  Dm: 'soilSeriesDm',
  Dn: 'soilSeriesDn',
  Ks: 'soilSeriesKs',
  Np: 'soilSeriesNp',
  Rb: 'soilSeriesRb',
  Sb: 'soilSeriesSb',
  Tb: 'soilSeriesTb',
  Bk: 'soilSeriesBk',
  Bn: 'soilSeriesBn',
  Bp: 'soilSeriesBp',
  Cm: 'soilSeriesCm',
  Sm: 'soilSeriesSm',
  Sso: 'soilSeriesSso',
  Tc: 'soilSeriesTc',
  Tm: 'soilSeriesTm',
  Bpg: 'soilSeriesBpg',
  'SALT FARM': 'soilSeriesSaltFarm',
};

const VALUE_KEYS: Readonly<Record<string, MessageKey>> = {
  'ดินเหนียว': 'soilTextureClay',
  'ดินเหนียวปนทรายแป้ง': 'soilTextureSiltyClay',
  'ดินร่วนปนทรายแป้ง': 'soilTextureSiltLoam',
  'ดินร่วนเหนียวปนทรายแป้ง': 'soilTextureSiltyClayLoam',
  'กรดจัดมาก': 'soilPhVeryStronglyAcidic',
  'กรดจัดถึงกรดเล็กน้อย': 'soilPhStronglyToSlightlyAcidic',
  'กรดจัดถึงด่างปานกลาง': 'soilPhVeryAcidicToModeratelyAlkaline',
  'กรดปานกลางถึงกรดเล็กน้อย': 'soilPhModeratelyToSlightlyAcidic',
  'กรดปานกลางถึงด่างปานกลาง': 'soilPhModeratelyToModeratelyAlkaline',
  'กรดปานกลางถึงเป็นกลาง': 'soilPhModeratelyToNeutral',
  'กรดเล็กน้อยถึงเป็นกลาง': 'soilPhSlightlyToNeutral',
  'กรดจัดมากถึงกรดจัด': 'soilPhVeryStronglyToStronglyAcidic',
  'กรดจัดมากถึงเป็นกลาง': 'soilPhVeryStronglyAcidicToNeutral',
  ปานกลาง: 'soilFertilityModerate',
  สูง: 'soilFertilityHigh',
  กรุงเทพมหานคร: 'soilDistrictBangkok',
  กำแพงแสน: 'soilDistrictKamphaengSaen',
  คลองหลวง: 'soilDistrictKhlongLuang',
  ดอนตูม: 'soilDistrictDonTum',
  นครชัยศรี: 'soilDistrictNakhonChaiSi',
  ธัญบุรี: 'soilDistrictThanyaburi',
  บางกรวย: 'soilDistrictBangKruai',
  บางคนที: 'soilDistrictBangKhonthi',
  บางบัวทอง: 'soilDistrictBangBuaThong',
  บางบ่อ: 'soilDistrictBangBo',
  บางพลี: 'soilDistrictBangPhli',
  บางเลน: 'soilDistrictBangLen',
  บางเสาธง: 'soilDistrictBangSaoThong',
  บางใหญ่: 'soilDistrictBangYai',
  กระทุ่มแบน: 'soilDistrictKrathumBaen',
  เมือง: 'soilDistrictMueang',
  ลาดหลุมแก้ว: 'soilDistrictLatLumKaeo',
  ลำลูกกา: 'soilDistrictLamLukKa',
  บ้านแพ้ว: 'soilDistrictBanPhaeo',
  เมืองสมุทรสาคร: 'soilDistrictMueangSamutSakhon',
  ปากเกร็ด: 'soilDistrictPakKret',
  พระประแดง: 'soilDistrictPhraPradaeng',
  พระสมุทรเจดีย์: 'soilDistrictPhraSamutChedi',
  พุทธมณฑล: 'soilDistrictPhutthamonthon',
  สามพราน: 'soilDistrictSamPhran',
  สามโคก: 'soilDistrictSamKhok',
  หนองเสือ: 'soilDistrictNongSuea',
  อัมพวา: 'soilDistrictAmphawa',
  เมืองนครปฐม: 'soilDistrictMueangNakhonPathom',
  เมืองนนทบุรี: 'soilDistrictMueangNonthaburi',
  เมืองสมุทรปราการ: 'soilDistrictMueangSamutPrakan',
  เมืองสมุทรสงคราม: 'soilDistrictMueangSamutSongkhram',
  ไทรน้อย: 'soilDistrictSaiNoi',
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
