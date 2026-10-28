import { useQuery } from '@tanstack/react-query';
import { fetchCapabilities } from '../api/capabilities.js';
import { capabilityTitleKeyById, useTranslation } from '../i18n.js';
import type { Capability } from '../../shared/contracts.js';

function formatTime(value: string, language: 'th' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function CapabilityCard({
  capability,
}: {
  capability: Capability;
}): React.ReactNode {
  const { language, t } = useTranslation();
  const isStale = Date.now() - new Date(capability.checkedAt).getTime() > 15 * 60 * 1000;
  const reasonKey = {
    ok: 'reasonOk',
    no_plan: 'reasonNoPlan',
    no_coverage: 'reasonNoCoverage',
    error: 'reasonError',
  } as const;

  return (
    <article className="capability-card surface-card">
      <div className="capability-card-heading">
        <h2>{t(capabilityTitleKeyById[capability.id])}</h2>
        <span className={`status-pill ${capability.available ? 'status-available' : 'status-unavailable'}`}>
          <span aria-hidden="true">{capability.available ? '✓' : '!'}</span>
          {capability.available ? t('available') : t('unavailable')}
        </span>
      </div>
      <p className="capability-reason">{t(reasonKey[capability.reason])}</p>
      <div className="card-meta">
        <span>{t('dataSource')}: {t('capabilityApiSource')}</span>
        <span>{t('updatedAt')} {formatTime(capability.checkedAt, language)}</span>
        {isStale && <span className="stale-inline" role="status">{t('staleNotice')}</span>}
      </div>
    </article>
  );
}

export function SystemStatusPage(): React.ReactNode {
  const { language, t } = useTranslation();
  const query = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => fetchCapabilities(signal),
  });

  if (query.isPending) {
    return (
      <section className="page-stack" aria-busy="true">
        <div className="page-heading">
          <p className="eyebrow">RAIN BURST EARLY WARNING</p>
          <h1>{t('statusTitle')}</h1>
        </div>
        <div className="surface-card loading-card" role="status">
          <span className="skeleton-line skeleton-title" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-short" />
          <span className="sr-only">{t('loading')}</span>
        </div>
      </section>
    );
  }

  if (query.isError && !query.data) {
    return (
      <section className="page-stack" aria-labelledby="page-title">
        <div className="page-heading">
          <p className="eyebrow">RAIN BURST EARLY WARNING</p>
          <h1 id="page-title">{t('statusTitle')}</h1>
        </div>
        <div className="state-card state-error" role="alert">
          <h2>{t('loadFailed')}</h2>
          <p>{t('loadFailedDescription')}</p>
        </div>
      </section>
    );
  }

  const result = query.data;
  if (!result) {
    return (
      <section className="page-stack">
        <div className="page-heading">
          <p className="eyebrow">RAIN BURST EARLY WARNING</p>
          <h1>{t('statusTitle')}</h1>
        </div>
        <div className="state-card"><p>{t('noCapabilities')}</p></div>
      </section>
    );
  }

  const stale = Date.now() - new Date(result.checkedAt).getTime() > 15 * 60 * 1000;

  return (
    <section className="page-stack" aria-labelledby="page-title">
      <div className="page-heading">
        <p className="eyebrow">RAIN BURST EARLY WARNING</p>
        <h1 id="page-title">{t('statusTitle')}</h1>
        <p>{t('statusDescription')}</p>
      </div>

      {stale && (
        <div className="notice notice-stale" role="status">
          <p>{t('staleNotice')}</p>
        </div>
      )}

      {result.capabilities.length === 0 ? (
        <div className="state-card">
          <p>{t('noCapabilities')}</p>
        </div>
      ) : (
        <div className="capability-grid">
          {result.capabilities.map((capability) => (
            <CapabilityCard
              key={capability.id}
              capability={capability}
            />
          ))}
        </div>
      )}

      <p className="source-note">
        {t('dataSource')}: API
        {' · '}
        {t('updatedAt')} {formatTime(result.checkedAt, language)}
      </p>
    </section>
  );
}
