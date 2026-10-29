import { useEffect, useRef, useState } from 'react';
import type { AreaEnvironment, Community, RiskResult } from '../../shared/contracts.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import { LEVEL_KEYS, LEVEL_SYMBOL, formatClock } from '../lib/risk.js';

interface StatusCardProps {
  community: Community;
  risk: RiskResult | undefined;
  riskLoading: boolean;
  riskError: boolean;
  retryRisk: () => void;
  pointNotice?: string | null;
  environment?: AreaEnvironment;
  environmentLoading: boolean;
  environmentError: boolean;
  retryEnvironment: () => void;
}

const FACTOR_NAME_KEYS: Record<RiskResult['factors'][number]['id'], MessageKey> = {
  rainNowMmHr: 'factorRainNow',
  peakRain3hMmHr: 'factorPeakRain3h',
  accum3hMm: 'factorAccum3h',
  accum24hMm: 'factorAccum24h',
  popMax3hPct: 'factorPopMax3h',
  lightning30minCount: 'factorLightning30m',
  pressureDrop3hHpa: 'factorPressureDrop3h',
  humidityPct: 'factorHumidity',
  tideFactor: 'factorTide',
};

const FACTOR_SOURCE_KEYS: Record<RiskResult['factors'][number]['id'], MessageKey> = {
  rainNowMmHr: 'sourceConditions',
  peakRain3hMmHr: 'sourceForecast',
  accum3hMm: 'sourceForecast',
  accum24hMm: 'sourceForecast',
  popMax3hPct: 'sourceForecast',
  lightning30minCount: 'sourceLightning',
  pressureDrop3hHpa: 'sourceObservationsArchive',
  humidityPct: 'sourceConditionsObservations',
  tideFactor: 'sourceMarine',
};

const REASON_KEYS: Record<'no_plan' | 'no_coverage' | 'error' | 'ok', MessageKey> = {
  no_plan: 'reasonNoPlan',
  no_coverage: 'reasonNoCoverage',
  error: 'reasonError',
  ok: 'available',
};

function formatNumber(value: number | null, maximumFractionDigits = 1): string {
  return value === null
    ? '—'
    : new Intl.NumberFormat('th-TH', { maximumFractionDigits }).format(value);
}

function formatBangkokTime(value: string, language: 'th' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function SeaLevelChart({
  values,
  language,
  label,
}: {
  values: AreaEnvironment['seaLevel']['hourly'];
  language: 'th' | 'en';
  label: string;
}): React.ReactNode {
  const valid = values.flatMap((item, index) =>
    item.seaLevelHeightMslM === null
      ? []
      : [{ time: item.timeISO, value: item.seaLevelHeightMslM, index }]
  );
  if (valid.length < 2) return null;
  const minimum = Math.min(...valid.map((item) => item.value));
  const maximum = Math.max(...valid.map((item) => item.value));
  const spread = Math.max(maximum - minimum, 0.1);
  const points = valid.map((item) => {
    const x = (item.index / Math.max(values.length - 1, 1)) * 300;
    const y = 76 - ((item.value - minimum) / spread) * 64;
    return { ...item, x, y };
  });
  const lineSegments: string[] = [];
  let segment: string[] = [];
  let sourceIndex = 0;
  for (const item of values) {
    if (item.seaLevelHeightMslM === null) {
      if (segment.length > 1) lineSegments.push(segment.join(' '));
      segment = [];
      sourceIndex += 1;
      continue;
    }
    const point = points.find((candidate) => candidate.index === sourceIndex);
    if (point) segment.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    sourceIndex += 1;
  }
  if (segment.length > 1) lineSegments.push(segment.join(' '));
  const detailItems = values.map((item) => (
    <li key={item.timeISO}>
      {formatBangkokTime(item.timeISO, language)}: {item.seaLevelHeightMslM === null
        ? (language === 'th' ? 'ไม่มีข้อมูล' : 'No data')
        : `${formatNumber(item.seaLevelHeightMslM)} ${language === 'th' ? 'ม.' : 'm'}`}
    </li>
  ));
  return (
    <figure className="sea-level-chart">
      <svg viewBox="0 0 300 88" role="img" aria-label={label} preserveAspectRatio="none">
        <line x1="0" y1="44" x2="300" y2="44" className="sea-level-chart-grid" />
        {lineSegments.map((points, index) => (
          <polyline key={index} points={points} className="sea-level-chart-line" />
        ))}
        {points.map((point) => (
          <circle key={point.index} cx={point.x} cy={point.y} r="1.7" className="sea-level-chart-dot" />
        ))}
      </svg>
      <figcaption>{formatBangkokTime(valid[0]!.time, language)} – {formatBangkokTime(valid.at(-1)!.time, language)}</figcaption>
      <details className="sea-level-chart-data">
        <summary>{language === 'th' ? 'ดูค่ารายชั่วโมง' : 'View hourly values'}</summary>
        <ol>{detailItems}</ol>
      </details>
    </figure>
  );
}

const speechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export function StatusCard({
  community,
  risk,
  riskLoading,
  riskError,
  retryRisk,
  pointNotice,
  environment,
  environmentLoading,
  environmentError,
  retryEnvironment,
}: StatusCardProps): React.ReactNode {
  const { t, language } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastAnnounced = useRef('');
  const name = language === 'th' ? community.name_th : community.name_en;
  const level = risk?.level;
  const keys = level && level !== 'INSUFFICIENT' ? LEVEL_KEYS[level] : null;

  useEffect(() => {
    if (!level) return;
    const key = `${community.id}:${level}`;
    if (key !== lastAnnounced.current) {
      lastAnnounced.current = key;
      setAnnouncement(`${t('riskChangedAnnouncement')} ${name} ${t('riskChangedTo')} ${
        keys ? t(keys.status) : t('riskInsufficient')
      }`);
    }
  }, [community.id, keys, level, name, t]);

  useEffect(() => () => {
    if (speechSupported()) window.speechSynthesis.cancel();
  }, [community.id]);

  const summary = risk
    ? `${name}. ${keys ? t(keys.status) : t('riskInsufficient')}. ${risk.recommendationTh}`
    : '';
  const toggleSpeech = (): void => {
    if (!speechSupported()) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(summary);
    utterance.lang = language === 'th' ? 'th-TH' : 'en-US';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const shareToLine = (): void => {
    if (!risk) return;
    const pageUrl = new URL(window.location.href);
    pageUrl.search = new URLSearchParams({
      lat: String(community.lat),
      lon: String(community.lon),
      name: community.name_th,
    }).toString();
    const text = `${t('shareText')} · ${community.name_th}: ${
      keys ? t(keys.status) : t('riskInsufficient')
    } — ${risk.recommendationTh}`;
    window.open(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(pageUrl.toString())}&text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return (
    <section
      className={`status-card${expanded ? ' is-expanded' : ''}${keys ? ` status-${level?.toLowerCase()}` : ''}`}
      aria-labelledby="status-card-title"
      aria-busy={riskLoading}
    >
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="status-head">
        <h2 id="status-card-title" className="status-community">{name}</h2>
      </div>

      <section className="environment-context" aria-labelledby="environment-context-title" aria-busy={environmentLoading}>
        <h3 id="environment-context-title">{t('environmentContext')}</h3>
        {environmentLoading && <p className="status-message">{t('environmentLoading')}</p>}
        {environmentError && (
          <div className="status-message" role="alert">
            <p>{t('environmentLoadFailed')}</p>
            <button type="button" className="action-button" onClick={retryEnvironment}>{t('retry')}</button>
          </div>
        )}
        {environment && (
          <>
            <p>
              {environment.elevation.valueM === null
                ? t('noElevation')
                : `${t('elevationEstimatePrefix')} ${formatNumber(environment.elevation.valueM)} ${t('elevationEstimateSuffix')}`}
            </p>
            {environment.elevation.messageTh && environment.elevation.valueM === null && (
              <p className="status-updated">{environment.elevation.messageTh}</p>
            )}
            <div className="sea-level-context">
              <h4>{t('seaLevelHeading')}</h4>
              <p>{t('referencePoint')}: {environment.seaLevel.referencePoint.nameTh} · {formatNumber(environment.seaLevel.referencePoint.distanceKm)} {t('distanceUnit')}</p>
              <p className="sea-level-warning">{t('seaLevelForecastLabel')}</p>
              <p>{t('marineNotObserved')}</p>
              <p>{t('marineDatumNotice')}</p>
              <p>{t('marineAccuracyNotice')}</p>
              <p>{t('marineNavigationNotice')}</p>
              {environment.seaLevel.messageTh && (
                <p className="status-updated" role="status">{t('noSeaLevelData')} · {environment.seaLevel.messageTh}</p>
              )}
              {environment.seaLevel.hourly.length > 0 && (
                <>
                  <p>{t('seaLevelChartHeading')}</p>
                  <p>
                    {t('seaLevelNow')} ({formatBangkokTime(environment.seaLevel.hourly[0]!.timeISO, language)}):
                    {' '}{formatNumber(environment.seaLevel.hourly[0]!.seaLevelHeightMslM)} {t('meterUnit')}
                  </p>
                  <SeaLevelChart
                    values={environment.seaLevel.hourly}
                    language={language}
                    label={t('seaLevelChartLabel')}
                  />
                </>
              )}
              <p className="sea-level-warning">{t('seaLevelAttribution')}</p>
            </div>
          </>
        )}
      </section>

      {riskLoading && <p className="status-message">{t('cardLoading')}</p>}
      {riskError && !risk && (
        <div className="status-message" role="alert">
          <p>{t('cardFailed')}</p>
          <button type="button" className="action-button" onClick={retryRisk}>{t('retry')}</button>
        </div>
      )}

      {risk && (
        <>
          <p className={`status-level${keys ? '' : ' status-insufficient'}`}>
            {keys && <span className="status-symbol" aria-hidden="true">{LEVEL_SYMBOL[level as 'HIGH' | 'MEDIUM' | 'LOW']}</span>}
            <span>{keys ? t(keys.status) : t('riskInsufficient')}</span>
          </p>
          <p className="status-action">
            <span className="status-action-label">{t('whatToDo')}:</span>
            <strong>{risk.recommendationTh}</strong>
          </p>
          {pointNotice && <p className="point-risk-notice">{pointNotice}</p>}

          <button
            type="button"
            className="sheet-toggle"
            aria-expanded={expanded}
            aria-controls="status-extra"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('collapseCard') : t('expandCard')} <span aria-hidden="true">{expanded ? '▾' : '▴'}</span>
          </button>

          <div id="status-extra" className="status-extra">
            <p className="status-explain">{keys ? t(keys.explain) : t('insufficientExplain')}</p>
            <p className="status-updated">
              {t('updatedAtLabel')} {risk.fetchedAt ? formatClock(risk.fetchedAt, language) : t('noData')} {t('timeSuffix')}
            </p>
            {risk.factors.some((factor) => factor.isStale) && (
              <p className="status-updated" role="status">{t('staleData')}</p>
            )}
            <p className="status-updated">{t('confidenceLimited')}</p>

            <div className="status-buttons">
              {speechSupported() && (
                <button type="button" className="action-button" aria-pressed={speaking} onClick={toggleSpeech}>
                  <span aria-hidden="true">🔊</span> {speaking ? t('readAloudStop') : t('readAloud')}
                </button>
              )}
              <button type="button" className="action-button line-button" onClick={shareToLine}>
                <span aria-hidden="true">💬</span> {t('shareLine')}
              </button>
            </div>

            <details className="status-details">
              <summary>{t('seeDetails')}</summary>
              <p className="detail-plain">{t('detailPlain')}</p>
              <dl className="detail-grid">
                <dt>{t('detailScore')}</dt>
                <dd>{risk.score === null ? t('riskInsufficient') : `${formatNumber(risk.score, 0)} / 100`}</dd>
                <dt>{t('detailAlertType')}</dt>
                <dd>{risk.alertType === 'URGENT' ? t('urgentAlert') : risk.alertType === 'ADVANCE' ? t('advanceAlert') : t('noAlert')}</dd>
                <dt>{t('detailConfidence')}</dt>
                <dd>{`${formatNumber(risk.confidence * 100, 0)}% · ${t(
                  risk.confidenceLevel === 'LOW' ? 'lowConfidence'
                    : risk.confidenceLevel === 'HIGH' ? 'highConfidence' : 'mediumConfidence'
                )}`}</dd>
                <dt>{t('lightningCount')}</dt>
                <dd>{risk.lightningSummary.count30min === null ? t('noData') : formatNumber(risk.lightningSummary.count30min, 0)}</dd>
                <dt>{t('nearestLightning')}</dt>
                <dd>{risk.lightningSummary.nearestStrikeKm === null ? t('noData') : `${formatNumber(risk.lightningSummary.nearestStrikeKm)} กม.`}</dd>
              </dl>

              <h3>{t('detailFactors')}</h3>
              <div className="factor-table-wrap">
                <table className="factor-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('factorName')}</th>
                      <th scope="col">{t('factorValue')}</th>
                      <th scope="col">{t('detailNormalized')}</th>
                      <th scope="col">{t('detailWeight')}</th>
                      <th scope="col">{t('detailSource')}</th>
                      <th scope="col">{t('detailObservedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risk.factors.map((factor) => (
                      <tr key={factor.id}>
                        <th scope="row">{t(FACTOR_NAME_KEYS[factor.id])}</th>
                        <td>{factor.available ? `${formatNumber(factor.rawValue)} ${factor.unit}` : t('noData')}</td>
                        <td>{factor.normalized === null ? '—' : formatNumber(factor.normalized, 2)}</td>
                        <td>{formatNumber(factor.weight, 2)}</td>
                        <td>{t(FACTOR_SOURCE_KEYS[factor.id])}{!factor.available ? ` · ${t(REASON_KEYS[factor.reason ?? 'error'])}` : ''}</td>
                        <td>{factor.observedAt ? formatClock(factor.observedAt, language) : t('noData')}{factor.isStale ? ` · ${t('staleData')}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="detail-plain">{t('calibrationNotice')}</p>
              <p className="detail-plain">{t('environmentAttribution')}</p>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
