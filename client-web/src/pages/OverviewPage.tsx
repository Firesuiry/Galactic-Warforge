import { useMemo, useRef } from 'react';

import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Icon } from '@/common/Icon';
import { resolveEarlyGameNextAction } from '@/features/early-game-next';
import { formatMineralInventory } from '@/features/mineral-summary';
import { isResearchStationAlertNoise } from '@/features/production-alerts';
import { MiniGalaxyMap } from '@/features/starmap/MiniGalaxyMap';
import { planetColorOf } from '@/features/starmap/model';
import { toPlayerFacingMessage } from '@/common/player-facing-error';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import {
  translateAlertType,
  translateBuildingType,
  translateEventType,
  translatePlanetKind,
  translateSeverity,
  translateTechId,
  translateUi,
} from '@/i18n/translate';

function formatNumber(value: number | undefined) {
  return value ?? 0;
}

function formatPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 3);
  if (entries.length === 0) {
    return '无附加字段';
  }
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

/** 相对 tick 时间：与当前 tick 的差值，友好中文。 */
function formatTickAge(currentTick: number, tick: number) {
  const delta = currentTick - tick;
  if (delta <= 0) {
    return '本 tick';
  }
  return `${delta} tick 前`;
}

// ---------- 情报时间线（告警 + 事件合并） ----------

type FeedTone = 'info' | 'good' | 'warning' | 'danger';

interface FeedItem {
  id: string;
  tick: number;
  tone: FeedTone;
  iconKey: string;
  title: string;
  detail: string;
}

const TONE_COLORS: Record<FeedTone, string> = {
  info: '#5fb0ff',
  good: '#6ee7b7',
  warning: '#ffb454',
  danger: '#ff5757',
};

const SEVERITY_TONES: Record<string, FeedTone> = {
  warning: 'warning',
  error: 'danger',
  critical: 'danger',
};

/** event_type → iconKey（走 common/icon-map 唯一事实来源）。 */
const EVENT_ICON_KEYS: Record<string, string> = {
  command_result: 'intel',
  entity_created: 'build',
  entity_moved: 'logistics',
  entity_destroyed: 'alert',
  entity_updated: 'build',
  building_state_changed: 'build',
  resource_changed: 'mining_machine',
  production_alert: 'alert',
  research_completed: 'tech',
  threat_level_changed: 'laser_turret',
  construction_paused: 'build',
  construction_resumed: 'build',
  damage_applied: 'laser_turret',
  loot_dropped: 'iron_ore',
  tick_completed: 'system',
};

const EVENT_TONES: Record<string, FeedTone> = {
  entity_destroyed: 'danger',
  production_alert: 'warning',
  threat_level_changed: 'danger',
  damage_applied: 'danger',
  research_completed: 'good',
};

interface PlanetStatusEntry {
  planetId: string;
  name: string;
  kind?: string;
  systemName: string;
}

export function OverviewPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const timelineRef = useRef<HTMLElement | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
  });

  const statsQuery = useQuery({
    queryKey: ['stats', session.serverUrl, session.playerId],
    queryFn: () => client.fetchStats(),
  });

  const eventQuery = useQuery({
    queryKey: ['events-snapshot', session.serverUrl, session.playerId],
    queryFn: () => client.fetchEventSnapshot({ limit: 8 }),
  });

  const alertQuery = useQuery({
    queryKey: ['alerts-snapshot', session.serverUrl, session.playerId],
    queryFn: () => client.fetchAlertSnapshot({ limit: 8 }),
  });

  // mini 星图 / 行星态势数据：失败不阻塞主面板，降级为空态
  const galaxyQuery = useQuery({
    queryKey: ['galaxy', session.serverUrl, session.playerId],
    queryFn: () => client.fetchGalaxy(),
  });

  const discoveredSystemIds = useMemo(
    () => (galaxyQuery.data?.systems ?? [])
      .filter((system) => system.discovered)
      .map((system) => system.system_id),
    [galaxyQuery.data],
  );

  const systemQueries = useQueries({
    queries: discoveredSystemIds.map((systemId) => ({
      queryKey: ['system', session.serverUrl, session.playerId, systemId],
      queryFn: () => client.fetchSystem(systemId),
    })),
  });

  const isLoading = summaryQuery.isLoading || statsQuery.isLoading || eventQuery.isLoading || alertQuery.isLoading;
  const error = summaryQuery.error || statsQuery.error || eventQuery.error || alertQuery.error;

  const summary = summaryQuery.data;
  const stats = statsQuery.data;
  const activePlanetId = summary?.active_planet_id ?? '';

  // 行星态势列表：已探明行星，活跃行星置顶，其余按 id 稳定排序
  const planetEntries = useMemo(() => {
    const entries: PlanetStatusEntry[] = [];
    systemQueries.forEach((query) => {
      const system = query.data;
      if (!system) {
        return;
      }
      (system.planets ?? [])
        .filter((planet) => planet.discovered)
        .forEach((planet) => {
          entries.push({
            planetId: planet.planet_id,
            name: planet.name || planet.planet_id,
            kind: planet.kind,
            systemName: system.name || system.system_id,
          });
        });
    });
    entries.sort((a, b) => {
      if (a.planetId === activePlanetId) return -1;
      if (b.planetId === activePlanetId) return 1;
      return a.planetId.localeCompare(b.planetId);
    });
    return entries;
  }, [systemQueries, activePlanetId]);

  const activeSystemId = useMemo(() => {
    for (const query of systemQueries) {
      const system = query.data;
      if (system?.planets?.some((planet) => planet.planet_id === activePlanetId)) {
        return system.system_id;
      }
    }
    return null;
  }, [systemQueries, activePlanetId]);

  const events = useMemo(() => eventQuery.data?.events ?? [], [eventQuery.data]);
  const alerts = useMemo(
    () => (alertQuery.data?.alerts ?? []).filter((alert) => !isResearchStationAlertNoise(alert)),
    [alertQuery.data],
  );

  // 告警 + 事件合并为统一时间线：tick 倒序，id 兜底保证确定性
  const feedItems = useMemo(() => {
    const items: FeedItem[] = [];
    alerts.forEach((alert) => {
      items.push({
        id: `alert-${alert.alert_id}`,
        tick: alert.tick,
        tone: SEVERITY_TONES[alert.severity] ?? 'warning',
        iconKey: alert.building_type || 'alert',
        title: translateAlertType(alert.alert_type, translateSeverity(alert.severity)),
        detail: alert.building_type
          ? `${translateBuildingType(alert.building_type)} ${alert.building_id}`
          : alert.message,
      });
    });
    events.forEach((event) => {
      items.push({
        id: `event-${event.event_id}`,
        tick: event.tick,
        tone: EVENT_TONES[event.event_type] ?? 'info',
        iconKey: EVENT_ICON_KEYS[event.event_type] ?? 'intel',
        title: translateEventType(event.event_type),
        detail: formatPayload(event.payload),
      });
    });
    items.sort((a, b) => b.tick - a.tick || a.id.localeCompare(b.id));
    return items;
  }, [alerts, events]);

  function scrollToTimeline() {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    timelineRef.current?.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  if (isLoading) {
    return <div className="panel">正在加载总览数据...</div>;
  }

  if (error || !summary || !stats) {
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? toPlayerFacingMessage(error.message) : '总览数据加载失败'}
      </div>
    );
  }

  const currentPlayer = summary.players[session.playerId];
  const resources = currentPlayer?.resources;
  const mineralSummary = formatMineralInventory(currentPlayer?.inventory);
  const currentResearch = currentPlayer?.tech?.current_research;
  const researchPercent = currentResearch && currentResearch.total_cost > 0
    ? Math.min(100, Math.round((currentResearch.progress / currentResearch.total_cost) * 100))
    : null;
  const energyStats = stats.energy_stats;
  const powerShort = energyStats.shortage_ticks > 0 || energyStats.consumption > energyStats.generation;
  const threatLevel = stats.combat_stats.threat_level;
  const activePlanetName = planetEntries.find((entry) => entry.planetId === activePlanetId)?.name;
  const discoveredSystemCount = discoveredSystemIds.length;
  const totalSystemCount = galaxyQuery.data?.systems?.length ?? 0;

  // 文明6 式"下一步"：告警优先，否则按开局状态机（无电→风机→研究站→电磁学→采矿）
  const nextAction = resolveEarlyGameNextAction({
    activePlanetId,
    player: currentPlayer,
    energy: energyStats,
    alerts,
  });

  return (
    <div className="page-grid command-page">
      <section className="panel command-hero">
        <div className="command-hero__top">
          <div className="page-header">
            <p className="eyebrow">{translateUi('page.campaign_overview')}</p>
            <h1>全局总览</h1>
            <p className="subtle-text">帝国指挥态势一览</p>
          </div>
          <ul className="command-hero__stats">
            <li className="command-hero__stat">
              <Icon iconKey="traffic_monitor" color="#5fb0ff" size={28} />
              <span className="command-hero__stat-text">
                <span className="command-hero__stat-label">当前 tick</span>
                <strong className="command-hero__stat-value">{summary.tick}</strong>
              </span>
            </li>
            <li className="command-hero__stat">
              <Icon iconKey="planet" color="#39e6d0" size={28} />
              <span className="command-hero__stat-text">
                <span className="command-hero__stat-label">活跃行星</span>
                <strong className="command-hero__stat-value">{activePlanetName ?? activePlanetId}</strong>
              </span>
            </li>
            <li className="command-hero__stat">
              <Icon iconKey="alert" color={threatLevel > 0 ? '#ffb454' : '#6ee7b7'} size={28} />
              <span className="command-hero__stat-text">
                <span className="command-hero__stat-label">威胁等级</span>
                <strong className="command-hero__stat-value">{threatLevel}</strong>
              </span>
            </li>
            <li className="command-hero__stat">
              <Icon iconKey="tech" color="#6ee7b7" size={28} />
              <span className="command-hero__stat-text">
                <span className="command-hero__stat-label">研究进度</span>
                <strong className="command-hero__stat-value">
                  {researchPercent !== null ? `${researchPercent}%` : '—'}
                </strong>
                <span className="command-hero__stat-meta">
                  {currentResearch ? translateTechId(currentResearch.tech_id) : '暂无研究'}
                </span>
              </span>
            </li>
          </ul>
        </div>
        <Link
          className={`command-next${nextAction.idle ? ' command-next--idle' : ''}`}
          to={nextAction.to}
        >
          <Icon iconKey={nextAction.iconKey} color={nextAction.color} size={34} />
          <span className="command-next__text">
            <span className="command-next__label">下一步优先处理</span>
            <strong>{nextAction.text}</strong>
          </span>
          <ChevronRight className="command-next__chevron" size={20} strokeWidth={2} aria-hidden="true" />
        </Link>
      </section>

      <section className="command-layout">
        <aside className="command-column">
          <Link className="panel command-minimap" to="/galaxy" aria-label="打开银河星图">
            <div className="command-minimap__head">
              <span className="section-title">银河星图</span>
              <span className="command-minimap__enter">进入星图</span>
            </div>
            <div className="command-minimap__stage">
              <MiniGalaxyMap galaxy={galaxyQuery.data} activeSystemId={activeSystemId} />
            </div>
            <div className="command-minimap__foot">
              <span>{totalSystemCount > 0 ? `已探明 ${discoveredSystemCount}/${totalSystemCount} 恒星系` : '星图数据不可用'}</span>
              <span>{activeSystemId ? '已定位活跃星系' : ''}</span>
            </div>
          </Link>

          <nav className="command-quick" aria-label="快捷入口">
            <Link className="command-quick__card" to={`/planet/${activePlanetId}`}>
              <Icon iconKey="planet" color="#39e6d0" size={30} />
              <span className="command-quick__card-text">
                <strong>当前行星</strong>
                <span>{activePlanetName ?? activePlanetId}</span>
              </span>
            </Link>
            <Link
              className="command-quick__card"
              to={`/planet/${activePlanetId}?workflow=dyson`}
            >
              <Icon iconKey="ray_receiver" color="#39e6d0" size={30} />
              <span className="command-quick__card-text">
                <strong>戴森工程</strong>
                <span>发射 · 射线 · 组件</span>
              </span>
            </Link>
            <Link className="command-quick__card" to="/war?tab=industry">
              <Icon iconKey="fleet" color="#ffb454" size={30} />
              <span className="command-quick__card-text">
                <strong>军工部署</strong>
                <span>编成舰队 · 量产</span>
              </span>
            </Link>
            <Link className="command-quick__card" to="/replay">
              <Icon iconKey="replay" color="#5fb0ff" size={30} />
              <span className="command-quick__card-text">
                <strong>回放</strong>
                <span>复盘任意 tick 区间</span>
              </span>
            </Link>
            <button className="command-quick__card" type="button" onClick={scrollToTimeline}>
              <Icon iconKey="intel" color="#ffb454" size={30} />
              <span className="command-quick__card-text">
                <strong>情报</strong>
                <span>定位到情报时间线</span>
              </span>
            </button>
          </nav>
        </aside>

        <section className="panel command-timeline" ref={timelineRef} aria-label="情报时间线">
          <div className="command-timeline__head">
            <span className="section-title">情报时间线</span>
            <span className="badge badge--ok">{feedItems.length} 条</span>
          </div>
          {feedItems.length === 0 ? (
            <div className="command-feed__empty">
              <Icon iconKey="intel" size={36} />
              <p>星海平静，暂无告警与事件</p>
            </div>
          ) : (
            <ul className="command-feed">
              {feedItems.map((item) => (
                <li className={`command-feed__item command-feed__item--${item.tone}`} key={item.id}>
                  <Icon iconKey={item.iconKey} color={TONE_COLORS[item.tone]} size={28} />
                  <div className="command-feed__body">
                    <div className="command-feed__title">
                      <strong>{item.title}</strong>
                      <span className="command-feed__tick">
                        T{item.tick} · {formatTickAge(summary.tick, item.tick)}
                      </span>
                    </div>
                    <span className="command-feed__detail">{item.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="command-column">
          <section className="panel command-resources" aria-label="资源脉搏">
            <div className="section-title">资源脉搏</div>
            <div className="command-resources__grid">
              <article className="command-resource">
                <div className="command-resource__head">
                  <Icon iconKey="mining_machine" color="#5fb0ff" size={24} />
                  <span>矿产</span>
                </div>
                <strong className="command-resource__value">{formatNumber(resources?.minerals)}</strong>
                <span className="command-resource__meta">产出 +{stats.production_stats.total_output}/t</span>
                <span className="command-resource__meta command-resource__meta--dim">{mineralSummary}</span>
              </article>
              <article className="command-resource">
                <div className="command-resource__head">
                  <Icon iconKey="energy" color="#ffb454" size={24} />
                  <span>能量</span>
                </div>
                <strong className="command-resource__value">{formatNumber(resources?.energy)}</strong>
                <div className="command-resource__bar" aria-hidden="true">
                  <div
                    className="command-resource__bar-fill"
                    style={{ width: `${energyStats.storage > 0 ? Math.min(100, Math.round((energyStats.current_stored / energyStats.storage) * 100)) : 0}%` }}
                  />
                </div>
                <span className="command-resource__meta">储能 {energyStats.current_stored}/{energyStats.storage}</span>
              </article>
              <article className={`command-resource${powerShort ? ' command-resource--danger' : ''}`}>
                <div className="command-resource__head">
                  <Icon iconKey="power" color={powerShort ? '#ff5757' : '#39e6d0'} size={24} />
                  <span>电力</span>
                </div>
                <strong className="command-resource__value">{energyStats.generation}/{energyStats.consumption}</strong>
                <span className="command-resource__meta">
                  {energyStats.generation <= 0 && energyStats.consumption > 0
                    ? '无发电 · 立即建风机'
                    : powerShort
                      ? `短缺 ${energyStats.shortage_ticks} tick`
                      : '供电稳定'}
                </span>
              </article>
              <article className="command-resource">
                <div className="command-resource__head">
                  <Icon iconKey="tech" color="#6ee7b7" size={24} />
                  <span>研究</span>
                </div>
                <strong className="command-resource__value">
                  {researchPercent !== null ? `${researchPercent}%` : '—'}
                </strong>
                <div className="command-resource__bar" aria-hidden="true">
                  <div
                    className="command-resource__bar-fill command-resource__bar-fill--good"
                    style={{ width: `${researchPercent ?? 0}%` }}
                  />
                </div>
                <span className="command-resource__meta">
                  {currentResearch
                    ? `${translateTechId(currentResearch.tech_id)} ${currentResearch.progress}/${currentResearch.total_cost}`
                    : '等待队列'}
                </span>
              </article>
            </div>
          </section>

          <section className="panel command-planets" aria-label="行星态势">
            <div className="section-title">行星态势</div>
            {planetEntries.length === 0 ? (
              <p className="command-planets__empty">尚未发现行星</p>
            ) : (
              <ul className="command-planets__list">
                {planetEntries.map((entry) => (
                  <li key={entry.planetId}>
                    <Link
                      className={`command-planets__item${entry.planetId === activePlanetId ? ' command-planets__item--active' : ''}`}
                      to={`/planet/${entry.planetId}`}
                    >
                      <Icon
                        iconKey="planet"
                        color={`#${planetColorOf(entry.kind)[0].toString(16).padStart(6, '0')}`}
                        size={26}
                      />
                      <span className="command-planets__text">
                        <strong>{entry.name}</strong>
                        <span>{translatePlanetKind(entry.kind)} · {entry.systemName}</span>
                      </span>
                      {entry.planetId === activePlanetId ? (
                        <span className="command-planets__badge">当前</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </section>
    </div>
  );
}
