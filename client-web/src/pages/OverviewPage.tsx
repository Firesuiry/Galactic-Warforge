import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

function formatNumber(value: number | undefined) {
  return value ?? 0;
}

function formatPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 3);
  if (entries.length === 0) {
    return '无附加字段';
  }
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' · ');
}

export function OverviewPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();

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

  const isLoading = summaryQuery.isLoading || statsQuery.isLoading || eventQuery.isLoading || alertQuery.isLoading;
  const error = summaryQuery.error || statsQuery.error || eventQuery.error || alertQuery.error;

  if (isLoading) {
    return <div className="panel">正在加载总览数据...</div>;
  }

  if (error || !summaryQuery.data || !statsQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {error instanceof Error ? error.message : '总览数据加载失败'}
      </div>
    );
  }

  const summary = summaryQuery.data;
  const stats = statsQuery.data;
  const events = eventQuery.data?.events ?? [];
  const alerts = alertQuery.data?.alerts ?? [];
  const currentPlayer = summary.players[session.playerId];
  const resources = currentPlayer?.resources;
  const currentResearch = currentPlayer?.tech?.current_research;

  return (
    <div className="page-grid">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">T005 总览页</p>
          <h1>全局总览</h1>
          <p className="subtle-text">
            当前 tick {summary.tick}，活跃行星{' '}
            <Link to={`/planet/${summary.active_planet_id}`}>{summary.active_planet_id}</Link>
          </p>
        </div>
        <div className="hero-actions">
          <Link className="primary-link" to="/galaxy">打开星图</Link>
          <Link className="secondary-link" to={`/planet/${summary.active_planet_id}`}>打开当前行星</Link>
        </div>
      </section>

      <section className="card-grid">
        <article className="panel stat-card">
          <span className="stat-card__label">资源</span>
          <strong>矿物 {formatNumber(resources?.minerals)}</strong>
          <span>能量 {formatNumber(resources?.energy)}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">研究</span>
          <strong>{currentResearch?.tech_id ?? '暂无研究'}</strong>
          <span>{currentResearch ? `${currentResearch.progress}/${currentResearch.total_cost}` : '等待队列'}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">电力</span>
          <strong>{stats.energy_stats.generation} / {stats.energy_stats.consumption}</strong>
          <span>短缺 tick：{stats.energy_stats.shortage_ticks}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">物流</span>
          <strong>吞吐 {stats.logistics_stats.throughput}</strong>
          <span>交付 {stats.logistics_stats.deliveries}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">生产</span>
          <strong>产出 {stats.production_stats.total_output}</strong>
          <span>效率 {stats.production_stats.efficiency}</span>
        </article>
        <article className="panel stat-card">
          <span className="stat-card__label">战斗</span>
          <strong>威胁 {stats.combat_stats.threat_level}</strong>
          <span>击杀 {stats.combat_stats.enemies_killed}</span>
        </article>
      </section>

      <section className="panel split-panel">
        <div className="split-panel__section">
          <div className="section-title">最近关键事件</div>
          <ul className="timeline-list">
            {events.length === 0 ? <li>暂无事件</li> : null}
            {events.slice().reverse().map((event) => (
              <li key={event.event_id}>
                <strong>[t{event.tick}] {event.event_type}</strong>
                <span>{formatPayload(event.payload)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="split-panel__section">
          <div className="section-title">最近告警</div>
          <ul className="timeline-list">
            {alerts.length === 0 ? <li>暂无告警</li> : null}
            {alerts.slice().reverse().map((alert) => (
              <li key={alert.alert_id}>
                <strong>[t{alert.tick}] {alert.alert_type}</strong>
                <span>{alert.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
