import { describe, expect, it, vi } from 'vitest';
import {
  activeCell,
  buildStormTrackAndCone,
  CELL_CORE_RADIUS_RATIO,
  cellPosition,
  cellStage,
  countWithinKm,
  createMockScenario,
  DEFAULT_CONE_KM_PER_30MIN,
  getMockRiskInputs,
  haversineDistanceKm,
  nearestApproachingCell,
  scenarioIntensity,
  scenarioLightningStrikes,
  stormConeHalfWidthKm,
} from '../../shared/mockWeatherScenario.js';
import { RiskDataService } from '../services/riskDataService.js';
import { XweatherClient } from '../services/xweatherClient.js';

const demoPoint = { lat: 13.7563, lon: 100.5018 };
const testDate = '2026-10-29';

describe('shared mock weather scenario', () => {
  it('is deterministic for cell positions, rainfall, and strikes', () => {
    const first = createMockScenario('moderate', testDate);
    const second = createMockScenario('moderate', testDate);
    expect(first).toEqual(second);
    expect(scenarioIntensity(first, demoPoint.lat, demoPoint.lon, 0))
      .toBe(scenarioIntensity(second, demoPoint.lat, demoPoint.lon, 0));
    expect(scenarioLightningStrikes(first, 0)).toEqual(scenarioLightningStrikes(second, 0));
  });

  it('keeps generated lightning inside an active cell core above the strike threshold', () => {
    const scenario = createMockScenario('burst', testDate);
    const strikes = scenarioLightningStrikes(scenario, 0);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) {
      const cell = scenario.cells.find((candidate) => candidate.id === strike.cellId);
      expect(cell).toBeDefined();
      expect(scenarioIntensity(scenario, strike.lat, strike.lon, strike.timeOffsetMin))
        .toBeGreaterThanOrEqual(8);
      expect(haversineDistanceKm(
        cellPosition(cell!, strike.timeOffsetMin).lat,
        cellPosition(cell!, strike.timeOffsetMin).lon,
        strike.lat,
        strike.lon
      )).toBeLessThan(cell!.radiusKm);
    }
    expect(countWithinKm(scenario, demoPoint.lat, demoPoint.lon, 20, 30, 0))
      .toBeGreaterThan(0);
  });

  it('calculates storm arrival from the cell velocity and radius', () => {
    const scenario = createMockScenario('moderate', testDate);
    const result = nearestApproachingCell(scenario, demoPoint.lat + 0.1, demoPoint.lon, 0);
    expect(result).not.toBeNull();
    const position = cellPosition(result!.cell, result!.etaMin);
    expect(haversineDistanceKm(
      demoPoint.lat + 0.1,
      demoPoint.lon,
      position.lat,
      position.lon
    )).toBeLessThanOrEqual(result!.cell.radiusKm);
    if (result!.etaMin > 0) {
      const previous = cellPosition(result!.cell, result!.etaMin - 5);
      expect(haversineDistanceKm(
        demoPoint.lat + 0.1,
        demoPoint.lon,
        previous.lat,
        previous.lon
      )).toBeGreaterThan(result!.cell.radiusKm);
    }
  });

  it('converts displayed mock timestamps with the Bangkok timezone', () => {
    expect(new Intl.DateTimeFormat('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date('2026-10-29T00:00:00.000Z'))).toBe('07:00');
  });

  it('derives LOW, MEDIUM, and HIGH through the configured real risk engine without provider calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: 'mock-mode-test',
      clientSecret: 'mock-mode-test-secret',
      fetchImpl,
    });
    const providerSpies = [
      vi.spyOn(client, 'fetchConditions'),
      vi.spyOn(client, 'fetchObservations'),
      vi.spyOn(client, 'fetchHourlyForecast'),
      vi.spyOn(client, 'fetchObservationsArchive'),
      vi.spyOn(client, 'fetchLightningWithin'),
      vi.spyOn(client, 'fetchRawEndpoint'),
    ];
    const service = new RiskDataService(client, 'mock');
    const results = await Promise.all(
      (['calm', 'moderate', 'burst'] as const).map((scenario) =>
        service.getPointRisk(demoPoint.lat, demoPoint.lon, {
          scenario,
          date: testDate,
          offsetMin: 0,
        })
      )
    );
    expect(results.map((result) => result.level)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(results.every((result) => result.isMock)).toBe(true);
    expect(results[1]?.factors.every((factor) =>
      factor.source === 'จำลอง (scenario: moderate)'
    )).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(providerSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('derives all mock risk fields from the scenario at the selected point', () => {
    const scenario = createMockScenario('moderate', testDate);
    const inputs = getMockRiskInputs(scenario, demoPoint.lat, demoPoint.lon, 0);
    expect(inputs.rainNowMmHr).toBeCloseTo(scenarioIntensity(
      scenario,
      demoPoint.lat,
      demoPoint.lon,
      0
    ), 1);
    expect(inputs.lightning30minCount).toBe(
      countWithinKm(scenario, demoPoint.lat, demoPoint.lon, 20, 30, 0)
    );
  });

  it('yields HIGH through the real risk engine at every active cell core in burst scenario', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new XweatherClient({
      baseUrl: 'https://data.api.xweather.com',
      clientId: 'mock-mode-test',
      clientSecret: 'mock-mode-test-secret',
      fetchImpl,
    });
    const service = new RiskDataService(client, 'mock');
    for (const date of ['2026-10-29', '2026-10-31', '2026-06-15']) {
      const scenario = createMockScenario('burst', date);
      const activeCells = scenario.cells.filter((cell) => activeCell(cell, 0));
      expect(activeCells.length).toBeGreaterThan(0);
      for (const cell of activeCells) {
        expect(cellStage(cell, 0)).toBe('mature');
        const center = cellPosition(cell, 0);
        const edgeLat = center.lat + (cell.radiusKm * CELL_CORE_RADIUS_RATIO * 0.9) / 111;
        for (const point of [center, { lat: edgeLat, lon: center.lon }]) {
          const risk = await service.getPointRisk(point.lat, point.lon, {
            scenario: 'burst',
            date,
            offsetMin: 0,
          });
          expect(risk.level).toBe('HIGH');
          expect(risk.noticeTh).not.toContain('ไม่มีฝนใกล้พื้นที่');
        }
      }
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('projects storm track dots at +30/60/90/120/180 min and grows cone width r(t) = r0 + k*(t/30)', () => {
    const scenario = createMockScenario('burst', testDate);
    const cell = scenario.cells[1]!;
    const track = buildStormTrackAndCone(cell, 0, DEFAULT_CONE_KM_PER_30MIN);
    expect(track.forecastDots.map((dot) => dot.stepMin)).toEqual([30, 60, 90, 120, 180]);
    const r0 = Math.max(1.5, cell.radiusKm * CELL_CORE_RADIUS_RATIO);
    for (const dot of track.forecastDots) {
      const expectedPos = cellPosition(cell, dot.stepMin);
      expect(dot.lat).toBeCloseTo(expectedPos.lat, 6);
      expect(dot.lon).toBeCloseTo(expectedPos.lon, 6);
      expect(dot.halfWidthKm).toBeCloseTo(stormConeHalfWidthKm(r0, dot.stepMin, 2.5), 6);
    }
    const wider = buildStormTrackAndCone(cell, 0, 5.0);
    expect(wider.forecastDots[4]!.halfWidthKm - wider.forecastDots[0]!.halfWidthKm).toBeCloseTo(5.0 * 5, 5);
    expect(track.conePolygon.length).toBeGreaterThanOrEqual(16);
  });
});
