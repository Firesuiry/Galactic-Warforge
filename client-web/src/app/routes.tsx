import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/app/layout/AppShell';
import { OnlyGuests, RequireSession } from '@/features/auth/route-guards';
import { useApiClient } from '@/hooks/use-api-client';
import { useHasSession, useSessionSnapshot } from '@/hooks/use-session';
import { GalaxyPage } from '@/pages/GalaxyPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { PlanetPage } from '@/pages/PlanetPage';
import { ReplayPage } from '@/pages/ReplayPage';
import { SystemPage } from '@/pages/SystemPage';
import { TechPage } from '@/pages/TechPage';
import { WarPage } from '@/pages/WarPage';

/**
 * 已登录的根路径落地：对标戴森球计划，默认直接进入机甲所在行星的
 * 第一人称 3D 视图（行星页会聚焦基地），拉高相机即可切换轨道视角，
 * 再经「恒星系 ↗ / 银河」链接逐级拉远；查不到行星时回退星系视图。
 */
function ActivePlanetLanding() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const summaryQuery = useQuery({
    queryKey: ['landing-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    retry: 1,
    staleTime: 30_000,
  });

  if (summaryQuery.isLoading) {
    return <div className="panel">正在进入行星...</div>;
  }

  const planetId = summaryQuery.data?.active_planet_id;
  return (
    <Navigate
      to={planetId ? `/planet/${encodeURIComponent(planetId)}` : '/galaxy'}
      replace
    />
  );
}

function RootRedirect() {
  const hasSession = useHasSession();
  if (!hasSession) {
    return <Navigate to="/login" replace />;
  }
  return <ActivePlanetLanding />;
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
        <Route path="/tech" element={<TechPage />} />
        <Route path="/war" element={<WarPage />} />
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
