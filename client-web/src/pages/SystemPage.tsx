import type { CSSProperties } from 'react';
import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ActivePlanetDysonContextCard } from '@/features/system/ActivePlanetDysonContextCard';
import { DysonSituationPanel } from '@/features/system/DysonSituationPanel';
import { useSystemSituation } from '@/features/system/use-system-situation';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translatePlanetKind, translateUi } from '@/i18n/translate';

export function SystemPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const { systemId = '' } = useParams();

  const systemQuery = useQuery({
    queryKey: ['system', session.serverUrl, session.playerId, systemId],
    queryFn: () => client.fetchSystem(systemId),
    enabled: Boolean(systemId),
  });

  const runtimeQuery = useQuery({
    queryKey: ['system-runtime', session.serverUrl, session.playerId, systemId],
    queryFn: () => client.fetchSystemRuntime(systemId),
    enabled: Boolean(systemId),
  });

  const summaryQuery = useQuery({
    queryKey: ['summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(systemId),
  });
  const situation = useSystemSituation({
    system: systemQuery.data,
    runtime: runtimeQuery.data,
    summary: summaryQuery.data,
  });

  const [selectedPlanetId, setSelectedPlanetId] = useState('');

  if (systemQuery.isLoading || runtimeQuery.isLoading || summaryQuery.isLoading) {
    return <div className="panel">正在加载星系详情...</div>;
  }

  if (
    systemQuery.error
    || runtimeQuery.error
    || summaryQuery.error
    || !systemQuery.data
    || !runtimeQuery.data
    || !summaryQuery.data
  ) {
    return (
      <div className="panel error-banner" role="alert">
        {systemQuery.error instanceof Error
          ? systemQuery.error.message
          : runtimeQuery.error instanceof Error
            ? runtimeQuery.error.message
            : summaryQuery.error instanceof Error
              ? summaryQuery.error.message
              : '星系数据加载失败'}
      </div>
    );
  }

  const system = systemQuery.data;
  const runtime = runtimeQuery.data;
  const summary = summaryQuery.data;
  const planets = system.planets ?? [];
  const selectedPlanet = (
    planets.find((planet) => planet.planet_id === selectedPlanetId)
    ?? planets.find((planet) => planet.planet_id === summary.active_planet_id)
    ?? planets.find((planet) => planet.discovered)
    ?? planets[0]
    ?? null
  );

  return (
    <div className="page-grid strategic-page">
      <section className="panel page-hero strategic-hero">
        <div className="page-header">
          <p className="eyebrow">{translateUi('page.system_targeting')}</p>
          <h1>{situation.systemName}</h1>
          <p className="subtle-text">
            {system.discovered
              ? '当前页直接展示 system authoritative 运行态，以及 active planet 对戴森操作链路的支撑能力。'
              : '该星系尚未发现。'}
          </p>
        </div>
      </section>

      <section className="strategic-layout">
        <aside className="strategic-rail">
          <button className="secondary-button strategic-rail__link" type="button">戴森</button>
          <button className="secondary-button strategic-rail__link" type="button">行星</button>
          <button className="secondary-button strategic-rail__link" type="button">运行态</button>
        </aside>

        <section className="panel strategic-main">
          <DysonSituationPanel
            layers={situation.layers}
            metrics={situation.metrics}
          />
          <div className="system-orbit-map">
            <div className="system-orbit-map__star">STAR</div>
            {planets.map((planet, index) => (
              <button
                className={planet.planet_id === selectedPlanet?.planet_id ? 'orbit-node orbit-node--active' : 'orbit-node'}
                key={planet.planet_id}
                onClick={() => setSelectedPlanetId(planet.planet_id)}
                style={{ '--orbit-index': index } as CSSProperties}
                type="button"
              >
                <strong>{planet.name || planet.planet_id}</strong>
                <span>{translatePlanetKind(planet.kind)}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="panel strategic-side">
          <section className="planet-side-section">
            <div className="section-title">目标行星</div>
            {selectedPlanet ? (
              <dl className="planet-kv-list">
                <div>
                  <dt>名称</dt>
                  <dd>{selectedPlanet.name || selectedPlanet.planet_id}</dd>
                </div>
                <div>
                  <dt>类型</dt>
                  <dd>{translatePlanetKind(selectedPlanet.kind)}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{selectedPlanet.discovered ? '已发现' : '未发现'}</dd>
                </div>
              </dl>
            ) : (
              <p className="subtle-text">暂无行星数据。</p>
            )}
            {selectedPlanet?.discovered ? (
              <Link className="primary-link" to={`/planet/${selectedPlanet.planet_id}`}>
                进入行星
              </Link>
            ) : null}
          </section>

          <ActivePlanetDysonContextCard context={situation.activePlanetContext} />
        </aside>
      </section>
    </div>
  );
}
