import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';

const ModulePlaceholderPage = lazy(() =>
  import('./pages/ModulePlaceholderPage.js').then((module) => ({
    default: module.ModulePlaceholderPage,
  }))
);
const OverviewPage = lazy(() =>
  import('./pages/OverviewPage.js').then((module) => ({
    default: module.OverviewPage,
  }))
);
const SystemStatusPage = lazy(() =>
  import('./pages/SystemStatusPage.js').then((module) => ({
    default: module.SystemStatusPage,
  }))
);

function RouteLoading(): React.ReactNode {
  return (
    <div className="surface-card loading-card" aria-busy="true">
      <span className="skeleton-line skeleton-title" />
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-short" />
    </div>
  );
}

export function App(): React.ReactNode {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="forecast" element={<ModulePlaceholderPage />} />
          <Route path="alerts" element={<ModulePlaceholderPage />} />
          <Route path="history" element={<ModulePlaceholderPage />} />
          <Route path="more" element={<ModulePlaceholderPage />} />
          <Route path="method" element={<ModulePlaceholderPage />} />
          <Route path="settings" element={<ModulePlaceholderPage />} />
          <Route path="system-status" element={<SystemStatusPage />} />
          <Route path="*" element={<ModulePlaceholderPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
