import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, PropsWithChildren } from 'react';
import L from 'leaflet';
import { Map as MapLibreMap } from 'maplibre-gl';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  Community,
  OverlayLayerId,
  RiskResult,
  SoilFeatureCollection,
  SoilInfo,
} from '../../shared/contracts.js';
import { DEFAULT_INITIAL_POINT } from '../../shared/geo.js';
import type { LightningSummary, StormTrackFeatureCollection } from '../../shared/providerContracts.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import { getBasemapStyleUrl, OSM_RASTER_TILE_URL } from '../lib/basemap.js';
import { LEVEL_KEYS, LEVEL_SYMBOL, worstLevel, type RiskLevel } from '../lib/risk.js';
import { translateSoilName, translateSoilValue } from '../lib/soilLocalization.js';
import { soilPathStyle } from '../lib/soilStyle.js';

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
  selectedSoilKey: string | null;
  showSoilLayer: boolean;
  radarFrameTime: number | null;
  radarProviderId: 'rainviewer' | 'tmd';
  radarMaxZoom: number;
  lightningSummary: LightningSummary | null;
  stormTracks: StormTrackFeatureCollection | null;
  stormTrackProviderId: 'gdacs';
  radarOpacity: number;
  userPosition: UserPosition | null;
  onMapReady: (map: L.Map) => void;
  onBaseTilesFailed: (failed: boolean, fellBackToOsm?: boolean) => void;
  baseTileRetry: number;
}

const CLUSTER_RADIUS_PX = 56;
/** 1×1 transparent PNG so a missing overlay tile (404) renders nothing instead of a broken image. */
const BLANK_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const OVERLAY_Z: Record<OverlayLayerId, number> = { radar: 300, storm: 310, lightning: 320 };

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

function SoilPane(): null {
  const map = useMap();
  useMemo(() => {
    const pane = map.getPane('soilPane') ?? map.createPane('soilPane');
    pane.style.zIndex = '280';
  }, [map]);
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

function VectorBasemap({
  styleUrl,
  onLoad,
  onFailure,
}: {
  styleUrl: string;
  onLoad: () => void;
  onFailure: () => void;
}): null {
  const leafletMap = useMap();

  useEffect(() => {
    const pane = leafletMap.createPane('vector-basemap');
    pane.style.zIndex = '199';
    pane.style.width = '100%';
    pane.style.height = '100%';
    pane.style.pointerEvents = 'none';
    pane.replaceChildren();
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    pane.append(container);

    const center = leafletMap.getCenter();
    const map = new MapLibreMap({
      container,
      style: styleUrl,
      center: [center.lng, center.lat],
      zoom: leafletMap.getZoom(),
      interactive: false,
      attributionControl: false,
      maxZoom: 19,
    });
    let failed = false;
    const fail = (): void => {
      if (failed) return;
      failed = true;
      onFailure();
    };
    const timeout = window.setTimeout(() => {
      if (!map.isStyleLoaded()) fail();
    }, 15_000);
    map.once('load', () => {
      window.clearTimeout(timeout);
      onLoad();
    });
    map.on('error', () => {
      if (!map.isStyleLoaded()) fail();
    });
    const syncView = (): void => {
      const current = leafletMap.getCenter();
      map.jumpTo({ center: [current.lng, current.lat], zoom: leafletMap.getZoom() });
    };
    const resize = (): void => {
      map.resize();
    };
    leafletMap.on('move zoom', syncView);
    leafletMap.on('resize', resize);

    return () => {
      window.clearTimeout(timeout);
      leafletMap.off('move zoom', syncView);
      leafletMap.off('resize', resize);
      map.remove();
      pane.replaceChildren();
    };
  }, [leafletMap, onFailure, onLoad, styleUrl]);

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
  radarFrameTime,
  radarProviderId,
  radarMaxZoom,
  lightningSummary,
  stormTracks,
  stormTrackProviderId,
  radarOpacity,
  userPosition,
  onMapReady,
  onBaseTilesFailed,
  baseTileRetry,
  soilLayer,
  selectedSoilKey,
  showSoilLayer,
}: MapCanvasProps): React.ReactNode {
  const { t, language } = useTranslation();
  const selectedSoilKeyRef = useRef(selectedSoilKey);
  selectedSoilKeyRef.current = selectedSoilKey;
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );
  const configuredStyleUrl = getBasemapStyleUrl(
    import.meta.env.VITE_BASEMAP_PROVIDER,
    import.meta.env.VITE_BASEMAP_STYLE_URL
  );
  const [baseStyleFailed, setBaseStyleFailed] = useState(!configuredStyleUrl);
  const [radarRefreshVersion, setRadarRefreshVersion] = useState(0);

  useEffect(() => {
    setBaseStyleFailed(!configuredStyleUrl);
    if (!configuredStyleUrl) onBaseTilesFailed(true, true);
  }, [baseTileRetry, configuredStyleUrl, onBaseTilesFailed]);
  const reportBaseStyleLoaded = useCallback(() => {
    setBaseStyleFailed(false);
    onBaseTilesFailed(false, false);
  }, [onBaseTilesFailed]);
  const reportBaseStyleFailure = useCallback(() => {
    setBaseStyleFailed(true);
    onBaseTilesFailed(true, true);
  }, [onBaseTilesFailed]);
  const initialCenter = useMemo<[number, number]>(
    () =>
      communities[0]
        ? [communities[0].lat, communities[0].lon]
        : [DEFAULT_INITIAL_POINT.lat, DEFAULT_INITIAL_POINT.lon],
    // Only compute initial center once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!overlays.has('radar')) return undefined;
    let timer: number | null = null;
    const startTimer = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = document.visibilityState === 'visible'
        ? window.setInterval(() => setRadarRefreshVersion((version) => version + 1), 5 * 60 * 1000)
        : null;
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') setRadarRefreshVersion((version) => version + 1);
      startTimer();
    };

    startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [overlays]);

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
        <SoilPane />
        <FollowSelection communities={communities} selectedCommunityId={selectedCommunityId} />
        <MapClickHandler onMapPick={onMapPick} />
        {configuredStyleUrl && !baseStyleFailed ? (
          <VectorBasemap
            key={`${baseTileRetry}-${configuredStyleUrl}`}
            styleUrl={configuredStyleUrl}
            onLoad={reportBaseStyleLoaded}
            onFailure={reportBaseStyleFailure}
          />
        ) : (
          <TileLayer
            key={`osm-fallback-${baseTileRetry}`}
            url={OSM_RASTER_TILE_URL}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
            maxZoom={19}
            eventHandlers={{
              tileerror: () => onBaseTilesFailed(true, true),
            }}
          />
        )}
        {[...overlays].map((layer) => {
          if (layer === 'radar' && radarFrameTime === null) return null;
          if (layer !== 'radar') return null;
          const tileUrl = `/api/radar/tiles/{z}/{x}/{y}/${radarFrameTime}.png`;
          return (
            <MapOverlayErrorBoundary key={layer} fallback={t('mapOverlayError')}>
              <TileLayer
                key={`${layer}-${radarRefreshVersion}-${radarProviderId}-${radarFrameTime}`}
                url={tileUrl}
                opacity={radarOpacity}
                zIndex={OVERLAY_Z[layer]}
                maxNativeZoom={radarMaxZoom}
                maxZoom={19}
                errorTileUrl={BLANK_TILE}
              />
            </MapOverlayErrorBoundary>
          );
        })}
        {overlays.has('storm') && stormTrackProviderId === 'gdacs' && stormTracks && (
          <GeoJSON
            data={stormTracks}
            style={(feature) => ({
              color: feature?.geometry.type === 'Polygon' ? '#f97316' : '#facc15',
              weight: feature?.geometry.type === 'Polygon' ? 1.5 : 3,
              fillColor: '#f97316',
              fillOpacity: 0.12,
            })}
            onEachFeature={(feature, layer) => {
              const name = String(feature.properties?.['eventname'] ?? '').trim();
              const label = String(feature.properties?.['polygonlabel'] ?? '').trim();
              const text = [name, label].filter(Boolean).join(' · ');
              if (text) {
                layer.bindTooltip(text, { className: 'glass-leaflet-tooltip', sticky: true });
              }
            }}
          />
        )}
        {overlays.has('lightning') &&
          userPosition && lightningSummary?.count30min !== null &&
          lightningSummary?.count30min !== undefined && (
            <CircleMarker
              center={[userPosition.lat, userPosition.lon]}
              radius={12}
              pathOptions={{ color: '#facc15', fillColor: '#facc15', fillOpacity: 0.7 }}
            >
              <Tooltip direction="top" className="glass-leaflet-tooltip">
                ⚡ {lightningSummary.count30min} · {lightningSummary.nearestStrikeKm === null
                  ? 'ไม่พบจุดฟ้าผ่าใน 30 นาที'
                  : `ใกล้สุด ${lightningSummary.nearestStrikeKm.toFixed(1)} กม.`}
              </Tooltip>
            </CircleMarker>
          )}
        {showSoilLayer && soilLayer && (
          <GeoJSON
            key={`soil-layer-${language}`}
            data={soilLayer}
            pane="soilPane"
            bubblingMouseEvents={false}
            style={(feature) => soilPathStyle(feature, selectedSoilKey)}
            onEachFeature={(feature, layer) => {
              bindSoilTooltip(feature, layer, language, t);
              if (!(layer instanceof L.Path)) return;
              layer.on('mouseover', () => {
                layer.setStyle({ color: '#ffffff', weight: 4, opacity: 1 });
              });
              layer.on('mouseout', () => {
                layer.setStyle(soilPathStyle(feature, selectedSoilKeyRef.current));
              });
              layer.on('click', (event: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(event.originalEvent);
                onMapPick({ lat: event.latlng.lat, lon: event.latlng.lng });
              });
            }}
          />
        )}
        {showRisk && (
          <RiskMarkers
            items={items}
            selectedCommunityId={selectedCommunityId}
            onSelectCommunity={onSelectCommunity}
            onMapPick={onMapPick}
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
                  onMapPick({ lat: position.lat, lon: position.lng });
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
