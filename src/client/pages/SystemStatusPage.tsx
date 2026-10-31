import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert } from 'lucide-react';
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
    mock: 'reasonMock',
  } as const;

  return (
    <article className="glass-subcard rounded-2xl p-3.5 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-50">
          {t(capabilityTitleKeyById[capability.id])}
        </h2>
        <span
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold shrink-0 ${
            capability.available
              ? 'bg-sky-500/20 text-sky-200 border border-sky-400/30'
              : 'bg-white/10 text-slate-200 border border-white/15'
          }`}
        >
          {capability.available ? (
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {capability.available ? t('available') : t('unavailable')}
        </span>
      </div>
      <p className="text-xs text-slate-200">{t(reasonKey[capability.reason])}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-200">
        <span>
          {t('dataSource')}: {t('capabilityApiSource')}
        </span>
        <span>
          {t('updatedAt')} {formatTime(capability.checkedAt, language)}
        </span>
        {isStale && (
          <span className="font-semibold text-sky-200" role="status">
            {t('staleNotice')}
          </span>
        )}
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
      <section className="flex flex-col gap-4" aria-busy="true">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
            RAIN BURST EARLY WARNING
          </p>
          <h1 id="page-title" className="text-lg font-bold text-slate-50 mt-1">
            {t('statusTitle')}
          </h1>
        </div>
        <div className="glass-subcard rounded-2xl p-4" role="status">
          <p className="text-sm text-slate-200">{t('loading')}</p>
        </div>
      </section>
    );
  }

  if (query.isError && !query.data) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="page-title">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
            RAIN BURST EARLY WARNING
          </p>
          <h1 id="page-title" className="text-lg font-bold text-slate-50 mt-1">
            {t('statusTitle')}
          </h1>
        </div>
        <div className="glass-subcard rounded-2xl p-4" role="alert">
          <h2 className="text-base font-semibold text-slate-50">{t('loadFailed')}</h2>
          <p className="text-sm text-slate-200 mt-1">{t('loadFailedDescription')}</p>
        </div>
      </section>
    );
  }

  const result = query.data;
  if (!result) {
    return (
      <section className="flex flex-col gap-4">
        <h1 id="page-title" className="text-lg font-bold text-slate-50">
          {t('statusTitle')}
        </h1>
        <div className="glass-subcard rounded-2xl p-4">
          <p className="text-sm text-slate-200">{t('noCapabilities')}</p>
        </div>
      </section>
    );
  }

  const stale = Date.now() - new Date(result.checkedAt).getTime() > 15 * 60 * 1000;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="page-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
          RAIN BURST EARLY WARNING
        </p>
        <h1 id="page-title" className="text-lg font-bold text-slate-50 mt-1">
          {t('statusTitle')}
        </h1>
        <p className="text-sm text-slate-200 mt-0.5">{t('statusDescription')}</p>
      </div>

      {stale && (
        <div className="glass-subcard rounded-2xl p-3" role="status">
          <p className="text-xs text-sky-200">{t('staleNotice')}</p>
        </div>
      )}

      {result.capabilities.length === 0 ? (
        <div className="glass-subcard rounded-2xl p-4">
          <p className="text-sm text-slate-200">{t('noCapabilities')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {result.capabilities.map((capability) => (
            <CapabilityCard key={capability.id} capability={capability} />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-200 border-t border-white/10 pt-3">
        {t('dataSource')}: API · {t('updatedAt')} {formatTime(result.checkedAt, language)}
      </p>
    </section>
  );
}
