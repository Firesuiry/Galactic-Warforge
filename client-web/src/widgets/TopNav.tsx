import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';

import { getFixtureScenario, isFixtureServerUrl, parseFixtureIdFromServerUrl } from '@/fixtures';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { useSessionStore } from '@/stores/session';

export function TopNav() {
  const client = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionSnapshot();
  const clearSession = useSessionStore((state) => state.clearSession);
  const fixtureId = parseFixtureIdFromServerUrl(session.serverUrl);
  const fixtureScenario = fixtureId ? getFixtureScenario(fixtureId) : null;

  const summaryQuery = useQuery({
    queryKey: ['shell-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(session.playerId),
  });

  const statsQuery = useQuery({
    queryKey: ['shell-stats', session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
    enabled: Boolean(session.playerId),
  });

  function handleLogout() {
    clearSession();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  const currentPlayer = summaryQuery.data?.players?.[session.playerId];
  const energyStats = statsQuery.data?.energy_stats;

  return (
    <header className="top-nav">
      <div className="top-nav__brand">
        <div className="top-nav__title">SiliconWorld Command</div>
        <div className="top-nav__meta">
          <span>玩家 {session.playerId}</span>
          <span>
            {isFixtureServerUrl(session.serverUrl)
              ? `样例 ${fixtureScenario?.label ?? fixtureId}`
              : `服务 ${session.serverUrl || '(同源)'}`}
          </span>
        </div>
      </div>

      <div className="top-nav__status">
        <span className="top-nav__chip">tick {summaryQuery.data?.tick ?? '-'}</span>
        <span className="top-nav__chip">
          资源 {currentPlayer?.resources?.minerals ?? 0} / {currentPlayer?.resources?.energy ?? 0}
        </span>
        <span className="top-nav__chip">
          电力 {energyStats ? `${energyStats.generation}/${energyStats.consumption}` : '-'}
        </span>
        <span className="top-nav__chip">
          活跃行星 {summaryQuery.data?.active_planet_id ?? '-'}
        </span>
      </div>

      <nav className="top-nav__links">
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/overview">
          总览
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/galaxy">
          星图
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/replay">
          回放
        </NavLink>
      </nav>

      <button className="secondary-button top-nav__logout" type="button" onClick={handleLogout}>
        退出
      </button>
    </header>
  );
}
