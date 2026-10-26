import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { CommunityMap } from '../components/CommunityMap.js';
import { fetchCommunities, fetchCommunityWeather, fetchMockRiskResult } from '../api/weather.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import type { Capability, CapabilityId, Community, RiskResult, WeatherBundle } from '../../shared/contracts.js';
import { fetchCapabilities } from '../api/capabilities.js';

function formatTime(value: string, language: 'th' | 'en'): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(timestamp);
}

function unavailableTextKey(reason: Capability['reason']): MessageKey {
  const keys: Record<Capability['reason'], MessageKey> = {
    ok: 'reasonOk',
    no_plan: 'reasonNoPlan',
    no_coverage: 'reasonNoCoverage',
    error: 'reasonError',
  };
  return keys[reason];
}

function StatusCard({
  title,
  message,
  kind = 'empty',
  onRetry,
}: {
  title: string;
  message: string;
  kind?: 'empty' | 'error';
  onRetry?: () => void;
}): React.ReactNode {
  const { t } = useTranslation();
  return (
    <div className={`state-card overview-state overview-state-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && (
        <button className="secondary-button" type="button" onClick={onRetry}>
          {t('retry')}
        </button>
      )}
    </div>
  );
}

function LoadingCard({ className = '' }: { className?: string }): React.ReactNode {
  const { t } = useTranslation();
  return (
    <div className={`surface-card loading-card ${className}`} aria-busy="true" role="status">
      <span className="skeleton-line skeleton-title" />
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-short" />
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}

function LevelLabel({ level }: { level: RiskResult['level'] }): React.ReactNode {
  const { t } = useTranslation();
  const labels = { HIGH: t('riskHigh'), MEDIUM: t('riskMedium'), LOW: t('riskLow') };
  const icons = { HIGH: '▲', MEDIUM: '◆', LOW: '●' };

  return (
    <span className={`risk-level risk-level-${level.toLowerCase()}`}>
      <span aria-hidden="true">{icons[level]}</span>
      {labels[level]}
    </span>
  );
}

function unavailableModule(
  capability: { available: boolean; reason: 'ok' | 'no_plan' | 'no_coverage' | 'error' } | undefined,
  t: ReturnType<typeof useTranslation>['t']
): React.ReactNode {
  if (!capability || capability.available) {
    return null;
  }
  return (
    <StatusCard
      title={t('unavailable')}
      message={t(unavailableTextKey(capability.reason))}
    />
  );
}

function getWeatherValues(weather: WeatherBundle | undefined) {
  const hourly = weather?.hourly ?? [];
  return {
    maxRain: hourly.reduce<number | null>(
      (maximum, point) => (maximum === null ? point.precipMM : Math.max(maximum, point.precipMM)),
      null
    ),
    maxPop: hourly.reduce<number | null>(
      (maximum, point) => (maximum === null ? point.pop : Math.max(maximum, point.pop)),
      null
    ),
    rainRate: weather?.current.rainRateMmPerHr ?? null,
  };
}

function formatValue(value: number | null, unit: string): string {
  return value === null ? '—' : `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

function RiskCard({
  community,
  risk,
  weather,
  weatherLoading,
  weatherError,
  retryWeather,
  selected,
}: {
  community: Community;
  risk: RiskResult;
  weather: WeatherBundle | undefined;
  weatherLoading: boolean;
  weatherError: boolean;
  retryWeather: () => void;
  selected: boolean;
}): React.ReactNode {
  const { language, t } = useTranslation();
  const values = getWeatherValues(weather);
  const updatedAt = weather?.current.dateTimeISO ?? weather?.meta.fetchedAtISO ?? new Date().toISOString();
  const riskUpdatedAt = risk.generatedAt;
  const stale =
    weather?.meta.isStale === true ||
    (weather !== undefined &&
      Date.now() - new Date(updatedAt).getTime() > 15 * 60 * 1000);
  const alertLabels = {
    URGENT: t('urgentAlert'),
    ADVANCE: t('advanceAlert'),
    NONE: t('noAlert'),
  };
  const actions = {
    HIGH: t('sampleActionHigh'),
    MEDIUM: t('sampleActionMedium'),
    LOW: t('sampleActionLow'),
  };
  const factorItems = [
    { id: 'forecast-rain', title: t('sampleFactorRain'), value: formatValue(values.maxRain, t('unitMmPerHour')) },
    { id: 'forecast-pop', title: t('sampleFactorPop'), value: formatValue(values.maxPop, t('unitPercent')) },
    { id: 'current-rain-rate', title: t('sampleFactorRate'), value: formatValue(values.rainRate, t('unitMmPerHour')) },
  ];

  return (
    <article
      className={`risk-card surface-card${selected ? ' risk-card-selected' : ''}`}
      aria-labelledby={`risk-title-${community.id}`}
      aria-busy={weatherLoading}
    >
      <div className="risk-card-header">
        <div>
          <p className="risk-community-label">{t('communityRisk')}</p>
          <h3 id={`risk-title-${community.id}`}>{community.name_th}</h3>
        </div>
        <LevelLabel level={risk.level} />
      </div>

      <div className={`risk-score-panel risk-score-${risk.level.toLowerCase()}`}>
        <div>
          <span className="risk-score-caption">{t('riskScore')}</span>
          <strong className="risk-score-value">{risk.score}</strong>
          <span className="risk-score-range">/ 100</span>
        </div>
        <div className="risk-alert-type">
          <span>{t('alertType')}</span>
          <strong>{alertLabels[risk.alertType]}</strong>
        </div>
      </div>

      <div className="risk-mock-line">
        {risk.isMock && <span className="mock-badge">{t('mockBadge')}</span>}
        <span>{t('calibrationMockNotice')}</span>
      </div>
      {weatherLoading && (
        <p className="sr-only" role="status">{t('loadingDescription')}</p>
      )}

      <div className="risk-detail-grid">
        <section aria-label={t('topFactors')}>
          <h4>{t('topFactors')}</h4>
          <ol className="factor-list">
            {risk.factorIds.slice(0, 3).map((factorId) => {
              const factor = factorItems.find((item) => item.id === factorId);
              return factor ? (
                <li key={factor.id}>
                  <span>{factor.title}</span>
                  <strong>{weatherLoading ? '…' : factor.value}</strong>
                </li>
              ) : null;
            })}
          </ol>
          {weatherError && (
            <p className="weather-error-note">
              {t('weatherLoadError')}{' '}
              <button className="inline-button" type="button" onClick={retryWeather}>
                {t('retry')}
              </button>
            </p>
          )}
          {!weather && !weatherLoading && !weatherError && (
            <p className="weather-error-note">{t('weatherUnavailable')}</p>
          )}
          {weather && weather.hourly.length === 0 && (
            <p className="weather-error-note">{t('noForecastInputs')}</p>
          )}
        </section>

        <section aria-label={t('inputsUsed')}>
          <h4>{t('inputsUsed')}</h4>
          <ul className="input-list">
            {risk.inputIds.map((inputId) => {
              const factor = factorItems.find((item) => item.id === inputId);
              return factor ? (
                <li key={factor.id}>
                  <span className="input-check" aria-hidden="true">✓</span>
                  <span>{factor.title}</span>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      </div>

      <div className="risk-bottom">
        <div className="confidence-row">
          <span>{t('confidence')}</span>
          <strong>{risk.confidence === 'LOW' ? t('lowConfidence') : '—'}</strong>
        </div>
        <div className="action-panel">
          <span className="action-icon" aria-hidden="true">i</span>
          <div>
            <strong>{t('recommendedAction')}</strong>
            <p>{actions[risk.recommendedActionId]}</p>
          </div>
        </div>
        <div className="risk-card-meta">
          <span>{t('riskDataSource')}: {t('riskMockSource')}</span>
          <span>{t('updatedAt')} {formatTime(riskUpdatedAt, language)}</span>
          <span>
            {t('weatherData')}: {weather?.meta.source ?? t('weatherSourcePending')}
            {' · '}{t('updatedAt')} {weather ? formatTime(updatedAt, language) : '—'}
          </span>
        </div>
        {stale && (
          <p className="stale-banner" role="status">{t('staleNotice')}</p>
        )}
      </div>
    </article>
  );
}

export function OverviewPage(): React.ReactNode {
  const { language, t } = useTranslation();
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const capabilityQuery = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => fetchCapabilities(signal),
  });
  const communitiesQuery = useQuery({
    queryKey: ['communities'],
    queryFn: ({ signal }) => fetchCommunities(signal),
  });
  const communities = communitiesQuery.data ?? [];
  const capabilities = capabilityQuery.data?.capabilities ?? [];
  const getCapability = (id: CapabilityId) =>
    capabilities.find((capability) => capability.id === id);
  const riskAvailable = capabilityQuery.data?.capabilities.some(
    (capability) => capability.id === 'risk-summary' && capability.available
  ) ?? false;
  const hourlyAvailable = getCapability('hourly-forecast')?.available === true;
  const dailyAvailable = getCapability('daily-forecast')?.available === true;
  const conditionsAvailable =
    getCapability('current-conditions')?.available === true ||
    getCapability('observations')?.available === true;
  const weatherAvailable = hourlyAvailable && dailyAvailable && conditionsAvailable;
  const weatherQueries = useQueries({
    queries: communities.map((community) => ({
      queryKey: ['weather', community.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchCommunityWeather(community.id, signal),
      enabled: weatherAvailable,
    })),
  });
  const riskQueries = useQueries({
    queries: communities.map((community) => ({
      queryKey: ['risk', community.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchMockRiskResult(community.id, signal),
      enabled: riskAvailable,
    })),
  });
  if (communitiesQuery.isPending || capabilityQuery.isPending) {
    return (
      <section className="page-stack" aria-busy="true">
        <div className="page-heading">
          <p className="eyebrow">RAIN BURST EARLY WARNING</p>
          <h1>{t('pageOverview')}</h1>
        </div>
        <LoadingCard />
        <LoadingCard />
      </section>
    );
  }

  if (
    (communitiesQuery.isError && !communitiesQuery.data) ||
    (capabilityQuery.isError && !capabilityQuery.data)
  ) {
    return (
      <section className="page-stack" aria-labelledby="page-title">
        <div className="page-heading">
          <p className="eyebrow">RAIN BURST EARLY WARNING</p>
          <h1 id="page-title">{t('pageOverview')}</h1>
        </div>
        <StatusCard
          title={communitiesQuery.isError ? t('communitiesLoadError') : t('loadFailed')}
          message={t('loadFailedDescription')}
          kind="error"
          onRetry={() => {
            void communitiesQuery.refetch();
            void capabilityQuery.refetch();
          }}
        />
      </section>
    );
  }

  if (communities.length === 0) {
    return (
      <section className="page-stack" aria-labelledby="page-title">
        <div className="page-heading">
          <p className="eyebrow">RAIN BURST EARLY WARNING</p>
          <h1 id="page-title">{t('pageOverview')}</h1>
        </div>
        <StatusCard title={t('noCommunities')} message={t('noCapabilities')} />
      </section>
    );
  }

  const selectedId =
    communities.some((community) => community.id === selectedCommunityId)
      ? selectedCommunityId
      : communities[0]?.id ?? '';
  const mockData = capabilityQuery.data.isMock;
  const mapCapability = getCapability('overview-map');
  const riskCapability = getCapability('risk-summary');
  const riskResults = riskQueries.flatMap((query) => query.data ? [query.data] : []);
  const riskMapLoading =
    riskCapability?.available === true &&
    riskResults.length === 0 &&
    riskQueries.some((query) => query.isPending);
  const riskMapError = riskQueries.some((query) => query.isError);
  const capabilitiesStale =
    Date.now() - new Date(capabilityQuery.data.checkedAt).getTime() > 15 * 60 * 1000;

  return (
    <section className="page-stack overview-page" aria-labelledby="page-title">
      <div className="page-heading">
        <p className="eyebrow">RAIN BURST EARLY WARNING</p>
        <h1 id="page-title">{t('pageOverview')}</h1>
        <p>{t('overviewDescription')}</p>
      </div>

      {mockData && (
        <div className="notice notice-mock overview-mock-notice" role="status">
          <span className="mock-badge">{t('mockBadge')}</span>
          <p>{t('calibrationMockNotice')}</p>
        </div>
      )}
      {(communitiesQuery.isError || capabilityQuery.isError) && (
        <div className="notice notice-stale" role="status">
          <p>{t('staleNotice')}</p>
        </div>
      )}

      <section className="overview-section" aria-labelledby="map-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COMMUNITIES</p>
            <h2 id="map-heading">{t('communityMap')}</h2>
          </div>
          <span className="map-source">{t('dataSource')}: config/communities.json</span>
        </div>

        {!mapCapability || !mapCapability.available ? (
          unavailableModule(mapCapability, t)
        ) : (
          <>
            <div className="surface-card map-card">
              <div className="map-legend" aria-label={t('mapLegend')}>
                <span>{t('mapLegend')}:</span>
                <span className="legend-item legend-high"><b aria-hidden="true">▲</b>{t('riskHigh')}</span>
                <span className="legend-item legend-medium"><b aria-hidden="true">◆</b>{t('riskMedium')}</span>
                <span className="legend-item legend-low"><b aria-hidden="true">●</b>{t('riskLow')}</span>
              </div>
              {riskMapLoading && (
                <p className="map-state-note" role="status">{t('mapRiskLoading')}</p>
              )}
              {riskMapError && (
                <p className="map-state-note" role="alert">{t('loadFailed')}</p>
              )}
              {riskCapability && !riskCapability.available && (
                <div className="map-state-note">
                  {unavailableModule(riskCapability, t)}
                </div>
              )}
              {riskResults.some((risk) => risk.isMock) && (
                <div className="map-mock-caption">{t('mockBadge')}</div>
              )}
              <CommunityMap
                communities={communities}
                risks={riskResults}
                selectedCommunityId={selectedId}
                onSelectCommunity={setSelectedCommunityId}
              />
              <p className="map-meta">
                {t('dataSource')}: config/communities.json · {t('riskDataSource')}: {t('riskMockSource')}
                {' · '}{t('updatedAt')} {riskResults[0] ? formatTime(riskResults[0].generatedAt, language) : '—'}
                {' · '}{t('mapAttribution')}
              </p>
              {capabilitiesStale && (
                <p className="stale-banner" role="status">{t('staleNotice')}</p>
              )}
            </div>
          </>
        )}
      </section>

      <section className="overview-section" aria-labelledby="risk-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RISK MONITORING</p>
            <h2 id="risk-heading">{t('communityRisk')}</h2>
          </div>
        </div>

        {!riskCapability || !riskCapability.available ? (
          unavailableModule(riskCapability, t)
        ) : (
          <div className="risk-card-grid">
            {communities.map((community, index) => {
              const riskQuery = riskQueries[index];
              const risk = riskQuery?.data;
              const query = weatherQueries[index];
              if (!risk) {
                return (
                  <StatusCard
                    key={community.id}
                    title={riskQuery?.isError ? t('loadFailed') : community.name_th}
                    message={riskQuery?.isError ? t('loadFailedDescription') : t('loadingDescription')}
                    kind={riskQuery?.isError ? 'error' : 'empty'}
                    onRetry={riskQuery?.isError ? () => { void riskQuery.refetch(); } : undefined}
                  />
                );
              }
              return (
                <RiskCard
                  key={community.id}
                  community={community}
                  risk={risk}
                  weather={query?.data}
                  weatherLoading={query?.isPending ?? false}
                  weatherError={query?.isError ?? false}
                  retryWeather={() => {
                    if (query) {
                      void query.refetch();
                    }
                  }}
                  selected={community.id === selectedId}
                />
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
