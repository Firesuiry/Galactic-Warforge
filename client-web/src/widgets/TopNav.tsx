import { useQueryClient } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';

import { getFixtureScenario, isFixtureServerUrl, parseFixtureIdFromServerUrl } from '@/fixtures';
import { useSessionSnapshot } from '@/hooks/use-session';
import { useSessionStore } from '@/stores/session';

export function TopNav() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionSnapshot();
  const clearSession = useSessionStore((state) => state.clearSession);
  const fixtureId = parseFixtureIdFromServerUrl(session.serverUrl);
  const fixtureScenario = fixtureId ? getFixtureScenario(fixtureId) : null;

  function handleLogout() {
    clearSession();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <header className="top-nav">
      <div className="top-nav__brand">
        <div className="top-nav__title">SiliconWorld Web Client</div>
        <div className="top-nav__meta">
          <span>玩家：{session.playerId}</span>
          <span>
            {isFixtureServerUrl(session.serverUrl)
              ? `样例：${fixtureScenario?.label ?? fixtureId}`
              : `服务：${session.serverUrl || '(同源)'}`}
          </span>
        </div>
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
      <button className="secondary-button" type="button" onClick={handleLogout}>
        退出登录
      </button>
    </header>
  );
}
