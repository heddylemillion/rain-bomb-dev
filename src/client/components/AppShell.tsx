import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { useTranslation, type MessageKey } from '../i18n.js';
import { usePreferences, type FontStep } from '../lib/preferences.js';

/** Core navigation: 4 items maximum, always visible with text labels. */
const primaryRoutes = [
  { to: '/', key: 'navMap' },
  { to: '/forecast', key: 'forecast' },
  { to: '/alerts', key: 'alerts' },
  { to: '/more', key: 'more' },
] as const satisfies ReadonlyArray<{ to: string; key: MessageKey }>;

const fontSteps: ReadonlyArray<{ step: FontStep; label: string; ariaKey: MessageKey }> = [
  { step: 0, label: 'ก', ariaKey: 'fontSizeNormal' },
  { step: 1, label: 'ก+', ariaKey: 'fontSizeLarge' },
  { step: 2, label: 'ก++', ariaKey: 'fontSizeXLarge' },
];

export function AppShell(): React.ReactNode {
  const { language, setLanguage, t } = useTranslation();
  const { fontStep, setFontStep, highContrast, toggleHighContrast } = usePreferences();
  const isMapRoute = useMatch({ path: '/', end: true }) !== null;

  return (
    <div className={`app-shell${isMapRoute ? ' app-shell-map' : ''}`}>
      <a className="skip-link" href="#main-content">
        {t('skipToContent')}
      </a>

      <header className="site-header">
        <div className="topbar">
          <NavLink className="brand-lockup" to="/" aria-label={`${t('brandTitle')} — ${t('brandSubtitle')}`}>
            <span className="brand-mark" aria-hidden="true">RB</span>
            <span className="brand-text">
              <strong>{t('brandTitle')}</strong>
              <small>{t('brandSubtitle')}</small>
            </span>
          </NavLink>

          <div className="header-tools">
            <div className="font-toggle" role="group" aria-label={t('fontSizeLabel')}>
              {fontSteps.map(({ step, label, ariaKey }) => (
                <button
                  key={step}
                  type="button"
                  className="tool-button font-button"
                  aria-pressed={fontStep === step}
                  aria-label={t(ariaKey)}
                  title={t(ariaKey)}
                  onClick={() => setFontStep(step)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="tool-button contrast-button"
              aria-pressed={highContrast}
              aria-label={t('highContrastAria')}
              onClick={toggleHighContrast}
            >
              <span aria-hidden="true">◐</span> {t('highContrast')}
            </button>
            <button
              className="tool-button language-toggle"
              type="button"
              aria-label={t('switchLanguage')}
              onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
            >
              {language === 'th' ? 'TH · EN' : 'EN · TH'}
            </button>
          </div>
        </div>

        <nav className="site-navigation" aria-label={t('navAriaLabel')}>
          <ul className="site-navigation-inner">
            {primaryRoutes.map(({ to, key }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `site-nav-link${isActive ? ' site-nav-link-active' : ''}`}
                >
                  {t(key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main-content" className={`main-content${isMapRoute ? ' main-content-map' : ''}`} tabIndex={-1}>
        {isMapRoute ? (
          <Outlet />
        ) : (
          <div className="main-content-inner">
            <Outlet />
          </div>
        )}
      </main>

      <footer className="site-footer">
        <p className="disclaimer">{isMapRoute ? t('decisionSupportShort') : t('decisionSupport')}</p>
        {!isMapRoute && <p className="disclaimer disclaimer-note">{t('footerCalibration')}</p>}
        {isMapRoute && (
          <p className="disclaimer disclaimer-note">
            <a className="footer-link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              {t('mapAttribution')}
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}
