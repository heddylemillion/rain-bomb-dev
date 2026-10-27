export interface SoilProfile {
  group: 'A' | 'B' | 'C' | 'D';
  nameTh: string;
  nameEn: string;
  drainageTh: string;
  drainageEn: string;
}

const MOCK_SOIL_PROFILES: readonly SoilProfile[] = [
  {
    group: 'A',
    nameTh: 'ดินทราย',
    nameEn: 'Sandy soil',
    drainageTh: 'ระบายน้ำเร็ว ซึมน้ำได้ดี',
    drainageEn: 'Fast drainage with high infiltration',
  },
  {
    group: 'B',
    nameTh: 'ดินร่วนปนทราย',
    nameEn: 'Sandy loam',
    drainageTh: 'ระบายน้ำค่อนข้างดี',
    drainageEn: 'Moderately good drainage',
  },
  {
    group: 'C',
    nameTh: 'ดินร่วนเหนียว',
    nameEn: 'Clay loam',
    drainageTh: 'ระบายน้ำปานกลางถึงช้า',
    drainageEn: 'Moderate to slow drainage',
  },
  {
    group: 'D',
    nameTh: 'ดินเหนียว',
    nameEn: 'Clay soil',
    drainageTh: 'ระบายน้ำช้า มีโอกาสเกิดน้ำขัง',
    drainageEn: 'Slow drainage with a higher chance of ponding',
  },
];

export function getMockSoilProfile(lat: number, lon: number): SoilProfile {
  const gridLat = Math.floor(lat * 20);
  const gridLon = Math.floor(lon * 20);
  const index = Math.abs(gridLat * 31 + gridLon * 17) % MOCK_SOIL_PROFILES.length;
  return MOCK_SOIL_PROFILES[index]!;
}