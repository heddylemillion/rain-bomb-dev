import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from '../i18n.js';

const primaryRoutes = [
  { to: '/', key: 'overview' },
  { to: '/forecast', key: 'forecast' },
  { to: '/alerts', key: 'alerts' },
  { to: '/history', key: 'history' },
  { to: '/more', key: 'more' },
] as const;

const secondaryRoutes = [
  { to: '/system-status', key: 'systemStatus' },
  { to: '/method', key: 'method' },
  { to: '/settings', key: 'settings' },
] as const;

const allRoutes = [...primaryRoutes, ...secondaryRoutes] as const;

export function AppShell(): React.ReactNode {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t('skipToContent')}
      </a>

      <header className="site-header">
        <div className="topbar">
          <NavLink className="brand-lockup" to="/" aria-label={`${t('brandTitle')} — ${t('brandSubtitle')}`}>
            <span className="brand-mark" aria-hidden="true">RB</span>
            <span>
              <strong>{t('brandTitle')}</strong>
              <small>{t('brandSubtitle')}</small>
            </span>
          </NavLink>
          <button
            className="language-toggle"
            type="button"
            aria-label={t('switchLanguage')}
            onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
          >
            {language === 'th' ? 'TH · EN' : 'EN · TH'}
          </button>
        </div>
        <nav className="site-navigation" aria-label={t('brandSubtitle')}>
          <div className="site-navigation-inner">
            {allRoutes.map(({ to, key }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `site-nav-link${isActive ? ' site-nav-link-active' : ''}`}
              >
                {t(key)}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="main-content-inner">
          <Outlet />
          <p className="disclaimer">{t('decisionSupport')}</p>
        </div>
      </main>
    </div>
  );
}
