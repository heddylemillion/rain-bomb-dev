import { useEffect, useRef, useState } from 'react';
import {
  CloudRain,
  Layers,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Tornado,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { OverlayLayerId } from '../../shared/contracts.js';
import type { MockScenarioName } from '../../shared/mockWeatherScenario.js';
import { useTranslation } from '../i18n.js';
import { LEVEL_SYMBOL } from '../lib/risk.js';
import { readStorage, writeStorage } from '../lib/storage.js';
import { GlassTooltip, useAccessibleTooltip } from './GlassTooltip.js';

export type SideTopicState = 'on' | 'off' | 'unavailable';

export type SideLayerId = OverlayLayerId | 'soil';

export interface SideLayerItem {
  id: SideLayerId;
  label: string;
  description: string;
  state: SideTopicState;
  mock?: boolean;
}

const SIDEBAR_STORAGE_KEY = 'rain-burst-sidebar-expanded';

const LAYER_ICONS: Record<SideLayerId, LucideIcon> = {
  radar: CloudRain,
  lightning: Zap,
  storm: Tornado,
  soil: Layers,
};

function readInitialExpanded(): boolean {
  const isDesktop =
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true;
  if (!isDesktop) return false;
  try {
    const saved = readStorage(SIDEBAR_STORAGE_KEY);
    if (saved === '0') return false;
    if (saved === '1') return true;
  } catch {
    // Ignore storage errors
  }
  return true;
}

function SidebarLayerButton({
  item,
  expanded,
  onToggle,
}: {
  item: SideLayerItem;
  expanded: boolean;
  onToggle: (id: SideLayerId) => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const Icon = LAYER_ICONS[item.id];
  const isOn = item.state === 'on';
  const unavailable = item.state === 'unavailable';
  const tip = useAccessibleTooltip(!expanded);
  const stateLabel = isOn ? t('topicOn') : unavailable ? t('topicUnavailable') : t('topicOff');

  return (
    <div className="relative flex-1 min-w-0">
      <button
        type="button"
        data-layer-id={item.id}
        aria-pressed={isOn}
        disabled={unavailable}
        {...tip.triggerProps}
        onClick={() => onToggle(item.id)}
        className={`glass-control-btn min-h-[44px] w-full rounded-xl transition-colors flex items-center ${
          expanded ? 'justify-between px-2 py-1.5 gap-1.5' : 'justify-center px-0 min-w-[44px]'
        } ${isOn ? 'glass-control-active' : ''} ${unavailable ? 'opacity-50' : ''}`}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="relative inline-flex items-center justify-center shrink-0">
            <Icon
              className={`w-4 h-4 ${isOn ? 'text-sky-300' : 'text-slate-100'}`}
              aria-hidden="true"
            />
            {!expanded && isOn && (
              <span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-400"
                aria-hidden="true"
              />
            )}
          </span>
          {expanded ? (
            <span className="text-xs font-semibold text-slate-50 truncate">{item.label}</span>
          ) : (
            <span className="sr-only">{item.label}</span>
          )}
        </span>

        {expanded && (
          <span className="inline-flex items-center gap-1 shrink-0">
            {item.mock ? (
              <span className="px-1.5 py-0.5 rounded bg-white/15 text-[0.6rem] font-semibold text-slate-100 leading-none">
                {t('mockPill')}
              </span>
            ) : (
              <span className="text-[0.62rem] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-slate-100 leading-none">
                {isOn ? 'ON' : 'OFF'}
              </span>
            )}
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isOn ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.85)]' : 'bg-slate-400/50'
              }`}
              aria-hidden="true"
            />
          </span>
        )}
      </button>

      <GlassTooltip id={tip.tooltipId} open={tip.open} placement="right">
        <span className="font-semibold">{item.label}</span>
        {' · '}
        <span>{stateLabel}</span>
        {item.mock ? ` · ${t('mockPill')}` : ''}
      </GlassTooltip>
    </div>
  );
}

export function SideBar({
  layers,
  onToggleLayer,
  mockMode,
  scenario,
  onScenarioChange,
  radarOpacity,
  onRadarOpacityChange,
  menuOpen,
  onOpenMenu,
}: {
  layers: SideLayerItem[];
  onToggleLayer: (id: SideLayerId) => void;
  mockMode: boolean;
  scenario: MockScenarioName;
  onScenarioChange: (scenario: MockScenarioName) => void;
  radarOpacity: number;
  onRadarOpacityChange: (opacity: number) => void;
  menuOpen: boolean;
  onOpenMenu: () => void;
}): React.ReactNode {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(readInitialExpanded);
  const [radarPopoverOpen, setRadarPopoverOpen] = useState(false);
  const popoverWrapRef = useRef<HTMLDivElement>(null);
  const popoverBtnRef = useRef<HTMLButtonElement>(null);

  const expandTip = useAccessibleTooltip(true);
  const radarOptTip = useAccessibleTooltip(true);
  const menuTip = useAccessibleTooltip(!expanded);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent): void => {
      if (!event.matches) {
        setExpanded(false);
      } else {
        try {
          const saved = readStorage(SIDEBAR_STORAGE_KEY);
          setExpanded(saved === '0' ? false : true);
        } catch {
          setExpanded(true);
        }
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!radarPopoverOpen) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (popoverWrapRef.current && !popoverWrapRef.current.contains(event.target as Node)) {
        setRadarPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setRadarPopoverOpen(false);
        popoverBtnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [radarPopoverOpen]);

  const toggleExpanded = (): void => {
    setExpanded((current) => {
      const next = !current;
      if (window.matchMedia('(min-width: 768px)').matches) {
        try {
          writeStorage(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
        } catch {
          // Ignore storage errors
        }
      }
      return next;
    });
  };

  const toggleLabel = expanded ? t('sidebarCollapse') : t('sidebarExpand');

  return (
    <aside
      id="map-side-bar"
      aria-label={t('mapLayers')}
      data-expanded={expanded ? 'true' : 'false'}
      className={`relative z-30 glass-panel rounded-2xl p-1.5 flex flex-col gap-1.5 pointer-events-auto shrink-0 transition-[width] duration-150 ${
        expanded ? 'w-[196px] md:w-[208px]' : 'w-[56px] md:w-[60px]'
      }`}
    >
      <div className="relative flex items-center justify-between gap-1">
        {expanded && (
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-slate-200 pl-2 truncate">
            {t('mapLayers')}
          </span>
        )}
        <div className={`relative ${expanded ? '' : 'w-full flex justify-center'}`}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={toggleLabel}
            {...expandTip.triggerProps}
            onClick={toggleExpanded}
            className="glass-icon-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-slate-100"
          >
            {expanded ? (
              <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
          <GlassTooltip id={expandTip.tooltipId} open={expandTip.open} placement="right">
            {toggleLabel}
          </GlassTooltip>
        </div>
      </div>

      <nav aria-label={t('sideTopics')} className="flex flex-col gap-1.5">
        {layers.map((item) => {
          if (item.id === 'radar') {
            return (
              <div
                key={item.id}
                ref={popoverWrapRef}
                className={`relative flex ${expanded ? 'flex-row items-center gap-1' : 'flex-col items-center gap-1'}`}
              >
                <SidebarLayerButton item={item} expanded={expanded} onToggle={onToggleLayer} />
                <div className="relative shrink-0">
                  <button
                    ref={popoverBtnRef}
                    type="button"
                    id="radar-options-trigger"
                    aria-label={t('radarOptions')}
                    aria-expanded={radarPopoverOpen}
                    aria-haspopup="dialog"
                    aria-controls="radar-options-popover"
                    {...radarOptTip.triggerProps}
                    onClick={() => setRadarPopoverOpen((current) => !current)}
                    className={`glass-control-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-slate-100 ${
                      radarPopoverOpen ? 'glass-control-active' : ''
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {!radarPopoverOpen && (
                    <GlassTooltip id={radarOptTip.tooltipId} open={radarOptTip.open} placement="right">
                      {t('radarOptions')}
                    </GlassTooltip>
                  )}
                </div>

                {radarPopoverOpen && (
                  <div
                    id="radar-options-popover"
                    role="dialog"
                    aria-label={t('radarOptions')}
                    className="glass-panel absolute left-full top-0 ml-2.5 w-[min(280px,calc(100vw-84px))] max-h-[70dvh] overflow-y-auto rounded-2xl p-3.5 z-50 flex flex-col gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-100 mb-1.5">
                        <label htmlFor="mock-radar-opacity">{t('mockRadarOpacity')}</label>
                        <span>{Math.round(radarOpacity * 100)}%</span>
                      </div>
                      <input
                        id="mock-radar-opacity"
                        type="range"
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={radarOpacity}
                        aria-valuetext={`${Math.round(radarOpacity * 100)}%`}
                        onChange={(event) => onRadarOpacityChange(Number(event.target.value))}
                        className="w-full min-h-[32px] accent-sky-400 cursor-pointer"
                      />
                    </div>

                    {mockMode && (
                      <div>
                        <label
                          htmlFor="mock-scenario"
                          className="block text-xs font-semibold text-slate-100 mb-1.5"
                        >
                          {t('mockScenarioLabel')}
                        </label>
                        <select
                          id="mock-scenario"
                          value={scenario}
                          onChange={(event) => {
                            const next = event.target.value;
                            if (next === 'calm' || next === 'moderate' || next === 'burst') {
                              onScenarioChange(next);
                            }
                          }}
                          className="glass-select w-full min-h-[44px] rounded-xl px-2.5 text-xs font-semibold"
                        >
                          <option value="calm">{t('scenarioCalm')}</option>
                          <option value="moderate">{t('scenarioModerate')}</option>
                          <option value="burst">{t('scenarioBurst')}</option>
                        </select>
                      </div>
                    )}

                    <div className="border-t border-white/10 pt-2.5 flex flex-col gap-2">
                      <span className="text-xs font-semibold text-slate-100">
                        {t('mockRadarLegend')}
                      </span>
                      <div className="radar-ramp-bar h-2.5 w-full rounded-full" aria-hidden="true" />
                      <div className="flex justify-between text-[0.65rem] font-medium text-slate-200">
                        <span>0</span>
                        <span>2</span>
                        <span>12</span>
                        <span>25</span>
                        <span>40</span>
                        <span>60+</span>
                      </div>

                      <div className="text-[0.68rem] text-slate-200 flex flex-col gap-1 pt-1">
                        <div>
                          <strong className="text-slate-100">{t('layerLightning')}:</strong>{' '}
                          {t('mockAgeRecent')} · {t('mockAgeMid')} · {t('mockAgeOld')}
                        </div>
                        <div>
                          <strong className="text-slate-100">{t('layerStormTrack')}:</strong> +30..+180
                          นาที · {t('coneOfUncertainty')}
                        </div>
                      </div>

                      <div className="border-t border-white/10 pt-2 flex items-center justify-between gap-1 text-[0.68rem] font-semibold">
                        <span className="risk-pill risk-pill-high px-2 py-0.5 rounded-md">
                          {LEVEL_SYMBOL.HIGH} {t('riskHigh')}
                        </span>
                        <span className="risk-pill risk-pill-medium px-2 py-0.5 rounded-md">
                          {LEVEL_SYMBOL.MEDIUM} {t('riskMedium')}
                        </span>
                        <span className="risk-pill risk-pill-low px-2 py-0.5 rounded-md">
                          {LEVEL_SYMBOL.LOW} {t('riskLow')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          return (
            <SidebarLayerButton
              key={item.id}
              item={item}
              expanded={expanded}
              onToggle={onToggleLayer}
            />
          );
        })}
      </nav>

      {!expanded && mockMode && (
        <div className="text-center">
          <span className="inline-block px-1.5 py-0.5 rounded bg-white/15 text-[0.58rem] font-semibold text-slate-100 leading-none">
            {t('mockPill')}
          </span>
        </div>
      )}

      <div className="border-t border-white/10 pt-1.5 mt-0.5 relative">
        <button
          type="button"
          data-menu-trigger="true"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls="app-drawer"
          {...menuTip.triggerProps}
          onClick={onOpenMenu}
          className={`glass-control-btn min-h-[44px] w-full rounded-xl flex items-center ${
            expanded ? 'justify-start px-2.5 gap-2' : 'justify-center px-0 min-w-[44px]'
          } ${menuOpen ? 'glass-control-active' : ''}`}
        >
          <Menu className="w-4 h-4 text-sky-300 shrink-0" aria-hidden="true" />
          {expanded ? (
            <span className="text-xs font-semibold text-slate-50">{t('menu')}</span>
          ) : (
            <span className="sr-only">{t('menu')}</span>
          )}
        </button>
        <GlassTooltip id={menuTip.tooltipId} open={menuTip.open} placement="right">
          {t('menu')}
        </GlassTooltip>
      </div>
    </aside>
  );
}
