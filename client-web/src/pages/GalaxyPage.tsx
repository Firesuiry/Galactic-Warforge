import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateUi } from '@/i18n/translate';

export function GalaxyPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();

  const galaxyQuery = useQuery({
    queryKey: ['galaxy', session.serverUrl, session.playerId],
    queryFn: () => client.fetchGalaxy(),
  });

  const [selectedSystemId, setSelectedSystemId] = useState('');

  if (galaxyQuery.isLoading) {
    return <div className="panel">正在加载银河总览...</div>;
  }

  if (galaxyQuery.error || !galaxyQuery.data) {
    return (
      <div className="panel error-banner" role="alert">
        {galaxyQuery.error instanceof Error ? galaxyQuery.error.message : '银河数据加载失败'}
      </div>
    );
  }

  const galaxy = galaxyQuery.data;
  const systems = galaxy.systems ?? [];
  const selectedSystem = (
    systems.find((system) => system.system_id === selectedSystemId)
    ?? systems.find((system) => system.discovered)
    ?? systems[0]
    ?? null
  );

  return (
    <div className="page-grid strategic-page">
      <section className="panel page-hero strategic-hero">
        <div className="page-header">
          <p className="eyebrow">{translateUi('page.galaxy_command_map')}</p>
          <h1>{galaxy.name || galaxy.galaxy_id}</h1>
          <p className="subtle-text">
            已发现 {systems.filter((system) => system.discovered).length} / {systems.length} 个恒星系
          </p>
        </div>
      </section>

      <section className="strategic-layout">
        <aside className="strategic-rail">
          <button className="secondary-button strategic-rail__link" type="button">筛选</button>
          <button className="secondary-button strategic-rail__link" type="button">发现状态</button>
          <button className="secondary-button strategic-rail__link" type="button">情报</button>
        </aside>

        <section className="panel strategic-main">
          <div className="galaxy-map">
            {systems.map((system) => (
              <button
                className={system.system_id === selectedSystem?.system_id ? 'galaxy-node galaxy-node--active' : 'galaxy-node'}
                key={system.system_id}
                onClick={() => setSelectedSystemId(system.system_id)}
                type="button"
              >
                <strong>{system.name || system.system_id}</strong>
                <span>{system.position ? `${system.position.x}, ${system.position.y}` : '未知坐标'}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="panel strategic-side">
          <section className="planet-side-section">
            <div className="section-title">恒星系情报</div>
            {selectedSystem ? (
              <dl className="planet-kv-list">
                <div>
                  <dt>名称</dt>
                  <dd>{selectedSystem.name || selectedSystem.system_id}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{selectedSystem.discovered ? '已发现' : '未发现'}</dd>
                </div>
                <div>
                  <dt>坐标</dt>
                  <dd>{selectedSystem.position ? `${selectedSystem.position.x}, ${selectedSystem.position.y}` : '未知'}</dd>
                </div>
              </dl>
            ) : (
              <p className="subtle-text">暂无可选恒星系。</p>
            )}
            {selectedSystem?.discovered ? (
              <Link className="primary-link" to={`/system/${selectedSystem.system_id}`}>
                进入星系
              </Link>
            ) : null}
          </section>
        </aside>
      </section>
    </div>
  );
}
