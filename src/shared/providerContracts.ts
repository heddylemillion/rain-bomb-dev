import { z } from 'zod';

export const ProviderModeSchema = z.enum(['live', 'cache']);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export const RadarFrameSchema = z.object({
  time: z.number().int().positive(),
  path: z.string().startsWith('/v2/radar/').optional(),
  offset: z.enum(['current', '-1hour', '-2hour', '-3hour']).optional(),
}).refine((frame) => frame.path !== undefined || frame.offset !== undefined, {
  message: 'A radar frame must contain a provider path or offset.',
});
export type RadarFrame = z.infer<typeof RadarFrameSchema>;

export const RadarFramesResponseSchema = z.object({
  frames: z.array(RadarFrameSchema),
  coverage: z.enum(['available', 'none', 'unknown']),
  noticeTh: z.string().nullable(),
  attribution: z.string(),
  attributionUrl: z.string().url(),
  maxZoom: z.number().int().positive(),
});
export type RadarFramesResponse = z.infer<typeof RadarFramesResponseSchema>;

export const LightningSummarySchema = z.object({
  count30min: z.number().int().nonnegative().nullable(),
  nearestStrikeKm: z.number().nonnegative().nullable(),
  within5km15min: z.number().int().nonnegative().nullable(),
  source: z.string(),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  display: z.enum(['counts-only', 'tiles']),
});
export type LightningSummary = z.infer<typeof LightningSummarySchema>;

const PositionSchema = z.tuple([z.number(), z.number()]);
const LineCoordinatesSchema = z.array(PositionSchema).min(2);
const PolygonCoordinatesSchema = z.array(z.array(PositionSchema).min(4)).min(1);
export const StormTrackFeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    id: z.union([z.string(), z.number()]).optional(),
    geometry: z.discriminatedUnion('type', [
      z.object({ type: z.literal('LineString'), coordinates: LineCoordinatesSchema }),
      z.object({ type: z.literal('Polygon'), coordinates: PolygonCoordinatesSchema }),
    ]),
    properties: z.record(z.unknown()),
  })),
});
export type StormTrackFeatureCollection = z.infer<typeof StormTrackFeatureCollectionSchema>;

export const ProviderStatusSchema = z.object({
  id: z.enum(['radar', 'lightning', 'storm-track']),
  provider: z.string(),
  mode: ProviderModeSchema,
  coverage: z.enum(['available', 'none', 'unknown', 'not-tested']),
  lastSuccess: z.string().datetime({ offset: true }).nullable(),
  quotaUsed: z.number().int().nonnegative(),
  quotaLimit: z.number().int().positive().nullable(),
  attribution: z.string(),
  attributionUrl: z.string().url(),
  licenceLimits: z.string(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderStatusResponseSchema = z.object({
  providers: z.array(ProviderStatusSchema),
  checkedAt: z.string().datetime({ offset: true }),
});
export type ProviderStatusResponse = z.infer<typeof ProviderStatusResponseSchema>;
