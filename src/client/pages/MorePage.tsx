import { Link } from 'react-router-dom';
import { useTranslation, type MessageKey } from '../i18n.js';

const items: ReadonlyArray<{ to: string; titleKey: MessageKey; descKey: MessageKey; icon: string }> = [
  { to: '/history', titleKey: 'history', descKey: 'moreHistoryDesc', icon: '🕘' },
  { to: '/system-status', titleKey: 'systemStatus', descKey: 'moreStatusDesc', icon: '✔' },
  { to: '/method', titleKey: 'method', descKey: 'moreMethodDesc', icon: '?' },
  { to: '/settings', titleKey: 'settings', descKey: 'moreSettingsDesc', icon: '⚙' },
];

/** "เพิ่มเติม": a plain list of large rows, each with a one-line description. */
export function MorePage(): React.ReactNode {
  const { t } = useTranslation();
  return (
    <section className="page-stack" aria-labelledby="page-title">
      <div className="page-heading">
        <h1 id="page-title">{t('moreTitle')}</h1>
        <p>{t('moreDescription')}</p>
      </div>
      <ul className="more-list">
        {items.map(({ to, titleKey, descKey, icon }) => (
          <li key={to}>
            <Link className="more-row" to={to}>
              <span className="more-icon" aria-hidden="true">{icon}</span>
              <span className="more-text">
                <strong>{t(titleKey)}</strong>
                <span>{t(descKey)}</span>
              </span>
              <span className="more-chevron" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
