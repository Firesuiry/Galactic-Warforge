import { useEffect, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';

import { formatMineralInventory } from '@/features/mineral-summary';
import { getFixtureScenario, isFixtureServerUrl, parseFixtureIdFromServerUrl } from '@/fixtures';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateUi } from '@/i18n/translate';
import { useSessionStore } from '@/stores/session';

export function TopNav() {
  const client = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionSnapshot();
  const clearSession = useSessionStore((state) => state.clearSession);
  const fixtureId = parseFixtureIdFromServerUrl(session.serverUrl);
  const fixtureScenario = fixtureId ? getFixtureScenario(fixtureId) : null;
  const [saveMessage, setSaveMessage] = useState('');

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

  const saveMutation = useMutation({
    mutationFn: () => client.sendSave({ reason: 'manual' }),
    onSuccess: (result) => {
      setSaveMessage(`已保存到 tick ${result.tick}`);
    },
    onError: (error) => {
      setSaveMessage(error instanceof Error ? error.message : '保存失败');
    },
  });

  useEffect(() => {
    setSaveMessage('');
  }, [session.playerId, session.playerKey, session.serverUrl]);

  function handleLogout() {
    clearSession();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  function handleSave() {
    setSaveMessage('');
    saveMutation.mutate();
  }

  const currentPlayer = summaryQuery.data?.players?.[session.playerId];
  const mineralSummary = formatMineralInventory(currentPlayer?.inventory);
  const energyStats = statsQuery.data?.energy_stats;
  const saveDisabled = isFixtureServerUrl(session.serverUrl) || saveMutation.isPending;

  return (
    <header className="top-nav">
      <div className="top-nav__brand">
        <div className="top-nav__title">{translateUi('app.command_center')}</div>
        <div className="top-nav__meta">
          <span>玩家 {session.playerId}</span>
          <span>
            {isFixtureServerUrl(session.serverUrl)
              ? `样例：${fixtureScenario?.label ?? fixtureId}`
              : `服务 ${session.serverUrl || '(同源)'}`}
          </span>
        </div>
      </div>

      <div className="top-nav__status">
        <span className="top-nav__chip">tick {summaryQuery.data?.tick ?? '-'}</span>
        <span className="top-nav__chip">
          矿产 {mineralSummary}
        </span>
        <span className="top-nav__chip">
          能量 {currentPlayer?.resources?.energy ?? 0}
        </span>
        <span className="top-nav__chip">
          电力 {energyStats ? `${energyStats.generation}/${energyStats.consumption}` : '-'}
        </span>
        <span className="top-nav__chip">
          活跃行星 {summaryQuery.data?.active_planet_id ?? '-'}
        </span>
        {saveMessage ? (
          <span className="top-nav__chip top-nav__chip--accent">{saveMessage}</span>
        ) : null}
      </div>

      <nav className="top-nav__links">
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/overview">
          总览
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/galaxy">
          星图
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/agents">
          智能体
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/replay">
          回放
        </NavLink>
      </nav>

      <button
        className="secondary-button top-nav__save"
        type="button"
        onClick={handleSave}
        disabled={saveDisabled}
      >
        {saveMutation.isPending ? '保存中...' : '保存'}
      </button>

      <button className="secondary-button top-nav__logout" type="button" onClick={handleLogout}>
        退出
      </button>
    </header>
  );
}
