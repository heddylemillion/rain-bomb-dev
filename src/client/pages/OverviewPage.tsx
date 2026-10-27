import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type L from 'leaflet';
import { MapCanvas, type UserPosition } from '../components/MapCanvas.js';
import {
  CommunityPicker,
  FirstVisitPrompt,
  LayerPanel,
  Legend,
  MapControls,
  RadarSlider,
  type LayerAvailability,
  type MapLayerId,
} from '../components/MapOverlays.js';
import { StatusCard } from '../components/StatusCard.js';
import { fetchCapabilities } from '../api/capabilities.js';
import { fetchCommunities, fetchCommunityWeather, fetchMockRiskResult } from '../api/weather.js';
import { OVERLAY_CAPABILITY_ID, type CapabilityId, type RiskResult } from '../../shared/contracts.js';
import { useTranslation } from '../i18n.js';
import { usePreferences } from '../lib/preferences.js';
import { readStorage, writeStorage } from '../lib/storage.js';

const SAVED_COMMUNITY_KEY = 'rain-burst-community';
const STALE_AFTER_MS = 15 * 60 * 1000;

function MapMessage({
  title,
  message,
  onRetry,
  kind = 'status',
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
  kind?: 'status' | 'alert';
}): React.ReactNode {
  const { t } = useTranslation();
  return (
    <div className="map-home map-home-message">
      <h1 className="sr-only">{t('mapRegionLabel')}</h1>
      <div className="map-message-card" role={kind} aria-busy={kind === 'status'}>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        {onRetry && (
          <button type="button" className="action-button" onClick={onRetry}>
            {t('retry')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Home: a full-screen map with floating, high-contrast controls on top. */
export function OverviewPage(): React.ReactNode {
  const { t } = useTranslation();
  const { fontStep } = usePreferences();
  const [searchParams] = useSearchParams();
  const sharedCommunityId = searchParams.get('c');

  // The remembered (or shared-link) community. Null => first visit.
  const [choice, setChoice] = useState<string | null>(() => sharedCommunityId ?? readStorage(SAVED_COMMUNITY_KEY));
  const [activeLayers, setActiveLayers] = useState<ReadonlySet<MapLayerId>>(() => new Set<MapLayerId>(['risk']));
  const [radarHours, setRadarHours] = useState(0);
  const [baseTilesFailed, setBaseTilesFailed] = useState(false);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateMessage, setLocateMessage] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const capabilityQuery = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => fetchCapabilities(signal),
  });
  const communitiesQuery = useQuery({
    queryKey: ['communities'],
    queryFn: ({ signal }) => fetchCommunities(signal),
  });

  const communities = useMemo(() => communitiesQuery.data ?? [], [communitiesQuery.data]);
  const capabilities = capabilityQuery.data?.capabilities;
  const getCapability = useCallback(
    (id: CapabilityId) => capabilities?.find((capability) => capability.id === id),
    [capabilities]
  );

  const riskAvailable = getCapability('risk-summary')?.available === true;
  const weatherAvailable =
    getCapability('hourly-forecast')?.available === true &&
    getCapability('daily-forecast')?.available === true &&
    (getCapability('current-conditions')?.available === true || getCapability('observations')?.available === true);

  const selectedId = communities.some((community) => community.id === choice) ? choice : null;
  const selectedCommunity = communities.find((community) => community.id === selectedId);

  const riskQueries = useQueries({
    queries: communities.map((community) => ({
      queryKey: ['risk', community.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchMockRiskResult(community.id, signal),
      enabled: riskAvailable,
    })),
  });
  // Weather details are only needed for the selected community (keeps API usage low).
  const weatherQuery = useQuery({
    queryKey: ['weather', selectedId],
    queryFn: ({ signal }) => fetchCommunityWeather(selectedId ?? '', signal),
    enabled: weatherAvailable && selectedId !== null,
  });

  const risks = useMemo(() => {
    const byId = new Map<string, RiskResult>();
    riskQueries.forEach((query) => {
      if (query.data) {
        byId.set(query.data.communityId, query.data);
      }
    });
    return byId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskQueries.map((query) => query.dataUpdatedAt).join(',')]);

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  const chooseCommunity = useCallback((id: string) => {
    writeStorage(SAVED_COMMUNITY_KEY, id);
    setChoice(id);
  }, []);

  const toggleLayer = useCallback((id: MapLayerId) => {
    setActiveLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocateMessage(t('myLocationUnsupported'));
      return;
    }
    setLocating(true);
    setLocateMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lon: position.coords.longitude };
        setUserPosition(next);
        setLocating(false);
        mapRef.current?.setView([next.lat, next.lon], Math.max(mapRef.current.getZoom(), 14));
      },
      () => {
        setLocating(false);
        setLocateMessage(t('myLocationDenied'));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }, [t]);

  if (communitiesQuery.isPending || capabilityQuery.isPending) {
    return <MapMessage title={t('mapLoadingOverlay')} />;
  }

  if ((communitiesQuery.isError && !communitiesQuery.data) || (capabilityQuery.isError && !capabilityQuery.data)) {
    return (
      <MapMessage
        kind="alert"
        title={communitiesQuery.isError ? t('communitiesFailed') : t('loadFailed')}
        message={t('loadFailedDescription')}
        onRetry={() => {
          void communitiesQuery.refetch();
          void capabilityQuery.refetch();
        }}
      />
    );
  }

  if (communities.length === 0) {
    return <MapMessage title={t('noCommunities')} />;
  }

  const mapCapability = getCapability('overview-map');
  if (!mapCapability?.available) {
    return <MapMessage title={t('mapUnavailable')} message={t('reasonError')} />;
  }

  const capabilityData = capabilityQuery.data;
  const isMock =
    capabilityData?.isMock === true ||
    [...risks.values()].some((risk) => risk.isMock) ||
    weatherQuery.data?.meta.isMock === true;
  const capabilitiesStale =
    capabilityData !== undefined && Date.now() - new Date(capabilityData.checkedAt).getTime() > STALE_AFTER_MS;

  const layerAvailability: LayerAvailability[] = (['risk', 'radar', 'lightning', 'storm'] as const).map((id) => {
    const capability = getCapability(id === 'risk' ? 'risk-summary' : OVERLAY_CAPABILITY_ID[id]);
    return { id, available: capability?.available === true, reason: capability?.reason ?? 'error' };
  });
  const isAvailable = (id: MapLayerId): boolean => layerAvailability.find((layer) => layer.id === id)?.available === true;
  const effectiveLayers = new Set([...activeLayers].filter(isAvailable));
  const overlays = new Set([...effectiveLayers].filter((id): id is Exclude<MapLayerId, 'risk'> => id !== 'risk'));
  const showRisk = effectiveLayers.has('risk');
  const radarOn = effectiveLayers.has('radar');

  const isDesktop = window.matchMedia('(min-width: 900px)').matches;
  const roomyPhone = window.innerHeight >= 760 && fontStep < 2;

  const riskIndex = communities.findIndex((community) => community.id === selectedId);
  const riskQuery = riskIndex >= 0 ? riskQueries[riskIndex] : undefined;

  return (
    <div className="map-home">
      <h1 className="sr-only">{t('mapRegionLabel')}</h1>

      <MapCanvas
        communities={communities}
        risks={risks}
        showRisk={showRisk}
        selectedCommunityId={selectedId}
        onSelectCommunity={chooseCommunity}
        overlays={overlays}
        radarHours={radarHours}
        userPosition={userPosition}
        onMapReady={handleMapReady}
        onBaseTilesFailed={setBaseTilesFailed}
      />

      <div className="map-ui">
        <CommunityPicker communities={communities} selectedId={selectedId} onChange={chooseCommunity} />

        <MapControls
          onZoomIn={() => mapRef.current?.zoomIn()}
          onZoomOut={() => mapRef.current?.zoomOut()}
          onLocate={locate}
          locating={locating}
          locateMessage={locateMessage}
        />

        <LayerPanel
          layers={layerAvailability}
          active={effectiveLayers}
          onToggle={toggleLayer}
          defaultOpen={isDesktop || roomyPhone}
        />

        <Legend defaultOpen={isDesktop} />

        <div className="map-bottom">
          {(baseTilesFailed || capabilitiesStale || !riskAvailable) && (
            <div className="map-notices">
              {baseTilesFailed && (
                <p className="map-notice" role="alert">
                  {t('mapTilesError')}
                </p>
              )}
              {capabilitiesStale && (
                <p className="map-notice" role="status">
                  {t('staleNotice')}
                </p>
              )}
              {!riskAvailable && (
                <p className="map-notice" role="status">
                  {t('riskLayerUnavailable')}
                </p>
              )}
            </div>
          )}

          {radarOn && <RadarSlider hours={radarHours} onChange={setRadarHours} />}

          {selectedCommunity &&
            (showRisk ? (
              <StatusCard
                community={selectedCommunity}
                risk={riskQuery?.data}
                riskLoading={riskQuery?.isPending === true && riskAvailable}
                riskError={riskQuery?.isError === true}
                retryRisk={() => {
                  void riskQuery?.refetch();
                }}
                weather={{
                  data: weatherQuery.data,
                  loading: weatherQuery.isPending && weatherAvailable,
                  error: weatherQuery.isError,
                  retry: () => {
                    void weatherQuery.refetch();
                  },
                }}
                isMock={isMock}
              />
            ) : (
              <section className="status-card status-card-hint" aria-label={t('layerRisk')}>
                <p className="status-message">{t('riskLayerOffHint')}</p>
                <button type="button" className="action-button" onClick={() => toggleLayer('risk')}>
                  {t('riskLayerTurnOn')}
                </button>
              </section>
            ))}
        </div>
      </div>

      {selectedId === null && <FirstVisitPrompt communities={communities} onChoose={chooseCommunity} />}
    </div>
  );
}
