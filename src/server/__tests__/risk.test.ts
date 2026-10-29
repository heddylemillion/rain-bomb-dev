import { describe, expect, it } from 'vitest';
import type { RiskInput } from '../services/riskService.js';
import {
  calculateRisk,
  calculateScsCnRunoffRatio,
  haversineDistanceKm,
  normalizeFactor,
} from '../services/riskService.js';

const sourceInput = (id: RiskInput['id'], rawValue: number): RiskInput => ({
  id,
  rawValue,
  source: 'Xweather',
  observedAt: '2026-10-28T07:00:00.000Z',
});

const baseInputs = (): RiskInput[] => [
  sourceInput('peakRain3hMmHr', 5),
  sourceInput('accum3hMm', 10),
];

describe('transparent risk calculations', () => {
  it('clamps normalized values to the configured interval', () => {
    expect(normalizeFactor(0, 2, 30)).toBe(0);
    expect(normalizeFactor(16, 2, 30)).toBe(0.5);
    expect(normalizeFactor(40, 2, 30)).toBe(1);
    expect(() => normalizeFactor(1, 5, 5)).toThrow(RangeError);
  });

  it('weights only available factors and reports their coverage', () => {
    const result = calculateRisk({ communityId: 'point-1', inputs: baseInputs() });
    expect(result.score).toBe(0);
    expect(result.confidence).toBeCloseTo(0.4);
    expect(result.confidenceLevel).toBe('MEDIUM');
    expect(result.topContributors).toHaveLength(2);
    expect(result.missingFactors).toHaveLength(6);
  });

  it('keeps tide data contextual at zero weight and excludes it from the risk result', () => {
    const withoutTide = calculateRisk({ communityId: 'point-1', inputs: baseInputs() });
    const withTide = calculateRisk({
      communityId: 'point-1',
      inputs: [...baseInputs(), sourceInput('tideFactor', 2)],
    });

    expect(withTide.score).toBe(withoutTide.score);
    expect(withTide.confidence).toBe(withoutTide.confidence);
    expect(withTide.factors.some((factor) => factor.id === 'tideFactor')).toBe(false);
  });

  it.each([
    [35, 'MEDIUM'],
    [64, 'MEDIUM'],
    [65, 'HIGH'],
  ] as const)('uses configured level threshold at score %i', (targetScore, expected) => {
    const normalized = targetScore / 100;
    const inputs = [
      sourceInput('peakRain3hMmHr', 5 + normalized * 45),
      sourceInput('accum3hMm', 10 + normalized * 90),
    ];
    expect(calculateRisk({ communityId: 'point-1', inputs }).level).toBe(expected);
  });

  it('returns INSUFFICIENT without a score when available weight is below 0.40', () => {
    const result = calculateRisk({
      communityId: 'point-1',
      inputs: [sourceInput('rainNowMmHr', 20)],
    });
    expect(result.score).toBeNull();
    expect(result.level).toBe('INSUFFICIENT');
  });

  it('applies lightning and official-alert floors without changing the calculated score', () => {
    const inputs = baseInputs();
    const lightning = calculateRisk({
      communityId: 'point-1',
      inputs,
      lightningWithin5km15minCount: 1,
    });
    expect(lightning.level).toBe('MEDIUM');
    expect(lightning.score).toBe(0);

    const alert = calculateRisk({
      communityId: 'point-1',
      inputs,
      severeAlert: 'severe',
    });
    expect(alert.level).toBe('HIGH');
  });

  it('classifies urgent, advance, and no alert from available factor windows', () => {
    const urgent = calculateRisk({
      communityId: 'point-1',
      inputs: [
        sourceInput('peakRain3hMmHr', 50),
        sourceInput('accum3hMm', 100),
      ],
    });
    const advance = calculateRisk({
      communityId: 'point-1',
      inputs: [sourceInput('accum24hMm', 150)],
    });
    const none = calculateRisk({ communityId: 'point-1', inputs: baseInputs() });

    expect(urgent.alertType).toBe('URGENT');
    expect(advance.alertType).toBe('ADVANCE');
    expect(none.alertType).toBe('NONE');
  });

  it('computes SCS-CN runoff ratio and haversine distance', () => {
    expect(calculateScsCnRunoffRatio(10, 75)).toBe(0);
    const ratio = calculateScsCnRunoffRatio(50, 75);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
    expect(haversineDistanceKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
  });
});
