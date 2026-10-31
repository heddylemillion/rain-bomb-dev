import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type L from 'leaflet';
import {
  DEFAULT_CONE_KM_PER_30MIN,
  DEFAULT_DEMO_POINT,
  type MockScenarioName,
} from '../../shared/mockWeatherScenario.js';
import {
  OVERLAY_CAPABILITY_ID,
  OVERLAY_LAYER_IDS,
  type CapabilityId,
  type Community,
  type GeocodingResult,
  type OverlayLayerId,
  type RiskResult,
  type SoilResponse,
} from '../../shared/contracts.js';
import { fetchCapabilities } from '../api/capabilities.js';
import { fetchSoil, fetchSoilLayer } from '../api/soil.js';
import {
  fetchAreaEnvironment,
  fetchCommunities,
  fetchPointRisk,
  reverseGeocode,
} from '../api/weather.js';
import { DisplayPopover } from '../components/DisplayPopover.js';
import { LocationSearch } from '../components/LocationSearch.js';
import { MapCanvas, type UserPosition } from '../components/MapCanvas.js';
import { MapControls, RadarSlider } from '../components/MapOverlays.js';
import { SideBar, type SideLayerId, type SideLayerItem } from '../components/SideBar.js';
import { StatusCard } from '../components/StatusCard.js';
import { useTranslation } from '../i18n.js';
import { writeStorage } from '../lib/storage.js';

const LOCATION_CHOICE_KEY = 'rain-burst-location-choice';
const THAILAND_BOUNDS = { minLat: 5.5, maxLat: 20.5, minLon: 97, maxLon: 106 };

const ignoreSearchOpenChange = (): void => undefined;

interface SelectedPlace {
  lat: number;
  lon: number;
  name: string;
  address?: string | undefined;
}

export interface RuntimeConfigData {
  demoMode: boolean;
  dataMode: 'live' | 'mock' | 'cache';
  stormConeKmPer30Min: number;
}

function isInThailand(lat: number, lon: number): boolean {
  return (
    lat >= THAILAND_BOUNDS.minLat &&
    lat <= THAILAND_BOUNDS.maxLat &&
    lon >= THAILAND_BOUNDS.minLon &&
    lon <= THAILAND_BOUNDS.maxLon
  );
}

function initialPlace(params: URLSearchParams, defaultName: string): SelectedPlace {
  const rawLat = params.get('lat');
  const rawLon = params.get('lon');
  if (rawLat !== null && rawLon !== null) {
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && isInThailand(lat, lon)) {
      return { lat, lon, name: params.get('name') || 'ตำแหน่งที่แชร์' };
    }
  }
  return {
    lat: DEFAULT_DEMO_POINT.lat,
    lon: DEFAULT_DEMO_POINT.lon,
    name: defaultName,
  };
}

function makePointCommunity(place: SelectedPlace): Community {
  return {
    id: `point-${place.lat.toFixed(4)}-${place.lon.toFixed(4)}`,
    name_th: place.name,
    name_en: place.name,
    lat: place.lat,
    lon: place.lon,
  };
}

function rememberPlace(place: GeocodingResult): void {
  let recent: GeocodingResult[] = [];
  try {
    const raw = window.localStorage.getItem('rain-burst-recent-places');
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      recent = parsed.filter(
        (item): item is GeocodingResult =>
          typeof item === 'object' &&
          item !== null &&
          typeof item['lat'] === 'number' &&
          typeof item['lon'] === 'number' &&
          typeof item['name'] === 'string' &&
          typeof item['district'] === 'string' &&
          typeof item['province'] === 'string' &&
          typeof item['displayName'] === 'string'
      );
    }
  } catch {
    recent = [];
  }
  writeStorage(
    'rain-burst-recent-places',
    JSON.stringify(
      [
        place,
        ...recent.filter(
          (item) =>
            item.displayName !== place.displayName &&
            (item.lat !== place.lat || item.lon !== place.lon)
        ),
      ].slice(0, 5)
    )
  );
}

export function OverviewPage({
  runtimeConfig,
}: {
  runtimeConfig?: RuntimeConfigData | undefined;
}): React.ReactNode {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [place, setPlace] = useState<SelectedPlace>(() =>
    initialPlace(searchParams, t('defaultDemoAreaName'))
  );
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(min-width: 768px)').matches : false
  );
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === 'visible');
  const [activeOverlays, setActiveOverlays] = useState<ReadonlySet<SideLayerId>>(
    () => new Set<SideLayerId>(['radar', 'lightning', 'storm', 'soil'])
  );
  const [radarHours, setRadarHours] = useState(0);
  const [timelineMinutes, setTimelineMinutes] = useState(0);
  const [radarOpacity, setRadarOpacity] = useState(0.7);
  const scenarioName: MockScenarioName =
    (['calm', 'moderate', 'burst'] as const).find(
      (name) => name === searchParams.get('scenario')
    ) ?? 'moderate';
  const scenarioDate = new Date().toISOString().slice(0, 10);
  const [baseTilesFailed, setBaseTilesFailed] = useState(false);
  const [baseTileRetry, setBaseTileRetry] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [focusSearchRequest, setFocusSearchRequest] = useState(0);
  const mapRef = useRef<L.Map | null>(null);
  const reverseRequestId = useRef(0);

  const focusSearch = useCallback((): void => {
    setFocusSearchRequest((value) => value + 1);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onMediaChange = (event: MediaQueryListEvent): void => setIsMobile(!event.matches);
    media.addEventListener('change', onMediaChange);
    return () => media.removeEventListener('change', onMediaChange);
  }, []);

  useEffect(() => {
    const updateVisibility = (): void => {
      setTabVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  // Keep place synchronized if URL lat/lon query parameters change externally
  useEffect(() => {
    const rawLat = searchParams.get('lat');
    const rawLon = searchParams.get('lon');
    if (rawLat !== null && rawLon !== null) {
      const lat = Number(rawLat);
      const lon = Number(rawLon);
      if (Number.isFinite(lat) && Number.isFinite(lon) && isInThailand(lat, lon)) {
        const nextName = searchParams.get('name') || place.name;
        if (
          Math.abs(lat - place.lat) > 1e-5 ||
          Math.abs(lon - place.lon) > 1e-5 ||
          nextName !== place.name
        ) {
          setPlace((prev) => ({ lat, lon, name: nextName, address: prev.address }));
        }
      }
    }
  }, [place.lat, place.lon, place.name, searchParams]);

  const capabilityQuery = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => fetchCapabilities(signal),
  });
  const dataMode = runtimeConfig?.dataMode ?? (capabilityQuery.data?.isMock ? 'mock' : 'live');
  const mockMode = dataMode === 'mock' || (capabilityQuery.data?.isMock ?? false);

  const communitiesQuery = useQuery({
    queryKey: ['communities'],
    queryFn: ({ signal }) => fetchCommunities(signal),
  });

  // Area risk is always evaluated at "now" (offsetMin = 0) so timeline scrubbing does not misreport current risk.
  const pointRiskQuery = useQuery({
    queryKey: ['point-risk', place.lat.toFixed(4), place.lon.toFixed(4), scenarioName, scenarioDate],
    queryFn: ({ signal }) =>
      fetchPointRisk(place.lat, place.lon, signal, {
        scenario: scenarioName,
        date: scenarioDate,
        offsetMin: 0,
      }),
    retry: 1,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const selectedCommunity = useMemo(() => makePointCommunity(place), [place]);

  const environmentQuery = useQuery({
    queryKey: ['area-environment', place.lat.toFixed(5), place.lon.toFixed(5)],
    queryFn: ({ signal }) =>
      fetchAreaEnvironment(place.lat, place.lon, selectedCommunity.id, signal),
    enabled: tabVisible,
    staleTime: 45 * 60 * 1000,
    refetchInterval: () => (tabVisible ? 45 * 60 * 1000 : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const soilQuery = useQuery<SoilResponse>({
    queryKey: ['soil', place.lat, place.lon],
    queryFn: ({ signal }) => fetchSoil(place.lat, place.lon, signal),
    enabled: activeOverlays.has('soil'),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  const soilLayerQuery = useQuery({
    queryKey: ['soil-layer'],
    queryFn: ({ signal }) => fetchSoilLayer(signal),
    enabled: activeOverlays.has('soil'),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const capabilities = capabilityQuery.data?.capabilities;
  const getCapability = useCallback(
    (id: CapabilityId) => capabilities?.find((capability) => capability.id === id),
    [capabilities]
  );

  const sideLayers: SideLayerItem[] = [
    ...OVERLAY_LAYER_IDS.map((id) => {
      const capability = getCapability(OVERLAY_CAPABILITY_ID[id]);
      const available = capability ? capability.available : mockMode;
      const label =
        id === 'radar'
          ? t('layerRadar')
          : id === 'lightning'
            ? t('layerLightning')
            : t('layerStormTrack');
      const description =
        id === 'radar'
          ? t('topicRadarDesc')
          : id === 'lightning'
            ? t('topicLightningDesc')
            : t('topicStormDesc');
      const state: SideLayerItem['state'] = !available
        ? 'unavailable'
        : activeOverlays.has(id)
          ? 'on'
          : 'off';
      return {
        id,
        label,
        description,
        state,
        mock: mockMode || capability?.mock === true,
      };
    }),
    {
      id: 'soil',
      label: t('layerSoil'),
      description: t('topicSoilDesc'),
      state: activeOverlays.has('soil') ? ('on' as const) : ('off' as const),
    },
  ];

  const effectiveOverlays = useMemo(() => {
    const availableSet = new Set(
      sideLayers.filter((item) => item.state !== 'unavailable').map((item) => item.id)
    );
    return new Set(
      [...activeOverlays].filter(
        (id): id is OverlayLayerId => id !== 'soil' && availableSet.has(id)
      )
    );
  }, [activeOverlays, sideLayers]);

  const risks = useMemo(() => {
    const map = new Map<string, RiskResult>();
    const risk = pointRiskQuery.data;
    if (risk && (risk.level === 'HIGH' || risk.level === 'MEDIUM' || risk.level === 'LOW')) {
      map.set(selectedCommunity.id, risk);
    }
    return map;
  }, [pointRiskQuery.data, selectedCommunity.id]);

  const choosePoint = useCallback(
    (lat: number, lon: number, name: string, address?: string): void => {
      if (!isInThailand(lat, lon)) {
        setLocationMessage(t('pointOutsideThailand'));
        return;
      }
      setLocationMessage('');
      const next: SelectedPlace = { lat, lon, name, address };
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
    },
    [setSearchParams, t]
  );

  const chooseGeocodedPlace = useCallback(
    (result: GeocodingResult): void => {
      rememberPlace(result);
      choosePoint(result.lat, result.lon, result.displayName || result.name, result.address);
    },
    [choosePoint]
  );

  const reverseAndChoose = useCallback(
    async (lat: number, lon: number, fallback: string): Promise<void> => {
      if (!isInThailand(lat, lon)) {
        setLocationMessage(t('pointOutsideThailand'));
        return;
      }
      const requestId = ++reverseRequestId.current;
      choosePoint(lat, lon, fallback);
      try {
        const result = await reverseGeocode(lat, lon, new AbortController().signal);
        if (result && requestId === reverseRequestId.current) {
          const friendlyName = result.displayName || result.name;
          const resolved: SelectedPlace = {
            lat,
            lon,
            name: friendlyName,
            address: result.address,
          };
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
    },
    [choosePoint, setSearchParams, t]
  );

  const locate = useCallback((): void => {
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setLocationMessage(t('locationInsecure'));
      focusSearch();
      return;
    }
    if (!('geolocation' in navigator)) {
      setLocationMessage(t('myLocationUnsupported'));
      focusSearch();
      return;
    }
    setLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        writeStorage(LOCATION_CHOICE_KEY, 'granted');
        void reverseAndChoose(position.coords.latitude, position.coords.longitude, t('myLocation'));
      },
      (error) => {
        setLocating(false);
        if (error.code === 1) {
          writeStorage(LOCATION_CHOICE_KEY, 'denied');
          setLocationMessage(t('locationDeniedHelp'));
          focusSearch();
        } else {
          setLocationMessage(error.code === 3 ? t('locationTimeout') : t('locationFailed'));
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  }, [focusSearch, reverseAndChoose, t]);

  const toggleOverlay = useCallback((id: SideLayerId) => {
    setActiveOverlays((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleMapPick = useCallback(
    (point: UserPosition): void => {
      void reverseAndChoose(point.lat, point.lon, t('selectedPoint'));
    },
    [reverseAndChoose, t]
  );

  const menuOpen = location.pathname !== '/';
  const handleToggleMenu = useCallback((): void => {
    if (menuOpen) {
      navigate({ pathname: '/', search: location.search });
    } else {
      navigate({ pathname: '/more', search: location.search });
    }
  }, [location.search, menuOpen, navigate]);

  const dataModeLabel =
    dataMode === 'mock' || runtimeConfig?.demoMode
      ? t('dataModeMock')
      : dataMode === 'cache'
        ? t('dataModeCache')
        : t('dataModeLive');

  const isLiveUsingXweather =
    dataMode === 'live' &&
    Boolean(capabilities?.some((cap) => cap.available && cap.reason === 'ok' && !cap.mock));

  const statusCardElement = (
    <StatusCard
      community={selectedCommunity}
      address={place.address}
      risk={pointRiskQuery.data}
      riskLoading={pointRiskQuery.isPending}
      riskError={pointRiskQuery.isError}
      retryRisk={() => {
        void pointRiskQuery.refetch();
      }}
      pointNotice={pointRiskQuery.data?.noticeTh ?? null}
      environment={environmentQuery.data}
      environmentLoading={environmentQuery.isPending}
      environmentError={environmentQuery.isError}
      retryEnvironment={() => {
        void environmentQuery.refetch();
      }}
      soilEnabled={activeOverlays.has('soil')}
      soil={soilQuery.data}
      soilLoading={soilQuery.isPending}
      soilError={soilQuery.isError}
      retrySoil={() => {
        void soilQuery.refetch();
      }}
      soilLayerLoading={soilLayerQuery.isPending}
      soilLayerError={soilLayerQuery.isError}
      retrySoilLayer={() => {
        void soilLayerQuery.refetch();
      }}
    />
  );

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden select-none sm:select-auto bg-slate-950">
      <h1 className="sr-only">{t('mapRegionLabel')}</h1>

      <MapCanvas
        communities={[selectedCommunity]}
        risks={risks}
        showRisk
        selectedCommunityId={selectedCommunity.id}
        onSelectCommunity={() => undefined}
        onMapPick={handleMapPick}
        overlays={effectiveOverlays}
        soilLayer={soilLayerQuery.data ?? null}
        showSoilLayer={activeOverlays.has('soil')}
        radarHours={radarHours}
        mockMode={mockMode}
        scenarioName={scenarioName}
        scenarioDate={scenarioDate}
        simulationOffsetMin={timelineMinutes}
        radarOpacity={radarOpacity}
        stormConeKmPer30Min={runtimeConfig?.stormConeKmPer30Min ?? DEFAULT_CONE_KM_PER_30MIN}
        userPosition={place}
        onMapReady={(map) => {
          mapRef.current = map;
        }}
        onBaseTilesFailed={setBaseTilesFailed}
        baseTileRetry={baseTileRetry}
      />

      {/* Top floating controls: Search + Brand top-left, DataMode pill top-center, Aa popover top-right */}
      <div className="absolute top-2 md:top-3 left-2 md:left-3 right-2 md:right-3 z-30 pointer-events-none flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5 md:gap-2 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex items-center min-w-0 flex-1 md:flex-initial lg:justify-self-start">
            <LocationSearch
              communities={communitiesQuery.data ?? []}
              focusSearchRequest={focusSearchRequest}
              locating={locating}
              onOpenChange={ignoreSearchOpenChange}
              onLocate={locate}
              onSelect={chooseGeocodedPlace}
            />
          </div>

          {!isMobile && (
            <div
              role="status"
              aria-live="polite"
              data-testid="data-mode-pill"
              className="glass-panel min-h-[36px] px-3.5 py-1 rounded-full inline-flex items-center gap-2 text-xs font-semibold text-slate-50 pointer-events-auto lg:justify-self-center shrink-0"
            >
              <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" aria-hidden="true" />
              <span>{dataModeLabel}</span>
            </div>
          )}

          <div className="shrink-0 lg:justify-self-end flex justify-end">
            <DisplayPopover />
          </div>
        </div>

        {isMobile && (
          <div className="flex justify-center">
            <div
              role="status"
              aria-live="polite"
              data-testid="data-mode-pill"
              className="glass-panel px-3 py-0.5 rounded-full inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-slate-50 pointer-events-auto"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" aria-hidden="true" />
              <span>{dataModeLabel}</span>
            </div>
          </div>
        )}
      </div>

      {/* Left floating rail + Desktop Area Status Card */}
      <div className="absolute left-2 md:left-3 top-[92px] md:top-[68px] z-20 pointer-events-none flex items-start gap-3">
        <SideBar
          layers={sideLayers}
          onToggleLayer={toggleOverlay}
          mockMode={mockMode}
          scenario={scenarioName}
          onScenarioChange={(name) =>
            setSearchParams((current) => {
              const next = new URLSearchParams(current);
              next.set('scenario', name);
              return next;
            })
          }
          radarOpacity={radarOpacity}
          onRadarOpacityChange={setRadarOpacity}
          menuOpen={menuOpen}
          onOpenMenu={handleToggleMenu}
        />
        {!isMobile && statusCardElement}
      </div>

      {/* Right-middle Zoom +/- & Locate group */}
      <div className="absolute right-2 md:right-3 top-[204px] md:top-1/2 md:-translate-y-1/2 z-20 pointer-events-none">
        <MapControls
          onZoomIn={() => mapRef.current?.zoomIn()}
          onZoomOut={() => mapRef.current?.zoomOut()}
          onLocate={locate}
          locating={locating}
        />
      </div>

      {/* Bottom stack: notices, mobile status bottom sheet, centered glass timeline, disclaimer & attribution */}
      <div className="absolute bottom-1.5 left-2 right-2 md:left-3 md:right-3 z-20 pointer-events-none flex flex-col gap-1.5">
        <div className="flex flex-col items-center gap-1.5">
          {(baseTilesFailed ||
            capabilityQuery.isError ||
            pointRiskQuery.isError ||
            Boolean(locationMessage)) && (
            <div className="flex flex-col items-center gap-1 max-w-[min(560px,calc(100vw-16px))] pointer-events-auto">
              {baseTilesFailed && (
                <p
                  className="glass-panel rounded-xl px-3 py-1.5 text-xs text-slate-50 flex items-center gap-2"
                  role="alert"
                >
                  <span>{t('mapTilesError')}</span>
                  <button
                    type="button"
                    className="glass-control-btn min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-sky-300"
                    onClick={() => {
                      setBaseTilesFailed(false);
                      setBaseTileRetry((retry) => retry + 1);
                    }}
                  >
                    {t('mapTilesRetry')}
                  </button>
                </p>
              )}
              {capabilityQuery.isError && (
                <p className="glass-panel rounded-xl px-3 py-1 text-xs text-slate-100" role="status">
                  {t('capabilityLoadWarning')}
                </p>
              )}
              {locationMessage && (
                <p
                  className="glass-panel rounded-xl px-3 py-1.5 text-xs text-slate-100 flex items-center gap-2"
                  role="status"
                >
                  <span>{locationMessage}</span>
                  {(locationMessage === t('locationTimeout') ||
                    locationMessage === t('locationFailed')) && (
                    <button
                      type="button"
                      className="glass-control-btn min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-sky-300"
                      onClick={locate}
                    >
                      {t('locationRetry')}
                    </button>
                  )}
                </p>
              )}
              {pointRiskQuery.isError && (
                <p className="glass-panel rounded-xl px-3 py-1 text-xs text-slate-100" role="alert">
                  {t('pointRiskFailed')}
                </p>
              )}
            </div>
          )}

          {isMobile && (
            <div className="w-[min(640px,calc(100vw-16px))] flex justify-center">
              {statusCardElement}
            </div>
          )}

          <RadarSlider
            mockMode={mockMode}
            minutes={timelineMinutes}
            onMinutesChange={setTimelineMinutes}
            onHoursChange={setRadarHours}
          />
        </div>

        {/* Bottom-left Thai disclaimer & Bottom-right active-source attribution watermark */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1 md:gap-2">
          <p
            data-testid="map-disclaimer"
            className="glass-watermark pointer-events-auto self-start rounded-lg px-2 py-0.5 text-[10px] sm:text-[10.5px] leading-tight text-slate-100"
          >
            {t('decisionSupportShort')}
          </p>

          <p
            data-testid="map-attribution"
            className="glass-watermark pointer-events-auto self-end md:self-auto rounded-lg px-2 py-0.5 text-[10px] sm:text-[10.5px] leading-tight text-slate-100 text-right"
          >
            ©{' '}
            <a
              className="underline hover:text-sky-300"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>
            {' · '}
            <a
              className="underline hover:text-sky-300"
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open-Meteo
            </a>
            {' · '}
            <a
              className="underline hover:text-sky-300"
              href="https://www.dwd.de/"
              target="_blank"
              rel="noopener noreferrer"
            >
              DWD
            </a>
            {' · '}
            <a
              className="underline hover:text-sky-300"
              href="https://www.copernicus.eu/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Copernicus
            </a>
            {isLiveUsingXweather && (
              <>
                {' · '}
                <a
                  className="underline hover:text-sky-300"
                  href="https://www.xweather.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Xweather
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
