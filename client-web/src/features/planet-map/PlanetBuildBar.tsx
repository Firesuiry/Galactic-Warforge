/**
 * 建造栏：地图底部的建筑类型选择条（DSP 式工厂棋盘）。
 * 卡片按 catalog.category 分组（电力/生产/物流/军事……），lucide 大图标为主视觉；
 * 三态：锁定=灰化+锁角标+解锁科技提示，负担不起=红边+红成本，可建造=全息卡片+hover 微光上浮。
 * 点击卡片进入建造模式（地图幽灵预览 + 点击放置），再次点击或 Esc/右键退出。
 */

import { Lock, Mountain, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { CatalogView, StateSummary } from '@shared/types';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';
import {
  deriveBuildWorkflowView,
  DIRECTION_LABELS,
  isConveyorBeltBuilding,
  listBuildingRecipes,
  nextBeltDirection,
  type BuildCatalogEntryView,
} from '@/features/planet-map/build-workflow';
import { getTechDisplayName, type PlanetRenderView } from '@/features/planet-map/model';
import { normalizeCompletedTechIds } from '@/features/planet-map/research-workflow';
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
  // 传送带建造模式：方向可循环切换（auto → 北 → 东 → 南 → 西），随 build 命令下发服务端。
  const beltMode = buildMode && isConveyorBeltBuilding(activeBuildingType ?? '');
  const buildDirection = interactionMode.kind === 'build' ? interactionMode.direction : 'auto';
  // 生产类建造模式：可在建造时指定配方（无配方 = 服务端默认行为，如 matrix_lab 作研究站）。
  const activeRecipeId = interactionMode.kind === 'build' ? interactionMode.recipeId : undefined;
  const availableRecipes = useMemo(() => {
    if (!buildMode || !activeBuildingType) {
      return [];
    }
    const completedTechIds = normalizeCompletedTechIds(summary?.players?.[session.playerId]?.tech);
    return listBuildingRecipes(catalog, activeBuildingType, completedTechIds);
  }, [buildMode, activeBuildingType, catalog, summary, session.playerId]);

  const cycleBeltDirection = () => {
    const mode = usePlanetViewStore.getState().interactionMode;
    if (mode.kind !== 'build') {
      return;
    }
    setInteractionMode({ ...mode, direction: nextBeltDirection(mode.direction) });
  };

  const selectBuildRecipe = (recipeId: string) => {
    const mode = usePlanetViewStore.getState().interactionMode;
    if (mode.kind !== 'build') {
      return;
    }
    setInteractionMode({ ...mode, recipeId: recipeId || undefined });
  };

  // R 键循环传送带方向（输入控件聚焦时不抢按键）。
  useEffect(() => {
    if (!beltMode) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        cycleBeltDirection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beltMode, setInteractionMode]);
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
                      sfx.uiClick();
                      if (active) {
                        exitInteractionMode();
                      } else {
                        setInteractionMode({ kind: 'build', buildingType: entry.id, direction: 'auto' });
                      }
                    }}
                  >
                    <span className="planet-build-card__icon">
                      <Icon iconKey={entry.icon_key || entry.id} color={entry.color} size={26} />
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
        <div className="planet-build-bar__status">
          {buildMode ? (
            <span className="planet-build-bar__hint">
              放置 {translateBuildingType(activeBuildingType ?? '')}：移动鼠标预览，点击放置，右键/Esc 退出
            </span>
          ) : (
            <span className="planet-build-bar__hint planet-build-bar__hint--dim">
              选择建筑类型后在地图上点击放置
            </span>
          )}
          {beltMode ? (
            <button
              className="planet-build-bar__control"
              type="button"
              title="切换传送带方向（快捷键 R）"
              onClick={cycleBeltDirection}
            >
              方向：{DIRECTION_LABELS[buildDirection]}（R）
            </button>
          ) : null}
          {buildMode && availableRecipes.length > 0 ? (
            <select
              className="planet-build-bar__select"
              aria-label="建造配方"
              value={activeRecipeId ?? ''}
              onChange={(event) => selectBuildRecipe(event.target.value)}
            >
              <option value="">无配方（默认）</option>
              {availableRecipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
              ))}
            </select>
          ) : null}
        </div>
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
