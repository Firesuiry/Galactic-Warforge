/**
 * 建造栏：地图底部的建筑类型选择条（DSP 式工厂棋盘）。
 * 卡片按 catalog.category 分组（电力/生产/物流/军事……），lucide 大图标为主视觉；
 * 三态：锁定=灰化+锁角标+解锁科技提示，负担不起=红边+红成本，可建造=全息卡片+hover 微光上浮。
 * 点击卡片进入建造模式（地图幽灵预览 + 点击放置），再次点击或 Esc/右键退出。
 */

import { Lock, Mountain, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { CatalogView, StateSummary } from '@shared/types';

import { Icon } from '@/common/Icon';
import { deriveBuildWorkflowView, type BuildCatalogEntryView } from '@/features/planet-map/build-workflow';
import { getTechDisplayName, type PlanetRenderView } from '@/features/planet-map/model';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateBuildingCategory, translateBuildingType } from '@/i18n/translate';

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

/** 锁定卡的解锁条件提示：catalog 缺科技名时回退 tech id。 */
function formatUnlockCondition(catalog: CatalogView | undefined, entry: BuildCatalogEntryView) {
  const techIds = entry.unlock_tech?.filter(Boolean) ?? [];
  if (techIds.length === 0) {
    return '';
  }
  return techIds.map((techId) => getTechDisplayName(catalog, techId)).join('、');
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

  // 按 catalog.category 分组（保留组内既有排序，组序取首次出现顺序）。
  const groups = new Map<string, BuildCatalogEntryView[]>();
  for (const entry of visibleEntries) {
    const key = entry.category ?? '';
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <div className="planet-build-bar" data-testid="planet-build-bar">
      <div className="planet-build-bar__scroller">
        {[...groups.entries()].map(([category, entries]) => (
          <div className="planet-build-group" key={category || '__uncategorized'}>
            <span className="planet-build-group__label">{translateBuildingCategory(category)}</span>
            <div className="planet-build-group__cards">
              {entries.map((entry) => {
                const locked = entry.visibility === 'locked' || entry.visibility === 'debugOnly';
                const active = entry.id === activeBuildingType;
                const name = translateBuildingType(entry.id, entry.name);
                const cost = formatCost(entry);
                const mineralCost = entry.build_cost?.minerals ?? 0;
                const energyCost = entry.build_cost?.energy ?? 0;
                const unaffordable =
                  !locked && mineralsBalance !== undefined && mineralsBalance < mineralCost;
                const unlockCondition = locked ? formatUnlockCondition(catalog, entry) : '';
                const title = `${name}${cost ? ` · ${cost}` : ''}${locked ? ` · 未解锁${unlockCondition ? ` · 需要科技：${unlockCondition}` : ''}` : ''}${unaffordable ? ` · 矿不足：需要 ${mineralCost} / 现有 ${mineralsBalance}` : ''}`;
                return (
                  <button
                    key={entry.id}
                    className={`planet-build-card${active ? ' planet-build-card--active' : ''}${locked ? ' planet-build-card--locked' : ''}${unaffordable ? ' planet-build-card--unaffordable' : ''}`}
                    data-building-id={entry.id}
                    type="button"
                    disabled={locked || unaffordable}
                    title={title}
                    aria-label={title}
                    onClick={() => {
                      if (active) {
                        exitInteractionMode();
                      } else {
                        setInteractionMode({ kind: 'build', buildingType: entry.id, direction: 'auto' });
                      }
                    }}
                  >
                    <span className="planet-build-card__icon">
                      <Icon iconKey={entry.icon_key || entry.id} color={entry.color} size={30} />
                      {locked ? (
                        <Lock aria-hidden="true" className="planet-build-card__lock" size={11} strokeWidth={2.5} />
                      ) : null}
                    </span>
                    <span className="planet-build-card__name">{name}</span>
                    {mineralCost > 0 || energyCost > 0 ? (
                      <span className="planet-build-card__cost">
                        {mineralCost > 0 ? (
                          <span className="planet-build-card__cost-item planet-build-card__cost-item--minerals">
                            <Mountain aria-hidden="true" size={11} strokeWidth={2.5} />
                            {mineralCost}
                          </span>
                        ) : null}
                        {energyCost > 0 ? (
                          <span className="planet-build-card__cost-item planet-build-card__cost-item--energy">
                            <Zap aria-hidden="true" size={11} strokeWidth={2.5} />
                            {energyCost}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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
