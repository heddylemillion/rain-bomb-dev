import { useEffect, useRef, useState } from 'react';
import type { Community, RiskResult, WeatherBundle } from '../../shared/contracts.js';
import { useTranslation } from '../i18n.js';
import { LEVEL_KEYS, LEVEL_SYMBOL, formatClock } from '../lib/risk.js';

interface WeatherState {
  data: WeatherBundle | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

interface StatusCardProps {
  community: Community;
  risk: RiskResult | undefined;
  riskLoading: boolean;
  riskError: boolean;
  retryRisk: () => void;
  weather: WeatherState;
  isMock: boolean;
}

const speechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function formatNumber(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

/**
 * The one big status card: icon + level in huge text, one plain sentence, one clear action,
 * updated time. Technical values live behind "ดูรายละเอียด". Becomes a bottom sheet on mobile.
 */
export function StatusCard({
  community,
  risk,
  riskLoading,
  riskError,
  retryRisk,
  weather,
  isMock,
}: StatusCardProps): React.ReactNode {
  const { t, language } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastAnnounced = useRef('');
  const name = language === 'th' ? community.name_th : community.name_en;

  // Tell screen-reader users when the selected community or its risk level changes.
  const level = risk?.level;
  useEffect(() => {
    if (!level) {
      return;
    }
    const key = `${community.id}:${level}`;
    if (key !== lastAnnounced.current) {
      lastAnnounced.current = key;
      setAnnouncement(`${t('riskChangedAnnouncement')} ${name} ${t('riskChangedTo')} ${t(LEVEL_KEYS[level].status)}`);
    }
  }, [community.id, level, name, t]);

  // Stop speaking when the community changes or the card goes away.
  useEffect(() => {
    return () => {
      if (speechSupported()) {
        window.speechSynthesis.cancel();
      }
    };
  }, [community.id]);

  const keys = risk ? LEVEL_KEYS[risk.level] : null;
  const updated = risk ? `${t('updatedAtLabel')} ${formatClock(risk.generatedAt, language)} ${t('timeSuffix')}`.trim() : '';
  const summary =
    risk && keys
      ? `${isMock ? `${t('mockBadge')}. ` : ''}${name}. ${t(keys.status)}. ${t(keys.explain)}. ${t(keys.action)}.`
      : '';

  const toggleSpeech = (): void => {
    if (!speechSupported()) {
      return;
    }
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
    if (!risk || !keys) {
      return;
    }
    const pageUrl = `${window.location.origin}/?c=${encodeURIComponent(community.id)}`;
    const text = `${t('shareText')} · ${community.name_th}: ${t(keys.status)} — ${t(keys.action)}${isMock ? ` (${t('mockBadge')})` : ''}`;
    const shareUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const values = (() => {
    const hourly = weather.data?.hourly ?? [];
    return {
      maxRain: hourly.reduce<number | null>((max, point) => (max === null ? point.precipMM : Math.max(max, point.precipMM)), null),
      maxPop: hourly.reduce<number | null>((max, point) => (max === null ? point.pop : Math.max(max, point.pop)), null),
      rainNow: weather.data?.current.rainRateMmPerHr ?? null,
    };
  })();

  return (
    <section
      className={`status-card${expanded ? ' is-expanded' : ''}${risk ? ` status-${risk.level.toLowerCase()}` : ''}`}
      aria-labelledby="status-card-title"
      aria-busy={riskLoading}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="status-head">
        <h2 id="status-card-title" className="status-community">
          {name}
        </h2>
        {isMock && <span className="mock-badge">{t('mockBadge')}</span>}
      </div>

      {riskLoading && <p className="status-message">{t('cardLoading')}</p>}
      {riskError && !risk && (
        <div className="status-message" role="alert">
          <p>{t('cardFailed')}</p>
          <button type="button" className="action-button" onClick={retryRisk}>
            {t('retry')}
          </button>
        </div>
      )}

      {risk && keys && (
        <>
          <p className="status-level">
            <span className="status-symbol" aria-hidden="true">{LEVEL_SYMBOL[risk.level]}</span>
            <span>{t(keys.status)}</span>
          </p>
          <p className="status-action">
            <span className="status-action-label">{t('whatToDo')}</span>
            <strong>{t(keys.action)}</strong>
          </p>

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
            <p className="status-explain">{t(keys.explain)}</p>
            <p className="status-updated">{updated}</p>
            {isMock && <p className="status-mock-note">{t('mockLongNotice')}</p>}

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
              {weather.loading && <p>{t('weatherDetailsLoading')}</p>}
              {weather.error && (
                <p>
                  {t('weatherDetailsFailed')}{' '}
                  <button type="button" className="inline-button" onClick={weather.retry}>
                    {t('retry')}
                  </button>
                </p>
              )}
              <dl className="detail-grid">
                <dt>{t('detailRainForecast')}</dt>
                <dd>{formatNumber(values.maxRain, t('unitMmPerHour'))}</dd>
                <dt>{t('detailRainChance')}</dt>
                <dd>{formatNumber(values.maxPop, t('unitPercent'))}</dd>
                <dt>{t('detailRainNow')}</dt>
                <dd>{formatNumber(values.rainNow, t('unitMmPerHour'))}</dd>
                <dt>{t('detailScore')}</dt>
                <dd>{risk.score} / 100</dd>
                <dt>{t('detailAlertType')}</dt>
                <dd>
                  {risk.alertType === 'URGENT'
                    ? t('urgentAlert')
                    : risk.alertType === 'ADVANCE'
                      ? t('advanceAlert')
                      : t('noAlert')}
                </dd>
                <dt>{t('detailConfidence')}</dt>
                <dd>{risk.confidence === 'LOW' ? t('lowConfidence') : '—'}</dd>
                <dt>{t('detailWeatherSource')}</dt>
                <dd>
                  {weather.data?.meta.source ?? t('weatherSourcePending')}
                  {weather.data?.meta.isMock ? ` · ${t('mockBadge')}` : ''}
                </dd>
                <dt>{t('riskDataSource')}</dt>
                <dd>{t('riskMockSource')}</dd>
              </dl>
              <p className="detail-plain">{t('calibrationMockNotice')}</p>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
