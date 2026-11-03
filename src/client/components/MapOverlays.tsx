import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Minus, Pause, Play, Plus } from 'lucide-react';
import type { OverlayLayerId, RiskDataReason } from '../../shared/contracts.js';
import type { RadarFrame } from '../../shared/providerContracts.js';
import { useTranslation } from '../i18n.js';
import { GlassTooltip, useAccessibleTooltip } from './GlassTooltip.js';

export type MapLayerId = 'risk' | OverlayLayerId;

export interface LayerAvailability {
  id: MapLayerId;
  available: boolean;
  reason: RiskDataReason;
  updatedAt: string | null;
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
 * Centered floating glass timeline for real radar frames.
 * Playback only starts when the user presses "เล่น" (never autoplays).
 */
export function RadarSlider({
  frames = [],
  selectedFrameTime,
  onFrameTimeChange,
}: {
  frames?: RadarFrame[];
  selectedFrameTime?: number | null;
  onFrameTimeChange?: (time: number) => void;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const foundIndex = frames.findIndex((frame) => frame.time === selectedFrameTime);
  const frameIndex = foundIndex >= 0 ? foundIndex : Math.max(0, frames.length - 1);
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;

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
    if (!playing || !visible || reduceMotion || frames.length === 0 || !onFrameTimeChange) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const nextIndex = (frameIndexRef.current + 1) % frames.length;
      frameIndexRef.current = nextIndex;
      const frame = frames[nextIndex];
      if (frame) onFrameTimeChange(frame.time);
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [frames, onFrameTimeChange, playing, reduceMotion, visible]);

  const formatFrameClock = (unixSeconds: number): string =>
    new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(unixSeconds * 1000));

  const activeFrame = frames[frameIndex];
  const frameClock = activeFrame
    ? formatFrameClock(activeFrame.time)
    : formatFrameClock(Math.floor(Date.now() / 1000));

  const frameOffsetMin = activeFrame && frames.length > 0
    ? Math.max(0, Math.round(((frames.at(-1)?.time ?? activeFrame.time) - activeFrame.time) / 60))
    : null;
  const offsetText =
    frames.length === 0
      ? t('noRadarFrames')
      : frameOffsetMin === null || frameOffsetMin === 0
        ? t('timeNow')
        : `−${frameOffsetMin} ${language === 'th' ? 'นาที' : 'min'}`;

  const pastFillPct = frames.length <= 1 ? 100 : (frameIndex / (frames.length - 1)) * 100;

  return (
    <section
      aria-label={t('timeSliderLabel')}
      className="slider-panel glass-panel rounded-2xl px-2.5 sm:px-3.5 py-1.5 sm:py-2.5 w-[min(640px,calc(100vw-16px))] md:w-[min(640px,calc(100vw-32px))] pointer-events-auto"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          aria-pressed={playing}
          disabled={reduceMotion || frames.length === 0}
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

            <span className="px-1.5 py-0.5 rounded-md bg-white/10 border border-white/15 text-[0.64rem] font-semibold text-slate-100 shrink-0">
              {t('noRadarForecast')}
            </span>
          </div>

          <div className="relative h-6 flex items-center">
            <div
              className="w-full h-2.5 rounded-full overflow-hidden flex border border-white/15 bg-slate-950/70"
              aria-hidden="true"
            >
              <div className="w-full h-full relative timeline-segment-past">
                <div
                  className="h-full bg-sky-400"
                  style={{ width: `${Math.max(0, Math.min(100, pastFillPct))}%` }}
                />
              </div>
            </div>

            <span
              aria-hidden="true"
              className="timeline-now-pin pointer-events-none"
              style={{ left: `${pastFillPct}%` }}
            />

            <input
              id="radar-time"
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              step={1}
              value={frameIndex}
              disabled={frames.length === 0}
              aria-valuetext={`${frameClock} · ${offsetText}`}
              onChange={(event) => {
                setPlaying(false);
                const next = Number(event.target.value);
                const frame = frames[next];
                if (frame) onFrameTimeChange?.(frame.time);
              }}
              className="timeline-range-input absolute inset-0 w-full h-full m-0 cursor-pointer"
            />
          </div>

          <div
            className="flex items-center justify-between text-[0.6rem] sm:text-[0.65rem] font-medium text-slate-200 leading-none"
            aria-hidden="true"
          >
            <span>{frames[0] ? formatFrameClock(frames[0].time) : t('timePast3')}</span>
            <span>
              {frames[Math.floor(frames.length / 2)]
                ? formatFrameClock(frames[Math.floor(frames.length / 2)]!.time)
                : t('timePast1')}
            </span>
            <span className={frameOffsetMin === 0 ? 'font-bold text-sky-300' : ''}>
              {frames.at(-1) ? formatFrameClock(frames.at(-1)!.time) : t('timeNow')}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
