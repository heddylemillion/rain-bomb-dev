import { z } from 'zod';

/**
 * Zod Schemas สร้างจาก JSON จริงของ Xweather ที่ได้จาก Phase 0 Smoke Test
 * พิกัด 14.0647,100.6186 (อ.คลองหลวง จ.ปทุมธานี)
 * ไม่มีการเดาชื่อฟิลด์นอกเหนือจากที่ปรากฏใน samples/*.json
 */

export const XweatherErrorSchema = z.object({
  code: z.string().optional(),
  description: z.string().optional(),
});

export const XweatherLocSchema = z.object({
  lat: z.number(),
  long: z.number(),
});

export const XweatherPlaceSchema = z.object({
  name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
});

export const XweatherProfileSchema = z.object({
  tz: z.string(),
  tzname: z.string().optional(),
  tzoffset: z.number().optional(),
  isDST: z.boolean().optional(),
  elevM: z.number().optional(),
  elevFT: z.number().optional(),
});

export const XweatherCodedItemSchema = z.object({
  timestamp: z.number(),
  wx: z.string(),
  dateTimeISO: z.string(),
});

/**
 * 1) & 2) Period Schema สำหรับ /forecasts (ใช้ได้ทั้ง filter=1hr และ filter=day)
 * หมายเหตุจากผลจริง Phase 0:
 * - ใน filter=day ฟิลด์ tempC และ tempF เป็น null ได้ (ใช้ maxTempC, minTempC, avgTempC แทน)
 * - ใน filter=day มี sunrise, sunset, sunriseISO, sunsetISO
 */
export const XweatherForecastPeriodSchema = z.object({
  timestamp: z.number(),
  validTime: z.string(),
  dateTimeISO: z.string(),
  maxTempC: z.number().nullable(),
  minTempC: z.number().nullable(),
  avgTempC: z.number().nullable(),
  tempC: z.number().nullable(),
  feelslikeC: z.number().nullable(),
  maxFeelslikeC: z.number().nullable().optional(),
  minFeelslikeC: z.number().nullable().optional(),
  avgFeelslikeC: z.number().nullable().optional(),
  dewpointC: z.number().nullable(),
  maxDewpointC: z.number().nullable().optional(),
  minDewpointC: z.number().nullable().optional(),
  avgDewpointC: z.number().nullable().optional(),
  maxHumidity: z.number().nullable().optional(),
  minHumidity: z.number().nullable().optional(),
  humidity: z.number().nullable(),
  pop: z.number().nullable(),
  precipMM: z.number().nullable(),
  pressureMB: z.number().nullable(),
  spressureMB: z.number().nullable().optional(),
  altimeterMB: z.number().nullable().optional(),
  windDir: z.string().nullable(),
  windDirDEG: z.number().nullable().optional(),
  windSpeedKPH: z.number().nullable(),
  windSpeedMPS: z.number().nullable().optional(),
  windGustKPH: z.number().nullable(),
  windSpeedMaxKPH: z.number().nullable().optional(),
  sky: z.number().nullable(),
  cloudsCoded: z.string().nullable().optional(),
  weather: z.string().nullable(),
  weatherCoded: z.array(XweatherCodedItemSchema).optional(),
  weatherPrimary: z.string().nullable().optional(),
  weatherPrimaryCoded: z.string().nullable(),
  icon: z.string().nullable(),
  visibilityKM: z.number().nullable().optional(),
  uvi: z.number().nullable().optional(),
  isDay: z.boolean().optional(),
  sunriseISO: z.string().nullable().optional(),
  sunsetISO: z.string().nullable().optional(),
});

export const XweatherForecastItemSchema = z.object({
  loc: XweatherLocSchema,
  interval: z.string(),
  place: XweatherPlaceSchema.optional(),
  periods: z.array(XweatherForecastPeriodSchema),
  profile: XweatherProfileSchema,
});

export const XweatherForecastEnvelopeSchema = z.object({
  success: z.boolean(),
  error: XweatherErrorSchema.nullable().optional(),
  response: z.array(XweatherForecastItemSchema),
});

/**
 * 3) Schema สำหรับ /observations
 * หมายเหตุจากผลจริง Phase 0:
 * - ตัวอย่างที่บันทึกไว้มี response เป็น object เดียว; schema รองรับทั้ง object และ array
 * - windGustKPH, ceilingM, uvi, snowDepthCM เป็น null ได้
 * - weatherCoded เป็น string (เช่น "::SC") ไม่ใช่ array
 */
export const XweatherObservationBlockSchema = z.object({
  type: z.string().optional(),
  timestamp: z.number(),
  dateTimeISO: z.string(),
  recTimestamp: z.number().optional(),
  recDateTimeISO: z.string().optional(),
  tempC: z.number().nullable(),
  dewpointC: z.number().nullable(),
  humidity: z.number().nullable(),
  pressureMB: z.number().nullable(),
  spressureMB: z.number().nullable().optional(),
  altimeterMB: z.number().nullable().optional(),
  windSpeedKPH: z.number().nullable(),
  windSpeedMPS: z.number().nullable().optional(),
  windDirDEG: z.number().nullable().optional(),
  windDir: z.string().nullable(),
  windGustKPH: z.number().nullable(),
  visibilityKM: z.number().nullable().optional(),
  weather: z.string().nullable(),
  weatherShort: z.string().nullable().optional(),
  weatherCoded: z.string().nullable().optional(),
  weatherPrimary: z.string().nullable().optional(),
  weatherPrimaryCoded: z.string().nullable(),
  cloudsCoded: z.string().nullable().optional(),
  icon: z.string().nullable(),
  feelslikeC: z.number().nullable(),
  isDay: z.boolean().nullable().optional(),
  sunriseISO: z.string().nullable().optional(),
  sunsetISO: z.string().nullable().optional(),
  precipMM: z.number().nullable(),
  sky: z.number().nullable().optional(),
});

export const XweatherObservationItemSchema = z.object({
  id: z.string(),
  dataSource: z.string().optional(),
  loc: XweatherLocSchema,
  place: XweatherPlaceSchema.optional(),
  profile: XweatherProfileSchema,
  obTimestamp: z.number(),
  obDateTime: z.string(),
  ob: XweatherObservationBlockSchema,
  raw: z.string().nullable().optional(),
  relativeTo: z
    .object({
      lat: z.number(),
      long: z.number(),
      bearing: z.number().optional(),
      bearingENG: z.string().optional(),
      distanceKM: z.number().optional(),
      distanceMI: z.number().optional(),
    })
    .optional(),
});

export const XweatherObservationEnvelopeSchema = z.object({
  success: z.boolean(),
  error: XweatherErrorSchema.nullable().optional(),
  response: z
    .union([z.array(XweatherObservationItemSchema), XweatherObservationItemSchema])
    .transform((response) => (Array.isArray(response) ? response : [response])),
});

/**
 * 4) Schema สำหรับ /conditions
 * หมายเหตุจากผลจริง Phase 0:
 * - มีฟิลด์สำคัญสำหรับคำนวณน้ำท่วมฉับพลันคือ precipRateMM (มม./ชม.) และ precipMM
 * - weatherCoded เป็น string (เช่น ":VL:RW")
 */
export const XweatherConditionPeriodSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  tempC: z.number().nullable(),
  feelslikeC: z.number().nullable(),
  wetBulbGlobeTempC: z.number().nullable().optional(),
  dewpointC: z.number().nullable(),
  humidity: z.number().nullable(),
  pressureMB: z.number().nullable(),
  windDir: z.string().nullable(),
  windDirDEG: z.number().nullable().optional(),
  windSpeedKPH: z.number().nullable(),
  windGustKPH: z.number().nullable(),
  precipMM: z.number().nullable(),
  precipRateMM: z.number().nullable().optional(),
  pop: z.number().nullable().optional(),
  visibilityKM: z.number().nullable().optional(),
  sky: z.number().nullable(),
  cloudsCoded: z.string().nullable().optional(),
  weather: z.string().nullable(),
  weatherCoded: z.string().nullable().optional(),
  weatherPrimary: z.string().nullable().optional(),
  weatherPrimaryCoded: z.string().nullable(),
  icon: z.string().nullable(),
  uvi: z.number().nullable().optional(),
  isDay: z.boolean().nullable().optional(),
  spressureMB: z.number().nullable().optional(),
  altimeterMB: z.number().nullable().optional(),
});

export const XweatherConditionItemSchema = z.object({
  loc: XweatherLocSchema,
  place: XweatherPlaceSchema.optional(),
  periods: z.array(XweatherConditionPeriodSchema),
  profile: XweatherProfileSchema,
});

export const XweatherConditionEnvelopeSchema = z.object({
  success: z.boolean(),
  error: XweatherErrorSchema.nullable().optional(),
  response: z
    .union([z.array(XweatherConditionItemSchema), XweatherConditionItemSchema])
    .transform((response) => (Array.isArray(response) ? response : [response])),
});

export type XweatherForecastEnvelope = z.infer<typeof XweatherForecastEnvelopeSchema>;
export type XweatherObservationEnvelope = z.infer<typeof XweatherObservationEnvelopeSchema>;
export type XweatherConditionEnvelope = z.infer<typeof XweatherConditionEnvelopeSchema>;
