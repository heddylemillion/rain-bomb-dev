import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ROOT_DIR } from '../config.js';
import { RiskResultSchema, type RiskResult } from '../../shared/contracts.js';

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
