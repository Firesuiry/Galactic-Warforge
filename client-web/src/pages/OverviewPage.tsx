import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatMineralInventory } from '@/features/mineral-summary';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import {
  translateAlertType,
  translateEventType,
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
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' · ');
}

export function OverviewPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const [intelOpen, setIntelOpen] = useState(false);

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
  const mineralSummary = formatMineralInventory(currentPlayer?.inventory);
  const currentResearch = currentPlayer?.tech?.current_research;
  const recommendedAlert = alerts[0];

  return (
    <div className="page-grid strategic-page">
      <section className="panel page-hero strategic-hero">
        <div className="page-header">
          <p className="eyebrow">{translateUi('page.campaign_overview')}</p>
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

      <section className="strategic-layout">
        <aside className="strategic-rail">
          <Link className="secondary-link strategic-rail__link" to="/galaxy">星图</Link>
          <Link className="secondary-link strategic-rail__link" to={`/planet/${summary.active_planet_id}`}>当前行星</Link>
          <Link className="secondary-link strategic-rail__link" to="/replay">回放</Link>
          <button className="secondary-button strategic-rail__link" onClick={() => setIntelOpen((open) => !open)} type="button">
            情报
          </button>
        </aside>

        <section className="panel strategic-main">
          <div className="campaign-board">
            <div className="campaign-board__headline">
              <span className="badge badge--ok">战役主板</span>
              <strong>下一步优先处理：{recommendedAlert?.message ?? '继续推进产能与侦察'}</strong>
            </div>
            <div className="campaign-board__grid">
              <article className="campaign-card">
                <span className="campaign-card__label">矿产库存</span>
                <strong>{mineralSummary}</strong>
                <span>能量 {formatNumber(resources?.energy)}</span>
              </article>
              <article className="campaign-card">
                <span className="campaign-card__label">研究</span>
                <strong>{currentResearch ? translateTechId(currentResearch.tech_id) : '暂无研究'}</strong>
                <span>{currentResearch ? `${currentResearch.progress}/${currentResearch.total_cost}` : '等待队列'}</span>
              </article>
              <article className="campaign-card">
                <span className="campaign-card__label">电力前线</span>
                <strong>{stats.energy_stats.generation} / {stats.energy_stats.consumption}</strong>
                <span>短缺 tick {stats.energy_stats.shortage_ticks}</span>
              </article>
              <article className="campaign-card">
                <span className="campaign-card__label">物流脉冲</span>
                <strong>吞吐 {stats.logistics_stats.throughput}</strong>
                <span>交付 {stats.logistics_stats.deliveries}</span>
              </article>
            </div>
          </div>

          {intelOpen ? (
            <div className="strategic-overlay">
              <div className="split-panel">
                <section className="panel split-panel__section">
                  <div className="section-title">最近关键事件</div>
                  <ul className="timeline-list">
                    {events.length === 0 ? <li>暂无事件</li> : null}
                    {events.slice().reverse().map((event) => (
                      <li key={event.event_id}>
                        <strong>[t{event.tick}] {translateEventType(event.event_type)}</strong>
                        <span>{formatPayload(event.payload)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="panel split-panel__section">
                  <div className="section-title">最近告警</div>
                  <ul className="timeline-list">
                    {alerts.length === 0 ? <li>暂无告警</li> : null}
                    {alerts.slice().reverse().map((alert) => (
                      <li key={alert.alert_id}>
                        <strong>[t{alert.tick}] {translateAlertType(alert.alert_type)}</strong>
                        <span>{alert.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="panel strategic-side">
          <section className="planet-side-section">
            <div className="section-title">玩家状态</div>
            <dl className="planet-kv-list">
              <div>
                <dt>矿产</dt>
                <dd>{mineralSummary}</dd>
              </div>
              <div>
                <dt>能量</dt>
                <dd>{formatNumber(resources?.energy)}</dd>
              </div>
              <div>
                <dt>研究</dt>
                <dd>{currentResearch ? translateTechId(currentResearch.tech_id) : '暂无研究'}</dd>
              </div>
              <div>
                <dt>威胁</dt>
                <dd>{stats.combat_stats.threat_level}</dd>
              </div>
              <div>
                <dt>活跃行星</dt>
                <dd>{summary.active_planet_id}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>
    </div>
  );
}
