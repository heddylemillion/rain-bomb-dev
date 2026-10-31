import { useLocation } from 'react-router-dom';
import { DisplaySettingsControls } from '../components/DisplayPopover.js';
import { useTranslation, type MessageKey } from '../i18n.js';

const pageKeyByPath: Readonly<Record<string, MessageKey>> = {
  '/': 'pageOverview',
  '/forecast': 'pageForecast',
  '/alerts': 'pageAlerts',
  '/history': 'pageHistory',
  '/more': 'pageMore',
  '/method': 'method',
  '/settings': 'settings',
};

export function ModulePlaceholderPage(): React.ReactNode {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const titleKey = pageKeyByPath[pathname] ?? 'pageMore';

  return (
    <section className="flex flex-col gap-4" aria-labelledby="page-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
          RAIN BURST EARLY WARNING
        </p>
        <h1 id="page-title" className="text-lg font-bold text-slate-50 mt-1">
          {t(titleKey)}
        </h1>
      </div>
      {pathname === '/settings' && (
        <div className="glass-subcard rounded-2xl p-4">
          <DisplaySettingsControls />
        </div>
      )}
      <div className="glass-subcard rounded-2xl p-4 flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-50">{t('pagePending')}</h2>
        <p className="text-sm text-slate-200">{t('pagePendingDescription')}</p>
      </div>
    </section>
  );
}
