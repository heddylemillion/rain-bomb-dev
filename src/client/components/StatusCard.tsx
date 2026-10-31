import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  HelpCircle,
  Share2,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AreaEnvironment, Community, RiskResult, SoilResponse } from '../../shared/contracts.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import { LEVEL_KEYS, LEVEL_SYMBOL, formatClock } from '../lib/risk.js';
import { translateSoilName, translateSoilValue } from '../lib/soilLocalization.js';

interface StatusCardProps {
  community: Community;
  address?: string | undefined;
  risk: RiskResult | undefined;
  riskLoading: boolean;
  riskError: boolean;
  retryRisk: () => void;
  pointNotice?: string | null;
  environment?: AreaEnvironment;
  environmentLoading: boolean;
  environmentError: boolean;
  retryEnvironment: () => void;
  soilEnabled: boolean;
  soil?: SoilResponse;
  soilLoading: boolean;
  soilError: boolean;
  retrySoil: () => void;
  soilLayerLoading: boolean;
  soilLayerError: boolean;
  retrySoilLayer: () => void;
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
      {formatBangkokTime(item.timeISO, language)}:{' '}
      {item.seaLevelHeightMslM === null
        ? language === 'th'
          ? 'ไม่มีข้อมูล'
          : 'No data'
        : `${formatNumber(item.seaLevelHeightMslM)} ${language === 'th' ? 'ม.' : 'm'}`}
    </li>
  ));
  return (
    <figure className="mt-2 flex flex-col gap-1">
      <svg
        viewBox="0 0 300 88"
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
        className="w-full h-16 rounded-lg bg-slate-950/60 border border-white/10"
      >
        <line
          x1="0"
          y1="44"
          x2="300"
          y2="44"
          stroke="rgba(255,255,255,0.2)"
          strokeDasharray="3 3"
        />
        {lineSegments.map((pts, index) => (
          <polyline
            key={index}
            points={pts}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
          />
        ))}
        {points.map((point) => (
          <circle key={point.index} cx={point.x} cy={point.y} r="1.7" fill="#7dd3fc" />
        ))}
      </svg>
      <figcaption className="text-[0.65rem] text-slate-200">
        {formatBangkokTime(valid[0]!.time, language)} –{' '}
        {formatBangkokTime(valid.at(-1)!.time, language)}
      </figcaption>
      <details className="text-xs text-slate-200">
        <summary className="cursor-pointer min-h-[36px] inline-flex items-center font-medium text-sky-300">
          {language === 'th' ? 'ดูค่ารายชั่วโมง' : 'View hourly values'}
        </summary>
        <ol className="max-h-32 overflow-y-auto pl-5 mt-1 space-y-0.5 text-[0.68rem]">
          {detailItems}
        </ol>
      </details>
    </figure>
  );
}

const speechSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

function RiskIcon({ level }: { level: RiskResult['level'] | undefined }): React.ReactNode {
  if (level === 'HIGH') return <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />;
  if (level === 'MEDIUM') return <CircleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />;
  if (level === 'LOW') return <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />;
  return <HelpCircle className="w-4 h-4 shrink-0" aria-hidden="true" />;
}

export function StatusCard({
  community,
  address,
  risk,
  riskLoading,
  riskError,
  retryRisk,
  pointNotice,
  environment,
  environmentLoading,
  environmentError,
  retryEnvironment,
  soilEnabled,
  soil,
  soilLoading,
  soilError,
  retrySoil,
  soilLayerLoading,
  soilLayerError,
  retrySoilLayer,
}: StatusCardProps): React.ReactNode {
  const { t, language } = useTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(min-width: 1024px)').matches : false
  );
  const [speaking, setSpeaking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastAnnounced = useRef('');
  const name = language === 'th' ? community.name_th : community.name_en;
  const level = risk?.level;
  const keys = level && level !== 'INSUFFICIENT' ? LEVEL_KEYS[level] : null;
  const statusWord = keys ? t(keys.status) : t('riskInsufficient');
  const pillClass =
    level === 'HIGH'
      ? 'risk-pill risk-pill-high'
      : level === 'MEDIUM'
        ? 'risk-pill risk-pill-medium'
        : level === 'LOW'
          ? 'risk-pill risk-pill-low'
          : 'risk-pill risk-pill-neutral';

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent): void => {
      setCollapsed(!event.matches);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!level) return;
    const key = `${community.id}:${level}`;
    if (key !== lastAnnounced.current) {
      lastAnnounced.current = key;
      setAnnouncement(`${t('riskChangedAnnouncement')} ${name} ${t('riskChangedTo')} ${statusWord}`);
    }
  }, [community.id, level, name, statusWord, t]);

  useEffect(
    () => () => {
      if (speechSupported()) window.speechSynthesis.cancel();
    },
    [community.id]
  );

  const summary = risk ? `${name}. ${statusWord}. ${risk.recommendationTh}` : '';
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
    const text = `${t('shareText')} · ${community.name_th}: ${statusWord} — ${risk.recommendationTh}`;
    window.open(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(pageUrl.toString())}&text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const assessedClock = formatClock(risk?.fetchedAt ?? new Date().toISOString(), language);

  if (collapsed) {
    return (
      <section
        className={`status-card glass-panel rounded-2xl pointer-events-auto w-full md:w-auto ${
          keys ? `status-${level?.toLowerCase()}` : ''
        }`}
        aria-label={`${name} — ${statusWord}`}
        aria-busy={riskLoading}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        <button
          type="button"
          aria-expanded="false"
          aria-label={`${t('expandStatusCard')}: ${name} · ${statusWord}`}
          onClick={() => setCollapsed(false)}
          className="min-h-[48px] w-full px-3 py-1.5 flex items-center justify-between gap-2.5 text-left"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className={`${pillClass} inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold shrink-0`}>
              <RiskIcon level={level} />
              {keys && (
                <span aria-hidden="true">
                  {LEVEL_SYMBOL[level as 'HIGH' | 'MEDIUM' | 'LOW']}
                </span>
              )}
              <span>{ riskLoading && !risk ? t('cardLoading') : statusWord }</span>
            </span>
            <span className="text-xs font-semibold text-slate-100 truncate">{name}</span>
          </span>
          <ChevronUp className="w-4 h-4 text-slate-100 shrink-0 md:rotate-180" aria-hidden="true" />
        </button>
      </section>
    );
  }

  return (
    <section
      className={`status-card glass-panel rounded-2xl pointer-events-auto w-full md:w-[clamp(300px,26vw,360px)] max-h-[38dvh] md:max-h-[min(55dvh,calc(100dvh-210px))] flex flex-col overflow-hidden ${
        keys ? `status-${level?.toLowerCase()}` : ''
      }`}
      aria-labelledby="status-card-title"
      aria-busy={riskLoading}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="flex items-start justify-between gap-2 px-3.5 pt-2.5 pb-2 border-b border-white/10 shrink-0">
        <div className="min-w-0">
          <h2 id="status-card-title" className="text-sm font-bold text-slate-50 truncate">
            {name}
          </h2>
          {address && (
            <p className="text-[0.68rem] text-slate-200 truncate" title={address}>
              {address}
            </p>
          )}
          <p className="text-[0.65rem] text-slate-200">
            {t('sideCoordinates')}: {community.lat.toFixed(4)}, {community.lon.toFixed(4)}
          </p>
        </div>
        <button
          type="button"
          aria-expanded="true"
          aria-label={t('collapseStatusCard')}
          title={t('collapseStatusCard')}
          onClick={() => setCollapsed(true)}
          className="glass-icon-btn min-w-[44px] min-h-[44px] -my-1 -mr-1.5 rounded-xl inline-flex items-center justify-center text-slate-100 shrink-0"
        >
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5 status-scroll-body">
        {riskLoading && !risk && (
          <p className="text-xs text-slate-200">{t('cardLoading')}</p>
        )}
        {riskError && !risk && (
          <div className="glass-subcard rounded-xl p-2.5 flex flex-col gap-2" role="alert">
            <p className="text-xs text-slate-100">{t('cardFailed')}</p>
            <button
              type="button"
              className="glass-control-btn min-h-[44px] rounded-xl px-3 text-xs font-semibold"
              onClick={retryRisk}
            >
              {t('retry')}
            </button>
          </div>
        )}

        {risk && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`${pillClass} inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold`}
              >
                <RiskIcon level={level} />
                {keys && (
                  <span aria-hidden="true">
                    {LEVEL_SYMBOL[level as 'HIGH' | 'MEDIUM' | 'LOW']}
                  </span>
                )}
                <span>{statusWord}</span>
              </span>
              <span className="text-xs font-semibold text-sky-200">
                {t('riskTimeNow')} ({t('timeNow')} · {assessedClock} {t('timeSuffix')})
              </span>
            </div>

            <p className="text-xs leading-snug text-slate-50">
              <span className="text-slate-200">{t('whatToDo')}: </span>
              <strong className="font-semibold">{risk.recommendationTh}</strong>
            </p>

            {pointNotice && (
              <p className="text-[0.7rem] leading-snug text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10">
                {pointNotice}
              </p>
            )}

            <p className="text-[0.68rem] text-slate-200">
              {t('updatedAtLabel')}{' '}
              {risk.fetchedAt ? formatClock(risk.fetchedAt, language) : t('noData')}{' '}
              {t('timeSuffix')}
              {risk.factors.some((factor) => factor.isStale) ? ` · ${t('staleData')}` : ''}
            </p>

            <div className="grid grid-cols-2 gap-2">
              {speechSupported() && (
                <button
                  type="button"
                  aria-pressed={speaking}
                  onClick={toggleSpeech}
                  className={`glass-control-btn min-h-[44px] rounded-xl px-2.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold ${
                    speaking ? 'glass-control-active' : ''
                  }`}
                >
                  {speaking ? (
                    <VolumeX className="w-4 h-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{speaking ? t('readAloudStop') : t('readAloud')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={shareToLine}
                className="glass-control-btn min-h-[44px] rounded-xl px-2.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold col-span-1"
              >
                <Share2 className="w-4 h-4 shrink-0 text-sky-300" aria-hidden="true" />
                <span>{t('shareLine')}</span>
              </button>
            </div>

            <details className="glass-subcard rounded-xl px-3 py-1">
              <summary className="min-h-[44px] cursor-pointer flex items-center justify-between text-xs font-semibold text-sky-300 select-none">
                <span>{t('seeDetails')}</span>
              </summary>
              <div className="pb-2.5 pt-1 flex flex-col gap-2 text-xs text-slate-200 border-t border-white/10">
                <p>{keys ? t(keys.explain) : t('insufficientExplain')}</p>
                <p className="text-[0.68rem]">{t('confidenceLimited')}</p>
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[0.7rem]">
                  <dt className="text-slate-200">{t('detailScore')}</dt>
                  <dd className="font-semibold text-slate-50 text-right">
                    {risk.score === null ? t('riskInsufficient') : `${formatNumber(risk.score, 0)} / 100`}
                  </dd>
                  <dt className="text-slate-200">{t('detailAlertType')}</dt>
                  <dd className="font-semibold text-slate-50 text-right">
                    {risk.alertType === 'URGENT'
                      ? t('urgentAlert')
                      : risk.alertType === 'ADVANCE'
                        ? t('advanceAlert')
                        : t('noAlert')}
                  </dd>
                  <dt className="text-slate-200">{t('detailConfidence')}</dt>
                  <dd className="font-semibold text-slate-50 text-right">
                    {`${formatNumber(risk.confidence * 100, 0)}% · ${t(
                      risk.confidenceLevel === 'LOW'
                        ? 'lowConfidence'
                        : risk.confidenceLevel === 'HIGH'
                          ? 'highConfidence'
                          : 'mediumConfidence'
                    )}`}
                  </dd>
                  <dt className="text-slate-200">{t('lightningCount')}</dt>
                  <dd className="font-semibold text-slate-50 text-right">
                    {risk.lightningSummary.count30min === null
                      ? t('noData')
                      : formatNumber(risk.lightningSummary.count30min, 0)}
                  </dd>
                  <dt className="text-slate-200">{t('nearestLightning')}</dt>
                  <dd className="font-semibold text-slate-50 text-right">
                    {risk.lightningSummary.nearestStrikeKm === null
                      ? t('noData')
                      : `${formatNumber(risk.lightningSummary.nearestStrikeKm)} กม.`}
                  </dd>
                </dl>

                <h3 className="text-xs font-semibold text-slate-50 pt-1">{t('detailFactors')}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[0.66rem]">
                    <thead>
                      <tr className="border-b border-white/15 text-slate-100">
                        <th scope="col" className="py-1 pr-2">{t('factorName')}</th>
                        <th scope="col" className="py-1 px-1">{t('factorValue')}</th>
                        <th scope="col" className="py-1 px-1">{t('detailWeight')}</th>
                        <th scope="col" className="py-1 pl-1">{t('detailSource')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {risk.factors.map((factor) => (
                        <tr key={factor.id} className="border-b border-white/5">
                          <th scope="row" className="py-1 pr-2 font-medium text-slate-100">
                            {t(FACTOR_NAME_KEYS[factor.id])}
                          </th>
                          <td className="py-1 px-1 text-slate-50 whitespace-nowrap">
                            {factor.available ? `${formatNumber(factor.rawValue)} ${factor.unit}` : t('noData')}
                          </td>
                          <td className="py-1 px-1 text-slate-200">{formatNumber(factor.weight, 2)}</td>
                          <td className="py-1 pl-1 text-slate-200">
                            {factor.source.startsWith('จำลอง (scenario:')
                              ? factor.source
                              : t(FACTOR_SOURCE_KEYS[factor.id])}
                            {!factor.available ? ` · ${t(REASON_KEYS[factor.reason ?? 'error'])}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[0.65rem]">{t('calibrationNotice')}</p>
              </div>
            </details>
          </>
        )}

        {soilEnabled && (
          <details className="glass-subcard rounded-xl px-3 py-1" aria-busy={soilLoading}>
              <summary className="min-h-[44px] cursor-pointer flex items-center justify-between text-xs font-semibold text-slate-100 select-none">
                <span>{t('soilInfoTitle')}</span>
              </summary>
              <div className="pb-2.5 pt-1 flex flex-col gap-1.5 text-[0.7rem] text-slate-200 border-t border-white/10">
                {soilLoading && <p>{t('soilLoading')}</p>}
                {soilLayerLoading && <p>{t('soilLayerLoading')}</p>}
                {soilError && (
                  <div role="alert" className="flex flex-col gap-1.5">
                    <p>{t('soilLoadError')}</p>
                    <button
                      type="button"
                      className="glass-control-btn min-h-[44px] rounded-xl px-3 text-xs font-semibold"
                      onClick={retrySoil}
                    >
                      {t('retry')}
                    </button>
                  </div>
                )}
                {soilLayerError && (
                  <div role="alert" className="flex flex-col gap-1.5">
                    <p>{t('soilLayerLoadError')}</p>
                    <button
                      type="button"
                      className="glass-control-btn min-h-[44px] rounded-xl px-3 text-xs font-semibold"
                      onClick={retrySoilLayer}
                    >
                      {t('retry')}
                    </button>
                  </div>
                )}
                {soil?.soil ? (
                  <>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                      <dt>{t('soilType')}</dt>
                      <dd>{translateSoilName(soil.soil, language, t)} ({soil.soil.soilCode})</dd>
                      <dt>{t('soilTexture')}</dt>
                      <dd>{translateSoilValue(soil.soil.textureTh, language, t)}</dd>
                      <dt>{t('soilPh')}</dt>
                      <dd>{translateSoilValue(soil.soil.phTopTh, language, t)}</dd>
                      <dt>{t('soilFertility')}</dt>
                      <dd>{translateSoilValue(soil.soil.fertilityTh, language, t)}</dd>
                      <dt>{t('soilAmphoe')}</dt>
                      <dd>{translateSoilValue(soil.soil.amphoeTh, language, t)}</dd>
                      <dt>{t('soilDrainage')}</dt>
                      <dd>{translateSoilValue(soil.soil.drainageClass ?? '', language, t)}</dd>
                      <dt>{t('soilSource')}</dt>
                      <dd>{t('soilSourceName')} · 1:25,000</dd>
                    </dl>
                    <p>{t('soilResolutionNotice')}</p>
                  </>
                ) : soil ? (
                  <p>{t('soilOutOfCoverage')}</p>
                ) : null}
              </div>
          </details>
        )}

        <details className="glass-subcard rounded-xl px-3 py-1" aria-busy={environmentLoading}>
          <summary className="min-h-[44px] cursor-pointer flex items-center justify-between text-xs font-semibold text-slate-100 select-none">
            <span>{t('environmentContext')}</span>
          </summary>
          <div className="pb-2.5 pt-1 flex flex-col gap-1.5 text-[0.7rem] text-slate-200 border-t border-white/10">
            {environmentLoading && <p>{t('environmentLoading')}</p>}
            {environmentError && (
              <div role="alert" className="flex flex-col gap-1.5">
                <p>{t('environmentLoadFailed')}</p>
                <button
                  type="button"
                  className="glass-control-btn min-h-[44px] rounded-xl px-3 text-xs font-semibold"
                  onClick={retryEnvironment}
                >
                  {t('retry')}
                </button>
              </div>
            )}
            {environment && (
              <>
                <p className="text-slate-50 font-medium">
                  {environment.elevation.valueM === null
                    ? t('noElevation')
                    : `${t('elevationEstimatePrefix')} ${formatNumber(environment.elevation.valueM)} ${t('elevationEstimateSuffix')}`}
                </p>
                {environment.elevation.messageTh && environment.elevation.valueM === null && (
                  <p>{environment.elevation.messageTh}</p>
                )}
                <div className="pt-1 border-t border-white/10 flex flex-col gap-1">
                  <h4 className="font-semibold text-slate-100">{t('seaLevelHeading')}</h4>
                  <p>
                    {t('referencePoint')}: {environment.seaLevel.referencePoint.nameTh} ·{' '}
                    {formatNumber(environment.seaLevel.referencePoint.distanceKm)} {t('distanceUnit')}
                  </p>
                  <p className="text-sky-200 font-medium">{t('seaLevelForecastLabel')}</p>
                  <p>{t('marineDatumNotice')}</p>
                  {environment.seaLevel.messageTh && (
                    <p role="status">
                      {t('noSeaLevelData')} · {environment.seaLevel.messageTh}
                    </p>
                  )}
                  {environment.seaLevel.hourly.length > 0 && (
                    <>
                      <p className="text-slate-100 font-medium">
                        {t('seaLevelNow')} (
                        {formatBangkokTime(environment.seaLevel.hourly[0]!.timeISO, language)}):{' '}
                        {formatNumber(environment.seaLevel.hourly[0]!.seaLevelHeightMslM)}{' '}
                        {t('meterUnit')}
                      </p>
                      <SeaLevelChart
                        values={environment.seaLevel.hourly}
                        language={language}
                        label={t('seaLevelChartLabel')}
                      />
                    </>
                  )}
                  <p className="text-[0.64rem]">{t('seaLevelAttribution')}</p>
                </div>
              </>
            )}
          </div>
        </details>

        <p className="text-[0.66rem] text-slate-200 border-t border-white/10 pt-2">
          {t('decisionSupportShort')}
        </p>
      </div>
    </section>
  );
}
