import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useTranslation } from '../i18n.js';
import { OverviewPage } from '../pages/OverviewPage.js';
import { MenuDrawer } from './MenuDrawer.js';

const RuntimeConfigSchema = z.object({
  dataMode: z.enum(['live', 'cache']),
  stormConeKmPer30Min: z.number().nonnegative().default(2.5),
  radarProvider: z.object({
    id: z.enum(['rainviewer', 'tmd']),
    mode: z.enum(['live', 'cache']),
  }),
  lightningProvider: z.object({
    id: z.enum(['open-meteo-cape', 'none']),
    mode: z.enum(['live', 'cache']),
    display: z.enum(['cape', 'counts-only']),
  }),
  stormTrackProvider: z.object({
    id: z.literal('gdacs'),
    mode: z.enum(['live', 'cache']),
  }),
});

export function AppShell(): React.ReactNode {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isDrawerOpen = location.pathname !== '/';

  const runtimeConfig = useQuery({
    queryKey: ['runtime-config'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/runtime-config', { signal });
      if (!response.ok) {
        throw new Error(`Runtime configuration request failed: ${response.status}`);
      }
      return RuntimeConfigSchema.parse(await response.json());
    },
    retry: 2,
    staleTime: 30 * 60 * 1000,
    refetchInterval: false,
  });

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-slate-950 text-slate-50">
      <a className="skip-link" href="#main-content">
        {t('skipToContent')}
      </a>

      <main id="main-content" className="w-full h-full" tabIndex={-1}>
        <OverviewPage runtimeConfig={runtimeConfig.data} />
      </main>

      <MenuDrawer
        open={isDrawerOpen}
        onClose={() => navigate({ pathname: '/', search: location.search })}
      >
        <Outlet />
      </MenuDrawer>
    </div>
  );
}
