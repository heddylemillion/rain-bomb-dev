import { useQuery } from '@tanstack/react-query';
import { fetchProviderStatus } from '../api/providers.js';
import { useTranslation } from '../i18n.js';
import type { ProviderStatus } from '../../shared/providerContracts.js';

function formatTime(value: string | null, language: 'th' | 'en'): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function ProviderStatusCard({ provider }: { provider: ProviderStatus }): React.ReactNode {
  const { language, t } = useTranslation();
  const coverageKey = {
    available: 'coverageAvailable',
    none: 'coverageNone',
    unknown: 'coverageUnknown',
    'not-tested': 'coverageUntested',
  } as const;
  const quota = provider.quotaLimit === null
    ? `${provider.quotaUsed} · ${t('noPublishedQuota')}`
    : `${provider.quotaUsed} / ${provider.quotaLimit}`;

  return (
    <article className="glass-subcard rounded-2xl p-3.5 flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-50">{provider.provider}</h2>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-200">
        <span>{t('providerMode')}</span><span>{provider.mode}</span>
        <span>{t('coverageTest')}</span><span>{t(coverageKey[provider.coverage])}</span>
        <span>{t('lastSuccess')}</span><span>{formatTime(provider.lastSuccess, language)}</span>
        <span>{t('quotaUse')}</span><span>{quota}</span>
        <span>{t('attribution')}</span>
        <a className="underline hover:text-sky-300" href={provider.attributionUrl} target="_blank" rel="noopener noreferrer">
          {provider.attribution}
        </a>
      </div>
      <p className="text-xs text-slate-300">{t('licenceLimits')}: {provider.licenceLimits}</p>
    </article>
  );
}

export function SystemStatusPage(): React.ReactNode {
  const { t } = useTranslation();
  const providerQuery = useQuery({
    queryKey: ['provider-status'],
    queryFn: ({ signal }) => fetchProviderStatus(signal),
    refetchInterval: 60_000,
  });

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

      {providerQuery.isPending && (
        <div className="glass-subcard rounded-2xl p-4" role="status">
          <p className="text-sm text-slate-200">{t('loading')}</p>
        </div>
      )}
      {providerQuery.isError && (
        <div className="glass-subcard rounded-2xl p-4" role="alert">
          <p className="text-sm text-slate-200">{t('loadFailedDescription')}</p>
        </div>
      )}
      {providerQuery.data && (
        <div className="flex flex-col gap-2.5">
          {providerQuery.data.providers.map((provider) => (
            <ProviderStatusCard key={provider.id} provider={provider} />
          ))}
        </div>
      )}
    </section>
  );
}
