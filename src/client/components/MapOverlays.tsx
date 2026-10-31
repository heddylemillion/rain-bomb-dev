import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Minus, Pause, Play, Plus } from 'lucide-react';
import type { Capability, OverlayLayerId } from '../../shared/contracts.js';
import { useTranslation } from '../i18n.js';
import { GlassTooltip, useAccessibleTooltip } from './GlassTooltip.js';

export type MapLayerId = 'risk' | OverlayLayerId;

export interface LayerAvailability {
  id: MapLayerId;
  available: boolean;
  reason: Capability['reason'];
  updatedAt: string | null;
  mock?: boolean;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onLocate,
  locating,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  locating: boolean;
}): React.ReactNode {
  const { t } = useTranslation();
  const zoomInTip = useAccessibleTooltip(true);
  const zoomOutTip = useAccessibleTooltip(true);
  const locateTip = useAccessibleTooltip(true);

  return (
    <div
      className="map-controls glass-panel rounded-2xl p-1 flex flex-col gap-1 pointer-events-auto"
      role="group"
      aria-label={t('mapRegionLabel')}
    >
      <div className="relative">
        <button
          type="button"
          aria-label={t('zoomInAria')}
          {...zoomInTip.triggerProps}
          onClick={onZoomIn}
          className="glass-icon-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-slate-50"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
        <GlassTooltip id={zoomInTip.tooltipId} open={zoomInTip.open} placement="left">
          {t('zoomInAria')}
        </GlassTooltip>
      </div>

      <div className="relative border-t border-white/10 pt-1">
        <button
          type="button"
          aria-label={t('zoomOutAria')}
          {...zoomOutTip.triggerProps}
          onClick={onZoomOut}
          className="glass-icon-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-slate-50"
        >
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>
        <GlassTooltip id={zoomOutTip.tooltipId} open={zoomOutTip.open} placement="left">
          {t('zoomOutAria')}
        </GlassTooltip>
      </div>

      <div className="relative border-t border-white/10 pt-1">
        <button
          type="button"
          aria-label={t('myLocation')}
          aria-busy={locating}
          disabled={locating}
          {...locateTip.triggerProps}
          onClick={onLocate}
          className="glass-icon-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-sky-300"
        >
          <LocateFixed className="w-4 h-4" aria-hidden="true" />
        </button>
        <GlassTooltip id={locateTip.tooltipId} open={locateTip.open} placement="left">
          {t('myLocation')}
        </GlassTooltip>
      </div>
    </div>
  );
}

const PLAY_INTERVAL_MS = 1200;

/**
 * Centered floating glass timeline.
 * Playback only starts when the user presses "เล่น" (never autoplays).
 * Steps by 10 minutes; in live mode without radar forecast frames, hides the future segment.
 */
export function RadarSlider({
  mockMode,
  minutes,
  onMinutesChange,
  onHoursChange,
}: {
  mockMode: boolean;
  minutes: number;
  onMinutesChange: (minutes: number) => void;
  onHoursChange: (hours: number) => void;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // Live mode has no verified radar forecast frames, so future segment is hidden (max = 0).
  const hasForecast = mockMode;
  const maxMin = hasForecast ? 180 : 0;
  const clampedMinutes = Math.max(-180, Math.min(maxMin, Math.round(minutes / 10) * 10));
  const minutesRef = useRef(clampedMinutes);
  minutesRef.current = clampedMinutes;

  useEffect(() => {
    if (!hasForecast && minutes > 0) {
      onMinutesChange(0);
      onHoursChange(0);
    }
  }, [hasForecast, minutes, onHoursChange, onMinutesChange]);

  useEffect(() => {
    const updateVisibility = (): void => setVisible(document.visibilityState === 'visible');
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = (event: MediaQueryListEvent): void => {
      setReduceMotion(event.matches);
      if (event.matches) setPlaying(false);
    };
    document.addEventListener('visibilitychange', updateVisibility);
    media.addEventListener('change', updateMotion);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      media.removeEventListener('change', updateMotion);
    };
  }, []);

  useEffect(() => {
    if (!playing || !visible || reduceMotion) return undefined;
    const timer = window.setInterval(() => {
      const next = minutesRef.current + 10 > maxMin ? -180 : minutesRef.current + 10;
      onMinutesChange(next);
      onHoursChange(Math.max(-3, Math.min(0, Math.round(next / 60))));
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [maxMin, onHoursChange, onMinutesChange, playing, reduceMotion, visible]);

  const frameClock = new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(Date.now() + clampedMinutes * 60_000));

  const offsetText =
    clampedMinutes === 0
      ? t('timeNow')
      : `${clampedMinutes > 0 ? '+' : '−'}${Math.abs(clampedMinutes)} ${language === 'th' ? 'นาที' : 'min'}`;

  const pastFillPct = hasForecast
    ? Math.min(50, ((clampedMinutes + 180) / 360) * 100)
    : ((clampedMinutes + 180) / 180) * 100;
  const futureFillPct =
    hasForecast && clampedMinutes > 0 ? (clampedMinutes / 360) * 100 : 0;

  return (
    <section
      aria-label={mockMode ? t('mockTimelineLabel') : t('timeSliderLabel')}
      className="slider-panel glass-panel rounded-2xl px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 w-[min(640px,calc(100vw-16px))] md:w-[min(640px,calc(100vw-32px))] pointer-events-auto"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          aria-pressed={playing}
          disabled={reduceMotion}
          onClick={() => setPlaying((current) => !current)}
          className={`glass-control-btn min-h-[44px] min-w-[74px] sm:min-w-[82px] px-2.5 sm:px-3 rounded-xl inline-flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold shrink-0 ${
            playing ? 'glass-control-active' : ''
          }`}
        >
          {playing ? (
            <Pause className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
          <span>{playing ? t('timePause') : t('timePlay')}</span>
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-[0.7rem] sm:text-xs leading-tight">
            <label htmlFor="radar-time" className="font-semibold text-slate-50 truncate">
              {frameClock} {t('timeSuffix')} ·{' '}
              <span className="text-sky-300">{offsetText}</span>
            </label>

            {hasForecast ? (
              <span className="timeline-forecast-tag px-1.5 py-0.5 rounded-md text-[0.64rem] font-semibold shrink-0">
                {t('radarForecastSimulated')}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-[0.64rem] font-semibold text-slate-100 shrink-0">
                {t('noRadarForecast')}
              </span>
            )}
          </div>

          <div className="relative h-6 flex items-center">
            <div
              className="w-full h-2.5 rounded-full overflow-hidden flex border border-white/15 bg-slate-950/70"
              aria-hidden="true"
            >
              {hasForecast ? (
                <>
                  <div className="w-1/2 h-full relative timeline-segment-past">
                    <div
                      className="h-full bg-sky-400"
                      style={{ width: `${Math.min(100, pastFillPct * 2)}%` }}
                    />
                  </div>
                  <div className="w-1/2 h-full relative timeline-segment-future border-l-2 border-dashed border-sky-200/80">
                    {futureFillPct > 0 && (
                      <div
                        className="h-full bg-indigo-400/70"
                        style={{ width: `${Math.min(100, futureFillPct * 2)}%` }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="w-full h-full relative timeline-segment-past">
                  <div
                    className="h-full bg-sky-400"
                    style={{ width: `${Math.max(0, Math.min(100, pastFillPct))}%` }}
                  />
                </div>
              )}
            </div>

            <span
              aria-hidden="true"
              className="timeline-now-pin pointer-events-none"
              style={{ left: hasForecast ? '50%' : '100%' }}
            />

            <input
              id="radar-time"
              type="range"
              min={-180}
              max={maxMin}
              step={10}
              value={clampedMinutes}
              aria-valuetext={`${frameClock} · ${offsetText}${
                hasForecast && clampedMinutes > 0 ? ` · ${t('radarForecastSimulated')}` : ''
              }`}
              onChange={(event) => {
                setPlaying(false);
                const next = Number(event.target.value);
                onMinutesChange(next);
                onHoursChange(Math.max(-3, Math.min(0, Math.round(next / 60))));
              }}
              className="timeline-range-input absolute inset-0 w-full h-full m-0 cursor-pointer"
            />
          </div>

          <div
            className="flex items-center justify-between text-[0.6rem] sm:text-[0.65rem] font-medium text-slate-200 leading-none"
            aria-hidden="true"
          >
            {hasForecast ? (
              <>
                <span>{t('timePast3')}</span>
                <span className={clampedMinutes === 0 ? 'font-bold text-sky-300' : ''}>
                  {t('timeNow')}
                </span>
                <span>{t('timeNext3')}</span>
              </>
            ) : (
              <>
                <span>{t('timePast3')}</span>
                <span>{t('timePast1')}</span>
                <span className={clampedMinutes === 0 ? 'font-bold text-sky-300' : ''}>
                  {t('timeNow')}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
