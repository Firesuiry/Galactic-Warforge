/**
 * 建造栏：地图底部的建筑类型选择条（群星式）。
 * 点击卡片进入建造模式（地图幽灵预览 + 点击放置），再次点击或 Esc/右键退出。
 */

import { useMemo, useState } from 'react';

import type { CatalogView, StateSummary } from '@shared/types';

import { Icon } from '@/common/Icon';
import { deriveBuildWorkflowView, type BuildCatalogEntryView } from '@/features/planet-map/build-workflow';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateBuildingType } from '@/i18n/translate';

interface PlanetBuildBarProps {
  catalog?: CatalogView;
  planet: PlanetRenderView;
  summary?: StateSummary;
}

function formatCost(entry: BuildCatalogEntryView) {
  const cost = entry.build_cost;
  if (!cost) {
    return '';
  }
  const parts: string[] = [];
  if (cost.minerals) {
    parts.push(`矿 ${cost.minerals}`);
  }
  if (cost.energy) {
    parts.push(`能 ${cost.energy}`);
  }
  return parts.join(' ');
}

export function PlanetBuildBar({ catalog, planet, summary }: PlanetBuildBarProps) {
  const session = useSessionSnapshot();
  const interactionMode = usePlanetViewStore((state) => state.interactionMode);
  const setInteractionMode = usePlanetViewStore((state) => state.setInteractionMode);
  const exitInteractionMode = usePlanetViewStore((state) => state.exitInteractionMode);
  const [showLocked, setShowLocked] = useState(false);

  const workflow = useMemo(() => deriveBuildWorkflowView({
    catalog,
    planet,
    playerId: session.playerId,
    summary,
  }), [catalog, planet, session.playerId, summary]);

  const activeBuildingType = interactionMode.kind === 'build' ? interactionMode.buildingType : null;
  const buildMode = interactionMode.kind === 'build';
  // 建设资金余额：resources 缺失时视为"未知"，不做置灰（避免旧快照误伤）。
  const mineralsBalance = summary?.players?.[session.playerId]?.resources?.minerals;

  const visibleEntries = [
    ...workflow.catalog.recommended,
    ...workflow.catalog.unlocked,
    ...(showLocked ? [...workflow.catalog.locked, ...workflow.catalog.debugOnly] : []),
  ];

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <div className="planet-build-bar" data-testid="planet-build-bar">
      <div className="planet-build-bar__scroller">
        {visibleEntries.map((entry) => {
          const locked = entry.visibility === 'locked' || entry.visibility === 'debugOnly';
          const active = entry.id === activeBuildingType;
          const cost = formatCost(entry);
          const mineralCost = entry.build_cost?.minerals ?? 0;
          const unaffordable =
            !locked && mineralsBalance !== undefined && mineralsBalance < mineralCost;
          return (
            <button
              key={entry.id}
              className={`planet-build-card${active ? ' planet-build-card--active' : ''}${locked ? ' planet-build-card--locked' : ''}${unaffordable ? ' planet-build-card--unaffordable' : ''}`}
              data-building-id={entry.id}
              type="button"
              disabled={locked || unaffordable}
              title={`${translateBuildingType(entry.id, entry.name)}${cost ? ` · ${cost}` : ''}${locked ? ' · 未解锁' : ''}${unaffordable ? ` · 矿不足：需要 ${mineralCost} / 现有 ${mineralsBalance}` : ''}`}
              onClick={() => {
                if (active) {
                  exitInteractionMode();
                } else {
                  setInteractionMode({ kind: 'build', buildingType: entry.id, direction: 'auto' });
                }
              }}
            >
              <Icon iconKey={entry.icon_key || entry.id} color={entry.color} size={22} />
              <span className="planet-build-card__name">{translateBuildingType(entry.id, entry.name)}</span>
              {cost ? <span className="planet-build-card__cost">{cost}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="planet-build-bar__footer">
        {buildMode ? (
          <span className="planet-build-bar__hint">
            放置 {translateBuildingType(activeBuildingType ?? '')}：移动鼠标预览，点击放置，右键/Esc 退出
          </span>
        ) : (
          <span className="planet-build-bar__hint planet-build-bar__hint--dim">
            选择建筑类型后在地图上点击放置
          </span>
        )}
        <button
          className="planet-build-bar__toggle"
          type="button"
          onClick={() => setShowLocked((value) => !value)}
        >
          {showLocked ? '收起未解锁' : '显示未解锁'}
        </button>
      </div>
    </div>
  );
}
