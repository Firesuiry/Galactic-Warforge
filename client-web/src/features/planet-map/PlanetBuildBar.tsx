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
  compareBuildItems,
  deriveBuildWorkflowView,
  DIRECTION_LABELS,
  isConveyorBeltBuilding,
  listBuildingRecipes,
  nextBeltDirection,
  type BuildCatalogEntryView,
} from '@/features/planet-map/build-workflow';
import { getItemDisplayName, getTechDisplayName, type PlanetRenderView } from '@/features/planet-map/model';
import { missingUnlockTechIds } from '@/features/planet-map/tech-gate';
import { normalizeCompletedTechIds } from '@/features/planet-map/research-workflow';
import { usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translateBuildingCategory, translateBuildingType } from '@/i18n/translate';

interface PlanetBuildBarProps {
  catalog?: CatalogView;
  planet: PlanetRenderView;
  summary?: StateSummary;
  dimensional?: boolean;
  /**
   * 收起态把手被点开时的回调（PlanetPage 用它在窄屏下同时收起抽屉）。
   * 建造栏与覆盖式抽屉在窄屏抢同一块空间，展开建造栏必须让抽屉让位，否则必然重叠。
   */
  onExpand?: () => void;
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

/** 锁定卡的解锁条件提示：任一未完成科技即可解锁（与服务端 any 语义一致），目录缺科技名时回退 tech id。 */
function formatUnlockCondition(catalog: CatalogView | undefined, entry: BuildCatalogEntryView, completedTechIds: ReadonlySet<string>) {
  const missing = missingUnlockTechIds(entry.unlock_tech, completedTechIds);
  if (missing.length === 0) {
    return '';
  }
  return missing.map((techId) => getTechDisplayName(catalog, techId)).join(' 或 ');
}

export function PlanetBuildBar({ catalog, planet, summary, dimensional = false, onExpand }: PlanetBuildBarProps) {
  const session = useSessionSnapshot();
  const interactionMode = usePlanetViewStore((state) => state.interactionMode);
  const setInteractionMode = usePlanetViewStore((state) => state.setInteractionMode);
  const exitInteractionMode = usePlanetViewStore((state) => state.exitInteractionMode);
  const [showLocked, setShowLocked] = useState(false);
  // 建造栏收起（贴底为一行把手）：右侧工作台抽屉是覆盖式的，展开的建造栏会盖住抽屉底部
  // 区域（试玩报告：抽屉里的「进阶：长线发展路线」点不到，命中被建造栏的造价 span 拦走）。
  const docked = usePlanetViewStore((state) => state.buildBarDocked);
  const setBuildBarDocked = usePlanetViewStore((state) => state.setBuildBarDocked);
  // 悬停/聚焦的卡片：造价详情浮在建造栏上方（卡片滚动容器会裁掉卡内浮层）。
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 新建筑（兵营/补给站/战车工厂等）尚无预渲染缩略图：加载失败则退回图标
  const [missingModels, setMissingModels] = useState<ReadonlySet<string>>(new Set());

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
  const completedTechIds = useMemo(
    () => new Set(normalizeCompletedTechIds(summary?.players?.[session.playerId]?.tech)),
    [summary, session.playerId],
  );
  const availableRecipes = useMemo(() => {
    if (!buildMode || !activeBuildingType) {
      return [];
    }
    return listBuildingRecipes(catalog, activeBuildingType, completedTechIds);
  }, [buildMode, activeBuildingType, catalog, completedTechIds]);

  const cycleBeltDirection = () => {
    const mode = usePlanetViewStore.getState().interactionMode;
    if (mode.kind !== 'build') {
      return;
    }
    if (isConveyorBeltBuilding(mode.buildingType)) setInteractionMode({ ...mode, direction: nextBeltDirection(mode.direction) });
    else setInteractionMode({ ...mode, rotation: ((mode.rotation ?? 0) + 90) % 360 as 0 | 90 | 180 | 270 });
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
    if (!buildMode) {
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
  }, [buildMode, setInteractionMode]);
  // 建设资金余额：resources 缺失时视为"未知"，不做置灰（避免旧快照误伤）。
  const mineralsBalance = summary?.players?.[session.playerId]?.resources?.minerals;
  const inventory = summary?.players?.[session.playerId]?.inventory;

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

  // 收起态：只留一行把手，避免遮挡右侧抽屉底部。
  if (docked) {
    return (
      <div className="planet-build-bar planet-build-bar--docked" data-testid="planet-build-bar">
        <button
          className="planet-build-bar__dock-handle"
          onClick={() => {
            setBuildBarDocked(false);
            onExpand?.();
          }}
          type="button"
        >
          建造栏
        </button>
      </div>
    );
  }

  const detailEntry = visibleEntries.find((entry) => entry.id === (hoveredId ?? activeBuildingType));
  const detail = detailEntry ? (() => {
    const locked = detailEntry.visibility === 'locked' || detailEntry.visibility === 'debugOnly';
    const unlockCondition = locked ? formatUnlockCondition(catalog, detailEntry, completedTechIds) : '';
    const mineralCost = detailEntry.build_cost?.minerals ?? 0;
    return (
      <div className="planet-build-bar__detail" role="tooltip" data-testid="planet-build-detail">
        <strong>{translateBuildingType(detailEntry.id, detailEntry.name)}</strong>
        {locked ? <span className="is-short">未解锁{unlockCondition ? `：需要科技 ${unlockCondition}` : ''}</span> : null}
        <span className="planet-build-bar__detail-head">拥有 / 需要</span>
        {mineralCost > 0 ? (
          <span className={mineralsBalance !== undefined && mineralsBalance < mineralCost ? 'is-short' : ''}>
            矿石 {mineralsBalance ?? '?'} / {mineralCost}
          </span>
        ) : null}
        {compareBuildItems(detailEntry, inventory).map((item) => (
          <span key={item.item_id} className={item.short ? 'is-short' : ''}>
            <Icon iconKey={item.item_id} size={12} /> {getItemDisplayName(catalog, item.item_id)} {item.owned} / {item.quantity}
          </span>
        ))}
        {(detailEntry.build_cost?.energy ?? 0) > 0 ? <span>能量 {detailEntry.build_cost?.energy}</span> : null}
      </div>
    );
  })() : null;

  return (
    <div className="planet-build-bar" data-testid="planet-build-bar">
      {detail}
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
                const items = compareBuildItems(entry, inventory);
                const itemsShort = items.some((item) => item.short);
                const mineralsShort = mineralsBalance !== undefined && mineralsBalance < mineralCost;
                const unaffordable = !locked && (mineralsShort || itemsShort);
                const unlockCondition = locked ? formatUnlockCondition(catalog, entry, completedTechIds) : '';
                const itemText = items.map((item) => `${getItemDisplayName(catalog, item.item_id)} ${item.owned}/${item.quantity}${item.short ? '（不足）' : ''}`).join('、');
                const title = `${name}${cost ? ` · ${cost}` : ''}${itemText ? ` · 物品（拥有/需要）：${itemText}` : ''}${locked ? ` · 未解锁${unlockCondition ? ` · 需要科技：${unlockCondition}` : ''}` : ''}${mineralsShort && !locked ? ` · 矿不足：需要 ${mineralCost} / 现有 ${mineralsBalance}` : ''}`;
                return (
                  <button
                    key={entry.id}
                    className={`planet-build-card${active ? ' planet-build-card--active' : ''}${locked ? ' planet-build-card--locked' : ''}${unaffordable ? ' planet-build-card--unaffordable' : ''}`}
                    data-building-id={entry.id}
                    type="button"
                    disabled={locked}
                    aria-label={title}
                    onMouseEnter={() => setHoveredId(entry.id)}
                    onMouseLeave={() => setHoveredId((id) => (id === entry.id ? null : id))}
                    onFocus={() => setHoveredId(entry.id)}
                    onBlur={() => setHoveredId((id) => (id === entry.id ? null : id))}
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
                      {dimensional && !missingModels.has(entry.id) ? <img className="planet-build-card__model" src={`/assets/buildings/${entry.id}.png`} alt="" loading="lazy" onError={() => setMissingModels((prev) => new Set(prev).add(entry.id))} /> : <Icon iconKey={entry.icon_key || entry.id} color={entry.color} size={26} />}
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
                    {items.length > 0 ? (
                      <span className="planet-build-card__items">
                        {items.map((item) => (
                          <span
                            key={item.item_id}
                            className={`planet-build-card__item${item.short ? ' planet-build-card__item--short' : ''}`}
                          >
                            <Icon iconKey={item.item_id} size={10} />
                            <span className="planet-build-card__item-name">{getItemDisplayName(catalog, item.item_id)}</span>
                            {item.owned}/{item.quantity}
                          </span>
                        ))}
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
              放置 {translateBuildingType(activeBuildingType ?? '')}：移动鼠标预览（ghost 上的箭头 = 物流方向），点击放置，右键/Esc 退出
            </span>
          ) : (
            <span className="planet-build-bar__hint planet-build-bar__hint--dim">
              选择建筑类型后在地图上点击放置
            </span>
          )}
          {buildMode ? (
            <button
              className="planet-build-bar__control"
              type="button"
              title="旋转建筑或传送带方向（快捷键 R）"
              onClick={cycleBeltDirection}
            >
              方向：{beltMode ? DIRECTION_LABELS[buildDirection] : (interactionMode.kind === 'build' ? interactionMode.rotation ?? 0 : 0) + '°'} · R 旋转
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
          className="planet-build-bar__dock"
          type="button"
          onClick={() => setBuildBarDocked(true)}
          title="收起建造栏（避免遮挡右侧工作台）"
        >
          收起
        </button>
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
