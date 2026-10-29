import { useEffect, useRef, useState } from 'react';
import type { Capability, Community, OverlayLayerId } from '../../shared/contracts.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import { formatClock, LEVEL_SYMBOL, type RiskLevel } from '../lib/risk.js';

/* ---------------------------------------------------------------- picker */

export function CommunityPicker({
  communities,
  selectedId,
  onChange,
}: {
  communities: Community[];
  selectedId: string | null;
  onChange: (id: string) => void;
}): React.ReactNode {
  const { t, language } = useTranslation();
  return (
    <div className="map-panel picker-panel">
      <label className="picker-label" htmlFor="community-select">
        {t('yourCommunity')}
      </label>
      <div className="select-wrap">
        <select
          id="community-select"
          className="picker-select"
          value={selectedId ?? ''}
          onChange={(event) => {
            if (event.target.value) {
              onChange(event.target.value);
            }
          }}
        >
          <option value="" disabled>
            {t('chooseCommunity')}
          </option>
          {communities.map((community) => (
            <option key={community.id} value={community.id}>
              {language === 'th' ? community.name_th : community.name_en}
            </option>
          ))}
        </select>
        <span className="select-caret" aria-hidden="true">▾</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- first visit */

export function FirstVisitPrompt({
  communities,
  onChoose,
}: {
  communities: Community[];
  onChoose: (id: string) => void;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstButton.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="first-visit-backdrop">
      <div className="first-visit-card" role="dialog" aria-labelledby="first-visit-title">
        <h2 id="first-visit-title">{t('chooseCommunity')}</h2>
        <p>{t('chooseCommunityHint')}</p>
        <ul className="first-visit-list">
          {communities.map((community, index) => (
            <li key={community.id}>
              <button
                ref={index === 0 ? firstButton : undefined}
                type="button"
                className="big-choice"
                onClick={() => onChoose(community.id)}
              >
                {language === 'th' ? community.name_th : community.name_en}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- layer panel */

export type MapLayerId = 'risk' | OverlayLayerId;

const LAYER_LABEL: Record<MapLayerId, MessageKey> = {
  risk: 'layerRisk',
  radar: 'layerRadar',
  lightning: 'layerLightning',
  storm: 'layerStorm',
};

const LAYER_ICON: Record<MapLayerId, string> = {
  risk: '▲',
  radar: '☔',
  lightning: '⚡',
  storm: '🌀',
};

export interface LayerAvailability {
  id: MapLayerId;
  available: boolean;
  reason: Capability['reason'];
  updatedAt: string | null;
  mock?: boolean;
}

function unavailableText(reason: Capability['reason']): MessageKey {
  if (reason === 'no_plan') {
    return 'layerNoPlan';
  }
  if (reason === 'no_coverage') {
    return 'layerNoCoverage';
  }
  return 'layerUnavailable';
}

export function LayerPanel({
  layers,
  active,
  onToggle,
  defaultOpen,
  mockMode = false,
  scenario = 'moderate',
  onScenarioChange,
  mockOverlays = new Set(),
}: {
  layers: LayerAvailability[];
  active: ReadonlySet<MapLayerId>;
  onToggle: (id: MapLayerId) => void;
  defaultOpen: boolean;
  mockMode?: boolean;
  scenario?: 'calm' | 'moderate' | 'burst';
  onScenarioChange?: (name: 'calm' | 'moderate' | 'burst') => void;
  mockOverlays?: ReadonlySet<OverlayLayerId>;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`map-panel layer-panel${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="layer-toggle"
        aria-expanded={open}
        aria-controls="layer-list"
        onClick={() => setOpen((value) => !value)}
      >
        {t('mapLayers')}
        {mockMode && mockOverlays.size > 0 && <span className="mock-map-badge">{t('mockMapBadge')}</span>}
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <ul id="layer-list" className="layer-list" aria-label={t('mapLayers')}>
        {layers.map(({ id, available, reason, updatedAt, mock }) => {
          const on = active.has(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={`layer-button${on ? ' layer-on' : ''}`}
                aria-pressed={on}
                disabled={!available}
                onClick={() => onToggle(id)}
              >
                <span className="layer-icon" aria-hidden="true">{LAYER_ICON[id]}</span>
                <span className="layer-text">
                  <span className="layer-name">{t(LAYER_LABEL[id])}</span>
                  <span className="layer-state">
                    {available ? (on ? `✓ ${t('layerOn')}` : t('layerOff')) : t(unavailableText(reason))}
                    {mock && <span className="mock-layer-pill">{t('mockPill')}</span>}
                    {mock && on && (
                      <span className="layer-updated"> · {t('mockUpdated')} {formatClock(updatedAt ?? new Date().toISOString(), language)}</span>
                    )}
                    {!mock && updatedAt && <span className="layer-updated"> · {t('updatedAt')} {formatClock(updatedAt, language)}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {mockMode && onScenarioChange && (
        <div className="scenario-control">
          <label htmlFor="mock-scenario">{t('mockScenarioLabel')}</label>
          <select
            id="mock-scenario"
            value={scenario}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'calm' || next === 'moderate' || next === 'burst') onScenarioChange(next);
            }}
          >
            <option value="calm">{t('scenarioCalm')}</option>
            <option value="moderate">{t('scenarioModerate')}</option>
            <option value="burst">{t('scenarioBurst')}</option>
          </select>
          <details className="mock-layer-legend">
            <summary>{t('mockLegendTitle')}</summary>
            {mockOverlays.has('radar') && (
              <div>
                <strong>{t('mockRadarLegend')}</strong>
                <div className="mock-radar-ramp"><span>0.2</span><span>2</span><span>5</span><span>10</span><span>20</span><span>40+</span></div>
              </div>
            )}
            {mockOverlays.has('lightning') && (
              <div><strong>{t('mockLightningLegend')}</strong><p>⚡ {t('mockAgeRecent')} · ⚡ {t('mockAgeMid')} · ⚡ {t('mockAgeOld')}</p></div>
            )}
            {mockOverlays.has('storm') && (
              <div><strong>{t('mockStormLegend')}</strong><p>⛈ {t('mockStormPathHint')}</p></div>
            )}
          </details>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- controls */

export function MapControls({
  onZoomIn,
  onZoomOut,
  onLocate,
  locating,
  locateMessage,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  locating: boolean;
  locateMessage: string | null;
}): React.ReactNode {
  const { t } = useTranslation();
  return (
    <div className="map-controls">
      <div className="map-controls-row">
        <button type="button" className="map-button zoom-button" aria-label={t('zoomInAria')} onClick={onZoomIn}>
          <span aria-hidden="true">+</span>
          <span className="zoom-word">{t('zoomInShort')}</span>
        </button>
        <button type="button" className="map-button zoom-button" aria-label={t('zoomOutAria')} onClick={onZoomOut}>
          <span aria-hidden="true">−</span>
          <span className="zoom-word">{t('zoomOutShort')}</span>
        </button>
        <button type="button" className="map-button locate-button" onClick={onLocate} aria-busy={locating}>
          <span aria-hidden="true">◎</span> {t('myLocation')}
        </button>
      </div>
      {locateMessage && (
        <p className="locate-message" role="status">
          {locateMessage}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- legend */

export function Legend({ defaultOpen }: { defaultOpen: boolean }): React.ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const levels: ReadonlyArray<{ level: RiskLevel; key: MessageKey }> = [
    { level: 'HIGH', key: 'riskHigh' },
    { level: 'MEDIUM', key: 'riskMedium' },
    { level: 'LOW', key: 'riskLow' },
  ];
  return (
    <div className="map-panel legend-panel">
      <button
        type="button"
        className="legend-toggle"
        aria-expanded={open}
        aria-controls="legend-list"
        onClick={() => setOpen((value) => !value)}
      >
        {t('legendTitle')} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        <span className="sr-only"> — {open ? t('legendToggleHide') : t('legendToggleShow')}</span>
      </button>
      {open && (
        <ul id="legend-list" className="legend-list" aria-label={t('mapLegend')}>
          {levels.map(({ level, key }) => (
            <li key={level} className={`legend-entry legend-${level.toLowerCase()}`}>
              <span className="legend-symbol" aria-hidden="true">{LEVEL_SYMBOL[level]}</span>
              {t(key)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- time slider */

const RADAR_HOURS = [-3, -2, -1, 0] as const;
const HOUR_LABEL: Record<number, MessageKey> = {
  [-3]: 'timePast3',
  [-2]: 'timePast2',
  [-1]: 'timePast1',
  0: 'timeNow',
};

const NOW_INDEX = RADAR_HOURS.indexOf(0);
const PLAY_INTERVAL_MS = 1400;

/** Radar time slider. Playback only starts when the user presses "เล่น" (no autoplay). */
export function RadarSlider({
  hours,
  onChange,
  mockMode = false,
  minutes = 0,
  onMinutesChange,
  opacity = 0.7,
  onOpacityChange,
}: {
  hours: number;
  onChange: (hours: number) => void;
  mockMode?: boolean;
  minutes?: number;
  onMinutesChange?: (minutes: number) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const reduceMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const index = Math.max(0, RADAR_HOURS.indexOf(hours as (typeof RADAR_HOURS)[number]));
  const indexRef = useRef(index);
  indexRef.current = index;
  const minuteIndex = Math.max(0, Math.min(36, Math.round((minutes + 180) / 10)));
  const minuteIndexRef = useRef(minuteIndex);
  minuteIndexRef.current = minuteIndex;

  useEffect(() => {
    const updateVisibility = (): void => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!playing || !visible || (mockMode && reduceMotion.current)) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (mockMode) {
        const next = (minuteIndexRef.current + 1) % 37;
        onMinutesChange?.(next * 10 - 180);
        return;
      }
      const next = (indexRef.current + 1) % RADAR_HOURS.length;
      onChange(RADAR_HOURS[next] ?? 0);
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [mockMode, onChange, onMinutesChange, playing, visible]);

  const currentLabel = t(HOUR_LABEL[hours] ?? 'timeNow');
  const mockTime = new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(Date.now() + minutes * 60_000));
  return (
    <div className="map-panel slider-panel">
      <div className="slider-row">
        <button
          type="button"
          className="map-button play-button"
          aria-pressed={playing}
          disabled={mockMode && reduceMotion.current}
          onClick={() => setPlaying((value) => !value)}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span> {playing ? t('timePause') : t('timePlay')}
        </button>
        <div className="slider-main">
          <label htmlFor="radar-time" className="slider-title">
            {mockMode ? t('mockTimelineLabel') : t('timeSliderLabel')}: <strong>{mockMode ? `${minutes > 0 ? '+' : ''}${minutes} นาที · ${mockTime}` : currentLabel}</strong>
          </label>
          <input
            id="radar-time"
            type="range"
            className="slider-input"
            min={mockMode ? 0 : 0}
            max={mockMode ? 36 : RADAR_HOURS.length - 1}
            step={mockMode ? 1 : 1}
            value={mockMode ? minuteIndex : index}
            aria-valuetext={mockMode ? `${minutes} นาที · ${mockTime}` : currentLabel}
            onChange={(event) => {
              setPlaying(false);
              if (mockMode) onMinutesChange?.(Number(event.target.value) * 10 - 180);
              else onChange(RADAR_HOURS[Number(event.target.value)] ?? 0);
            }}
          />
          <div className="slider-ticks" aria-hidden="true">
            {mockMode ? (
              <>
                <span>−3 ชม.</span>
                <span style={{ fontWeight: minutes === 0 ? 800 : 500 }}>{t('timeNow')}</span>
                <span>+3 ชม.</span>
              </>
            ) : (
              <>
                <span>{t('timePast3')}</span>
                <span>{t('timePast1')}</span>
                <span style={{ fontWeight: index === NOW_INDEX ? 800 : 500 }}>{t('timeNow')}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {mockMode ? (
        <>
          <p className="slider-note">{t('mockStepLabel')}</p>
          <div className="mock-radar-opacity">
            <label htmlFor="mock-radar-opacity">{t('mockRadarOpacity')}</label>
            <input
              id="mock-radar-opacity"
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => onOpacityChange?.(Number(event.target.value))}
              aria-valuetext={`${Math.round(opacity * 100)}%`}
            />
            <span>{Math.round(opacity * 100)}%</span>
          </div>
        </>
      ) : (
        <p className="slider-note">{t('radarPastOnly')} · {t('radarTilesUnverified')} · Xweather</p>
      )}
    </div>
  );
}
