/**
 * 右侧 Outliner（群星式）：焦点行星 / 恒星系 / 舰队 / 警报。
 * 固定悬浮在右侧，可折叠；折叠状态持久化到 localStorage。
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { starColorOf } from '@/features/starmap/model';
import { translateAlertType, translateSeverity } from '@/i18n/translate';

const FLEET_STATE_LABELS: Record<string, string> = {
  idle: '待命',
  attacking: '交战中',
};

function fleetStateLabel(state: string) {
  return FLEET_STATE_LABELS[state] ?? state;
}

const COLLAPSE_KEY = 'sw.outliner.collapsed';

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Outliner() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const summaryQuery = useQuery({
    queryKey: ['shell-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(session.playerId),
    refetchInterval: 5000,
  });

  const galaxyQuery = useQuery({
    queryKey: ['galaxy', session.serverUrl, session.playerId],
    queryFn: () => client.fetchGalaxy(),
    enabled: Boolean(session.playerId),
  });

  const fleetsQuery = useQuery({
    queryKey: ['outliner-fleets', session.serverUrl, session.playerId],
    queryFn: () => client.fetchFleets(),
    enabled: Boolean(session.playerId),
    refetchInterval: 10000,
  });

  const alertQuery = useQuery({
    queryKey: ['shell-alerts', session.serverUrl, session.playerId],
    queryFn: () => client.fetchAlertSnapshot({ limit: 5 }),
    enabled: Boolean(session.playerId),
    refetchInterval: 8000,
  });

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // 隐私模式等场景下忽略持久化失败
      }
      return next;
    });
  }

  const activePlanetId = summaryQuery.data?.active_planet_id;
  const systems = (galaxyQuery.data?.systems ?? []).filter((system) => system.discovered);
  const fleets = fleetsQuery.data ?? [];
  const alerts = alertQuery.data?.alerts ?? [];

  if (collapsed) {
    return (
      <button
        className="outliner-handle"
        type="button"
        onClick={toggleCollapsed}
        title="展开总览栏"
        aria-label="展开总览栏"
      >
        ◀
      </button>
    );
  }

  return (
    <aside className="outliner" aria-label="总览栏">
      <div className="outliner__head">
        <span className="outliner__title">总览</span>
        <button
          className="outliner__collapse"
          type="button"
          onClick={toggleCollapsed}
          title="收起总览栏"
          aria-label="收起总览栏"
        >
          ▶
        </button>
      </div>

      <section className="outliner__section">
        <div className="outliner__section-title">焦点行星</div>
        {activePlanetId ? (
          <button
            className="outliner__item outliner__item--accent"
            type="button"
            onClick={() => navigate(`/planet/${activePlanetId}`)}
          >
            <span aria-hidden="true">🪐</span>
            <span>{activePlanetId}</span>
          </button>
        ) : (
          <p className="outliner__empty">暂无活跃行星</p>
        )}
      </section>

      <section className="outliner__section">
        <div className="outliner__section-title">恒星系 {systems.length}</div>
        {systems.map((system) => {
          const color = starColorOf(typeof system.star?.type === 'string' ? system.star.type : undefined);
          return (
            <button
              className="outliner__item"
              type="button"
              key={system.system_id}
              onClick={() => navigate(`/system/${system.system_id}`)}
            >
              <span
                className="outliner__dot"
                style={{ background: `#${color.toString(16).padStart(6, '0')}` }}
                aria-hidden="true"
              />
              <span>{system.name || system.system_id}</span>
            </button>
          );
        })}
        {systems.length === 0 ? <p className="outliner__empty">尚未发现恒星系</p> : null}
      </section>

      <section className="outliner__section">
        <div className="outliner__section-title">舰队 {fleets.length}</div>
        {fleets.map((fleet) => (
          <button
            className="outliner__item"
            type="button"
            key={fleet.fleet_id}
            onClick={() => navigate('/war')}
            title={fleetStateLabel(fleet.state)}
          >
            <span aria-hidden="true">🚀</span>
            <span>{fleet.fleet_id}</span>
            <span className="outliner__item-meta">{fleetStateLabel(fleet.state)}</span>
          </button>
        ))}
        {fleets.length === 0 ? <p className="outliner__empty">暂无舰队</p> : null}
      </section>

      <section className="outliner__section">
        <div className="outliner__section-title">警报 {alerts.length}</div>
        {alerts.map((alert) => (
          <button
            className={`outliner__item outliner__item--alert outliner__item--${alert.severity}`}
            type="button"
            key={alert.alert_id}
            onClick={() => activePlanetId && navigate(`/planet/${activePlanetId}`)}
            title={alert.message}
          >
            <span aria-hidden="true">⚠️</span>
            <span>{translateAlertType(alert.alert_type, translateSeverity(alert.severity))}</span>
            <span className="outliner__item-meta">t{alert.tick}</span>
          </button>
        ))}
        {alerts.length === 0 ? <p className="outliner__empty">暂无警报</p> : null}
      </section>
    </aside>
  );
}
