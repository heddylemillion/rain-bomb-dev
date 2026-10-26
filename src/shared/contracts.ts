import { z } from 'zod';

export const CommunitySchema = z.object({
  id: z.string(),
  name_th: z.string(),
  name_en: z.string(),
  lat: z.number(),
  lon: z.number(),
  elevation_m: z.number(),
  soil_group: z.enum(['A', 'B', 'C', 'D']),
  drainage_capacity_mm_hr: z.number(),
  canal_station_id: z.string().nullable(),
  calibration_status: z.string(),
});

export type Community = z.infer<typeof CommunitySchema>;

export const HourlyForecastSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  tempC: z.number().nullable(),
  humidity: z.number().nullable(),
  pressureMB: z.number().nullable(),
  pop: z.number().nullable(),
  precipMM: z.number().nullable(),
  windSpeedKPH: z.number().nullable(),
});

export type HourlyForecast = z.infer<typeof HourlyForecastSchema>;

export const DailyForecastSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  maxTempC: z.number().nullable(),
  minTempC: z.number().nullable(),
  avgTempC: z.number().nullable(),
  pop: z.number().nullable(),
  precipMM: z.number().nullable(),
});

export type DailyForecast = z.infer<typeof DailyForecastSchema>;

export const ObservationSchema = z.object({
  id: z.string(),
  dataSource: z.string().optional(),
  obTimestamp: z.number(),
  obDateTime: z.string(),
  ob: z.object({
    timestamp: z.number(),
    dateTimeISO: z.string(),
    tempC: z.number().nullable(),
    humidity: z.number().nullable(),
    pressureMB: z.number().nullable(),
    windSpeedKPH: z.number().nullable(),
    windDir: z.string().nullable(),
    precipMM: z.number().nullable(),
  }),
});

export type Observation = z.infer<typeof ObservationSchema>;

export const NormalizedCurrentWeatherSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  tempC: z.number().nullable(),
  feelslikeC: z.number().nullable(),
  dewpointC: z.number().nullable(),
  humidity: z.number().nullable(),
  pressureMB: z.number().nullable(),
  rainRateMmPerHr: z.number().nullable(),
  recentPrecipMm: z.number().nullable(),
  pop: z.number().nullable(),
  windSpeedKPH: z.number().nullable(),
  windGustKPH: z.number().nullable(),
  windDir: z.string().nullable(),
  sky: z.number().nullable(),
  visibilityKM: z.number().nullable(),
  weather: z.string().nullable(),
  weatherPrimaryCoded: z.string().nullable(),
  icon: z.string().nullable(),
  isDay: z.boolean().nullable(),
  stationObservation: z.object({
    stationId: z.string(),
    dataSource: z.string().nullable(),
    placeName: z.string().nullable(),
    distanceKM: z.number().nullable(),
    obDateTimeISO: z.string(),
    tempC: z.number().nullable(),
    humidity: z.number().nullable(),
    pressureMB: z.number().nullable(),
    precipMM: z.number().nullable(),
    rawMetar: z.string().nullable(),
  }).nullable(),
});

export const NormalizedHourlyForecastSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  tempC: z.number().nullable(),
  humidity: z.number().nullable(),
  pressureMB: z.number().nullable(),
  pop: z.number(),
  precipMM: z.number(),
  windSpeedKPH: z.number().nullable(),
});

export const NormalizedDailyForecastSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  maxTempC: z.number().nullable(),
  minTempC: z.number().nullable(),
  avgTempC: z.number().nullable(),
  pop: z.number(),
  precipMM: z.number(),
});

export const WeatherBundleSchema = z.object({
  community: CommunitySchema,
  current: NormalizedCurrentWeatherSchema,
  hourly: z.array(NormalizedHourlyForecastSchema),
  daily: z.array(NormalizedDailyForecastSchema),
  meta: z.object({
    source: z.string(),
    fetchedAtISO: z.string(),
    timezone: z.string(),
    isMock: z.boolean(),
    isStale: z.boolean(),
    staleReason: z.string().nullable(),
    disclaimerTh: z.string(),
  }),
});

export type WeatherBundle = z.infer<typeof WeatherBundleSchema>;

export const RiskFactorIdSchema = z.enum([
  'forecast-rain',
  'forecast-pop',
  'current-rain-rate',
]);

export const RiskResultSchema = z.object({
  communityId: z.string(),
  score: z.number().int().min(0).max(100),
  level: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  alertType: z.enum(['URGENT', 'ADVANCE', 'NONE']),
  confidence: z.literal('LOW'),
  factorIds: z.array(RiskFactorIdSchema),
  inputIds: z.array(RiskFactorIdSchema),
  recommendedActionId: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  generatedAt: z.string(),
  isMock: z.literal(true),
  calibrationStatus: z.string(),
});

export type RiskResult = z.infer<typeof RiskResultSchema>;

export const CurrentConditionsSchema = z.object({
  loc: z.object({ lat: z.number(), long: z.number() }),
  place: z.object({
    name: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
  periods: z.array(
    z.object({
      timestamp: z.number(),
      dateTimeISO: z.string(),
      tempC: z.number().nullable(),
      humidity: z.number().nullable(),
      pressureMB: z.number().nullable(),
      windSpeedKPH: z.number().nullable(),
      windDir: z.string().nullable(),
      precipMM: z.number().nullable(),
      precipRateMM: z.number().nullable().optional(),
      pop: z.number().nullable().optional(),
    })
  ),
});

export type CurrentConditions = z.infer<typeof CurrentConditionsSchema>;

export const CAPABILITY_IDS = [
  'overview-map',
  'risk-summary',
  'current-conditions',
  'observations',
  'hourly-forecast',
  'daily-forecast',
  'lightning',
  'lightning-strikes',
  'lightning-threats',
  'official-alerts',
  'tropical-cyclones',
  'air-quality',
  'history-calibration',
  'alert-history',
  'radar-layer',
  'satellite-layer',
  'canal-level',
  'tide',
  'dem',
] as const;

export const CapabilityIdSchema = z.enum(CAPABILITY_IDS);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const CapabilityReasonSchema = z.enum([
  'ok',
  'no_plan',
  'no_coverage',
  'error',
]);

export const CapabilitySchema = z.object({
  id: CapabilityIdSchema,
  available: z.boolean(),
  reason: CapabilityReasonSchema,
  checkedAt: z.string().datetime({ offset: true }),
});

export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilitiesResponseSchema = z.object({
  capabilities: z.array(CapabilitySchema),
  checkedAt: z.string().datetime({ offset: true }),
  isMock: z.boolean(),
});

export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;
