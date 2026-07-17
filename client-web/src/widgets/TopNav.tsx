import { useEffect, useRef, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';

import { Icon } from '@/common/Icon';
import { formatMineralInventory } from '@/features/mineral-summary';
import { getFixtureScenario, isFixtureServerUrl, parseFixtureIdFromServerUrl } from '@/fixtures';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateAlertType, translateSeverity, translateUi } from '@/i18n/translate';
import { useSessionStore } from '@/stores/session';

const MENU_ITEMS = [
  { to: '/overview', glyph: '📊', label: '总览' },
  { to: '/galaxy', glyph: '🌌', label: '星图' },
  { to: '/war', glyph: '⚔️', label: '战争' },
  { to: '/agents', glyph: '🤖', label: '智能体' },
  { to: '/replay', glyph: '⏪', label: '回放' },
] as const;

export function TopNav() {
  const client = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionSnapshot();
  const clearSession = useSessionStore((state) => state.clearSession);
  const fixtureId = parseFixtureIdFromServerUrl(session.serverUrl);
  const fixtureScenario = fixtureId ? getFixtureScenario(fixtureId) : null;
  const [saveMessage, setSaveMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['shell-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(session.playerId),
    refetchInterval: 5000,
  });

  const statsQuery = useQuery({
    queryKey: ['shell-stats', session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
    enabled: Boolean(session.playerId),
    refetchInterval: 5000,
  });

  const alertQuery = useQuery({
    queryKey: ['shell-alerts', session.serverUrl, session.playerId],
    queryFn: () => client.fetchAlertSnapshot({ limit: 3 }),
    enabled: Boolean(session.playerId),
    refetchInterval: 8000,
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
    setSettingsOpen(false);
  }, [session.playerId, session.playerKey, session.serverUrl]);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [settingsOpen]);

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

  const alerts = alertQuery.data?.alerts ?? [];
  const alertCount = alerts.length + (powerDelta != null && powerDelta < 0 ? 1 : 0);
  const activePlanetId = summaryQuery.data?.active_planet_id;

  return (
    <header className="top-nav">
      <div className="top-nav__brand">
        <div className="top-nav__title">{translateUi('app.command_center')}</div>
      </div>

      <nav className="top-nav__menu" aria-label="主导航">
        {MENU_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            className={({ isActive }) => `top-nav__menu-btn${isActive ? ' top-nav__menu-btn--active' : ''}`}
            to={item.to}
            title={item.label}
            aria-label={item.label}
          >
            <span aria-hidden="true">{item.glyph}</span>
          </NavLink>
        ))}
      </nav>

      <div className="top-nav__status">
        <span
          className="top-nav__chip top-nav__chip--tick tick-pulse"
          key={`topnav-tick-${summaryQuery.data?.tick ?? 'none'}`}
          title="游戏 tick"
        >
          <Icon iconKey="gear" size={14} />
          <span>tick {summaryQuery.data?.tick ?? '-'}</span>
        </span>
        <span className="top-nav__chip" title="矿产库存">
          <Icon iconKey="iron_ore" color="#c9a06a" size={16} />
          <span>{mineralSummary}</span>
        </span>
        <span className="top-nav__chip" title="能量">
          <Icon iconKey="tesla_tower" color="#ffb454" size={16} />
          <span>{currentPlayer?.resources?.energy ?? 0}</span>
        </span>
        <span
          className={`top-nav__chip${powerClass ? ` ${powerClass}` : ''}${powerPulse}`}
          title="电力 发电/耗电"
        >
          <Icon iconKey="ray_receiver" color="#39e6d0" size={16} />
          <span>
            {energyStats ? `${energyStats.generation}/${energyStats.consumption}` : '-'}
          </span>
          {powerDelta != null ? (
            <span className="top-nav__chip-delta">
              {powerDelta >= 0 ? '+' : ''}
              {powerDelta}
            </span>
          ) : null}
        </span>
      </div>

      <div className="top-nav__alerts">
        {alertCount > 0 ? (
          <button
            className="top-nav__alert-btn"
            type="button"
            title={alerts[0]
              ? `${translateAlertType(alerts[0].alert_type, translateSeverity(alerts[0].severity))}：${alerts[0].message}`
              : '电力赤字'}
            onClick={() => activePlanetId && navigate(`/planet/${activePlanetId}`)}
          >
            <span aria-hidden="true">⚠️</span>
            <span className="top-nav__alert-count">{alertCount}</span>
          </button>
        ) : null}
      </div>

      <div className="top-nav__actions">
        <button
          className="top-nav__icon-btn"
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          title={saveMutation.isPending ? '保存中...' : '保存'}
          aria-label="保存"
        >
          <span aria-hidden="true">{saveMutation.isPending ? '⏳' : '💾'}</span>
        </button>

        <div className="top-nav__settings" ref={settingsRef}>
          <button
            className="top-nav__icon-btn"
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            title="设置"
            aria-label="设置"
            aria-expanded={settingsOpen}
          >
            <span aria-hidden="true">⚙️</span>
          </button>
          {settingsOpen ? (
            <div className="top-nav__settings-pop" role="menu">
              <div className="top-nav__settings-row">
                <span className="top-nav__settings-label">玩家</span>
                <span>{session.playerId}</span>
              </div>
              <div className="top-nav__settings-row">
                <span className="top-nav__settings-label">服务</span>
                <span className="top-nav__settings-value">
                  {isFixtureServerUrl(session.serverUrl)
                    ? `样例：${fixtureScenario?.label ?? fixtureId}`
                    : session.serverUrl || '(同源)'}
                </span>
              </div>
              {saveMessage ? (
                <div className="top-nav__settings-row top-nav__settings-row--accent">
                  {saveMessage}
                </div>
              ) : null}
              <button
                className="secondary-button top-nav__logout"
                type="button"
                onClick={handleLogout}
              >
                退出登录
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
