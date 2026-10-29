import { z } from 'zod';

/**
 * Schema สำหรับตรวจสอบไฟล์ config/communities.json
 */
export const HydrologicSoilGroupSchema = z.enum(['A', 'B', 'C', 'D']);
export type HydrologicSoilGroup = z.infer<typeof HydrologicSoilGroupSchema>;

export const CommunitySchema = z.object({
  id: z.string().min(1),
  name_th: z.string().min(1),
  name_en: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type CommunityConfig = z.infer<typeof CommunitySchema>;

export const CommunitiesFileSchema = z.object({
  _comment: z.string().optional(),
  communities: z.array(CommunitySchema),
});

/**
 * Internal Normalized Types สำหรับส่งให้ Risk Engine และ Frontend
 * แยกขาดจากโครงสร้างดิบของ Xweather 100%
 */
export interface NormalizedHourlyForecastPoint {
  timestamp: number;
  dateTimeISO: string;
  tempC: number | null;
  feelslikeC: number | null;
  dewpointC: number | null;
  humidity: number | null;
  pressureMB: number | null;
  pop: number | null;
  precipMM: number | null;
  windSpeedKPH: number | null;
  windGustKPH: number | null;
  windDir: string | null;
  sky: number | null;
  weather: string | null;
  weatherPrimaryCoded: string | null;
  icon: string | null;
  isDay: boolean | null;
}

export interface NormalizedDailyForecastPoint {
  timestamp: number;
  dateTimeISO: string;
  maxTempC: number | null;
  minTempC: number | null;
  avgTempC: number | null;
  maxFeelslikeC: number | null;
  dewpointC: number | null;
  humidity: number | null;
  maxHumidity: number | null;
  minHumidity: number | null;
  pressureMB: number | null;
  pop: number | null;
  precipMM: number | null;
  windSpeedMaxKPH: number | null;
  windGustKPH: number | null;
  windDir: string | null;
  sky: number | null;
  weather: string | null;
  weatherPrimaryCoded: string | null;
  icon: string | null;
  sunriseISO: string | null;
  sunsetISO: string | null;
}

export interface NormalizedCurrentWeather {
  /** เวลาที่ตรวจวัด (เลือกจาก /conditions เป็นหลักเพราะตรงพิกัด หากไม่มีจึงใช้ /observations) */
  timestamp: number;
  dateTimeISO: string;
  tempC: number | null;
  feelslikeC: number | null;
  dewpointC: number | null;
  humidity: number | null;
  pressureMB: number | null;
  /** อัตราฝนตกปัจจุบัน (มม./ชม.) จาก /conditions.periods[0].precipRateMM */
  rainRateMmPerHr: number | null;
  /** ปริมาณฝนสะสมล่าสุด (มม.) จาก precipMM */
  recentPrecipMm: number | null;
  pop: number | null;
  windSpeedKPH: number | null;
  windGustKPH: number | null;
  windDir: string | null;
  sky: number | null;
  visibilityKM: number | null;
  weather: string | null;
  weatherPrimaryCoded: string | null;
  icon: string | null;
  isDay: boolean | null;
  /** ข้อมูลสถานีตรวจวัดจริงจาก /observations (เช่น VTBD ดอนเมือง) */
  stationObservation: {
    stationId: string;
    dataSource: string | null;
    placeName: string | null;
    distanceKM: number | null;
    obDateTimeISO: string;
    tempC: number | null;
    humidity: number | null;
    pressureMB: number | null;
    precipMM: number | null;
    rawMetar: string | null;
  } | null;
}

export interface CommunityWeatherBundle {
  community: CommunityConfig;
  current: NormalizedCurrentWeather;
  hourly: NormalizedHourlyForecastPoint[];
  daily: NormalizedDailyForecastPoint[];
  meta: {
    source: string;
    fetchedAtISO: string;
    timezone: string;
    /** True only when the explicit demo-mode configuration is enabled. */
    isMock: boolean;
    /** true เมื่อดึงข้อมูลสดจาก Xweather ไม่สำเร็จและใช้ข้อมูลจาก cache ล่าสุดแทน */
    isStale: boolean;
    staleReason: string | null;
    disclaimerTh: string;
  };
}
