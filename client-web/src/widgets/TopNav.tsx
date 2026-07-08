import { useEffect, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';

import { Icon } from '@/common/Icon';
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
  const powerGeneration = energyStats?.generation;
  const powerConsumption = energyStats?.consumption;
  const powerDelta =
    typeof powerGeneration === 'number' && typeof powerConsumption === 'number'
      ? powerGeneration - powerConsumption
      : null;
  const powerClass = powerDelta == null ? '' : powerDelta >= 0 ? 'top-nav__chip--good' : 'top-nav__chip--danger';
  const powerPulse = powerDelta != null && powerDelta < 0 ? ' top-nav__chip--pulse' : '';
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
        <span className="top-nav__chip top-nav__chip--tick">
          <Icon iconKey="gear" size={14} />
          <span>tick {summaryQuery.data?.tick ?? '-'}</span>
        </span>
        <span className="top-nav__chip">
          <Icon iconKey="iron_ore" color="#c9a06a" size={16} />
          <span>矿产 {mineralSummary}</span>
        </span>
        <span className="top-nav__chip">
          <Icon iconKey="tesla_tower" color="#ffb454" size={16} />
          <span>能量 {currentPlayer?.resources?.energy ?? 0}</span>
        </span>
        <span className={`top-nav__chip${powerClass ? ` ${powerClass}` : ''}${powerPulse}`}>
          <Icon iconKey="ray_receiver" color="#39e6d0" size={16} />
          <span>
            电力{' '}
            {energyStats ? `${energyStats.generation}/${energyStats.consumption}` : '-'}
          </span>
          {powerDelta != null ? (
            <span className="top-nav__chip-delta">
              {powerDelta >= 0 ? '+' : ''}
              {powerDelta}
            </span>
          ) : null}
        </span>
        <span className="top-nav__chip">
          <span>活跃行星 {summaryQuery.data?.active_planet_id ?? '-'}</span>
        </span>
        {saveMessage ? (
          <span className="top-nav__chip top-nav__chip--accent">{saveMessage}</span>
        ) : null}
      </div>

      <nav className="top-nav__links">
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/overview">
          <span aria-hidden="true" className="top-nav__link-glyph">📊</span>
          总览
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/galaxy">
          <span aria-hidden="true" className="top-nav__link-glyph">🌌</span>
          星图
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/war">
          <span aria-hidden="true" className="top-nav__link-glyph">⚔️</span>
          战争
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/agents">
          <span aria-hidden="true" className="top-nav__link-glyph">🤖</span>
          智能体
        </NavLink>
        <NavLink className={({ isActive }) => (isActive ? 'active' : '')} to="/replay">
          <span aria-hidden="true" className="top-nav__link-glyph">⏪</span>
          回放
        </NavLink>
      </nav>

      <button
        className="secondary-button top-nav__save"
        type="button"
        onClick={handleSave}
        disabled={saveDisabled}
      >
        <span aria-hidden="true" className="top-nav__link-glyph">💾</span>
        {saveMutation.isPending ? '保存中...' : '保存'}
      </button>

      <button className="secondary-button top-nav__logout" type="button" onClick={handleLogout}>
        <span aria-hidden="true" className="top-nav__link-glyph">🚪</span>
        退出
      </button>
    </header>
  );
}
