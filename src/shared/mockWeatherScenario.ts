export type MockScenarioName = 'calm' | 'moderate' | 'burst';

export interface MockStormCell {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  peakMmHr: number;
  vxKmH: number;
  vyKmH: number;
  startOffsetMin: number;
  lifetimeMin: number;
}

export interface MockLightningStrike {
  id: string;
  lat: number;
  lon: number;
  timeOffsetMin: number;
  cellId: string;
}

export interface MockRiskInputs {
  rainNowMmHr: number;
  peakRain3hMmHr: number;
  accum3hMm: number;
  accum24hMm: number;
  popMax3hPct: number;
  lightning30minCount: number;
  lightningWithin5km15minCount: number;
  pressureDrop3hHpa: number;
  humidityPct: number;
}

export interface MockScenario {
  name: MockScenarioName;
  date: string;
  cells: MockStormCell[];
}

export const DEFAULT_DEMO_POINT = { lat: 13.7563, lon: 100.5018 };

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

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

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMockScenario(name: MockScenarioName, date: string): MockScenario {
  const random = seededRandom(hashSeed(`${name}:${date}`));
  const centerPeaks: Record<MockScenarioName, number> = { calm: 0.8, moderate: 12, burst: 82 };
  const spreadPeaks: Record<MockScenarioName, number> = { calm: 1.4, moderate: 11, burst: 58 };
  const cells: MockStormCell[] = [];

  for (let index = 0; index < 16; index += 1) {
    const central = index === 0;
    const angle = random() * Math.PI * 2;
    const distanceKm = central ? 0 : 14 + random() * 65;
    const eastKm = central ? 0 : Math.cos(angle) * distanceKm;
    const northKm = central ? 0 : Math.sin(angle) * distanceKm;
    const heading = random() * Math.PI * 2;
    const speed = central ? 2 : 5 + random() * 18;
    const peak = central
      ? centerPeaks[name]
      : (0.25 + random() * 0.75) * spreadPeaks[name];

    cells.push({
      id: `cell-${index + 1}`,
      lat: DEFAULT_DEMO_POINT.lat + (northKm / 111),
      lon: DEFAULT_DEMO_POINT.lon + (eastKm / (111 * Math.cos(DEFAULT_DEMO_POINT.lat * Math.PI / 180))),
      radiusKm: central ? 14 : 5 + random() * 14,
      peakMmHr: Math.round(peak * 10) / 10,
      vxKmH: Math.cos(heading) * speed,
      vyKmH: Math.sin(heading) * speed,
      startOffsetMin: central ? -240 : -180 + Math.floor(random() * 120),
      lifetimeMin: central ? 840 : 180 + Math.floor(random() * 360),
    });
  }
  return { name, date, cells };
}

export function activeCell(cell: MockStormCell, offsetMin: number): boolean {
  return offsetMin >= cell.startOffsetMin && offsetMin <= cell.startOffsetMin + cell.lifetimeMin;
}

export function cellPosition(cell: MockStormCell, offsetMin: number): { lat: number; lon: number } {
  const hours = offsetMin / 60;
  return {
    lat: cell.lat + (cell.vyKmH * hours) / 111,
    lon: cell.lon + (cell.vxKmH * hours) /
      (111 * Math.cos(cell.lat * Math.PI / 180)),
  };
}

export function cellIntensity(
  cell: MockStormCell,
  lat: number,
  lon: number,
  offsetMin: number
): number {
  if (!activeCell(cell, offsetMin)) return 0;
  const age = offsetMin - cell.startOffsetMin;
  const lifecycle = Math.min(1, age / 45, (cell.lifetimeMin - age) / 60);
  if (lifecycle <= 0) return 0;
  const position = cellPosition(cell, offsetMin);
  const distance = haversineDistanceKm(lat, lon, position.lat, position.lon);
  const sigma = Math.max(1, cell.radiusKm * 0.62);
  const gaussian = Math.exp(-(distance * distance) / (2 * sigma * sigma));
  const smoothNoise = 0.96 + (hashSeed(`${cell.id}:${Math.round(lat * 50)}:${Math.round(lon * 50)}`) % 9) / 100;
  return cell.peakMmHr * lifecycle * gaussian * smoothNoise;
}

export function scenarioIntensity(
  scenario: MockScenario,
  lat: number,
  lon: number,
  offsetMin: number
): number {
  return scenario.cells.reduce(
    (total, cell) => total + cellIntensity(cell, lat, lon, offsetMin),
    0
  );
}

export function scenarioLightningStrikes(
  scenario: MockScenario,
  offsetMin: number
): MockLightningStrike[] {
  const strikes: MockLightningStrike[] = [];
  for (const cell of scenario.cells) {
    if (cell.peakMmHr < 8) continue;
    for (const ageMin of [0, 10, 20]) {
      const strikeOffset = offsetMin - ageMin;
      const position = cellPosition(cell, strikeOffset);
      const intensity = cellIntensity(cell, position.lat, position.lon, strikeOffset);
      const count = Math.min(3, Math.floor(intensity / 11));
      const random = seededRandom(hashSeed(`${scenario.name}:${scenario.date}:${cell.id}:${strikeOffset}`));
      for (let index = 0; index < count; index += 1) {
        const angle = random() * Math.PI * 2;
        const distanceKm = random() * cell.radiusKm * 0.28;
        const lat = position.lat + (Math.sin(angle) * distanceKm) / 111;
        const lon = position.lon + (Math.cos(angle) * distanceKm) /
          (111 * Math.cos(position.lat * Math.PI / 180));
        if (cellIntensity(cell, lat, lon, strikeOffset) < 8) continue;
        strikes.push({
          id: `${cell.id}-${strikeOffset}-${index}`,
          lat,
          lon,
          timeOffsetMin: strikeOffset,
          cellId: cell.id,
        });
      }
    }
  }
  return strikes;
}

export function countWithinKm(
  scenario: MockScenario,
  lat: number,
  lon: number,
  radiusKm: number,
  minutes: number,
  offsetMin: number
): number {
  return scenarioLightningStrikes(scenario, offsetMin).filter((strike) =>
    offsetMin - strike.timeOffsetMin <= minutes &&
    haversineDistanceKm(lat, lon, strike.lat, strike.lon) <= radiusKm
  ).length;
}

export function nearestApproachingCell(
  scenario: MockScenario,
  lat: number,
  lon: number,
  offsetMin: number
): { cell: MockStormCell; etaMin: number; closestKm: number } | null {
  let nearest: { cell: MockStormCell; etaMin: number; closestKm: number } | null = null;
  for (const cell of scenario.cells) {
    if (cell.peakMmHr < 3 || !activeCell(cell, offsetMin)) continue;
    for (let etaMin = 0; etaMin <= 180; etaMin += 5) {
      if (!activeCell(cell, offsetMin + etaMin)) continue;
      const position = cellPosition(cell, offsetMin + etaMin);
      const distance = haversineDistanceKm(lat, lon, position.lat, position.lon);
      if (distance <= cell.radiusKm && (!nearest || etaMin < nearest.etaMin)) {
        nearest = { cell, etaMin, closestKm: distance };
        break;
      }
    }
  }
  return nearest;
}

function accumulatedRain(
  scenario: MockScenario,
  lat: number,
  lon: number,
  offsetMin: number,
  periodMin: number,
  stepMin: number
): number {
  let total = 0;
  for (let elapsed = 0; elapsed < periodMin; elapsed += stepMin) {
    total += scenarioIntensity(scenario, lat, lon, offsetMin + elapsed) * (stepMin / 60);
  }
  return Math.round(total * 10) / 10;
}

export function getMockRiskInputs(
  scenario: MockScenario,
  lat: number,
  lon: number,
  offsetMin: number
): MockRiskInputs {
  const rainNowMmHr = scenarioIntensity(scenario, lat, lon, offsetMin);
  let peakRain3hMmHr = rainNowMmHr;
  for (let elapsed = 10; elapsed <= 180; elapsed += 10) {
    peakRain3hMmHr = Math.max(
      peakRain3hMmHr,
      scenarioIntensity(scenario, lat, lon, offsetMin + elapsed)
    );
  }
  const lightning30minCount = countWithinKm(scenario, lat, lon, 20, 30, offsetMin);
  return {
    rainNowMmHr: Math.round(rainNowMmHr * 10) / 10,
    peakRain3hMmHr: Math.round(peakRain3hMmHr * 10) / 10,
    accum3hMm: accumulatedRain(scenario, lat, lon, offsetMin, 180, 10),
    accum24hMm: accumulatedRain(scenario, lat, lon, offsetMin, 1440, 30),
    popMax3hPct: Math.round(Math.min(95, 10 + peakRain3hMmHr * 2.7)),
    lightning30minCount,
    lightningWithin5km15minCount: countWithinKm(scenario, lat, lon, 5, 15, offsetMin),
    pressureDrop3hHpa: Math.round(Math.min(6, peakRain3hMmHr * 0.11) * 10) / 10,
    humidityPct: Math.round(Math.min(96, 70 + rainNowMmHr * 0.65)),
  };
}
