import { z } from 'zod';

export const CommunitySchema = z.object({
  id: z.string(),
  name_th: z.string(),
  name_en: z.string(),
  lat: z.number(),
  lon: z.number(),
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
  pop: z.number().nullable(),
  precipMM: z.number().nullable(),
  windSpeedKPH: z.number().nullable(),
});

export const NormalizedDailyForecastSchema = z.object({
  timestamp: z.number(),
  dateTimeISO: z.string(),
  maxTempC: z.number().nullable(),
  minTempC: z.number().nullable(),
  avgTempC: z.number().nullable(),
  pop: z.number().nullable(),
  precipMM: z.number().nullable(),
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

export const RiskLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']);
export const RiskFactorIdSchema = z.enum([
  'rainNowMmHr',
  'peakRain3hMmHr',
  'accum3hMm',
  'accum24hMm',
  'popMax3hPct',
  'lightning30minCount',
  'pressureDrop3hHpa',
  'humidityPct',
  'tideFactor',
]);
export type RiskFactorId = z.infer<typeof RiskFactorIdSchema>;
export const RiskFactorSchema = z.object({
  id: RiskFactorIdSchema,
  name: z.string(),
  rawValue: z.number().nullable(),
  unit: z.string(),
  normalized: z.number().min(0).max(1).nullable(),
  weight: z.number().min(0),
  available: z.boolean(),
  isStale: z.boolean().default(false),
  source: z.string(),
  observedAt: z.string().nullable(),
  reason: z.enum(['ok', 'no_plan', 'no_coverage', 'error']).optional(),
});
export const RiskResultSchema = z.object({
  communityId: z.string(),
  score: z.number().min(0).max(100).nullable(),
  level: RiskLevelSchema,
  alertType: z.enum(['URGENT', 'ADVANCE', 'NONE']),
  confidence: z.number().min(0).max(1),
  confidenceLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  factors: z.array(RiskFactorSchema),
  topContributors: z.array(
    z.object({
      id: RiskFactorIdSchema,
      name: z.string(),
      contribution: z.number(),
      rawValue: z.number(),
      unit: z.string(),
    })
  ),
  lightningSummary: z.object({
    count30min: z.number().nullable(),
    nearestStrikeKm: z.number().nullable(),
  }),
  missingFactors: z.array(
    z.object({
      id: RiskFactorIdSchema,
      name: z.string(),
      reason: z.enum(['ok', 'no_plan', 'no_coverage', 'error']),
    })
  ),
  generatedAt: z.string(),
  fetchedAt: z.string().nullable(),
  noticeTh: z.string(),
  recommendationTh: z.string(),
  isMock: z.boolean(),
});

export type RiskResult = z.infer<typeof RiskResultSchema>;

export const GeocodingResultSchema = z.object({
  lat: z.number().min(5.5).max(20.5),
  lon: z.number().min(97).max(106),
  name: z.string(),
  district: z.string(),
  province: z.string(),
  displayName: z.string(),
  address: z.string().optional(),
});
export type GeocodingResult = z.infer<typeof GeocodingResultSchema>;

export const PointRiskResponseSchema = RiskResultSchema;
export type PointRiskResponse = z.infer<typeof PointRiskResponseSchema>;

export const AreaEnvironmentSchema = z.object({
  isMock: z.boolean(),
  elevation: z.object({
    valueM: z.number().nullable(),
    messageTh: z.string().nullable(),
  }),
  seaLevel: z.object({
    referencePoint: z.object({
      id: z.string(),
      nameTh: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      distanceKm: z.number(),
    }),
    datum: z.literal('global_mean_sea_level'),
    model: z.literal('forecast'),
    hourly: z.array(z.object({
      timeISO: z.string(),
      seaLevelHeightMslM: z.number().nullable(),
      waveHeightM: z.number().nullable(),
    })),
    fetchedAtISO: z.string().nullable(),
    messageTh: z.string().nullable(),
  }),
});

export type AreaEnvironment = z.infer<typeof AreaEnvironmentSchema>;

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
  'mock',
]);
export type CapabilityReason = z.infer<typeof CapabilityReasonSchema>;
export type RiskDataReason = Exclude<CapabilityReason, 'mock'>;

export const CapabilitySchema = z.object({
  id: CapabilityIdSchema,
  available: z.boolean(),
  reason: CapabilityReasonSchema,
  mock: z.boolean().optional(),
  checkedAt: z.string().datetime({ offset: true }),
});

export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilitiesResponseSchema = z.object({
  capabilities: z.array(CapabilitySchema),
  checkedAt: z.string().datetime({ offset: true }),
  isMock: z.boolean(),
  demoMode: z.boolean().default(false),
});

export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

/**
 * Map overlay layers (raster tiles proxied by the backend).
 * Capability probes verify account access, not whether a frame has pixels over Thailand.
 */
export const OVERLAY_LAYER_IDS = ['radar', 'lightning', 'storm'] as const;
export type OverlayLayerId = (typeof OVERLAY_LAYER_IDS)[number];

export const OVERLAY_CAPABILITY_ID: Record<OverlayLayerId, CapabilityId> = {
  radar: 'radar-layer',
  lightning: 'lightning',
  storm: 'tropical-cyclones',
};

/** Documented relative radar offsets; actual account frame availability and timestamps remain unverified. */
export const RADAR_OFFSETS = ['-3hour', '-2hour', '-1hour', 'current'] as const;
export type RadarOffset = (typeof RADAR_OFFSETS)[number];
