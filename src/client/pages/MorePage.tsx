import {
  Activity,
  Bell,
  Calculator,
  ChevronRight,
  CloudSun,
  History,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation, type MessageKey } from '../i18n.js';

const items: ReadonlyArray<{
  to: string;
  titleKey: MessageKey;
  descKey: MessageKey;
  Icon: LucideIcon;
}> = [
  { to: '/forecast', titleKey: 'forecast', descKey: 'moreForecastDesc', Icon: CloudSun },
  { to: '/alerts', titleKey: 'alerts', descKey: 'moreAlertsDesc', Icon: Bell },
  { to: '/history', titleKey: 'history', descKey: 'moreHistoryDesc', Icon: History },
  { to: '/system-status', titleKey: 'systemStatus', descKey: 'moreStatusDesc', Icon: Activity },
  { to: '/method', titleKey: 'method', descKey: 'moreMethodDesc', Icon: Calculator },
  { to: '/settings', titleKey: 'settings', descKey: 'moreSettingsDesc', Icon: Settings },
];

/** Menu drawer index listing every former top-nav and secondary page. */
export function MorePage(): React.ReactNode {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <section className="flex flex-col gap-4" aria-labelledby="page-title">
      <div>
        <h1 id="page-title" className="text-lg font-bold text-slate-50">
          {t('menu')}
        </h1>
        <p className="text-sm text-slate-200 mt-0.5">{t('moreDescription')}</p>
      </div>
      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {items.map(({ to, titleKey, descKey, Icon }) => (
          <li key={to}>
            <Link
              className="glass-control-btn min-h-[56px] w-full rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-left no-underline"
              to={{ pathname: to, search: location.search }}
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center shrink-0 text-sky-300">
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="flex flex-col min-w-0">
                  <strong className="text-sm font-semibold text-slate-50">{t(titleKey)}</strong>
                  <span className="text-xs text-slate-200">{t(descKey)}</span>
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-slate-200 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-200 border-t border-white/10 pt-3">
        {t('footerCalibration')}
      </p>
    </section>
  );
}
