import { useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Community } from '../../shared/contracts.js';
import type { RiskResult } from '../../shared/contracts.js';
import { useTranslation } from '../i18n.js';

interface CommunityMapProps {
  communities: Community[];
  risks: readonly RiskResult[];
  selectedCommunityId: string;
  onSelectCommunity: (communityId: string) => void;
}

const markerColors: Record<RiskResult['level'], string> = {
  HIGH: '#b42318',
  MEDIUM: '#a15c00',
  LOW: '#18794e',
};

const markerSymbols: Record<RiskResult['level'], string> = {
  HIGH: '▲',
  MEDIUM: '◆',
  LOW: '●',
};

const tooltipDirections: Array<'top' | 'right' | 'bottom' | 'left'> = [
  'top',
  'right',
  'bottom',
  'left',
];

function makeMarkerIcon(level: RiskResult['level']): L.DivIcon {
  return L.divIcon({
    className: 'risk-marker-wrapper',
    html: `<span class="risk-marker risk-marker-${level.toLowerCase()}" style="--marker-color:${markerColors[level]}" aria-hidden="true">${markerSymbols[level]}</span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

export function CommunityMap({
  communities,
  risks,
  selectedCommunityId,
  onSelectCommunity,
}: CommunityMapProps): React.ReactNode {
  const { t } = useTranslation();
  const [tilesFailed, setTilesFailed] = useState(false);
  const riskByCommunity = useMemo(
    () => new Map(risks.map((risk) => [risk.communityId, risk])),
    [risks]
  );
  const bounds = useMemo(
    () =>
      L.latLngBounds(
        communities.map((community) => L.latLng(community.lat, community.lon))
      ).pad(0.35),
    [communities]
  );
  const labels: Record<RiskResult['level'], string> = {
    HIGH: t('riskHigh'),
    MEDIUM: t('riskMedium'),
    LOW: t('riskLow'),
  };

  return (
    <div className="community-map-frame">
      <MapContainer
        className="community-map"
        bounds={bounds}
        zoomControl
        scrollWheelZoom={false}
        aria-label={t('communityMap')}
      >
        <TileLayer
          url="/api/map/tiles/{z}/{x}/{y}.png"
          attribution={t('mapAttribution')}
          maxZoom={19}
          eventHandlers={{
            tileerror: () => setTilesFailed(true),
            tileload: () => setTilesFailed(false),
          }}
        />
        {communities.map((community, index) => {
          const risk = riskByCommunity.get(community.id);
          if (!risk) {
            return null;
          }
          const label = `${labels[risk.level]} · ${community.name_th}`;
          return (
            <Marker
              key={community.id}
              position={[community.lat, community.lon]}
              icon={makeMarkerIcon(risk.level)}
              title={label}
              alt={label}
              opacity={selectedCommunityId === community.id ? 1 : 0.82}
              zIndexOffset={selectedCommunityId === community.id ? 1000 : 0}
              eventHandlers={{
                click: () => onSelectCommunity(community.id),
                keypress: () => onSelectCommunity(community.id),
              }}
            >
              <Tooltip
                permanent
                direction={tooltipDirections[index % tooltipDirections.length]}
                offset={[0, 0]}
                className={`risk-map-tooltip risk-map-tooltip-${risk.level.toLowerCase()}`}
              >
                <span aria-label={label}>
                  <span aria-hidden="true">{markerSymbols[risk.level]}</span> {labels[risk.level]}
                </span>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      {tilesFailed && (
        <p className="map-tile-error" role="alert">{t('mapTilesError')}</p>
      )}
    </div>
  );
}
