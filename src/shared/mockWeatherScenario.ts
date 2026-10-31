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
  const centerPeaks: Record<MockScenarioName, number> = { calm: 0.8, moderate: 14, burst: 82 };
  const spreadPeaks: Record<MockScenarioName, number> = { calm: 1.4, moderate: 11, burst: 80 };
  /**
   * Minimum share of the spread peak. A "burst" (rain bomb) is made of mature convective
   * cores, so every burst cell is intense; weaker scenarios keep a wide spread.
   */
  const peakFloor: Record<MockScenarioName, number> = { calm: 0.25, moderate: 0.3, burst: 0.72 };
  /** Rain-bomb cells are slow-moving, which is what lets rain pile up over one place. */
  const speedRange: Record<MockScenarioName, [number, number]> = {
    calm: [5, 22],
    moderate: [5, 20],
    burst: [2, 5.5],
  };
  const radiusRange: Record<MockScenarioName, [number, number]> = {
    calm: [5, 18],
    moderate: [6, 18],
    burst: [10, 18],
  };
  const cells: MockStormCell[] = [];

  for (let index = 0; index < 16; index += 1) {
    const central = index === 0;
    const angle = random() * Math.PI * 2;
    const distanceKm = central ? 0 : 14 + random() * 65;
    const eastKm = central ? 0 : Math.cos(angle) * distanceKm;
    const northKm = central ? 0 : Math.sin(angle) * distanceKm;
    const heading = random() * Math.PI * 2;
    const [minSpeed, maxSpeed] = speedRange[name];
    const speed = central ? 2 : minSpeed + random() * (maxSpeed - minSpeed);
    const [minRadius, maxRadius] = radiusRange[name];
    const radiusKm = central ? 14 : minRadius + random() * (maxRadius - minRadius);
    const floor = peakFloor[name];
    const peak = central
      ? centerPeaks[name]
      : (floor + random() * (1 - floor)) * spreadPeaks[name];
    const startOffsetMin = central
      ? -240
      : name === 'burst'
        ? -240 + Math.floor(random() * 150)
        : -180 + Math.floor(random() * 110);
    const lifetimeMin = central
      ? 900
      : name === 'burst'
        ? 480 + Math.floor(random() * 360)
        : 300 + Math.floor(random() * 360);

    cells.push({
      id: `cell-${index + 1}`,
      lat: DEFAULT_DEMO_POINT.lat + (northKm / 111),
      lon: DEFAULT_DEMO_POINT.lon + (eastKm / (111 * Math.cos(DEFAULT_DEMO_POINT.lat * Math.PI / 180))),
      radiusKm,
      peakMmHr: Math.round(peak * 10) / 10,
      vxKmH: Math.cos(heading) * speed,
      vyKmH: Math.sin(heading) * speed,
      startOffsetMin,
      lifetimeMin,
    });
  }
  return { name, date, cells };
}

export function activeCell(cell: MockStormCell, offsetMin: number): boolean {
  return offsetMin >= cell.startOffsetMin && offsetMin <= cell.startOffsetMin + cell.lifetimeMin;
}

export type MockCellStage = 'developing' | 'mature' | 'dissipating';

/** Minutes a cell needs to reach full strength, and the window before it ends where it decays. */
export const CELL_GROWTH_MIN = 45;
export const CELL_DECAY_MIN = 120;
/** Share of the radius treated as the convective core (where rain and lightning concentrate). */
export const CELL_CORE_RADIUS_RATIO = 0.35;

export function cellStage(cell: MockStormCell, offsetMin: number): MockCellStage | null {
  if (!activeCell(cell, offsetMin)) return null;
  const age = offsetMin - cell.startOffsetMin;
  if (age < CELL_GROWTH_MIN) return 'developing';
  if (cell.lifetimeMin - age < CELL_DECAY_MIN) return 'dissipating';
  return 'mature';
}

/**
 * The mature cell whose core covers the point, if any. The map and the risk notice use the same
 * definition, so "under a storm core" means the same thing on screen and in the risk card.
 */
export function matureCoreAt(
  scenario: MockScenario,
  lat: number,
  lon: number,
  offsetMin: number
): MockStormCell | null {
  for (const cell of scenario.cells) {
    if (cellStage(cell, offsetMin) !== 'mature' || cell.peakMmHr < 3) continue;
    const position = cellPosition(cell, offsetMin);
    if (haversineDistanceKm(lat, lon, position.lat, position.lon) <= cell.radiusKm * CELL_CORE_RADIUS_RATIO) {
      return cell;
    }
  }
  return null;
}

/** Closest active cell centre to a point (any stage), with its distance in km. */
export function nearestActiveCell(
  scenario: MockScenario,
  lat: number,
  lon: number,
  offsetMin: number
): { cell: MockStormCell; distanceKm: number } | null {
  let best: { cell: MockStormCell; distanceKm: number } | null = null;
  for (const cell of scenario.cells) {
    if (cell.peakMmHr < 3 || !activeCell(cell, offsetMin)) continue;
    const position = cellPosition(cell, offsetMin);
    const distanceKm = haversineDistanceKm(lat, lon, position.lat, position.lon);
    if (!best || distanceKm < best.distanceKm) best = { cell, distanceKm };
  }
  return best;
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
      const maxPerStep = intensity >= 38 ? 5 : 3;
      const count = Math.min(maxPerStep, Math.floor(intensity / 10));
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

export const DEFAULT_CONE_KM_PER_30MIN = 2.5;
export const STORM_TRACK_STEPS_MIN = [30, 60, 90, 120, 180] as const;

export interface StormTrackPoint {
  stepMin: (typeof STORM_TRACK_STEPS_MIN)[number];
  lat: number;
  lon: number;
  halfWidthKm: number;
}

export interface StormTrackAndCone {
  center: { lat: number; lon: number };
  centreline: Array<[number, number]>;
  forecastDots: StormTrackPoint[];
  conePolygon: Array<[number, number]>;
}

/** Cone half-width r(t) = r0 + k * (t / 30), where k is km of uncertainty growth per 30 min. */
export function stormConeHalfWidthKm(
  r0Km: number,
  elapsedMin: number,
  coneKmPer30Min: number = DEFAULT_CONE_KM_PER_30MIN
): number {
  return Math.max(0.5, r0Km) + Math.max(0, coneKmPer30Min) * (Math.max(0, elapsedMin) / 30);
}

function offsetLatLonKm(
  originLat: number,
  originLon: number,
  eastKm: number,
  northKm: number
): [number, number] {
  const cosLat = Math.max(0.2, Math.cos((originLat * Math.PI) / 180));
  return [originLat + northKm / 111, originLon + eastKm / (111 * cosLat)];
}

/**
 * Projects a storm cell's centreline at +30/60/90/120/180 min from its velocity vector
 * and builds the cone-of-uncertainty polygon by offsetting perpendicular to the heading.
 */
export function buildStormTrackAndCone(
  cell: MockStormCell,
  offsetMin: number,
  coneKmPer30Min: number = DEFAULT_CONE_KM_PER_30MIN
): StormTrackAndCone {
  const center = cellPosition(cell, offsetMin);
  const speed = Math.hypot(cell.vxKmH, cell.vyKmH);
  const ux = speed > 1e-6 ? cell.vxKmH / speed : 1;
  const uy = speed > 1e-6 ? cell.vyKmH / speed : 0;
  // Perpendicular left/right normals in local (eastKm, northKm) plane
  const leftX = -uy;
  const leftY = ux;
  const headingRad = Math.atan2(uy, ux);
  const r0Km = Math.max(1.5, cell.radiusKm * CELL_CORE_RADIUS_RATIO);

  const allSteps = [0, ...STORM_TRACK_STEPS_MIN];
  const samples = allSteps.map((stepMin) => {
    const pos = cellPosition(cell, offsetMin + stepMin);
    const halfWidthKm = stormConeHalfWidthKm(r0Km, stepMin, coneKmPer30Min);
    return { stepMin, lat: pos.lat, lon: pos.lon, halfWidthKm };
  });

  const leftEdge = samples.map((sample) =>
    offsetLatLonKm(sample.lat, sample.lon, leftX * sample.halfWidthKm, leftY * sample.halfWidthKm)
  );
  const rightEdge = [...samples].reverse().map((sample) =>
    offsetLatLonKm(sample.lat, sample.lon, -leftX * sample.halfWidthKm, -leftY * sample.halfWidthKm)
  );

  const last = samples[samples.length - 1]!;
  const frontArc: Array<[number, number]> = [1, 2, 3, 4].map((index) => {
    const theta = headingRad + Math.PI / 2 - (index * Math.PI) / 5;
    return offsetLatLonKm(
      last.lat,
      last.lon,
      Math.cos(theta) * last.halfWidthKm,
      Math.sin(theta) * last.halfWidthKm
    );
  });

  const first = samples[0]!;
  const backArc: Array<[number, number]> = [1, 2, 3].map((index) => {
    const theta = headingRad - Math.PI / 2 - (index * Math.PI) / 4;
    return offsetLatLonKm(
      first.lat,
      first.lon,
      Math.cos(theta) * first.halfWidthKm,
      Math.sin(theta) * first.halfWidthKm
    );
  });

  return {
    center,
    centreline: samples.map((sample) => [sample.lat, sample.lon]),
    forecastDots: samples.slice(1) as StormTrackPoint[],
    conePolygon: [...leftEdge, ...frontArc, ...rightEdge, ...backArc],
  };
}
