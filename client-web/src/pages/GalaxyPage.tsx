import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';

export function GalaxyPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();

  const galaxyQuery = useQuery({
    queryKey: ['galaxy', session.serverUrl, session.playerId],
    queryFn: () => client.fetchGalaxy(),
  });

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

  return (
    <div className="page-grid">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">T006 银河 / 星系 / 行星导航页</p>
          <h1>{galaxy.name || galaxy.galaxy_id}</h1>
          <p className="subtle-text">
            已发现 {galaxy.systems?.filter((system) => system.discovered).length ?? 0} / {galaxy.systems?.length ?? 0} 个恒星系
          </p>
        </div>
      </section>

      <section className="card-grid">
        {(galaxy.systems ?? []).map((system) => (
          <article key={system.system_id} className="panel entity-card">
            <div className="entity-card__header">
              <strong>{system.name || system.system_id}</strong>
              <span className={system.discovered ? 'badge badge--ok' : 'badge'}>
                {system.discovered ? '已发现' : '未发现'}
              </span>
            </div>
            <div className="entity-card__body">
              <span>坐标：{system.position ? `${system.position.x}, ${system.position.y}` : '未知'}</span>
              {system.discovered ? (
                <Link className="primary-link" to={`/system/${system.system_id}`}>
                  进入星系
                </Link>
              ) : (
                <span className="subtle-text">等待扫描</span>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
