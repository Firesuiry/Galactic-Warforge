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

  return (
    <div className="page-grid">
      <section className="panel page-hero">
        <div className="page-header">
          <p className="eyebrow">星系详情</p>
          <h1>{system.name || system.system_id}</h1>
          <p className="subtle-text">
            {system.discovered ? '该星系已被发现，可继续进入已发现行星。' : '该星系尚未发现。'}
          </p>
        </div>
      </section>

      <section className="card-grid">
        {(system.planets ?? []).map((planet) => (
          <article key={planet.planet_id} className="panel entity-card">
            <div className="entity-card__header">
              <strong>{planet.name || planet.planet_id}</strong>
              <span className={planet.discovered ? 'badge badge--ok' : 'badge'}>
                {planet.discovered ? '已发现' : '未发现'}
              </span>
            </div>
            <div className="entity-card__body">
              <span>类型：{planet.kind || '未知'}</span>
              {planet.discovered ? (
                <Link className="primary-link" to={`/planet/${planet.planet_id}`}>
                  进入行星
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
