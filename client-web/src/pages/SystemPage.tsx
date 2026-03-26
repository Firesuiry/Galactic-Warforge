import type { CSSProperties } from 'react';
import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

export function SystemPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const { systemId = '' } = useParams();

  const systemQuery = useQuery({
    queryKey: ['system', session.serverUrl, session.playerId, systemId],
    queryFn: () => client.fetchSystem(systemId),
    enabled: Boolean(systemId),
  });

  const [selectedPlanetId, setSelectedPlanetId] = useState('');

  if (systemQuery.isLoading) {
    return <div className="panel">正在加载星系详情...</div>;
  }

  if (systemQuery.error || !systemQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {systemQuery.error instanceof Error ? systemQuery.error.message : '星系数据加载失败'}
      </div>
    );
  }

  const system = systemQuery.data;
  const planets = system.planets ?? [];
  const selectedPlanet = (
    planets.find((planet) => planet.planet_id === selectedPlanetId)
    ?? planets.find((planet) => planet.discovered)
    ?? planets[0]
    ?? null
  );

  return (
    <div className="page-grid strategic-page">
      <section className="panel page-hero strategic-hero">
        <div className="page-header">
          <p className="eyebrow">System Targeting</p>
          <h1>{system.name || system.system_id}</h1>
          <p className="subtle-text">
            {system.discovered ? '选择目标行星并切入主战区。' : '该星系尚未发现。'}
          </p>
        </div>
      </section>

      <section className="strategic-layout">
        <aside className="strategic-rail">
          <button className="secondary-button strategic-rail__link" type="button">视图</button>
          <button className="secondary-button strategic-rail__link" type="button">筛选</button>
          <button className="secondary-button strategic-rail__link" type="button">情报</button>
        </aside>

        <section className="panel strategic-main">
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
                <span>{planet.kind || '未知类型'}</span>
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
                  <dd>{selectedPlanet.kind || '未知'}</dd>
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
        </aside>
      </section>
    </div>
  );
}
