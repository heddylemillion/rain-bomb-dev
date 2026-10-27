import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Community, OverlayLayerId, RiskResult } from '../../shared/contracts.js';
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
  overlays: ReadonlySet<OverlayLayerId>;
  radarHours: number;
  userPosition: UserPosition | null;
  onMapReady: (map: L.Map) => void;
  onBaseTilesFailed: (failed: boolean) => void;
}

const CLUSTER_RADIUS_PX = 56;
/** 1×1 transparent PNG so a missing overlay tile (404) renders nothing instead of a broken image. */
const BLANK_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const OVERLAY_Z: Record<OverlayLayerId, number> = { radar: 300, storm: 310, lightning: 320 };

const iconCache = new Map<string, L.DivIcon>();

function markerIcon(level: RiskLevel, selected: boolean): L.DivIcon {
  const key = `${level}-${selected}`;
  const cached = iconCache.get(key);
  if (cached) {
    return cached;
  }
  const size = selected ? 64 : 44;
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
    iconSize: [56, 56],
    iconAnchor: [28, 28],
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
  risk: RiskResult;
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
}: {
  items: readonly MarkerItem[];
  selectedCommunityId: string | null;
  onSelectCommunity: (communityId: string) => void;
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
              zIndexOffset={selected ? 1000 : 0}
              eventHandlers={{ click: () => onSelectCommunity(community.id) }}
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
  overlays,
  radarHours,
  userPosition,
  onMapReady,
  onBaseTilesFailed,
}: MapCanvasProps): React.ReactNode {
  const { t } = useTranslation();
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const bounds = useMemo(
    () => L.latLngBounds(communities.map((community) => L.latLng(community.lat, community.lon))).pad(0.35),
    [communities]
  );
  const items = useMemo<MarkerItem[]>(
    () =>
      communities.flatMap((community) => {
        const risk = risks.get(community.id);
        return risk ? [{ community, risk }] : [];
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
        maxZoom={18}
      >
        <ExposeMap onMapReady={onMapReady} />
        <FollowSelection communities={communities} selectedCommunityId={selectedCommunityId} />
        <TileLayer
          url="/api/map/tiles/{z}/{x}/{y}.png"
          maxZoom={18}
          eventHandlers={{
            tileerror: () => onBaseTilesFailed(true),
            tileload: () => onBaseTilesFailed(false),
          }}
        />
        {[...overlays].map((layer) => (
          <TileLayer
            key={layer}
            url={`/api/map/overlay/${layer}/${layer === 'radar' ? radarHours : 0}/{z}/{x}/{y}.png`}
            opacity={layer === 'radar' ? 0.75 : 0.9}
            zIndex={OVERLAY_Z[layer]}
            maxNativeZoom={12}
            maxZoom={18}
            errorTileUrl={BLANK_TILE}
          />
        ))}
        {showRisk && (
          <RiskMarkers
            items={items}
            selectedCommunityId={selectedCommunityId}
            onSelectCommunity={onSelectCommunity}
          />
        )}
        {userPosition && (
          <Marker
            position={[userPosition.lat, userPosition.lon]}
            icon={userIcon}
            title={t('myLocation')}
            alt={t('myLocation')}
            keyboard={false}
          />
        )}
      </MapContainer>
    </div>
  );
}
