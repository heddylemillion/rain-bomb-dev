import fs from 'node:fs';
import path from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { z } from 'zod';
import {
  SoilFeatureCollectionSchema,
  SoilInfoSchema,
  type SoilFeatureCollection,
  type SoilInfo,
} from '../../shared/contracts.js';
import { ROOT_DIR } from '../config.js';

const SOIL_DATA_PATH = path.join(ROOT_DIR, 'data', 'soil-pathumthani.geojson');
const SOIL_DRAINAGE_PATH = path.join(ROOT_DIR, 'config', 'soil-drainage.json');

const SoilAttributesSchema = SoilInfoSchema.omit({ drainageClass: true });
const PolygonCoordinatesSchema = z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1);
const DatasetFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: SoilAttributesSchema,
  geometry: z.discriminatedUnion('type', [
    z.object({ type: z.literal('Polygon'), coordinates: PolygonCoordinatesSchema }),
    z.object({
      type: z.literal('MultiPolygon'),
      coordinates: z.array(PolygonCoordinatesSchema).min(1),
    }),
  ]),
});
const SoilDatasetSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(DatasetFeatureSchema).min(1),
});

const SoilDrainageConfigSchema = z.object({
  _comment: z.string(),
  verification_status: z.string(),
  source: z.string().nullable(),
  series: z.object({
    Rs: z.string().nullable(),
    Ay: z.string().nullable(),
    Tan: z.string().nullable(),
    Cc: z.string().nullable(),
    Bk: z.string().nullable(),
    Bn: z.string().nullable(),
    Se: z.string().nullable(),
    Ok: z.string().nullable(),
    Bp: z.string().nullable(),
    Dm: z.string().nullable(),
    Tb: z.string().nullable(),
    Cm: z.string().nullable(),
    W: z.string().nullable(),
  }),
});

function loadJsonFile<T>(filePath: string, schema: z.ZodType<T>): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return schema.parse(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load soil data from ${filePath}: ${detail}`, { cause: error });
  }
}

const soilDataset = loadJsonFile(SOIL_DATA_PATH, SoilDatasetSchema);
const drainageConfig = loadJsonFile(SOIL_DRAINAGE_PATH, SoilDrainageConfigSchema);
const drainageBySeries: Readonly<Record<string, string | null>> = drainageConfig.series;

function withDrainageClass(soil: z.infer<typeof SoilAttributesSchema>): SoilInfo {
  return SoilInfoSchema.parse({
    ...soil,
    drainageClass: drainageBySeries[soil.soilCode] ?? null,
  });
}

export function lookupSoil(lat: number, lon: number): SoilInfo | null {
  const searchPoint = point([lon, lat]);
  const feature = soilDataset.features.find((candidate) =>
    booleanPointInPolygon(searchPoint, candidate)
  );
  return feature ? withDrainageClass(feature.properties) : null;
}

export function getSoilLayer(): SoilFeatureCollection {
  return SoilFeatureCollectionSchema.parse({
    type: 'FeatureCollection',
    features: soilDataset.features.map((feature) => ({
      ...feature,
      properties: withDrainageClass(feature.properties),
    })),
  });
}
