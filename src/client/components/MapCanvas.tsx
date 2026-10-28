import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { GeoJSON, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Community, OverlayLayerId, RiskResult, SoilFeatureCollection, SoilInfo } from '../../shared/contracts.js';
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
  userPosition: UserPosition | null;
  onMapReady: (map: L.Map) => void;
  onBaseTilesFailed: (failed: boolean) => void;
}

const CLUSTER_RADIUS_PX = 56;
/** 1×1 transparent PNG so a missing overlay tile (404) renders nothing instead of a broken image. */
const BLANK_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const OVERLAY_Z: Record<OverlayLayerId, number> = { radar: 300, storm: 310, lightning: 320, soil: 330 };

const SOIL_TEXTURE_STYLES: Record<string, L.PathOptions> = {
  'ดินเหนียว': { color: '#8f4e3b', fillColor: '#c98164', dashArray: undefined },
  'ดินเหนียวปนทรายแป้ง': { color: '#8a6a2d', fillColor: '#d4a84e', dashArray: '7 4' },
  'ดินร่วนปนทรายแป้ง': { color: '#356d62', fillColor: '#6fa99a', dashArray: '2 4' },
  water: { color: '#356c8a', fillColor: '#78b6d2', dashArray: '1 4' },
};

function soilPathStyle(feature: { properties: SoilInfo } | undefined): L.PathOptions {
  const texture = feature?.properties.textureTh;
  const style = texture ? SOIL_TEXTURE_STYLES[texture] : SOIL_TEXTURE_STYLES['water'];
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
  const { soilCode } = feature.properties;
  const soilName = translateSoilName(feature.properties, language, t);
  const texture = translateSoilValue(feature.properties.textureTh, language, t);
  layer.bindTooltip(`${soilName} (${soilCode}) · ${texture}`);
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
  soilLayer,
  showSoilLayer,
  radarHours,
  userPosition,
  onMapReady,
  onBaseTilesFailed,
}: MapCanvasProps): React.ReactNode {
  const { t, language } = useTranslation();
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const bounds = useMemo(
    () => communities.length > 0
      ? L.latLngBounds(communities.map((community) => L.latLng(community.lat, community.lon))).pad(0.35)
      : L.latLngBounds([13.5, 99.5], [15.5, 102]).pad(0.4),
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
        <MapClickHandler onMapPick={onMapPick} />
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
        {showSoilLayer && soilLayer && (
          <GeoJSON
            key={`soil-layer-${language}`}
            data={soilLayer}
            style={soilPathStyle}
            onEachFeature={(feature, layer) => bindSoilTooltip(feature, layer, language, t)}
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
