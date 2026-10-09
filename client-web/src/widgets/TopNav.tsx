import { useEffect, useRef, useState } from 'react';

import type { CatalogView, ItemInventory } from '@shared/types';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChartColumn, Cpu, Flag, FlaskConical, Hourglass, Orbit, Rewind, Save, Settings, Swords, TriangleAlert, Users, Volume2, VolumeX, type LucideIcon } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { Icon } from '@/common/Icon';
import { isMuted, setMuted, sfx } from '@/engine/audio';
import { isPowerAlertType } from '@/features/notifications/event-toasts';
import { formatMineralInventory, pickKeyItems, sortedInventory } from '@/features/mineral-summary';
import { getItemDisplayName } from '@/features/planet-map/model';
import { getFixtureScenario, isFixtureServerUrl, parseFixtureIdFromServerUrl } from '@/fixtures';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { isResearchStationAlertNoise } from '@/features/production-alerts';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateAlertType, translateSeverity, translateUi } from '@/i18n/translate';
import { useSessionStore } from '@/stores/session';

const MENU_ITEMS: ReadonlyArray<{ to: string; icon: LucideIcon; label: string }> = [
  { to: '/overview', icon: ChartColumn, label: '总览' },
  { to: '/galaxy', icon: Orbit, label: '星图' },
  { to: '/tech', icon: FlaskConical, label: '科技' },
  { to: '/war', icon: Swords, label: '战争' },
  { to: '/agents', icon: Bot, label: '智能体' },
  { to: '/lobby', icon: Users, label: '对局' },
  { to: '/settlement', icon: Flag, label: '结算' },
  { to: '/replay', icon: Rewind, label: '回放' },
];

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
  const [audioMuted, setAudioMuted] = useState(() => isMuted());
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['shell-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(session.playerId),
    refetchInterval: 5000,
  });

  const catalogQuery = useQuery({
    queryKey: ['catalog', session.serverUrl, session.playerId],
    queryFn: () => client.fetchCatalog(),
    enabled: Boolean(session.playerId),
    staleTime: 5 * 60 * 1000,
  });

  const statsQuery = useQuery({
    queryKey: ['shell-stats', session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
    enabled: Boolean(session.playerId),
    refetchInterval: 5000,
  });

  const alertQuery = useQuery({
    queryKey: ['shell-alerts', session.serverUrl, session.playerId],
    // 拉更多条：既要顶栏告警计数，也要按建筑去重统计「几座建筑缺电」。
    // 服务端已按 (建筑, 告警类型) 聚合，同一建筑不会重复占用条目。
    queryFn: () => client.fetchAlertSnapshot({ limit: 50 }),
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

  function handleToggleMute() {
    const next = !audioMuted;
    setMuted(next);
    setAudioMuted(next);
    // 解除静音时播一声 tick 确认（本次点击的捕获阶段已完成 audio unlock）；
    // 静音时不播——主增益已归零，播了也听不见
    if (!next) {
      sfx.uiClick();
    }
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

  const alerts = (alertQuery.data?.alerts ?? []).filter(
    (alert) => !isResearchStationAlertNoise(alert),
  );
  const alertCount = alerts.length + (powerDelta != null && powerDelta < 0 ? 1 : 0);
  // 缺电建筑：按 building_id 去重统计断电类告警（试玩报告 F——需要一眼看出
  // 有几座建筑缺电，而不是被产线吞吐类告警稀释）。保留每座建筑的**首条**告警
  // （通常带更多 details）用于点击定位。
  const unpoweredByBuilding = new Map<string, (typeof alerts)[number]>();
  for (const alert of alerts) {
    if (isPowerAlertType(alert.alert_type) && !unpoweredByBuilding.has(alert.building_id)) {
      unpoweredByBuilding.set(alert.building_id, alert);
    }
  }
  const unpoweredAlerts = [...unpoweredByBuilding.values()];
  const unpoweredCount = unpoweredAlerts.length;
  const powerAlerting = unpoweredCount > 0;
  // 缺电告警或电力赤字都进 danger/pulse 态（沿用既有 chip 风格）
  const powerDeficit = powerDelta != null && powerDelta < 0;
  const powerChipClass = powerAlerting || powerDeficit ? 'top-nav__chip--danger' : powerClass;
  const powerChipPulse = powerAlerting || powerDeficit ? ' top-nav__chip--pulse' : '';
  const powerChipTitle = powerAlerting
    ? `${unpoweredCount} 座建筑缺电 · 点击定位`
    : '电力 发电/耗电';
  const activePlanetId = summaryQuery.data?.active_planet_id;

  /** 缺电建筑定位：带上 select 深链（行星页据此选中建筑并打开详情页签）。 */
  function handlePowerChipClick() {
    if (!activePlanetId) {
      return;
    }
    const target = unpoweredAlerts[0];
    if (!target) {
      navigate(`/planet/${activePlanetId}`);
      return;
    }
    // 手拼 query（不用 URLSearchParams：它会把 `building:b-1` 里的冒号转义成 %3A，
    // 深链可读性差；行星页 searchParams.get 两种写法都能解析）
    let href = `/planet/${activePlanetId}?select=building:${target.building_id}`;
    // 位置不一定有（服务端断电告警不带坐标）：有才带 x/y，否则只带 select
    const position = alertPosition(target.details);
    if (position) {
      href += `&x=${position.x}&y=${position.y}`;
    }
    navigate(href);
  }

  return (
    <header className="top-nav">
      <div className="top-nav__brand">
        <span className="top-nav__brand-mark" aria-hidden="true">
          <Cpu size={16} strokeWidth={2} />
        </span>
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
            <item.icon size={18} strokeWidth={2} aria-hidden="true" />
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
        <span
          className="top-nav__chip"
          title={`建设资金（矿石）· 背包库存：${mineralSummary}`}
        >
          <Icon iconKey="iron_ore" color="#c9a06a" size={16} />
          <span className="top-nav__chip-value">{currentPlayer?.resources?.minerals ?? 0}</span>
        </span>
        <span className="top-nav__chip" title="能量">
          <Icon iconKey="tesla_tower" color="#ffb454" size={16} />
          <span className="top-nav__chip-value">{currentPlayer?.resources?.energy ?? 0}</span>
        </span>
        <InventoryChips catalog={catalogQuery.data} inventory={currentPlayer?.inventory} />
        <button
          className={`top-nav__chip top-nav__chip--button${powerChipClass ? ` ${powerChipClass}` : ''}${powerChipPulse}`}
          type="button"
          title={powerChipTitle}
          onClick={handlePowerChipClick}
        >
          <Icon iconKey="ray_receiver" color="#39e6d0" size={16} />
          <span className="top-nav__chip-value">
            {energyStats ? `${energyStats.generation}/${energyStats.consumption}` : '-'}
          </span>
          {powerDelta != null ? (
            <span className="top-nav__chip-delta">
              {powerDelta >= 0 ? '+' : ''}
              {powerDelta}
            </span>
          ) : null}
          {powerAlerting ? (
            <span className="top-nav__chip-alert" title={`${unpoweredCount} 座建筑缺电`}>
              <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
              <span className="top-nav__chip-alert-count">{unpoweredCount}</span>
            </span>
          ) : null}
        </button>
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
            <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
            <span className="top-nav__alert-count">{alertCount}</span>
          </button>
        ) : null}
      </div>

      <div className="top-nav__actions">
        <NotificationBell />
        <button
          className="top-nav__icon-btn"
          type="button"
          onClick={handleToggleMute}
          title={audioMuted ? '取消静音' : '静音'}
          aria-label={audioMuted ? '取消静音' : '静音'}
          aria-pressed={audioMuted}
        >
          {audioMuted ? (
            <VolumeX size={18} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Volume2 size={18} strokeWidth={2} aria-hidden="true" />
          )}
        </button>

        <button
          className="top-nav__icon-btn"
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          title={saveMutation.isPending ? '保存中...' : '保存'}
          aria-label="保存"
        >
          {saveMutation.isPending ? (
            <Hourglass size={18} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Save size={18} strokeWidth={2} aria-hidden="true" />
          )}
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
            <Settings size={18} strokeWidth={2} aria-hidden="true" />
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

/**
 * 断电告警里的建筑位置：`details.position` / `details.{x,y}` 任一存在才返回。
 * 服务端当前不带位置，此时返回 null（跳转只带 select，不编造坐标）。
 */
function alertPosition(details: Record<string, unknown> | undefined): { x: number; y: number } | null {
  if (!details) {
    return null;
  }
  const nested = details.position;
  const source = (typeof nested === 'object' && nested !== null ? nested : details) as Record<string, unknown>;
  const x = typeof source.x === 'number' && Number.isFinite(source.x) ? source.x : undefined;
  const y = typeof source.y === 'number' && Number.isFinite(source.y) ? source.y : undefined;
  if (x === undefined || y === undefined) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** 顶栏关键库存（弹药/电路板/铁块…前 4 项），点击展开完整背包库存。 */
function InventoryChips({ catalog, inventory }: { catalog?: CatalogView; inventory?: ItemInventory }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  const keyItems = pickKeyItems(inventory);
  const all = sortedInventory(inventory);
  return (
    <div className="top-nav__inventory" ref={ref}>
      <button
        className="top-nav__inventory-btn"
        type="button"
        aria-expanded={open}
        aria-label="背包库存"
        title="背包库存（点击展开全部）"
        onClick={() => setOpen(!open)}
      >
        {keyItems.length === 0 ? <span className="top-nav__chip">背包空</span> : keyItems.map((item) => (
          <span className="top-nav__chip" key={item.id} title={getItemDisplayName(catalog, item.id)}>
            <Icon iconKey={item.id} size={14} />
            <span className="top-nav__chip-label">{getItemDisplayName(catalog, item.id)}</span>
            <span className="top-nav__chip-value">{item.quantity}</span>
          </span>
        ))}
      </button>
      {open ? (
        <div className="top-nav__inventory-panel" role="dialog" aria-label="完整库存">
          <div className="top-nav__inventory-title">背包库存 · {all.length} 种</div>
          {all.length === 0 ? <div className="top-nav__inventory-empty">背包是空的</div> : (
            <ul>
              {all.map((item) => (
                <li key={item.id}>
                  <Icon iconKey={item.id} size={14} />
                  <span>{getItemDisplayName(catalog, item.id)}</span>
                  <strong>{item.quantity}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
