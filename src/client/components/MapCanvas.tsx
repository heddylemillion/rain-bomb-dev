import { Component, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, PropsWithChildren } from 'react';
import L from 'leaflet';
import {
  Circle,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  Community,
  OverlayLayerId,
  RiskResult,
  SoilFeatureCollection,
  SoilInfo,
} from '../../shared/contracts.js';
import {
  activeCell,
  buildStormTrackAndCone,
  cellIntensity,
  cellPosition,
  createMockScenario,
  DEFAULT_CONE_KM_PER_30MIN,
  haversineDistanceKm,
  scenarioIntensity,
  scenarioLightningStrikes,
  type MockScenario,
  type MockScenarioName,
  type MockStormCell,
} from '../../shared/mockWeatherScenario.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import { LEVEL_KEYS, LEVEL_SYMBOL, worstLevel, type RiskLevel } from '../lib/risk.js';
import { translateSoilName, translateSoilValue } from '../lib/soilLocalization.js';

export interface UserPosition {
  lat: number;
  lon: number;
}

interface MapCanvasProps {
  communities: Community[];
  risks: ReadonlyMap<string, RiskResult>;
  showRisk: boolean;
  selectedCommunityId: string | null;
  onSelectCommunity: (communityId: string) => void;
  onMapPick: (point: UserPosition) => void;
  overlays: ReadonlySet<OverlayLayerId>;
  soilLayer: SoilFeatureCollection | null;
  showSoilLayer: boolean;
  radarHours: number;
  mockMode: boolean;
  scenarioName: MockScenarioName;
  scenarioDate: string;
  simulationOffsetMin: number;
  radarOpacity: number;
  stormConeKmPer30Min?: number;
  userPosition: UserPosition | null;
  onMapReady: (map: L.Map) => void;
  onBaseTilesFailed: (failed: boolean) => void;
  baseTileRetry: number;
}

const CLUSTER_RADIUS_PX = 56;
/** 1×1 transparent PNG so a missing overlay tile (404) renders nothing instead of a broken image. */
const BLANK_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const OVERLAY_Z: Record<OverlayLayerId, number> = { radar: 300, storm: 310, lightning: 320 };

const SOIL_TEXTURE_STYLES: Record<string, L.PathOptions> = {
  'ดินเหนียว': { color: '#8f4e3b', fillColor: '#c98164' },
  'ดินเหนียวปนทรายแป้ง': { color: '#8a6a2d', fillColor: '#d4a84e', dashArray: '7 4' },
  'ดินร่วนปนทรายแป้ง': { color: '#356d62', fillColor: '#6fa99a', dashArray: '2 4' },
  water: { color: '#356c8a', fillColor: '#78b6d2', dashArray: '1 4' },
};

function soilPathStyle(feature: { properties: SoilInfo } | undefined, selected = false): L.PathOptions {
  if (selected) {
    return {
      color: '#ffffff',
      fillColor: '#22c55e',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.62,
    };
  }
  const style = SOIL_TEXTURE_STYLES[feature?.properties.textureTh ?? ''] ?? SOIL_TEXTURE_STYLES.water;
  return {
    ...style,
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0.38,
  };
}

function bindSoilTooltip(
  feature: { properties: SoilInfo },
  layer: L.Layer,
  language: 'th' | 'en',
  t: (key: MessageKey) => string
): void {
  const soilName = translateSoilName(feature.properties, language, t);
  const texture = translateSoilValue(feature.properties.textureTh, language, t);
  layer.bindTooltip(`${soilName} (${feature.properties.soilCode}) · ${texture}`);
}

const TILE_LAYER_CODE: Record<OverlayLayerId, string> = {
  radar: 'radar-global',
  lightning: 'lightning-flash',
  storm: 'tropical-cyclones',
};

const mockTileFrames = new Map<string, Map<string, HTMLCanvasElement>>();
const RADAR_TILE_SIZE = 256;
const RADAR_SAMPLE_SIZE = 80;
const MAX_CACHED_RADAR_TILES = 48;

function rememberRadarTile(
  frameKey: string,
  tileKey: string,
  tile: HTMLCanvasElement
): void {
  const frame = mockTileFrames.get(frameKey);
  if (!frame) return;
  frame.delete(tileKey);
  frame.set(tileKey, tile);
  mockTileFrames.delete(frameKey);
  mockTileFrames.set(frameKey, frame);

  let tileCount = [...mockTileFrames.values()].reduce((total, cached) => total + cached.size, 0);
  while (tileCount > MAX_CACHED_RADAR_TILES) {
    const oldestFrame = mockTileFrames.entries().next().value;
    if (!oldestFrame) break;
    const oldestTileKey = oldestFrame[1].keys().next().value;
    if (!oldestTileKey) {
      mockTileFrames.delete(oldestFrame[0]);
      continue;
    }
    oldestFrame[1].delete(oldestTileKey);
    tileCount -= 1;
    if (oldestFrame[1].size === 0) {
      mockTileFrames.delete(oldestFrame[0]);
    } else {
      mockTileFrames.delete(oldestFrame[0]);
      mockTileFrames.set(oldestFrame[0], oldestFrame[1]);
    }
  }
}

class MockRadarGridLayer extends L.GridLayer {
  private readonly scenario: MockScenario;
  private readonly offsetMin: number;

  constructor(scenario: MockScenario, offsetMin: number, opacity: number) {
    super({
      tileSize: RADAR_TILE_SIZE,
      opacity,
      maxNativeZoom: 12,
      maxZoom: 19,
      updateWhenIdle: true,
      keepBuffer: 1,
    });
    this.scenario = scenario;
    this.offsetMin = offsetMin;
    this.setZIndex(OVERLAY_Z.radar);
  }

  public createTile(coords: L.Coords): HTMLElement {
    const frameIndex = Math.max(0, Math.min(36, Math.round((this.offsetMin + 180) / 10)));
    const frameKey = `${this.scenario.name}:${this.scenario.date}:${frameIndex}`;
    const tileKey = `${coords.z}/${coords.x}/${coords.y}`;
    let frame = mockTileFrames.get(frameKey);
    if (!frame) {
      frame = new Map<string, HTMLCanvasElement>();
      mockTileFrames.set(frameKey, frame);
      while (mockTileFrames.size > 6) {
        const oldest = mockTileFrames.keys().next().value;
        if (oldest) mockTileFrames.delete(oldest);
        else break;
      }
    }

    const cached = frame.get(tileKey);
    const tile = document.createElement('canvas');
    tile.width = RADAR_TILE_SIZE;
    tile.height = RADAR_TILE_SIZE;
    const context = tile.getContext('2d');
    if (!context) {
      return tile;
    }
    if (cached) {
      context.drawImage(cached, 0, 0);
      rememberRadarTile(frameKey, tileKey, cached);
      return tile;
    }

    const sample = document.createElement('canvas');
    sample.width = RADAR_SAMPLE_SIZE;
    sample.height = RADAR_SAMPLE_SIZE;
    const sampleContext = sample.getContext('2d');
    if (!sampleContext) {
      return tile;
    }
    const pixels = sampleContext.createImageData(RADAR_SAMPLE_SIZE, RADAR_SAMPLE_SIZE);
    const stepPx = RADAR_TILE_SIZE / RADAR_SAMPLE_SIZE;
    for (let y = 0; y < RADAR_SAMPLE_SIZE; y += 1) {
      for (let x = 0; x < RADAR_SAMPLE_SIZE; x += 1) {
        const point = this._map?.unproject(
          L.point(
            coords.x * RADAR_TILE_SIZE + (x + 0.5) * stepPx,
            coords.y * RADAR_TILE_SIZE + (y + 0.5) * stepPx
          ),
          coords.z
        );
        if (!point) continue;
        const intensity = scenarioIntensity(
          this.scenario,
          point.lat,
          point.lng,
          this.offsetMin
        );
        const [red, green, blue, alpha] = radarColor(intensity);
        const index = (y * RADAR_SAMPLE_SIZE + x) * 4;
        pixels.data[index] = red;
        pixels.data[index + 1] = green;
        pixels.data[index + 2] = blue;
        pixels.data[index + 3] = alpha;
      }
    }
    sampleContext.putImageData(pixels, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(sample, 0, 0, RADAR_TILE_SIZE, RADAR_TILE_SIZE);
    rememberRadarTile(frameKey, tileKey, tile);
    return tile;
  }
}

/**
 * Smooth meteorological radar ramp:
 * 0 -> fully transparent -> green -> yellow -> red -> purple (extreme).
 */
export function radarColor(intensity: number): [number, number, number, number] {
  const ramp: Array<[number, [number, number, number, number]]> = [
    [0.12, [34, 197, 94, 0]],
    [1.2, [34, 197, 94, 115]],
    [4.5, [74, 222, 128, 155]],
    [11, [250, 204, 21, 185]],
    [22, [249, 115, 22, 205]],
    [38, [239, 68, 68, 220]],
    [58, [168, 85, 247, 234]],
    [85, [147, 51, 234, 242]],
  ];
  if (!Number.isFinite(intensity) || intensity <= ramp[0]![0]) return [0, 0, 0, 0];
  for (let index = 1; index < ramp.length; index += 1) {
    const before = ramp[index - 1]!;
    const after = ramp[index]!;
    if (intensity <= after[0]) {
      const ratio = (intensity - before[0]) / (after[0] - before[0]);
      return [
        Math.round(before[1][0] + (after[1][0] - before[1][0]) * ratio),
        Math.round(before[1][1] + (after[1][1] - before[1][1]) * ratio),
        Math.round(before[1][2] + (after[1][2] - before[1][2]) * ratio),
        Math.round(before[1][3] + (after[1][3] - before[1][3]) * ratio),
      ];
    }
  }
  const top = ramp[ramp.length - 1]![1];
  return [top[0], top[1], top[2], top[3]];
}

interface MapOverlayErrorBoundaryProps extends PropsWithChildren {
  fallback: string;
}

interface MapOverlayErrorBoundaryState {
  hasError: boolean;
}

class MapOverlayErrorBoundary extends Component<
  MapOverlayErrorBoundaryProps,
  MapOverlayErrorBoundaryState
> {
  public state: MapOverlayErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): MapOverlayErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Map overlay failed to render', error, info.componentStack);
  }

  public render(): React.ReactNode {
    return this.state.hasError ? (
      <div className="map-overlay-error" role="alert">
        {this.props.fallback}
      </div>
    ) : (
      this.props.children
    );
  }
}

function MockRadarOverlay({
  scenario,
  offsetMin,
  opacity,
}: {
  scenario: MockScenario;
  offsetMin: number;
  opacity: number;
}): null {
  const map = useMap();
  useEffect(() => {
    const layer = new MockRadarGridLayer(scenario, offsetMin, opacity);
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, offsetMin, scenario]);

  useEffect(() => {
    map.eachLayer((layer) => {
      if (layer instanceof MockRadarGridLayer) {
        layer.setOpacity(opacity);
      }
    });
  }, [map, opacity]);

  return null;
}

function intensityLabel(peak: number): string {
  if (peak >= 40) return 'ฝนหนักมาก';
  if (peak >= 20) return 'ฝนแรง';
  if (peak >= 8) return 'ฝนปานกลาง';
  return 'ฝนเบา';
}

function headingText(cell: MockStormCell): string {
  const angle = ((Math.atan2(cell.vxKmH, cell.vyKmH) * 180) / Math.PI + 360) % 360;
  const directions = [
    'ทิศเหนือ',
    'ทิศตะวันออกเฉียงเหนือ',
    'ทิศตะวันออก',
    'ทิศตะวันออกเฉียงใต้',
    'ทิศใต้',
    'ทิศตะวันตกเฉียงใต้',
    'ทิศตะวันตก',
    'ทิศตะวันตกเฉียงเหนือ',
  ];
  return directions[Math.round(angle / 45) % directions.length] ?? 'ทิศเหนือ';
}

function cellEta(
  cell: MockStormCell,
  lat: number,
  lon: number,
  offsetMin: number
): number | null {
  for (let elapsed = 0; elapsed <= 180; elapsed += 5) {
    if (!activeCell(cell, offsetMin + elapsed)) continue;
    const position = cellPosition(cell, offsetMin + elapsed);
    if (haversineDistanceKm(lat, lon, position.lat, position.lon) <= cell.radiusKm) {
      return elapsed;
    }
  }
  return null;
}

function MockStormLayer({
  scenario,
  offsetMin,
  selectedPoint,
  coneKmPer30Min,
}: {
  scenario: MockScenario;
  offsetMin: number;
  selectedPoint: UserPosition | null;
  coneKmPer30Min: number;
}): React.ReactNode {
  const { t } = useTranslation();
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  const active = useMemo(
    () =>
      scenario.cells.filter((cell) => {
        if (cell.peakMmHr < 3 || !activeCell(cell, offsetMin)) return false;
        const pos = cellPosition(cell, offsetMin);
        return cellIntensity(cell, pos.lat, pos.lon, offsetMin) >= 3;
      }),
    [offsetMin, scenario]
  );

  const effectiveSelectedId = useMemo(() => {
    if (selectedCellId && active.some((cell) => cell.id === selectedCellId)) {
      return selectedCellId;
    }
    if (!selectedPoint || active.length === 0) return active[0]?.id ?? null;
    let closestId = active[0]!.id;
    let bestDist = Infinity;
    for (const cell of active) {
      const pos = cellPosition(cell, offsetMin);
      const dist = haversineDistanceKm(selectedPoint.lat, selectedPoint.lon, pos.lat, pos.lon);
      if (dist < bestDist) {
        bestDist = dist;
        closestId = cell.id;
      }
    }
    return closestId;
  }, [active, offsetMin, selectedCellId, selectedPoint]);

  return (
    <>
      {active.map((cell) => {
        const isSelected = cell.id === effectiveSelectedId;
        const track = buildStormTrackAndCone(cell, offsetMin, coneKmPer30Min);
        const heading = headingText(cell);
        const eta = selectedPoint
          ? cellEta(cell, selectedPoint.lat, selectedPoint.lon, offsetMin)
          : null;
        const speed = Math.round(Math.hypot(cell.vxKmH, cell.vyKmH));
        const label = `${intensityLabel(cell.peakMmHr)} · ~${speed} กม./ชม.`;
        const detail =
          eta === null
            ? 'ไม่ผ่านจุดที่เลือก'
            : eta === 0
              ? 'กำลังปกคลุมพื้นที่'
              : `อาจถึงในอีกประมาณ ${eta} นาที`;

        const icon = L.divIcon({
          className: 'mock-storm-wrapper',
          html: `<span class="mock-storm-dot${isSelected ? ' is-selected' : ''}" aria-hidden="true">⛈</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        return (
          <Fragment key={cell.id}>
            <Circle
              center={[track.center.lat, track.center.lon]}
              radius={cell.radiusKm * 1000}
              pathOptions={{
                color: isSelected ? '#7dd3fc' : '#94a3b8',
                weight: isSelected ? 1.2 : 0.8,
                opacity: isSelected ? 0.45 : 0.18,
                fillColor: isSelected ? '#38bdf8' : '#64748b',
                fillOpacity: isSelected ? 0.06 : 0.02,
              }}
            />

            <Polygon
              positions={track.conePolygon}
              pathOptions={{
                color: isSelected ? '#38bdf8' : '#94a3b8',
                weight: isSelected ? 1.8 : 1,
                opacity: isSelected ? 0.88 : 0.26,
                dashArray: '6 5',
                fillColor: isSelected ? '#38bdf8' : '#94a3b8',
                fillOpacity: isSelected ? 0.14 : 0.04,
              }}
              eventHandlers={{
                click: (event) => {
                  L.DomEvent.stopPropagation(event);
                  setSelectedCellId(cell.id);
                },
              }}
            >
              <Tooltip sticky direction="top" className="glass-leaflet-tooltip">
                {t('coneOfUncertainty')}
              </Tooltip>
            </Polygon>

            <Polyline
              positions={track.centreline}
              pathOptions={{
                color: isSelected ? '#e0f2fe' : '#cbd5e1',
                weight: isSelected ? 2.2 : 1.2,
                opacity: isSelected ? 0.95 : 0.3,
              }}
            />

            {track.forecastDots.map((dot) => (
              <CircleMarker
                key={`${cell.id}-dot-${dot.stepMin}`}
                center={[dot.lat, dot.lon]}
                radius={isSelected ? 4 : 2.5}
                pathOptions={{
                  color: '#0f172a',
                  weight: isSelected ? 1.5 : 1,
                  opacity: isSelected ? 0.95 : 0.35,
                  fillColor: isSelected ? '#7dd3fc' : '#cbd5e1',
                  fillOpacity: isSelected ? 0.95 : 0.38,
                }}
                eventHandlers={{
                  click: (event) => {
                    L.DomEvent.stopPropagation(event);
                    setSelectedCellId(cell.id);
                  },
                }}
              >
                <Tooltip direction="top" className="glass-leaflet-tooltip">
                  +{dot.stepMin} นาที (±{dot.halfWidthKm.toFixed(1)} กม.)
                </Tooltip>
              </CircleMarker>
            ))}

            <Marker
              position={[track.center.lat, track.center.lon]}
              icon={icon}
              title={`พายุจำลอง · ${label}`}
              alt={`พายุจำลอง · ${label}`}
              zIndexOffset={isSelected ? 450 : 100}
              eventHandlers={{
                click: () => setSelectedCellId(cell.id),
              }}
            >
              <Tooltip direction="top" className="glass-leaflet-tooltip">
                {label} · {t('coneOfUncertainty')}
              </Tooltip>
              <Popup>
                <strong>พายุฝนฟ้าคะนองจำลอง · {intensityLabel(cell.peakMmHr)}</strong>
                <br />
                เคลื่อนไปทาง{heading} ~{speed} กม./ชม.
                <br />
                {detail} · {t('coneOfUncertainty')}
              </Popup>
            </Marker>
          </Fragment>
        );
      })}
    </>
  );
}

function MockLightningLayer({
  scenario,
  offsetMin,
  selectedPoint,
}: {
  scenario: MockScenario;
  offsetMin: number;
  selectedPoint: UserPosition | null;
}): React.ReactNode {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const strikes = useMemo(() => scenarioLightningStrikes(scenario, offsetMin), [offsetMin, scenario]);

  const rendered = useMemo(() => {
    if (zoom >= 12) return strikes.map((strike) => ({ key: strike.id, strikes: [strike] }));
    const cellPx = zoom <= 8 ? 64 : 52;
    const groups = new Map<string, typeof strikes>();
    for (const strike of strikes) {
      const pixel = map.project([strike.lat, strike.lon], zoom);
      const key = `${Math.floor(pixel.x / cellPx)}:${Math.floor(pixel.y / cellPx)}`;
      groups.set(key, [...(groups.get(key) ?? []), strike]);
    }
    return [...groups].map(([key, group]) => ({ key, strikes: group }));
  }, [map, strikes, zoom]);

  return (
    <>
      {rendered.map(({ key, strikes: group }) => {
        const strike = group[0];
        if (!strike) return null;
        const minAge = Math.min(...group.map((item) => Math.max(0, offsetMin - item.timeOffsetMin)));
        const ageClass = minAge <= 5 ? 'recent' : minAge <= 15 ? 'mid' : 'old';
        const ageLabel = minAge <= 5 ? '0–5 นาที' : minAge <= 15 ? '5–15 นาที' : '15–30 นาที';
        const isCluster = group.length > 1;
        const icon = L.divIcon({
          className: 'mock-lightning-wrapper',
          html: `<span class="mock-lightning-chip mock-lightning-${ageClass}" aria-hidden="true">⚡${
            isCluster ? `<span class="mock-lightning-count">${group.length}</span>` : ''
          }</span>`,
          iconSize: [isCluster ? 34 : 24, 24],
          iconAnchor: [isCluster ? 17 : 12, 12],
        });
        const time = new Intl.DateTimeFormat('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Bangkok',
        }).format(new Date(Date.now() + strike.timeOffsetMin * 60_000));
        const avgLat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
        const avgLon = group.reduce((sum, item) => sum + item.lon, 0) / group.length;
        const distance = selectedPoint
          ? haversineDistanceKm(selectedPoint.lat, selectedPoint.lon, avgLat, avgLon)
          : null;
        return (
          <Marker
            key={key}
            position={[avgLat, avgLon]}
            icon={icon}
            title={`ฟ้าผ่าจำลอง ${time} · ${ageLabel}${isCluster ? ` (${group.length} จุด)` : ''}`}
            alt={`ฟ้าผ่าจำลอง ${ageLabel}`}
          >
            <Tooltip direction="top" className="glass-leaflet-tooltip">
              ⚡ {isCluster ? `${group.length} จุด · ` : ''}{ageLabel}
            </Tooltip>
            <Popup>
              ฟ้าผ่าจำลอง {time} · {ageLabel}
              {distance === null ? '' : ` · ห่าง ${distance.toFixed(1)} กม. จากจุดที่เลือก`}
              {isCluster ? ` · รวม ${group.length} จุด` : ''}
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function rasterOffset(hours: number): string {
  return hours === 0 ? 'current' : `${hours}hour`;
}

const iconCache = new Map<string, L.DivIcon>();

function markerIcon(level: RiskLevel, selected: boolean): L.DivIcon {
  const key = `${level}-${selected}`;
  const cached = iconCache.get(key);
  if (cached) {
    return cached;
  }
  const size = selected ? 34 : 28;
  const icon = L.divIcon({
    className: 'risk-marker-wrapper',
    html: `<span class="risk-marker risk-marker-${level.toLowerCase()}${
      selected ? ' risk-marker-selected' : ''
    }" aria-hidden="true">${LEVEL_SYMBOL[level]}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  iconCache.set(key, icon);
  return icon;
}

function clusterIcon(level: RiskLevel, count: number): L.DivIcon {
  return L.DivIcon.prototype
    ? L.divIcon({
        className: 'risk-marker-wrapper',
        html: `<span class="risk-marker risk-marker-cluster risk-marker-${level.toLowerCase()}" aria-hidden="true"><span class="cluster-symbol">${LEVEL_SYMBOL[level]}</span><span class="cluster-count">${count}</span></span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
    : markerIcon(level, false);
}

const userIcon = L.divIcon({
  className: 'risk-marker-wrapper',
  html: '<span class="user-marker" aria-hidden="true"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

interface MarkerItem {
  community: Community;
  risk: RiskResult & { level: RiskLevel };
}

interface Cluster {
  x: number;
  y: number;
  items: MarkerItem[];
}

function buildClusters(
  map: L.Map,
  items: readonly MarkerItem[],
  selectedId: string | null
): Cluster[] {
  const zoom = map.getZoom();
  const clusters: Cluster[] = [];
  for (const item of items) {
    const point = map.project(L.latLng(item.community.lat, item.community.lon), zoom);
    const target =
      item.community.id === selectedId
        ? undefined
        : clusters.find(
            (cluster) =>
              !cluster.items.some((member) => member.community.id === selectedId) &&
              Math.hypot(cluster.x - point.x, cluster.y - point.y) <= CLUSTER_RADIUS_PX
          );
    if (target) {
      const count = target.items.length;
      target.x = (target.x * count + point.x) / (count + 1);
      target.y = (target.y * count + point.y) / (count + 1);
      target.items.push(item);
    } else {
      clusters.push({ x: point.x, y: point.y, items: [item] });
    }
  }
  return clusters;
}

function RiskMarkers({
  items,
  selectedCommunityId,
  onSelectCommunity,
  onMapPick,
}: {
  items: readonly MarkerItem[];
  selectedCommunityId: string | null;
  onSelectCommunity: (communityId: string) => void;
  onMapPick: (point: UserPosition) => void;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const [, setZoomTick] = useState(0);
  const map = useMapEvents({ zoomend: () => setZoomTick((tick) => tick + 1) });
  const clusters = buildClusters(map, items, selectedCommunityId);

  return (
    <>
      {clusters.map((cluster) => {
        const first = cluster.items[0];
        if (!first) return null;
        if (cluster.items.length === 1) {
          const { community, risk } = first;
          const selected = community.id === selectedCommunityId;
          const name = language === 'th' ? community.name_th : community.name_en;
          const label = `${name} · ${t(LEVEL_KEYS[risk.level].status)}`;
          return (
            <Marker
              key={community.id}
              position={[community.lat, community.lon]}
              icon={markerIcon(risk.level, selected)}
              title={label}
              alt={label}
              draggable={selected}
              zIndexOffset={selected ? 1000 : 0}
              eventHandlers={{
                click: () => onSelectCommunity(community.id),
                dragend: (event) => {
                  const position = (event.target as L.Marker).getLatLng();
                  onMapPick({ lat: position.lat, lon: position.lng });
                },
              }}
            />
          );
        }
        const level = worstLevel(cluster.items.map((member) => member.risk.level));
        const latLngs = cluster.items.map((member) =>
          L.latLng(member.community.lat, member.community.lon)
        );
        const center = L.latLngBounds(latLngs).getCenter();
        const label = `${t('markerCluster')} ${cluster.items.length} · ${t(
          LEVEL_KEYS[level].status
        )} · ${t('clusterZoomHint')}`;
        return (
          <Marker
            key={`cluster-${cluster.items.map((member) => member.community.id).join('+')}`}
            position={center}
            icon={clusterIcon(level, cluster.items.length)}
            title={label}
            alt={label}
            eventHandlers={{
              click: () => map.fitBounds(L.latLngBounds(latLngs), { padding: [90, 90], maxZoom: 15 }),
            }}
          />
        );
      })}
    </>
  );
}

function ExposeMap({ onMapReady }: { onMapReady: (map: L.Map) => void }): React.ReactNode {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);
  return null;
}

function FollowSelection({
  communities,
  selectedCommunityId,
}: {
  communities: Community[];
  selectedCommunityId: string | null;
}): React.ReactNode {
  const map = useMap();
  const [previous, setPrevious] = useState<string | null>(selectedCommunityId);
  useEffect(() => {
    if (selectedCommunityId === previous) {
      return;
    }
    setPrevious(selectedCommunityId);
    const community = communities.find((item) => item.id === selectedCommunityId);
    if (!community) {
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = L.latLng(community.lat, community.lon);
    const zoom = Math.max(map.getZoom(), 11);
    if (reduceMotion) {
      map.setView(target, zoom, { animate: false });
    } else {
      map.flyTo(target, zoom, { duration: 0.7 });
    }
  }, [communities, map, previous, selectedCommunityId]);
  return null;
}

export function MapCanvas({
  communities,
  risks,
  showRisk,
  selectedCommunityId,
  onSelectCommunity,
  onMapPick,
  overlays,
  radarHours,
  mockMode,
  scenarioName,
  scenarioDate,
  simulationOffsetMin,
  radarOpacity,
  stormConeKmPer30Min = DEFAULT_CONE_KM_PER_30MIN,
  userPosition,
  onMapReady,
  onBaseTilesFailed,
  baseTileRetry,
  soilLayer,
  showSoilLayer,
}: MapCanvasProps): React.ReactNode {
  const { t, language } = useTranslation();
  const [selectedSoilFeature, setSelectedSoilFeature] = useState<object | null>(null);
  const selectedSoilFeatureRef = useRef<object | null>(selectedSoilFeature);
  const selectedSoilLayerRef = useRef<L.Path | null>(null);
  const selectedSoilBaseStyleRef = useRef<L.PathOptions | null>(null);
  const soilFeatureClickRef = useRef(false);
  selectedSoilFeatureRef.current = selectedSoilFeature;
  const pickMapPoint = useCallback(
    (point: UserPosition): void => {
      if (selectedSoilLayerRef.current && selectedSoilBaseStyleRef.current) {
        selectedSoilLayerRef.current.setStyle(selectedSoilBaseStyleRef.current);
      }
      selectedSoilLayerRef.current = null;
      selectedSoilBaseStyleRef.current = null;
      selectedSoilFeatureRef.current = null;
      setSelectedSoilFeature(null);
      onMapPick(point);
    },
    [onMapPick]
  );
  const pickMapBackgroundPoint = useCallback(
    (point: UserPosition): void => {
      if (soilFeatureClickRef.current) {
        soilFeatureClickRef.current = false;
        return;
      }
      pickMapPoint(point);
    },
    [pickMapPoint]
  );
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
  const activeOverlayKey = [...overlays].sort().join(',');
  const scenario = useMemo(
    () => (mockMode ? createMockScenario(scenarioName, scenarioDate) : null),
    [mockMode, scenarioDate, scenarioName]
  );
  const [tileRefreshVersion, setTileRefreshVersion] = useState<Record<OverlayLayerId, number>>({
    radar: 0,
    lightning: 0,
    storm: 0,
  });
  const initialCenter = useMemo<[number, number]>(
    () =>
      communities[0]
        ? [communities[0].lat, communities[0].lon]
        : [13.7563, 100.5018],
    // Only compute initial center once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (mockMode) return undefined;
    const activeLayers = activeOverlayKey
      .split(',')
      .filter(
        (layer): layer is OverlayLayerId =>
          layer === 'radar' || layer === 'lightning' || layer === 'storm'
      );
    if (activeLayers.length === 0) return undefined;

    let timers: number[] = [];
    const clearTimers = (): void => {
      timers.forEach((timer) => window.clearInterval(timer));
      timers = [];
    };
    const startTimers = (): void => {
      clearTimers();
      if (document.visibilityState !== 'visible') return;
      timers = activeLayers.map((layer) =>
        window.setInterval(
          () => {
            setTileRefreshVersion((versions) => ({
              ...versions,
              [layer]: (versions[layer] ?? 0) + 1,
            }));
          },
          layer === 'storm' ? 30 * 60 * 1000 : 5 * 60 * 1000
        )
      );
    };
    const onVisibilityChange = (): void => {
      clearTimers();
      if (document.visibilityState === 'visible') {
        setTileRefreshVersion((versions) =>
          activeLayers.reduce(
            (next, layer) => ({ ...next, [layer]: (next[layer] ?? 0) + 1 }),
            { ...versions }
          )
        );
        startTimers();
      }
    };

    startTimers();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimers();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeOverlayKey, mockMode]);

  const items = useMemo<MarkerItem[]>(
    () =>
      communities.flatMap((community) => {
        const risk = risks.get(community.id);
        if (!risk || risk.level === 'INSUFFICIENT') return [];
        return [{ community, risk: { ...risk, level: risk.level } }];
      }),
    [communities, risks]
  );

  return (
    <div className="map-canvas absolute inset-0 z-0" role="region" aria-label={t('mapRegionLabel')}>
      <MapContainer
        className="w-full h-full"
        center={initialCenter}
        zoom={10}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
        zoomAnimation={!reduceMotion}
        fadeAnimation={!reduceMotion}
        markerZoomAnimation={!reduceMotion}
        minZoom={5}
        maxZoom={19}
      >
        <ExposeMap onMapReady={onMapReady} />
        <FollowSelection communities={communities} selectedCommunityId={selectedCommunityId} />
        <MapClickHandler onMapPick={pickMapBackgroundPoint} />
        <TileLayer
          key={baseTileRetry}
          url={import.meta.env.VITE_BASE_TILE_URL || '/api/map/tiles/{z}/{x}/{y}.png'}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          maxZoom={19}
          eventHandlers={{
            tileerror: () => onBaseTilesFailed(true),
          }}
        />
        {!mockMode &&
          [...overlays].map((layer) => (
            <MapOverlayErrorBoundary key={layer} fallback={t('mapOverlayError')}>
              <TileLayer
                key={`${layer}-${tileRefreshVersion[layer]}`}
                url={`/api/tiles/${TILE_LAYER_CODE[layer]}/{z}/{x}/{y}/${
                  layer === 'radar' ? rasterOffset(radarHours) : 'current'
                }.png`}
                opacity={layer === 'radar' ? radarOpacity : 0.9}
                zIndex={OVERLAY_Z[layer]}
                maxNativeZoom={12}
                maxZoom={19}
                errorTileUrl={BLANK_TILE}
              />
            </MapOverlayErrorBoundary>
          ))}
        {mockMode && scenario && overlays.has('radar') && (
          <MapOverlayErrorBoundary fallback={t('mapOverlayError')}>
            <MockRadarOverlay
              scenario={scenario}
              offsetMin={simulationOffsetMin}
              opacity={radarOpacity}
            />
          </MapOverlayErrorBoundary>
        )}
        {mockMode && scenario && overlays.has('storm') && (
          <MapOverlayErrorBoundary fallback={t('mapOverlayError')}>
            <MockStormLayer
              scenario={scenario}
              offsetMin={simulationOffsetMin}
              selectedPoint={userPosition}
              coneKmPer30Min={stormConeKmPer30Min}
            />
          </MapOverlayErrorBoundary>
        )}
        {mockMode && scenario && overlays.has('lightning') && (
          <MapOverlayErrorBoundary fallback={t('mapOverlayError')}>
            <MockLightningLayer
              scenario={scenario}
              offsetMin={simulationOffsetMin}
              selectedPoint={userPosition}
            />
          </MapOverlayErrorBoundary>
        )}
        {showSoilLayer && soilLayer && (
          <GeoJSON
            key={`soil-layer-${language}`}
            data={soilLayer}
            style={(feature) => soilPathStyle(feature, feature === selectedSoilFeature)}
            onEachFeature={(feature, layer) => {
              bindSoilTooltip(feature, layer, language, t);
              if (!(layer instanceof L.Path)) return;
              layer.on({
                click: (event: L.LeafletMouseEvent) => {
                  L.DomEvent.stopPropagation(event.originalEvent);
                  soilFeatureClickRef.current = true;
                  window.setTimeout(() => {
                    soilFeatureClickRef.current = false;
                  }, 0);
                  if (selectedSoilLayerRef.current && selectedSoilLayerRef.current !== layer) {
                    const previousStyle = selectedSoilBaseStyleRef.current;
                    if (previousStyle) {
                      selectedSoilLayerRef.current.setStyle(previousStyle);
                    }
                  }
                  selectedSoilLayerRef.current = layer;
                  selectedSoilBaseStyleRef.current = soilPathStyle(feature);
                  selectedSoilFeatureRef.current = feature;
                  layer.setStyle(soilPathStyle(feature, true));
                  setSelectedSoilFeature(feature);
                  onMapPick({ lat: event.latlng.lat, lon: event.latlng.lng });
                },
                mouseover: () => {
                  if (selectedSoilFeatureRef.current !== feature) {
                    layer.setStyle({ color: '#ffffff', weight: 3, opacity: 1 });
                  }
                },
                mouseout: () => {
                  layer.setStyle(soilPathStyle(feature, selectedSoilFeatureRef.current === feature));
                },
              });
            }}
          />
        )}
        {showRisk && (
          <RiskMarkers
            items={items}
            selectedCommunityId={selectedCommunityId}
            onSelectCommunity={onSelectCommunity}
            onMapPick={pickMapPoint}
          />
        )}
        {userPosition &&
          (!showRisk || selectedCommunityId === null || !risks.has(selectedCommunityId)) && (
            <Marker
              position={[userPosition.lat, userPosition.lon]}
              icon={userIcon}
              title={t('selectedPoint')}
              alt={t('selectedPoint')}
              draggable
              eventHandlers={{
                dragend: (event) => {
                  const position = (event.target as L.Marker).getLatLng();
                  pickMapPoint({ lat: position.lat, lon: position.lng });
                },
              }}
            />
          )}
      </MapContainer>
    </div>
  );
}

function MapClickHandler({
  onMapPick,
}: {
  onMapPick: (point: UserPosition) => void;
}): React.ReactNode {
  useMapEvents({
    click(event) {
      onMapPick({ lat: event.latlng.lat, lon: event.latlng.lng });
    },
  });
  return null;
}
