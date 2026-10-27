import { useEffect, useRef, useState } from 'react';
import type { Capability, Community, OverlayLayerId } from '../../shared/contracts.js';
import { RADAR_OFFSET_HOURS } from '../../shared/contracts.js';
import { useTranslation, type MessageKey } from '../i18n.js';
import { LEVEL_SYMBOL, type RiskLevel } from '../lib/risk.js';

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
  soil: 'layerSoil',
};

const LAYER_ICON: Record<MapLayerId, string> = {
  risk: '▲',
  radar: '☔',
  lightning: '⚡',
  storm: '🌀',
  soil: '🌱',
};

export interface LayerAvailability {
  id: MapLayerId;
  available: boolean;
  reason: Capability['reason'];
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
}: {
  layers: LayerAvailability[];
  active: ReadonlySet<MapLayerId>;
  onToggle: (id: MapLayerId) => void;
  defaultOpen: boolean;
}): React.ReactNode {
  const { t } = useTranslation();
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
        {t('mapLayers')} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <ul id="layer-list" className="layer-list" aria-label={t('mapLayers')}>
        {layers.map(({ id, available, reason }) => {
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
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
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

const HOUR_LABEL: Record<number, MessageKey> = {
  [-3]: 'timePast3',
  [-2]: 'timePast2',
  [-1]: 'timePast1',
  0: 'timeNow',
  1: 'timeNext1',
  2: 'timeNext2',
  3: 'timeNext3',
};

const NOW_INDEX = RADAR_OFFSET_HOURS.indexOf(0);
const PLAY_INTERVAL_MS = 1400;

/** Radar time slider. Playback only starts when the user presses "เล่น" (no autoplay). */
export function RadarSlider({
  hours,
  onChange,
}: {
  hours: number;
  onChange: (hours: number) => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const index = Math.max(0, RADAR_OFFSET_HOURS.indexOf(hours as (typeof RADAR_OFFSET_HOURS)[number]));
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const next = (indexRef.current + 1) % RADAR_OFFSET_HOURS.length;
      onChange(RADAR_OFFSET_HOURS[next] ?? 0);
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [onChange, playing]);

  const currentLabel = t(HOUR_LABEL[hours] ?? 'timeNow');
  return (
    <div className="map-panel slider-panel">
      <div className="slider-row">
        <button
          type="button"
          className="map-button play-button"
          aria-pressed={playing}
          onClick={() => setPlaying((value) => !value)}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span> {playing ? t('timePause') : t('timePlay')}
        </button>
        <div className="slider-main">
          <label htmlFor="radar-time" className="slider-title">
            {t('timeSliderLabel')}: <strong>{currentLabel}</strong>
          </label>
          <input
            id="radar-time"
            type="range"
            className="slider-input"
            min={0}
            max={RADAR_OFFSET_HOURS.length - 1}
            step={1}
            value={index}
            aria-valuetext={currentLabel}
            onChange={(event) => {
              setPlaying(false);
              onChange(RADAR_OFFSET_HOURS[Number(event.target.value)] ?? 0);
            }}
          />
          <div className="slider-ticks" aria-hidden="true">
            <span>{t('timePast3')}</span>
            <span style={{ fontWeight: index === NOW_INDEX ? 800 : 500 }}>{t('timeNow')}</span>
            <span>{t('timeNext3')}</span>
          </div>
        </div>
      </div>
      <p className="slider-note">{t('radarTilesUnverified')} · Xweather</p>
    </div>
  );
}
