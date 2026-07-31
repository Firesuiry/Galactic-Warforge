import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { CatalogView, TechCatalogEntry } from '@shared/types';

import { Icon } from '@/common/Icon';
import { formatTechUnlockLabel, normalizeCompletedTechIds } from '@/features/planet-map/research-workflow';
import { buildTechTreeLayout, type TechNode } from '@/features/tech-tree/layout';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { getItemDisplayName, getTechDisplayName } from '@/features/planet-map/model';

const LANE_LABELS: Record<string, string> = {
  main: '主线',
  energy: '能源',
  smelting: '冶金',
  chemical: '化工',
  logistics: '物流',
  mecha: '机甲',
  combat: '军事',
  dyson: '戴森球',
};

const STATUS_LABELS = {
  completed: '已完成',
  researching: '研究中',
  available: '可研究',
  locked: '未解锁',
} as const;

/** 节点格宽高（与 tech.css 中的 --tech-node-* 保持一致）。 */
const COL_WIDTH = 208;
const ROW_HEIGHT = 84;

export function TechPage() {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [laneFilter, setLaneFilter] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ['tech-catalog', session.serverUrl],
    queryFn: () => client.fetchCatalog(),
    staleTime: 5 * 60 * 1000,
  });

  const summaryQuery = useQuery({
    queryKey: ['tech-summary', session.serverUrl, session.playerId],
    queryFn: () => client.fetchSummary(),
    enabled: Boolean(session.playerId),
    refetchInterval: 5000,
  });

  const catalog = catalogQuery.data;
  const player = session.playerId ? summaryQuery.data?.players?.[session.playerId] : undefined;
  const currentResearch = player?.tech?.current_research;

  const completedIds = useMemo(
    () => new Set(normalizeCompletedTechIds(player?.tech ?? null)),
    [player?.tech],
  );

  const layout = useMemo(
    () => buildTechTreeLayout(catalog?.techs ?? [], completedIds, currentResearch?.tech_id ?? null),
    [catalog?.techs, completedIds, currentResearch?.tech_id],
  );

  const visibleLanes = laneFilter ? layout.lanes.filter((l) => l === laneFilter) : layout.lanes;
  const selected = layout.nodes.find((n) => n.entry.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const total = layout.nodes.length;
    const done = layout.nodes.filter((n) => n.status === 'completed').length;
    const ready = layout.nodes.filter((n) => n.status === 'available').length;
    return { total, done, ready };
  }, [layout.nodes]);

  if (catalogQuery.isLoading) {
    return <div className="panel">正在加载科技目录...</div>;
  }
  if (catalogQuery.isError) {
    return <div className="panel error-banner" role="alert">科技目录加载失败，请检查服务器连接</div>;
  }

  return (
    <div className="tech-page">
      <section className="panel tech-header">
        <div className="tech-header__title">
          <Icon iconKey="tech" color="#6ee7b7" size={26} />
          <h2>科技树</h2>
        </div>
        <dl className="tech-header__stats">
          <div><dt>已完成</dt><dd>{stats.done} / {stats.total}</dd></div>
          <div><dt>可研究</dt><dd>{stats.ready}</dd></div>
          <div>
            <dt>当前研究</dt>
            <dd>
              {currentResearch
                ? `${getTechDisplayName(catalog, currentResearch.tech_id)} ${currentResearch.progress}/${currentResearch.total_cost}`
                : '暂无研究'}
            </dd>
          </div>
        </dl>
        <div className="tech-header__lanes" role="group" aria-label="科技分支筛选">
          <button
            type="button"
            className={laneFilter === null ? 'tech-lane-chip is-active' : 'tech-lane-chip'}
            onClick={() => setLaneFilter(null)}
          >
            全部
          </button>
          {layout.lanes.map((lane) => (
            <button
              key={lane}
              type="button"
              className={laneFilter === lane ? 'tech-lane-chip is-active' : 'tech-lane-chip'}
              onClick={() => setLaneFilter(lane === laneFilter ? null : lane)}
            >
              {LANE_LABELS[lane] ?? lane}
            </button>
          ))}
        </div>
      </section>

      <div className="tech-body">
        <div className="tech-canvas" data-testid="tech-canvas">
          {visibleLanes.map((lane) => (
            <TechLane
              key={lane}
              lane={lane}
              nodes={layout.nodes.filter((n) => n.lane === lane)}
              colCount={layout.colCount}
              selectedId={selectedId}
              onSelect={setSelectedId}
              catalog={catalog}
            />
          ))}
        </div>
        <TechDetailPanel node={selected} catalog={catalog} completedIds={completedIds} />
      </div>
    </div>
  );
}

interface TechLaneProps {
  lane: string;
  nodes: TechNode[];
  colCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  catalog: CatalogView | undefined;
}

function TechLane({ lane, nodes, colCount, selectedId, onSelect, catalog }: TechLaneProps) {
  const rowCount = nodes.reduce((max, n) => Math.max(max, n.row + 1), 1);
  return (
    <section className="tech-lane" aria-label={LANE_LABELS[lane] ?? lane}>
      <h3 className="tech-lane__title">{LANE_LABELS[lane] ?? lane}</h3>
      <div
        className="tech-lane__grid"
        style={{ width: colCount * COL_WIDTH, height: rowCount * ROW_HEIGHT }}
      >
        {nodes.map((node) => (
          <button
            key={node.entry.id}
            type="button"
            className={`tech-node is-${node.status}${selectedId === node.entry.id ? ' is-selected' : ''}`}
            style={{ left: node.col * COL_WIDTH, top: node.row * ROW_HEIGHT }}
            onClick={() => onSelect(node.entry.id)}
            data-tech-id={node.entry.id}
            data-tech-status={node.status}
            aria-pressed={selectedId === node.entry.id}
          >
            <Icon iconKey={node.entry.icon_key} color={node.entry.color} size={18} />
            <span className="tech-node__name">{getTechDisplayName(catalog, node.entry.id)}</span>
            <span className="tech-node__status">{STATUS_LABELS[node.status]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

interface TechDetailPanelProps {
  node: TechNode | null;
  catalog: CatalogView | undefined;
  completedIds: ReadonlySet<string>;
}

function TechDetailPanel({ node, catalog, completedIds }: TechDetailPanelProps) {
  if (!node) {
    return (
      <aside className="panel tech-detail tech-detail--empty">
        点击左侧任意科技节点查看成本、解锁内容与前置条件
      </aside>
    );
  }
  const entry: TechCatalogEntry = node.entry;
  const prerequisites = entry.prerequisites ?? [];
  const unlocks = entry.unlocks ?? [];
  const effects = entry.effects ?? [];

  return (
    <aside className="panel tech-detail" data-testid="tech-detail">
      <header className="tech-detail__head">
        <Icon iconKey={entry.icon_key} color={entry.color} size={24} />
        <div>
          <h3>{getTechDisplayName(catalog, entry.id)}</h3>
          <p className="tech-detail__meta">
            {LANE_LABELS[node.lane] ?? node.lane} · {STATUS_LABELS[node.status]}
            {entry.max_level && entry.max_level > 1 ? ` · 最高 ${entry.max_level} 级` : ''}
          </p>
        </div>
      </header>

      <TechDetailSection title="研究成本">
        {entry.cost && entry.cost.length > 0
          ? entry.cost.map((c) => (
            <li key={c.item_id}>{getItemDisplayName(catalog, c.item_id)} ×{c.quantity}</li>
          ))
          : <li className="tech-detail__dim">无消耗</li>}
      </TechDetailSection>

      <TechDetailSection title="前置科技">
        {prerequisites.length > 0
          ? prerequisites.map((id) => (
            <li key={id} className={completedIds.has(id) ? 'tech-detail__done' : 'tech-detail__missing'}>
              {getTechDisplayName(catalog, id)}
              {completedIds.has(id) ? ' ✓' : ' （未完成）'}
            </li>
          ))
          : <li className="tech-detail__dim">无前置</li>}
      </TechDetailSection>

      <TechDetailSection title="解锁内容">
        {unlocks.length > 0
          ? unlocks.map((u, i) => (
            <li key={`${u.type}-${u.id}-${i}`}>{formatTechUnlockLabel(catalog, u)}</li>
          ))
          : <li className="tech-detail__dim">无直接解锁</li>}
      </TechDetailSection>

      {effects.length > 0 ? (
        <TechDetailSection title="效果加成">
          {effects.map((e, i) => (
            <li key={`${e.type}-${i}`}>{e.type} +{e.value}</li>
          ))}
        </TechDetailSection>
      ) : null}

      {entry.leads_to && entry.leads_to.length > 0 ? (
        <TechDetailSection title="后继科技">
          {entry.leads_to.map((id) => <li key={id}>{getTechDisplayName(catalog, id)}</li>)}
        </TechDetailSection>
      ) : null}
    </aside>
  );
}

function TechDetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tech-detail__section">
      <h4>{title}</h4>
      <ul>{children}</ul>
    </section>
  );
}
