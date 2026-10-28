import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT_DIR } from '../config.js';
import type { CapabilityReason, RiskFactorId, RiskResult } from '../../shared/contracts.js';

const RiskConfigSchema = z.object({
  calibrationStatus: z.literal('TO BE CALIBRATED'),
  thresholds: z.object({ lowBelow: z.number(), mediumBelow: z.number() }),
  factors: z.array(
    z.object({
      id: z.enum([
        'rainNowMmHr',
        'peakRain3hMmHr',
        'accum3hMm',
        'accum24hMm',
        'popMax3hPct',
        'lightning30minCount',
        'pressureDrop3hHpa',
        'humidityPct',
      ]),
      name: z.string(),
      unit: z.string(),
      lo: z.number(),
      hi: z.number(),
      weight: z.number().positive(),
    })
  ),
});

const riskConfig = RiskConfigSchema.parse(
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config', 'risk.json'), 'utf8')) as unknown
);

export interface RiskInput {
  id: RiskFactorId;
  rawValue: number | null;
  source: string;
  observedAt: string | null;
  reason?: CapabilityReason;
}

export interface CalculateRiskOptions {
  communityId: string;
  inputs: readonly RiskInput[];
  lightningWithin5km15minCount?: number | null;
  severeAlert?: 'moderate' | 'severe' | 'extreme' | null;
  fetchedAt?: string | null;
  isMock?: boolean;
  lightningSummary?: { count30min: number | null; nearestStrikeKm: number | null };
}

const urgentFactorIds: ReadonlySet<RiskFactorId> = new Set([
  'rainNowMmHr',
  'peakRain3hMmHr',
  'accum3hMm',
  'lightning30minCount',
  'pressureDrop3hHpa',
  'popMax3hPct',
]);

const localFactorIds = new Set(['elevation', 'soil', 'drainage', 'canalLevel', 'tideLevel']);

export function normalizeFactor(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value) || hi <= lo) {
    throw new RangeError('Risk normalization requires a finite value and hi > lo.');
  }
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

export function calculateScsCnRunoffRatio(precipitationMm: number, curveNumber: number): number {
  if (!Number.isFinite(precipitationMm) || precipitationMm < 0 ||
      !Number.isFinite(curveNumber) || curveNumber <= 0 || curveNumber > 100) {
    throw new RangeError('SCS-CN requires precipitation >= 0 and curve number in (0, 100].');
  }
  if (precipitationMm === 0) return 0;
  const retention = 25400 / curveNumber - 254;
  const initialAbstraction = 0.2 * retention;
  if (precipitationMm <= initialAbstraction) return 0;
  const runoff = (precipitationMm - initialAbstraction) ** 2 /
    (precipitationMm + 0.8 * retention);
  return Math.max(0, Math.min(1, runoff / precipitationMm));
}

function classify(score: number): RiskResult['level'] {
  if (score < riskConfig.thresholds.lowBelow) return 'LOW';
  if (score < riskConfig.thresholds.mediumBelow) return 'MEDIUM';
  return 'HIGH';
}

function groupScore(
  factors: RiskResult['factors'],
  include: (id: RiskFactorId) => boolean
): number | null {
  const available = factors.filter((factor) => factor.available && include(factor.id));
  const weight = available.reduce((sum, factor) => sum + factor.weight, 0);
  if (weight === 0) return null;
  return 100 * available.reduce(
    (sum, factor) => sum + (factor.normalized ?? 0) * factor.weight,
    0
  ) / weight;
}

const recommendations: Record<RiskResult['level'], Record<RiskResult['alertType'], string>> = {
  HIGH: {
    URGENT: 'ติดตามประกาศจากหน่วยงานทางการ เตรียมของจำเป็น และแจ้งผู้ดูแลชุมชนทันที',
    ADVANCE: 'ติดตามประกาศจากหน่วยงานทางการ เตรียมของจำเป็น และแจ้งผู้ดูแลชุมชน',
    NONE: 'ติดตามประกาศจากหน่วยงานทางการ เตรียมของจำเป็น และแจ้งผู้ดูแลชุมชน',
  },
  MEDIUM: {
    URGENT: 'ติดตามฝนและประกาศจากหน่วยงานในพื้นที่ เตรียมของจำเป็นไว้ใกล้ตัว',
    ADVANCE: 'ติดตามข้อมูลฝนและประกาศจากหน่วยงานในพื้นที่ เตรียมของจำเป็นไว้',
    NONE: 'ติดตามข้อมูลฝนและประกาศจากหน่วยงานในพื้นที่ เตรียมของจำเป็นไว้',
  },
  LOW: {
    URGENT: 'ติดตามฝนและประกาศจากหน่วยงานในพื้นที่อย่างใกล้ชิด',
    ADVANCE: 'ติดตามข้อมูลฝนและประกาศจากหน่วยงานในพื้นที่',
    NONE: 'ติดตามข้อมูลอากาศและประกาศจากหน่วยงานในพื้นที่ตามปกติ',
  },
  INSUFFICIENT: {
    URGENT: 'ข้อมูลยังไม่เพียงพอ โปรดติดตามประกาศจากหน่วยงานทางการ',
    ADVANCE: 'ข้อมูลยังไม่เพียงพอ โปรดติดตามประกาศจากหน่วยงานทางการ',
    NONE: 'ข้อมูลยังไม่เพียงพอ โปรดติดตามประกาศจากหน่วยงานทางการ',
  },
};

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const radians = (degrees: number): number => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateRisk(options: CalculateRiskOptions): RiskResult {
  const inputs = new Map(options.inputs.map((input) => [input.id, input]));
  const factors = riskConfig.factors.map((config) => {
    const input = inputs.get(config.id);
    const rawValue = input?.rawValue ?? null;
    const available = rawValue !== null && Number.isFinite(rawValue);
    return {
      id: config.id,
      name: config.name,
      rawValue: available ? rawValue : null,
      unit: config.unit,
      normalized: available ? normalizeFactor(rawValue, config.lo, config.hi) : null,
      weight: config.weight,
      available,
      isStale: false,
      source: input?.source ?? 'Xweather',
      observedAt: input?.observedAt ?? null,
      ...(available ? {} : { reason: input?.reason ?? 'error' as const }),
    };
  });
  const available = factors.filter(
    (factor): factor is typeof factor & { rawValue: number; normalized: number } =>
      factor.available && factor.rawValue !== null && factor.normalized !== null
  );
  const availableWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  const totalWeight = riskConfig.factors.reduce((sum, factor) => sum + factor.weight, 0);
  const insufficient = availableWeight < 0.4;
  const calculatedScore = insufficient
    ? null
    : Math.round(100 * available.reduce(
      (sum, factor) => sum + (factor.normalized ?? 0) * factor.weight,
      0
    ) / availableWeight);

  let level: RiskResult['level'] = calculatedScore === null ? 'INSUFFICIENT' : classify(calculatedScore);
  if (level !== 'INSUFFICIENT' && (options.lightningWithin5km15minCount ?? 0) > 0) {
    level = classify(Math.max(calculatedScore ?? 0, riskConfig.thresholds.lowBelow));
  }
  if (options.severeAlert === 'moderate' && level !== 'INSUFFICIENT') {
    level = classify(Math.max(calculatedScore ?? 0, riskConfig.thresholds.lowBelow));
  } else if (options.severeAlert === 'severe' || options.severeAlert === 'extreme') {
    level = 'HIGH';
  }

  const urgentScore = groupScore(factors, (id) => urgentFactorIds.has(id));
  const dayScore = groupScore(factors, (id) => id === 'accum24hMm');
  const alertType: RiskResult['alertType'] = urgentScore !== null && urgentScore >= 35
    ? 'URGENT'
    : dayScore !== null && dayScore >= 35
      ? 'ADVANCE'
      : 'NONE';
  const topContributors = [...available]
    .map((factor) => ({
      id: factor.id,
      name: factor.name,
      contribution: (factor.normalized ?? 0) * factor.weight / Math.max(availableWeight, 1e-9) * 100,
      rawValue: factor.rawValue,
      unit: factor.unit,
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const missingFactors = factors
    .filter((factor) => !factor.available)
    .map((factor) => ({
      id: factor.id,
      name: factor.name,
      reason: factor.reason ?? 'error',
    }));
  const missingSiteFactors = localFactorIds.size > 0;
  const confidence = totalWeight > 0 ? availableWeight / totalWeight : 0;
  const confidenceLevel: RiskResult['confidenceLevel'] = confidence < 0.4
    ? 'LOW'
    : confidence >= 0.8 && !missingSiteFactors
      ? 'HIGH'
      : 'MEDIUM';
  const hasLightningFloor = (options.lightningWithin5km15minCount ?? 0) > 0;
  const recommendationTh = recommendations[level][alertType];

  return {
    communityId: options.communityId,
    score: calculatedScore,
    level,
    alertType,
    confidence,
    confidenceLevel,
    factors,
    topContributors,
    lightningSummary: options.lightningSummary ?? { count30min: null, nearestStrikeKm: null },
    missingFactors,
    generatedAt: new Date().toISOString(),
    fetchedAt: options.fetchedAt ?? null,
    noticeTh: `คำนวณจากข้อมูลจริง ยังไม่ได้สอบเทียบกับเหตุการณ์น้ำท่วมในไทย${missingSiteFactors ? ' · ยังไม่มีข้อมูลระดับพื้นที่ ความสูง ดิน การระบายน้ำ และคลอง' : ''}${hasLightningFloor ? ' · มีฟ้าผ่าใกล้พื้นที่ในช่วง 15 นาที' : ''}`,
    recommendationTh,
    isMock: options.isMock ?? false,
  };
}
