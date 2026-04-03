import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/app/layout/AppShell';
import { OnlyGuests, RequireSession } from '@/features/auth/route-guards';
import { useHasSession } from '@/hooks/use-session';
import { GalaxyPage } from '@/pages/GalaxyPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { PlanetPage } from '@/pages/PlanetPage';
import { ReplayPage } from '@/pages/ReplayPage';
import { SystemPage } from '@/pages/SystemPage';

function RootRedirect() {
  const hasSession = useHasSession();
  return <Navigate to={hasSession ? '/overview' : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route
        path="/login"
        element={(
          <OnlyGuests>
            <LoginPage />
          </OnlyGuests>
        )}
      />
      <Route
        element={(
          <RequireSession>
            <AppShell />
          </RequireSession>
        )}
      >
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/galaxy" element={<GalaxyPage />} />
        <Route path="/system/:systemId" element={<SystemPage />} />
        <Route path="/planet/:planetId" element={<PlanetPage />} />
        <Route path="/replay" element={<ReplayPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
