import { useEffect, useRef, useState } from 'react';
import { Contrast, Languages, Type } from 'lucide-react';
import { useTranslation, type MessageKey } from '../i18n.js';
import { usePreferences, type FontStep } from '../lib/preferences.js';
import { GlassTooltip, useAccessibleTooltip } from './GlassTooltip.js';

const FONT_STEPS: ReadonlyArray<{ step: FontStep; label: string; ariaKey: MessageKey }> = [
  { step: 0, label: 'ก', ariaKey: 'fontSizeNormal' },
  { step: 1, label: 'ก+', ariaKey: 'fontSizeLarge' },
  { step: 2, label: 'ก++', ariaKey: 'fontSizeXLarge' },
];

export function DisplaySettingsControls(): React.ReactNode {
  const { language, setLanguage, t } = useTranslation();
  const { fontStep, setFontStep, highContrast, toggleHighContrast } = usePreferences();

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="block text-xs font-medium text-slate-200 mb-1.5" id="font-size-group-label">
          {t('fontSizeLabel')}
        </span>
        <div
          className="grid grid-cols-3 gap-1.5"
          role="group"
          aria-labelledby="font-size-group-label"
        >
          {FONT_STEPS.map(({ step, label, ariaKey }) => {
            const active = fontStep === step;
            return (
              <button
                key={step}
                type="button"
                aria-pressed={active}
                aria-label={t(ariaKey)}
                onClick={() => setFontStep(step)}
                className={`glass-control-btn min-h-[44px] min-w-[44px] rounded-xl px-2 text-sm font-semibold ${
                  active ? 'glass-control-active' : ''
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        aria-pressed={highContrast}
        aria-label={t('highContrastAria')}
        onClick={toggleHighContrast}
        className={`glass-control-btn min-h-[44px] w-full rounded-xl px-3 flex items-center justify-between gap-2 text-sm font-medium ${
          highContrast ? 'glass-control-active' : ''
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <Contrast className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('highContrast')}</span>
        </span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/10">
          {highContrast ? t('topicOn') : t('topicOff')}
        </span>
      </button>

      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200">
          <Languages className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('languageLabel')}</span>
        </span>
        <div className="inline-flex gap-1" role="group" aria-label={t('switchLanguage')}>
          <button
            type="button"
            aria-pressed={language === 'th'}
            onClick={() => setLanguage('th')}
            className={`glass-control-btn min-h-[44px] min-w-[52px] rounded-xl px-2.5 text-xs font-semibold ${
              language === 'th' ? 'glass-control-active' : ''
            }`}
          >
            ไทย
          </button>
          <button
            type="button"
            aria-pressed={language === 'en'}
            onClick={() => setLanguage('en')}
            className={`glass-control-btn min-h-[44px] min-w-[52px] rounded-xl px-2.5 text-xs font-semibold ${
              language === 'en' ? 'glass-control-active' : ''
            }`}
          >
            EN
          </button>
        </div>
      </div>
    </div>
  );
}

export function DisplayPopover(): React.ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tip = useAccessibleTooltip(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative pointer-events-auto">
      <button
        ref={triggerRef}
        type="button"
        id="display-settings-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="display-settings-popover"
        aria-label={`${t('displaySettings')} (Aa)`}
        {...tip.triggerProps}
        onClick={() => setOpen((current) => !current)}
        className={`glass-panel min-h-[44px] min-w-[60px] px-3 rounded-2xl inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-50 hover:bg-slate-800/85 ${
          open ? 'ring-2 ring-sky-400' : ''
        }`}
      >
        <Type className="w-4 h-4 text-sky-300 shrink-0" aria-hidden="true" />
        <span>Aa</span>
      </button>
      {!open && (
        <GlassTooltip id={tip.tooltipId} open={tip.open} placement="bottom">
          {t('displaySettings')}
        </GlassTooltip>
      )}

      {open && (
        <div
          id="display-settings-popover"
          role="dialog"
          aria-label={t('displaySettings')}
          className="glass-panel absolute right-0 top-full mt-2 w-[256px] rounded-2xl p-3.5 z-50"
        >
          <DisplaySettingsControls />
        </div>
      )}
    </div>
  );
}

