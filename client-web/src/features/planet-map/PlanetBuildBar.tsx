/**
 * DSP 式快捷建造栏（§3.2）。
 *
 * 结构（自下而上）：
 * 1. 图标格一行（52px 方格：只有图标 + 左上角快捷键数字）；
 * 2. 选中建筑后才出现的状态行（放置提示 / 缺料 / 方向 / 配方）。
 * 分类页签与状态行都**不参与栏宽**：页签行浮在栏上方（绝对定位、随内容滚动），
 * 状态行只在建造模式出现，因此栏体始终收缩到图标格的实际宽度（不再是一个 640px 空框）。
 *
 * 名称/造价/缺料只走悬停浮层（`planet-build-detail`）与 aria-label：
 * 格子里写被截断的名称在 52px 下毫无可读性（§3.2 复核）。
 *
 * 兼容既有测试契约：`data-testid="planet-build-bar"` / `planet-build-detail` /
 * `planet-build-shortage`、`.planet-build-card[data-building-id]`（可点选语义）、
 * `.planet-build-bar__hint`、`.planet-build-bar__scroller`、`.planet-build-bar__categories`、
 * `planet-build-card--unaffordable`、`planet-build-card--locked`、`planet-build-card--active`。
 */

import { ChevronDown, Eye, EyeOff, Lock, Minimize2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { CatalogView, StateSummary } from '@shared/types';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';
import {
  compareBuildItems,
  deriveBuildWorkflowView,
  describeBuildShortage,
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
  /** 收起态把手被点开时的回调（窄屏下同时收起抽屉，避免抢同一块底部空间）。 */
  onExpand?: () => void;
}

/** 分类页签的数字键上限（1–9）。 */
const MAX_CATEGORY_KEYS = 9;
/** 未分类建筑归入的兜底页签 id。 */
const UNCATEGORIZED = '__uncategorized';

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
/** 锁定卡的解锁条件提示：任一未完成科技即可解锁（与服务端 any 语义一致）。 */
function formatUnlockCondition(catalog: CatalogView | undefined, entry: BuildCatalogEntryView, completedTechIds: ReadonlySet<string>) {
  const missing = missingUnlockTechIds(entry.unlock_tech, completedTechIds);
  if (missing.length === 0) {
    return '';
  }
  return missing.map((techId) => getTechDisplayName(catalog, techId)).join(' 或 ');
}

/** 分类页签（有序、去重）；空分类归到「其他」。 */
function groupByCategory(entries: BuildCatalogEntryView[]): { id: string; label: string; entries: BuildCatalogEntryView[] }[] {
  const groups: { id: string; label: string; entries: BuildCatalogEntryView[] }[] = [];
  const index = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.category || UNCATEGORIZED;
    const existing = index.get(id);
    if (existing === undefined) {
      index.set(id, groups.length);
      groups.push({
        id,
        label: id === UNCATEGORIZED ? '其他' : translateBuildingCategory(id),
        entries: [entry],
      });
    } else {
      groups[existing].entries.push(entry);
    }
  }
  return groups;
}

export function PlanetBuildBar({ catalog, planet, summary, dimensional = false, onExpand }: PlanetBuildBarProps) {
  const session = useSessionSnapshot();
  const interactionMode = usePlanetViewStore((state) => state.interactionMode);
  const setInteractionMode = usePlanetViewStore((state) => state.setInteractionMode);
  const exitInteractionMode = usePlanetViewStore((state) => state.exitInteractionMode);
  const [showLocked, setShowLocked] = useState(false);
  const docked = usePlanetViewStore((state) => state.buildBarDocked);
  const setBuildBarDocked = usePlanetViewStore((state) => state.setBuildBarDocked);
  const categoriesOpen = usePlanetViewStore((state) => state.buildBarCategoriesOpen);
  const setCategoriesOpen = usePlanetViewStore((state) => state.setBuildBarCategoriesOpen);
  // 悬停/聚焦的图标格：造价详情浮在快捷栏上方（卡片自身 overflow 会裁掉浮层）。
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 当前分类页签（'auto' = 跟随选中建筑；玩家点页签后固定）。
  const [activeCategory, setActiveCategory] = useState<string | 'auto'>('auto');
  // 新建筑尚无预渲染缩略图：加载失败则退回图标
  const [missingModels, setMissingModels] = useState<ReadonlySet<string>>(new Set());

  const workflow = useMemo(() => deriveBuildWorkflowView({
    catalog,
    planet,
    playerId: session.playerId,
    summary,
  }), [catalog, planet, session.playerId, summary]);

  const activeBuildingType = interactionMode.kind === 'build' ? interactionMode.buildingType : null;
  const buildMode = interactionMode.kind === 'build';
  const beltMode = buildMode && isConveyorBeltBuilding(activeBuildingType ?? '');
  const buildDirection = interactionMode.kind === 'build' ? interactionMode.direction : 'auto';
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

  const mineralsBalance = summary?.players?.[session.playerId]?.resources?.minerals;
  const inventory = summary?.players?.[session.playerId]?.inventory;
  const activeShortage = useMemo(() => {
    if (!activeBuildingType) {
      return '';
    }
    return describeBuildShortage(
      catalog?.buildings?.find((entry) => entry.id === activeBuildingType),
      inventory,
      mineralsBalance,
      (itemId) => getItemDisplayName(catalog, itemId),
    );
  }, [activeBuildingType, catalog, inventory, mineralsBalance]);

  const visibleEntries = useMemo(() => [
    ...workflow.catalog.recommended,
    ...workflow.catalog.unlocked,
    ...(showLocked ? [...workflow.catalog.locked, ...workflow.catalog.debugOnly] : []),
  ], [workflow.catalog, showLocked]);
  const groups = useMemo(() => groupByCategory(visibleEntries), [visibleEntries]);

  // 数字键 1–9 切分类（输入控件聚焦时不抢按键）。
  //
  // 与 RTS 编队键（Ctrl+数字记录、数字选取）共用同一批键位：数字键的归属按
  // 「有没有绑过编队」判定——该数字已绑非空编队时交给编队选取（usePlanetRtsHotkeys），
  // 未绑定时才切建造分类。同一次按键只产生一个效果。
  useEffect(() => {
    if (docked) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (!/^[1-9]$/.test(event.key)) {
        return;
      }
      const index = Number(event.key);
      if ((usePlanetViewStore.getState().controlGroups[index]?.length ?? 0) > 0) {
        return;
      }
      const group = groups[index - 1];
      if (group) {
        setActiveCategory(group.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [docked, groups]);

  if (visibleEntries.length === 0) {
    return null;
  }

  // 选中建筑所在分类优先展示：点「显示未解锁」或点选卡片后总能看见它。
  const activeGroup = activeBuildingType
    ? groups.find((group) => group.entries.some((entry) => entry.id === activeBuildingType))
    : undefined;
  const currentGroupId = activeCategory === 'auto'
    ? (activeGroup?.id ?? groups[0].id)
    : (groups.some((group) => group.id === activeCategory) ? activeCategory : groups[0].id);
  const currentGroup = groups.find((group) => group.id === currentGroupId) ?? groups[0];
  // 收起态：只留一行把手。
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
    <div
      className={`planet-build-bar${categoriesOpen ? ' planet-build-bar--categories-open' : ''}`}
      data-testid="planet-build-bar"
    >
      {detail}
      {categoriesOpen ? (
        <div className="planet-build-bar__categories" role="tablist" aria-label="建造分类">
          {groups.slice(0, MAX_CATEGORY_KEYS).map((group, index) => (
            <button
              aria-selected={group.id === currentGroup.id}
              className={`planet-build-bar__category${group.id === currentGroup.id ? ' planet-build-bar__category--active' : ''}`}
              key={group.id}
              onClick={() => setActiveCategory(group.id)}
              role="tab"
              title={`${group.label} · 快捷键 ${index + 1}`}
              type="button"
            >
              <span className="planet-build-bar__category-key">{index + 1}</span>
              {group.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="planet-build-bar__row">
        <div className="planet-build-bar__grid planet-build-bar__scroller" role="group" aria-label={`${currentGroup.label} 建筑`}>
          {currentGroup.entries.map((entry, index) => {
            const locked = entry.visibility === 'locked' || entry.visibility === 'debugOnly';
            const active = entry.id === activeBuildingType;
            const name = translateBuildingType(entry.id, entry.name);
            const cost = formatCost(entry);
            const mineralCost = entry.build_cost?.minerals ?? 0;
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
                  {unaffordable ? <span aria-hidden="true" className="planet-build-card__shortage-dot" /> : null}
                  {/* 数字键角标贴在图标左上角（DSP 口径）。 */}
                  {index < 9 ? <span aria-hidden="true" className="planet-build-card__hotkey">{index + 1}</span> : null}
                </span>
                {/* 格内不再写名称：52px 下只能显示被截断的两三个字，名称在 aria-label / 悬停浮层标题里。 */}
              </button>
            );
          })}
        </div>
        <div className="planet-build-bar__tools">
          <button
            aria-expanded={categoriesOpen}
            aria-label={categoriesOpen ? '收起分类页签' : '展开分类页签'}
            className="planet-build-bar__tool"
            onClick={() => setCategoriesOpen(!categoriesOpen)}
            title={categoriesOpen ? '收起分类页签' : '展开分类页签'}
            type="button"
          >
            <ChevronDown aria-hidden="true" className={categoriesOpen ? 'is-open' : ''} size={14} strokeWidth={2} />
          </button>
          <button
            aria-expanded={showLocked}
            aria-label={showLocked ? '隐藏未解锁' : '显示未解锁'}
            className="planet-build-bar__tool"
            onClick={() => setShowLocked((value) => !value)}
            title={showLocked ? '隐藏未解锁' : '显示未解锁'}
            type="button"
          >
            {showLocked ? <Eye aria-hidden="true" size={14} strokeWidth={2} /> : <EyeOff aria-hidden="true" size={14} strokeWidth={2} />}
          </button>
          <button
            aria-label="收起建造栏"
            className="planet-build-bar__tool"
            onClick={() => setBuildBarDocked(true)}
            title="收起建造栏"
            type="button"
          >
            <Minimize2 aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      {/* 底部提示行只在**选中了建筑**时显示（放置/缺料/方向/配方）；
          未选中的「选择建筑类型后在地图上点击放置」是常驻噪音，已删（§3.2 复核）。 */}
      {buildMode ? (
        <div className="planet-build-bar__footer">
          <div className="planet-build-bar__status">
            {activeShortage ? (
              <span className="planet-build-bar__shortage" role="status" data-testid="planet-build-shortage">
                无法建造：缺少 {activeShortage}
              </span>
            ) : (
              <span className="planet-build-bar__hint">
                放置 {translateBuildingType(activeBuildingType ?? '')}：移动鼠标预览（ghost 上的箭头 = 物流方向），点击放置，右键/Esc 退出
              </span>
            )}
            <button
              className="planet-build-bar__control"
              type="button"
              title="旋转建筑或传送带方向（快捷键 R）"
              onClick={cycleBeltDirection}
            >
              方向：{beltMode ? DIRECTION_LABELS[buildDirection] : (interactionMode.kind === 'build' ? interactionMode.rotation ?? 0 : 0) + '°'} · R 旋转
            </button>
            {availableRecipes.length > 0 ? (
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
        </div>
      ) : null}
    </div>
  );
}
