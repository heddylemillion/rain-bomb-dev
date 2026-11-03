import { z } from 'zod';

export const CommunitySchema = z.object({
  id: z.string(),
  name_th: z.string(),
  name_en: z.string(),
  lat: z.number(),
  lon: z.number(),
});

export type Community = z.infer<typeof CommunitySchema>;

const LddSoilAttributesSchema = z.object({
  soilCode: z.string().min(1),
  soilNameTh: z.string().min(1),
  soilGroup: z.enum(['2', '3', '8', '10', '11', '33', 'W']),
  textureTh: z.string(),
  phTopTh: z.string(),
  fertilityTh: z.string(),
  amphoeTh: z.string().min(1),
});

export const SoilInfoSchema = LddSoilAttributesSchema.extend({
  drainageClass: z.string().nullable(),
});
export type SoilInfo = z.infer<typeof SoilInfoSchema>;

const SoilPositionSchema = z.tuple([z.number(), z.number()]);
const SoilPolygonCoordinatesSchema = z.array(z.array(SoilPositionSchema).min(4)).min(1);
const SoilGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: SoilPolygonCoordinatesSchema }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(SoilPolygonCoordinatesSchema).min(1),
  }),
]);

export const SoilFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: SoilInfoSchema,
    geometry: SoilGeometrySchema,
  })),
});
export type SoilFeatureCollection = z.infer<typeof SoilFeatureCollectionSchema>;

export const SoilResponseSchema = z.object({
  soil: SoilInfoSchema.nullable(),
  source: z.literal('LDD 1:25,000'),
  coverage: z.literal('pathum-thani'),
});
export type SoilResponse = z.infer<typeof SoilResponseSchema>;

export const RiskLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']);
export const RiskFactorIdSchema = z.enum([
  'rainNowMmHr',
  'peakRain3hMmHr',
  'accum3hMm',
  'accum24hMm',
  'popMax3hPct',
  'capeMax5hJkg',
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
  reason: z.enum(['ok', 'no_plan', 'no_coverage', 'unavailable', 'error']).optional(),
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
    capeNowJkg: z.number().nullable().optional(),
    capeMax5hJkg: z.number().nullable().optional(),
    warning: z.boolean().optional(),
    count30min: z.number().nullable(),
    nearestStrikeKm: z.number().nullable(),
  }),
  missingFactors: z.array(
    z.object({
      id: RiskFactorIdSchema,
      name: z.string(),
      reason: z.enum(['ok', 'no_plan', 'no_coverage', 'unavailable', 'error']),
    })
  ),
  generatedAt: z.string(),
  fetchedAt: z.string().nullable(),
  noticeTh: z.string(),
  recommendationTh: z.string(),
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

export const HourlyForecastEntrySchema = z.object({
  timeISO: z.string(),
  temperatureC: z.number().nullable(),
  precipitationMm: z.number().nullable(),
  precipitationProbabilityPct: z.number().nullable(),
  humidityPct: z.number().nullable(),
  pressureMslHpa: z.number().nullable(),
  windSpeedKmh: z.number().nullable(),
  capeJkg: z.number().nullable(),
});
export type HourlyForecastEntry = z.infer<typeof HourlyForecastEntrySchema>;

export const HourlyForecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevationM: z.number().nullable(),
  utcOffsetSeconds: z.number(),
  fetchedAtISO: z.string().nullable(),
  source: z.literal('Open-Meteo'),
  hourly: z.array(HourlyForecastEntrySchema),
});
export type HourlyForecastResponse = z.infer<typeof HourlyForecastResponseSchema>;

export const RiskDataReasonSchema = z.enum(['ok', 'no_plan', 'no_coverage', 'unavailable', 'error']);
export type RiskDataReason = z.infer<typeof RiskDataReasonSchema>;

export const OVERLAY_LAYER_IDS = ['radar', 'lightning', 'storm'] as const;
export type OverlayLayerId = (typeof OVERLAY_LAYER_IDS)[number];
