import { Component, Fragment, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, PropsWithChildren } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Community, OverlayLayerId, RiskResult } from '../../shared/contracts.js';
import {
  activeCell,
  cellPosition,
  countWithinKm,
  createMockScenario,
  haversineDistanceKm,
  nearestApproachingCell,
  scenarioIntensity,
  scenarioLightningStrikes,
  type MockScenario,
  type MockScenarioName,
  type MockStormCell,
} from '../../shared/mockWeatherScenario.js';
import { useTranslation } from '../i18n.js';
import { LEVEL_KEYS, LEVEL_SYMBOL, worstLevel, type RiskLevel } from '../lib/risk.js';

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
  radarHours: number;
  mockMode: boolean;
  scenarioName: MockScenarioName;
  scenarioDate: string;
  simulationOffsetMin: number;
  radarOpacity: number;
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
const TILE_LAYER_CODE: Record<OverlayLayerId, string> = {
  radar: 'radar-global',
  lightning: 'lightning-flash',
  storm: 'tropical-cyclones',
};

const mockTileFrames = new Map<string, Map<string, HTMLCanvasElement>>();
const RADAR_TILE_SIZE = 256;
const RADAR_SAMPLE_SIZE = 64;
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

  public createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
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
      done(new Error('ไม่สามารถสร้างภาพเรดาร์จำลองได้'), tile);
      return tile;
    }
    if (cached) {
      context.drawImage(cached, 0, 0);
      rememberRadarTile(frameKey, tileKey, cached);
      done(undefined, tile);
      return tile;
    }

    const sample = document.createElement('canvas');
    sample.width = RADAR_SAMPLE_SIZE;
    sample.height = RADAR_SAMPLE_SIZE;
    const sampleContext = sample.getContext('2d');
    if (!sampleContext) {
      done(new Error('ไม่สามารถคำนวณเรดาร์จำลองได้'), tile);
      return tile;
    }
    const pixels = sampleContext.createImageData(RADAR_SAMPLE_SIZE, RADAR_SAMPLE_SIZE);
    for (let y = 0; y < RADAR_SAMPLE_SIZE; y += 1) {
      for (let x = 0; x < RADAR_SAMPLE_SIZE; x += 1) {
        const point = this._map?.unproject(
          L.point(coords.x * RADAR_TILE_SIZE + x * 4 + 2, coords.y * RADAR_TILE_SIZE + y * 4 + 2),
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
    context.drawImage(sample, 0, 0, RADAR_TILE_SIZE, RADAR_TILE_SIZE);
    rememberRadarTile(frameKey, tileKey, tile);
    done(undefined, tile);
    return tile;
  }
}

function radarColor(intensity: number): [number, number, number, number] {
  const ramp: Array<[number, [number, number, number]]> = [
    [0.2, [147, 220, 92]],
    [2, [40, 190, 75]],
    [5, [255, 232, 57]],
    [10, [255, 145, 35]],
    [20, [225, 40, 45]],
    [40, [210, 45, 205]],
  ];
  if (!Number.isFinite(intensity) || intensity < ramp[0]![0]) return [0, 0, 0, 0];
  for (let index = 1; index < ramp.length; index += 1) {
    const before = ramp[index - 1]!;
    const after = ramp[index]!;
    if (intensity <= after[0]) {
      const ratio = (intensity - before[0]) / (after[0] - before[0]);
      return [
        Math.round(before[1][0] + (after[1][0] - before[1][0]) * ratio),
        Math.round(before[1][1] + (after[1][1] - before[1][1]) * ratio),
        Math.round(before[1][2] + (after[1][2] - before[1][2]) * ratio),
        190,
      ];
    }
  }
  return [210, 45, 205, 210];
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
    return this.state.hasError
      ? <div className="map-overlay-error" role="alert">{this.props.fallback}</div>
      : this.props.children;
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
    const layer = new MockRadarGridLayer(scenario, offsetMin, opacity).addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, offsetMin, opacity, scenario]);
  return null;
}

function intensityLabel(peak: number): string {
  if (peak >= 40) return 'ฝนหนักมาก';
  if (peak >= 20) return 'ฝนแรง';
  if (peak >= 8) return 'ฝนปานกลาง';
  return 'ฝนเบา';
}

function headingText(cell: MockStormCell): string {
  const angle = (Math.atan2(cell.vxKmH, cell.vyKmH) * 180 / Math.PI + 360) % 360;
  const directions = ['ทิศเหนือ', 'ทิศตะวันออกเฉียงเหนือ', 'ทิศตะวันออก', 'ทิศตะวันออกเฉียงใต้',
    'ทิศใต้', 'ทิศตะวันตกเฉียงใต้', 'ทิศตะวันตก', 'ทิศตะวันตกเฉียงเหนือ'];
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
}: {
  scenario: MockScenario;
  offsetMin: number;
  selectedPoint: UserPosition | null;
}): React.ReactNode {
  const active = scenario.cells.filter((cell) =>
    cell.peakMmHr >= 3 && activeCell(cell, offsetMin)
  );
  return (
    <>
      {active.map((cell) => {
        const center = cellPosition(cell, offsetMin);
        const heading = headingText(cell);
        const eta = selectedPoint ? cellEta(cell, selectedPoint.lat, selectedPoint.lon, offsetMin) : null;
        const speed = Math.round(Math.hypot(cell.vxKmH, cell.vyKmH));
        const path = [0, 30, 60, 90].map((future) => {
          const point = cellPosition(cell, offsetMin + future);
          return [point.lat, point.lon] as [number, number];
        });
        const arrowBearing = (Math.atan2(cell.vxKmH, cell.vyKmH) * 180 / Math.PI + 360) % 360;
        const icon = L.divIcon({
          className: 'mock-storm-center',
          html: '<span aria-hidden="true">⛈</span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        const arrowIcon = L.divIcon({
          className: 'mock-storm-arrow',
          html: `<span aria-hidden="true" style="transform:rotate(${arrowBearing}deg)">➤</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const detail = eta === null ? 'ไม่ผ่านจุดนี้' : `อาจถึงในอีกประมาณ ${eta} นาที`;
        return (
          <Fragment key={cell.id}>
            <Circle
              center={[center.lat, center.lon]}
              radius={cell.radiusKm * 1000}
              pathOptions={{ color: '#6f2da8', weight: 2, fillColor: '#a966d2', fillOpacity: 0.2 }}
            />
            <Polyline positions={path} pathOptions={{ color: '#57237e', weight: 2, dashArray: '5 7' }} />
            {path.slice(1).map(([lat, lon], index) => (
              <Fragment key={`${cell.id}-path-${index}`}>
                <Circle center={[lat, lon]} radius={950} pathOptions={{
                  color: '#57237e', weight: 1, fillColor: '#ffffff', fillOpacity: 0.7,
                }} />
                <Marker position={[lat, lon]} icon={arrowIcon} title={`แนวพายุจำลอง +${(index + 1) * 30} นาที`} />
              </Fragment>
            ))}
            <Marker position={[center.lat, center.lon]} icon={icon} title="พายุฝนฟ้าคะนองจำลอง">
              <Tooltip direction="top" permanent>พายุฝนฟ้าคะนองจำลอง</Tooltip>
              <Popup>
                <strong>พายุฝนฟ้าคะนองจำลอง · {intensityLabel(cell.peakMmHr)}</strong>
                <br />เคลื่อนไปทาง{heading} ~{speed} กม./ชม.
                <br />{detail}
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
  const [, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const strikes = scenarioLightningStrikes(scenario, offsetMin);
  const rendered = useMemo(() => {
    if (map.getZoom() >= 9) return strikes.map((strike) => ({ key: strike.id, strikes: [strike] }));
    const groups = new Map<string, typeof strikes>();
    for (const strike of strikes) {
      const pixel = map.project([strike.lat, strike.lon], map.getZoom());
      const key = `${Math.floor(pixel.x / 44)}:${Math.floor(pixel.y / 44)}`;
      groups.set(key, [...(groups.get(key) ?? []), strike]);
    }
    return [...groups].map(([key, group]) => ({ key, strikes: group }));
  }, [map, strikes]);
  return (
    <>
      {rendered.map(({ key, strikes: group }) => {
        const strike = group[0];
        if (!strike) return null;
        const age = Math.max(0, offsetMin - strike.timeOffsetMin);
        const ageClass = age <= 5 ? 'recent' : age <= 15 ? 'mid' : 'old';
        const ageLabel = age <= 5 ? '0–5 นาที' : age <= 15 ? '5–15 นาที' : '15–30 นาที';
        const icon = L.divIcon({
          className: `mock-lightning-marker mock-lightning-${ageClass}`,
          html: `<span aria-hidden="true">⚡${group.length > 1 ? ` ${group.length}` : ''}</span>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const time = new Intl.DateTimeFormat('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Bangkok',
        }).format(new Date(Date.now() + strike.timeOffsetMin * 60_000));
        const distance = selectedPoint
          ? haversineDistanceKm(selectedPoint.lat, selectedPoint.lon, strike.lat, strike.lon)
          : null;
        return (
          <Marker
            key={key}
            position={[
              group.reduce((sum, item) => sum + item.lat, 0) / group.length,
              group.reduce((sum, item) => sum + item.lon, 0) / group.length,
            ]}
            icon={icon}
            title={`ฟ้าผ่าจำลอง ${time} · ${ageLabel}`}
            alt={`ฟ้าผ่าจำลอง ${ageLabel}`}
          >
            <Popup>
              ฟ้าผ่าจำลอง {time} · {ageLabel}
              {distance === null ? '' : ` · ห่าง ${distance.toFixed(1)} กม. จากจุดที่เลือก`}
              {group.length > 1 ? ` · รวม ${group.length} จุด` : ''}
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function mockSummary(
  layer: OverlayLayerId,
  scenario: MockScenario,
  point: UserPosition | null,
  offsetMin: number
): string {
  const target = point ?? { lat: 13.7563, lon: 100.5018 };
  if (layer === 'lightning') {
    const count = countWithinKm(scenario, target.lat, target.lon, 20, 30, offsetMin);
    return `ฟ้าผ่าจำลอง: ในรัศมี 20 กม. ช่วง 30 นาที ${count} จุด`;
  }
  const closest = scenario.cells
    .filter((cell) => activeCell(cell, offsetMin))
    .map((cell) => {
      const position = cellPosition(cell, offsetMin);
      return { cell, distance: haversineDistanceKm(target.lat, target.lon, position.lat, position.lon) };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  if (!closest || closest.distance > 100) {
    return layer === 'radar' ? 'เรดาร์จำลอง: ไม่มีฝนใกล้พื้นที่' : 'พายุจำลอง: ไม่มีพายุใกล้พื้นที่';
  }
  if (layer === 'storm') {
    const approach = nearestApproachingCell(scenario, target.lat, target.lon, offsetMin);
    return `พายุจำลอง: ${intensityLabel(closest.cell.peakMmHr)} ห่างประมาณ ${Math.round(closest.distance)} กม.${approach ? ` อาจถึงใน ${approach.etaMin} นาที` : ''}`;
  }
  const intensity = scenarioIntensity(scenario, target.lat, target.lon, offsetMin);
  if (intensity < 1) return 'เรดาร์จำลอง: ไม่มีฝนใกล้พื้นที่';
  return `เรดาร์จำลอง: ${intensityLabel(intensity)} ห่างประมาณ ${Math.round(closest.distance)} กม.`;
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
  const size = selected ? 36 : 28;
  const icon = L.divIcon({
    className: 'risk-marker-wrapper',
    html: `<span class="risk-marker risk-marker-${level.toLowerCase()}${selected ? ' risk-marker-selected' : ''}" aria-hidden="true">${LEVEL_SYMBOL[level]}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  iconCache.set(key, icon);
  return icon;
}

function clusterIcon(level: RiskLevel, count: number): L.DivIcon {
  return L.divIcon({
    className: 'risk-marker-wrapper',
    html: `<span class="risk-marker risk-marker-cluster risk-marker-${level.toLowerCase()}" aria-hidden="true"><span class="cluster-symbol">${LEVEL_SYMBOL[level]}</span><span class="cluster-count">${count}</span></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

const userIcon = L.divIcon({
  className: 'risk-marker-wrapper',
  html: '<span class="user-marker" aria-hidden="true"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
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

/** Greedy pixel-distance clustering. The selected community is never merged so it stays visible and large. */
function buildClusters(map: L.Map, items: readonly MarkerItem[], selectedId: string | null): Cluster[] {
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
        if (!first) {
          return null;
        }
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
        const latLngs = cluster.items.map((member) => L.latLng(member.community.lat, member.community.lon));
        const center = L.latLngBounds(latLngs).getCenter();
        const label = `${t('markerCluster')} ${cluster.items.length} · ${t(LEVEL_KEYS[level].status)} · ${t('clusterZoomHint')}`;
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

/** Pans to a community when it is chosen from the picker (skipped for the initial selection). */
function FollowSelection({ communities, selectedCommunityId }: { communities: Community[]; selectedCommunityId: string | null }): React.ReactNode {
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
    const zoom = Math.max(map.getZoom(), 13);
    if (reduceMotion) {
      map.setView(target, zoom, { animate: false });
    } else {
      map.flyTo(target, zoom, { duration: 0.8 });
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
  userPosition,
  onMapReady,
  onBaseTilesFailed,
  baseTileRetry,
}: MapCanvasProps): React.ReactNode {
  const { t } = useTranslation();
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const activeOverlayKey = [...overlays].sort().join(',');
  const scenario = useMemo(
    () => mockMode ? createMockScenario(scenarioName, scenarioDate) : null,
    [mockMode, scenarioDate, scenarioName]
  );
  const [tileRefreshVersion, setTileRefreshVersion] = useState<Record<OverlayLayerId, number>>({
    radar: 0,
    lightning: 0,
    storm: 0,
  });
  const bounds = useMemo(
    () => communities.length > 0
      ? L.latLngBounds(communities.map((community) => L.latLng(community.lat, community.lon))).pad(0.35)
      : L.latLngBounds([13.5, 99.5], [15.5, 102]).pad(0.4),
    [communities]
  );
  useEffect(() => {
    if (mockMode) return undefined;
    const activeLayers = activeOverlayKey.split(',').filter(
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
      timers = activeLayers.map((layer) => window.setInterval(() => {
        setTileRefreshVersion((versions) => ({
          ...versions,
          [layer]: (versions[layer] ?? 0) + 1,
        }));
      }, layer === 'storm' ? 30 * 60 * 1000 : 5 * 60 * 1000));
    };
    const onVisibilityChange = (): void => {
      clearTimers();
      if (document.visibilityState === 'visible') {
        setTileRefreshVersion((versions) => activeLayers.reduce(
          (next, layer) => ({ ...next, [layer]: (next[layer] ?? 0) + 1 }),
          { ...versions }
        ));
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
    <div className="map-canvas" role="region" aria-label={t('mapRegionLabel')}>
      <MapContainer
        className="leaflet-fill"
        bounds={bounds}
        boundsOptions={{ paddingTopLeft: [24, 24], paddingBottomRight: [24, 24] }}
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
        <MapClickHandler onMapPick={onMapPick} />
        <TileLayer
          key={baseTileRetry}
          url={import.meta.env.VITE_BASE_TILE_URL || '/api/map/tiles/{z}/{x}/{y}.png'}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          maxZoom={19}
          eventHandlers={{
            tileerror: () => onBaseTilesFailed(true),
          }}
        />
        {!mockMode && [...overlays].map((layer) => (
          <MapOverlayErrorBoundary key={layer} fallback={t('mapOverlayError')}>
            <TileLayer
              key={`${layer}-${tileRefreshVersion[layer]}`}
              url={`/api/tiles/${TILE_LAYER_CODE[layer]}/{z}/{x}/{y}/${layer === 'radar' ? rasterOffset(radarHours) : 'current'}.png`}
              opacity={layer === 'radar' ? 0.75 : 0.9}
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
        {showRisk && (
          <RiskMarkers
            items={items}
            selectedCommunityId={selectedCommunityId}
            onSelectCommunity={onSelectCommunity}
            onMapPick={onMapPick}
          />
        )}
        {userPosition && (!showRisk || selectedCommunityId === null || !risks.has(selectedCommunityId)) && (
          <Marker
            position={[userPosition.lat, userPosition.lon]}
            icon={userIcon}
            title={t('selectedPoint')}
            alt={t('selectedPoint')}
            draggable
            eventHandlers={{
              dragend: (event) => {
                const position = (event.target as L.Marker).getLatLng();
                onMapPick({ lat: position.lat, lon: position.lng });
              },
            }}
          />
        )}
      </MapContainer>
      {mockMode && scenario && overlays.size > 0 && (
        <ul className="mock-layer-summaries" role="status" aria-live="polite">
          {[...overlays].map((layer) => (
            <li key={layer}>{mockSummary(layer, scenario, userPosition, simulationOffsetMin)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MapClickHandler({ onMapPick }: { onMapPick: (point: UserPosition) => void }): React.ReactNode {
  useMapEvents({
    click(event) {
      onMapPick({ lat: event.latlng.lat, lon: event.latlng.lng });
    },
  });
  return null;
}
