import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { FullScreenLoader, PublicOnly, RequireAdmin, RequireAuth } from './components/RouteGuards';
import { AccountPage } from './pages/AccountPage';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { LandingRoute } from './pages/LandingPage';
import { TIERS_ENABLED } from './lib/tiers';

// The editor brings three.js and the scene: loaded only when a plan is opened.
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

export function App() {
  return (
    <Routes>
      {/* Public: the product page (prerendered into index.html for search engines). */}
      <Route path="/" element={<LandingRoute />} />
      <Route path="/pricing" element={TIERS_ENABLED ? <LandingRoute section="pricing" /> : <Navigate to="/" replace />} />
      <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
      <Route path="/plans" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route
        path="/plans/:planId"
        element={
          <RequireAuth>
            <Suspense fallback={<FullScreenLoader label="Открываем редактор…" />}>
              <EditorPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <Suspense fallback={<FullScreenLoader />}>
              <AdminPage />
            </Suspense>
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
