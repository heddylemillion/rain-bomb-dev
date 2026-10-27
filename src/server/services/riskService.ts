import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ROOT_DIR } from '../config.js';
import { RiskResultSchema, type RiskResult } from '../../shared/contracts.js';

export interface PointRiskInputs {
  forecastRain: number | null;
  forecastProbability: number | null;
  currentRainRate: number | null;
}

export function calculatePointRisk(inputs: PointRiskInputs, hasLocalTraits: boolean): {
  score: number;
  level: RiskResult['level'];
  factorIds: RiskResult['factorIds'];
  confidence: 'LOW' | 'MEDIUM';
  unavailableInputs: string[];
} {
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (inputs.forecastRain ?? 0) * 1.2 +
          (inputs.forecastProbability ?? 0) * 0.35 +
          (inputs.currentRainRate ?? 0) * 4
      )
    )
  );
  const level = score >= 65 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';
  return {
    score,
    level,
    factorIds: [
      ...(inputs.forecastRain === null ? [] : ['forecast-rain' as const]),
      ...(inputs.forecastProbability === null ? [] : ['forecast-pop' as const]),
      ...(inputs.currentRainRate === null ? [] : ['current-rain-rate' as const]),
    ],
    confidence: hasLocalTraits ? 'MEDIUM' : 'LOW',
    unavailableInputs: [
      ...(inputs.forecastRain === null ? ['forecast-rain'] : []),
      ...(inputs.forecastProbability === null ? ['forecast-probability'] : []),
      ...(inputs.currentRainRate === null ? ['current-rain-rate'] : []),
      ...(!hasLocalTraits ? ['elevation', 'soil', 'drainage', 'canal-station'] : []),
    ],
  };
}

const MockRiskRecordSchema = z.object({
  communityId: z.string(),
  score: z.number().int().min(0).max(100),
  level: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  alertType: z.enum(['URGENT', 'ADVANCE', 'NONE']),
  confidence: z.literal('LOW'),
  factorIds: z.array(z.enum(['forecast-rain', 'forecast-pop', 'current-rain-rate'])),
  inputIds: z.array(z.enum(['forecast-rain', 'forecast-pop', 'current-rain-rate'])),
  isMock: z.literal(true),
});

const MockRiskFileSchema = z.object({
  _comment: z.string(),
  calibrationStatus: z.string(),
  results: z.array(MockRiskRecordSchema),
});

export async function getMockRiskResult(
  communityId: string,
  generatedAt = new Date().toISOString()
): Promise<RiskResult | null> {
  const filePath = path.join(ROOT_DIR, 'mocks', 'risk-results.json');
  const fileContents = await fs.readFile(filePath, 'utf8');
  const fixture = MockRiskFileSchema.parse(JSON.parse(fileContents) as unknown);
  const record = fixture.results.find((result) => result.communityId === communityId);
  if (!record) {
    return null;
  }

  return RiskResultSchema.parse({
    ...record,
    recommendedActionId: record.level,
    generatedAt,
    calibrationStatus: fixture.calibrationStatus,
  });
}
