import { useLocation } from 'react-router-dom';
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
    <section className="page-stack" aria-labelledby="page-title">
      <div className="page-heading">
        <p className="eyebrow">RAIN BURST EARLY WARNING</p>
        <h1 id="page-title">{t(titleKey)}</h1>
      </div>
      <div className="surface-card placeholder-card">
        <span className="placeholder-symbol" aria-hidden="true">···</span>
        <h2>{t('pagePending')}</h2>
        <p>{t('pagePendingDescription')}</p>
      </div>
    </section>
  );
}
