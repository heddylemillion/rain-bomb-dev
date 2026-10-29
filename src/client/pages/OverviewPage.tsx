import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type L from 'leaflet';
import type { MockScenarioName } from '../../shared/mockWeatherScenario.js';
import type {
  Community,
  GeocodingResult,
  OverlayLayerId,
  RiskResult,
} from '../../shared/contracts.js';
import { OVERLAY_CAPABILITY_ID, type CapabilityId } from '../../shared/contracts.js';
import { fetchCapabilities } from '../api/capabilities.js';
import {
  fetchAreaEnvironment,
  fetchCommunities,
  fetchPointRisk,
  reverseGeocode,
} from '../api/weather.js';
import { LocationSearch } from '../components/LocationSearch.js';
import { MapCanvas, type UserPosition } from '../components/MapCanvas.js';
import {
  LayerPanel,
  Legend,
  RadarSlider,
  type LayerAvailability,
  type MapLayerId,
} from '../components/MapOverlays.js';
import { StatusCard } from '../components/StatusCard.js';
import { useTranslation } from '../i18n.js';
import { readStorage, writeStorage } from '../lib/storage.js';

const LOCATION_CHOICE_KEY = 'rain-burst-location-choice';
const THAILAND_BOUNDS = { minLat: 5.5, maxLat: 20.5, minLon: 97, maxLon: 106 };

interface SelectedPlace {
  lat: number;
  lon: number;
  name: string;
}

function isInThailand(lat: number, lon: number): boolean {
  return lat >= THAILAND_BOUNDS.minLat && lat <= THAILAND_BOUNDS.maxLat &&
    lon >= THAILAND_BOUNDS.minLon && lon <= THAILAND_BOUNDS.maxLon;
}

function initialPlace(params: URLSearchParams): SelectedPlace | null {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isInThailand(lat, lon)) return null;
  return { lat, lon, name: params.get('name') || 'ตำแหน่งที่แชร์' };
}

function makePointCommunity(place: SelectedPlace): Community {
  return {
    id: `point-${place.lat.toFixed(2)}-${place.lon.toFixed(2)}`,
    name_th: place.name,
    name_en: place.name,
    lat: place.lat,
    lon: place.lon,
  };
}

function rememberPlace(place: GeocodingResult): void {
  const raw = readStorage('rain-burst-recent-places');
  let recent: GeocodingResult[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      recent = parsed.filter((item): item is GeocodingResult =>
        typeof item === 'object' && item !== null &&
        typeof item['lat'] === 'number' && typeof item['lon'] === 'number' &&
        typeof item['name'] === 'string' && typeof item['district'] === 'string' &&
        typeof item['province'] === 'string' &&
        typeof item['displayName'] === 'string'
      );
    }
  } catch {
    recent = [];
  }
  writeStorage(
    'rain-burst-recent-places',
    JSON.stringify([
      place,
      ...recent.filter(
        (item) => item.displayName !== place.displayName &&
          (item.lat !== place.lat || item.lon !== place.lon)
      ),
    ].slice(0, 5))
  );
}

export function OverviewPage(): React.ReactNode {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [place, setPlace] = useState<SelectedPlace | null>(() => initialPlace(searchParams));
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === 'visible');
  const [activeLayers, setActiveLayers] = useState<ReadonlySet<MapLayerId>>(() => new Set<MapLayerId>(['risk']));
  const [radarHours, setRadarHours] = useState(0);
  const [timelineMinutes, setTimelineMinutes] = useState(0);
  const [radarOpacity, setRadarOpacity] = useState(0.7);
  const scenarioName: MockScenarioName = (['calm', 'moderate', 'burst'] as const).find(
    (name) => name === searchParams.get('scenario')
  ) ?? 'moderate';
  const scenarioDate = new Date().toISOString().slice(0, 10);
  const [baseTilesFailed, setBaseTilesFailed] = useState(false);
  const [baseTileRetry, setBaseTileRetry] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [consentChoice, setConsentChoice] = useState(() => readStorage(LOCATION_CHOICE_KEY) ?? '');
  const [focusSearchRequest, setFocusSearchRequest] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const initialLocationAttempt = useRef(false);

  useEffect(() => {
    const updateVisibility = (): void => {
      setTabVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  const capabilityQuery = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => fetchCapabilities(signal),
  });
  const mockMode = capabilityQuery.data?.isMock ?? false;
  const communitiesQuery = useQuery({
    queryKey: ['communities'],
    queryFn: ({ signal }) => fetchCommunities(signal),
  });
  const pointRiskQuery = useQuery({
    queryKey: ['point-risk', place?.lat.toFixed(2), place?.lon.toFixed(2), scenarioName, scenarioDate, timelineMinutes],
    queryFn: ({ signal }) => fetchPointRisk(place?.lat ?? 0, place?.lon ?? 0, signal, {
      scenario: scenarioName,
      date: scenarioDate,
      offsetMin: timelineMinutes,
    }),
    enabled: place !== null,
    retry: 1,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });
  const selectedCommunity = useMemo(
    () => place ? makePointCommunity(place) : null,
    [place]
  );
  const environmentQuery = useQuery({
    queryKey: ['area-environment', place?.lat.toFixed(5), place?.lon.toFixed(5)],
    queryFn: ({ signal }) =>
      fetchAreaEnvironment(place?.lat ?? 0, place?.lon ?? 0, selectedCommunity?.id ?? '', signal),
    enabled: place !== null && selectedCommunity !== null &&
      activeLayers.has('risk') && tabVisible,
    staleTime: 45 * 60 * 1000,
    refetchInterval: () => tabVisible ? 45 * 60 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const capabilities = capabilityQuery.data?.capabilities;
  const getCapability = useCallback(
    (id: CapabilityId) => capabilities?.find((capability) => capability.id === id),
    [capabilities]
  );
  const layerAvailability: LayerAvailability[] = (['risk', 'radar', 'lightning', 'storm'] as const).map((id) => {
    const capability = getCapability(id === 'risk' ? 'risk-summary' : OVERLAY_CAPABILITY_ID[id as OverlayLayerId]);
    return {
      id,
      available: id === 'risk' || capability?.available === true,
      reason: capability?.reason ?? 'error',
      updatedAt: capability?.checkedAt ?? null,
      mock: capability?.mock === true,
    };
  });
  useEffect(() => {
    if (mockMode) {
      setActiveLayers((current) => new Set([...current, 'radar', 'lightning', 'storm']));
    }
  }, [mockMode]);
  const availableLayers = new Set(layerAvailability.filter((item) => item.available).map((item) => item.id));
  const effectiveLayers = new Set([...activeLayers].filter((id) => availableLayers.has(id)));
  const overlays = new Set(
    [...effectiveLayers].filter((id): id is OverlayLayerId => id !== 'risk')
  );
  const risks = useMemo(() => {
    const map = new Map<string, RiskResult>();
    const risk = pointRiskQuery.data;
    if (selectedCommunity && risk && (
      risk.level === 'HIGH' || risk.level === 'MEDIUM' || risk.level === 'LOW'
    )) {
      map.set(selectedCommunity.id, risk);
    }
    return map;
  }, [pointRiskQuery.data, selectedCommunity]);

  const choosePoint = useCallback((lat: number, lon: number, name: string): void => {
    if (!isInThailand(lat, lon)) {
      setLocationMessage(t('pointOutsideThailand'));
      return;
    }
    setLocationMessage('');
    const next = { lat, lon, name };
    rememberPlace({
      lat,
      lon,
      name,
      district: '',
      province: '',
      displayName: name,
    });
    setPlace(next);
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.set('lat', String(lat));
      nextParams.set('lon', String(lon));
      nextParams.set('name', name);
      return nextParams;
    });
  }, [setSearchParams, t]);

  const chooseGeocodedPlace = useCallback((result: GeocodingResult): void => {
    rememberPlace(result);
    choosePoint(result.lat, result.lon, result.displayName || result.name);
  }, [choosePoint]);

  const reverseAndChoose = useCallback(async (lat: number, lon: number, fallback: string): Promise<void> => {
    if (!isInThailand(lat, lon)) {
      setLocationMessage(t('pointOutsideThailand'));
      return;
    }
    choosePoint(lat, lon, fallback);
    try {
      const result = await reverseGeocode(lat, lon, new AbortController().signal);
      if (result) {
        const friendlyName = result.displayName || result.name;
        const resolved = { lat, lon, name: friendlyName };
        setPlace(resolved);
        setSearchParams((current) => {
          const nextParams = new URLSearchParams(current);
          nextParams.set('lat', String(lat));
          nextParams.set('lon', String(lon));
          nextParams.set('name', friendlyName);
          return nextParams;
        });
        rememberPlace(result);
      }
    } catch {
      setLocationMessage(t('reverseGeocodeFailed'));
    }
  }, [choosePoint, setSearchParams, t]);

  const locate = useCallback((): void => {
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setLocationMessage(t('locationInsecure'));
      setFocusSearchRequest((value) => value + 1);
      return;
    }
    if (!('geolocation' in navigator)) {
      setLocationMessage(t('myLocationUnsupported'));
      setFocusSearchRequest((value) => value + 1);
      return;
    }
    setLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setConsentChoice('granted');
        writeStorage(LOCATION_CHOICE_KEY, 'granted');
        void reverseAndChoose(position.coords.latitude, position.coords.longitude, t('myLocation'));
      },
      (error) => {
        setLocating(false);
        if (error.code === 1) {
          setConsentChoice('denied');
          writeStorage(LOCATION_CHOICE_KEY, 'denied');
          setLocationMessage(t('locationDeniedHelp'));
          setFocusSearchRequest((value) => value + 1);
        } else {
          setLocationMessage(error.code === 3 ? t('locationTimeout') : t('locationFailed'));
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  }, [reverseAndChoose, t]);

  useEffect(() => {
    if (initialLocationAttempt.current || place || consentChoice === 'denied' || consentChoice === 'chose-search') return;
    initialLocationAttempt.current = true;
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setLocationMessage(t('locationInsecure'));
      return;
    }
    let active = true;
    let timer: number | undefined;
    const attempt = (permissionState?: PermissionState): void => {
      if (!active) return;
      if (permissionState === 'denied') {
        setConsentChoice('denied');
        writeStorage(LOCATION_CHOICE_KEY, 'denied');
        setLocationMessage(t('locationDeniedHelp'));
        setFocusSearchRequest((value) => value + 1);
      } else if (permissionState === 'granted' || (!consentChoice && permissionState === 'prompt')) {
        timer = window.setTimeout(locate, permissionState === 'granted' ? 0 : 700);
      }
    };
    if ('permissions' in navigator) {
      void navigator.permissions.query({ name: 'geolocation' }).then(({ state }) => attempt(state)).catch(() => {
        if (!consentChoice) attempt('prompt');
      });
    } else if (!consentChoice) {
      attempt('prompt');
    }
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [consentChoice, locate, place, t]);

  useEffect(() => {
    if (consentChoice === 'denied') {
      setLocationMessage(t('locationDeniedHelp'));
      setFocusSearchRequest((value) => value + 1);
    }
  }, [consentChoice, t]);

  const toggleLayer = useCallback((id: MapLayerId) => {
    setActiveLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleMapPick = useCallback((point: UserPosition): void => {
    void reverseAndChoose(point.lat, point.lon, t('selectedPoint'));
  }, [reverseAndChoose, t]);

  const chooseSearchInstead = (): void => {
    setConsentChoice('chose-search');
    writeStorage(LOCATION_CHOICE_KEY, 'chose-search');
    setLocationMessage('');
    setFocusSearchRequest((value) => value + 1);
  };

  const showRisk = effectiveLayers.has('risk');
  const locationPending = place !== null && pointRiskQuery.isPending;
  const statusRisk = pointRiskQuery.data;

  return (
    <div className={`map-home${overlays.has('radar') ? ' has-radar' : ''}`}>
      <h1 className="sr-only">{t('mapRegionLabel')}</h1>
      <MapCanvas
        communities={selectedCommunity ? [selectedCommunity] : []}
        risks={risks}
        showRisk={showRisk}
        selectedCommunityId={selectedCommunity?.id ?? null}
        onSelectCommunity={() => undefined}
        onMapPick={handleMapPick}
        overlays={overlays}
        radarHours={radarHours}
        mockMode={mockMode}
        scenarioName={scenarioName}
        scenarioDate={scenarioDate}
        simulationOffsetMin={timelineMinutes}
        radarOpacity={radarOpacity}
        userPosition={place}
        onMapReady={(map) => { mapRef.current = map; }}
        onBaseTilesFailed={setBaseTilesFailed}
        baseTileRetry={baseTileRetry}
      />
      <div className={`map-ui${searchOpen ? ' is-searching' : ''}`}>
        <LocationSearch
          communities={communitiesQuery.data ?? []}
          focusSearchRequest={focusSearchRequest}
          locating={locating}
          onOpenChange={setSearchOpen}
          onLocate={locate}
          onSelect={chooseGeocodedPlace}
        />
        <div className="map-controls">
          <div className="map-controls-row">
            <button type="button" className="map-button" aria-label={t('zoomInAria')} title={t('zoomInAria')} onClick={() => mapRef.current?.zoomIn()}>+</button>
            <button type="button" className="map-button" aria-label={t('zoomOutAria')} title={t('zoomOutAria')} onClick={() => mapRef.current?.zoomOut()}>−</button>
            <button type="button" className="map-button" aria-label={t('myLocation')} title={t('myLocation')} onClick={locate} disabled={locating}>◎</button>
          </div>
        </div>
        <LayerPanel
          layers={layerAvailability}
          active={effectiveLayers}
          onToggle={toggleLayer}
          defaultOpen={window.matchMedia('(min-width: 900px)').matches}
          mockMode={mockMode}
          scenario={scenarioName}
          mockOverlays={overlays}
          onScenarioChange={(name) => setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set('scenario', name);
            return next;
          })}
        />
        <Legend defaultOpen={window.matchMedia('(min-width: 900px)').matches} />
        <div className="map-bottom">
          {(baseTilesFailed || capabilityQuery.isError || pointRiskQuery.isError || locationMessage) && (
            <div className="map-notices">
              {baseTilesFailed && (
                <p className="map-notice" role="alert">
                  {t('mapTilesError')}{' '}
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => {
                      setBaseTilesFailed(false);
                      setBaseTileRetry((retry) => retry + 1);
                    }}
                  >
                    {t('mapTilesRetry')}
                  </button>
                </p>
              )}
              {capabilityQuery.isError && <p className="map-notice" role="status">{t('capabilityLoadWarning')}</p>}
              {locationMessage && (
                <p className="map-notice" role="status">
                  {locationMessage}
                  {(locationMessage === t('locationTimeout') || locationMessage === t('locationFailed')) && (
                    <button type="button" className="inline-button" onClick={locate}>{t('locationRetry')}</button>
                  )}
                </p>
              )}
              {pointRiskQuery.isError && <p className="map-notice" role="alert">{t('pointRiskFailed')}</p>}
            </div>
          )}
          {overlays.has('radar') && (
            <RadarSlider
              hours={radarHours}
              onChange={setRadarHours}
              mockMode={mockMode}
              minutes={timelineMinutes}
              onMinutesChange={setTimelineMinutes}
              opacity={radarOpacity}
              onOpacityChange={setRadarOpacity}
            />
          )}
          {!consentChoice && !place && (
            <section className="location-consent-banner" aria-label={t('locationConsent')}>
              <p>{t('locationConsent')}</p>
              <div>
                <button type="button" className="action-button" onClick={locate}>{t('locationAllow')}</button>
                <button type="button" className="secondary-button" onClick={chooseSearchInstead}>{t('searchInstead')}</button>
              </div>
              <small>{t('locationPrivacy')}</small>
            </section>
          )}
          {selectedCommunity && showRisk && (
            <StatusCard
              community={selectedCommunity}
              risk={statusRisk}
              riskLoading={locationPending}
              riskError={pointRiskQuery.isError}
              retryRisk={() => { void pointRiskQuery.refetch(); }}
              pointNotice={statusRisk?.noticeTh ?? null}
              environment={environmentQuery.data}
              environmentLoading={environmentQuery.isPending}
              environmentError={environmentQuery.isError}
              retryEnvironment={() => { void environmentQuery.refetch(); }}
            />
          )}
          {!showRisk && (
            <section className="status-card status-card-hint" aria-label={t('layerRisk')}>
              <p className="status-message">{t('riskLayerOffHint')}</p>
              <button type="button" className="action-button" onClick={() => toggleLayer('risk')}>{t('riskLayerTurnOn')}</button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
