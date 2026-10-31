import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';

const ModulePlaceholderPage = lazy(() =>
  import('./pages/ModulePlaceholderPage.js').then((module) => ({
    default: module.ModulePlaceholderPage,
  }))
);
const MorePage = lazy(() =>
  import('./pages/MorePage.js').then((module) => ({
    default: module.MorePage,
  }))
);
const SystemStatusPage = lazy(() =>
  import('./pages/SystemStatusPage.js').then((module) => ({
    default: module.SystemStatusPage,
  }))
);

function RouteLoading(): React.ReactNode {
  return (
    <div className="glass-subcard rounded-2xl p-4" aria-busy="true">
      <p className="text-sm text-slate-200">Loading…</p>
    </div>
  );
}

export function App(): React.ReactNode {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={null} />
          <Route path="forecast" element={<ModulePlaceholderPage />} />
          <Route path="alerts" element={<ModulePlaceholderPage />} />
          <Route path="history" element={<ModulePlaceholderPage />} />
          <Route path="more" element={<MorePage />} />
          <Route path="method" element={<ModulePlaceholderPage />} />
          <Route path="settings" element={<ModulePlaceholderPage />} />
          <Route path="system-status" element={<SystemStatusPage />} />
          <Route path="*" element={<ModulePlaceholderPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
