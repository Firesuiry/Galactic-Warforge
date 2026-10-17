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
import { useNavigate } from 'react-router-dom';

import type { CatalogView, StateSummary } from '@shared/types';

import { Icon } from '@/common/Icon';
import { sfx } from '@/engine/audio';
import {
  compareBuildItems,
  deriveBuildWorkflowView,
  describeBuildShortage,
  DIRECTION_LABELS,
  initialBuildDirection,
  isConveyorBeltBuilding,
  listBuildingRecipes,
  nextBeltDirection,
  type BuildCatalogEntryView,
} from '@/features/planet-map/build-workflow';
import { isSorterBuilding, DIRECTION_NAMES, OPPOSITE_DIRECTION, ROTATION_FACING, rotationTurns } from '@/features/planet-map/logistics-direction';
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

/** 卡片 aria-label 里的一行造价：只列物品（第 16 轮契约去掉资金维度）。 */
function formatCost(entry: BuildCatalogEntryView, itemName: (itemId: string) => string) {
  const items = entry.build_cost?.items ?? [];
  if (items.length === 0) {
    return '';
  }
  return items.map((item) => `${itemName(item.item_id)} ${item.quantity}`).join('、');
}

/** 锁定卡的解锁条件提示：任一未完成科技即可解锁（与服务端 any 语义一致）。 */
function formatUnlockCondition(catalog: CatalogView | undefined, entry: BuildCatalogEntryView, completedTechIds: ReadonlySet<string>) {
  const missing = missingUnlockTechIds(entry.unlock_tech, completedTechIds);
  if (missing.length === 0) {
    return '';
  }
  return missing.map((techId) => getTechDisplayName(catalog, techId)).join(' 或 ');
}

/** 卡片的可建造性：锁定（未解锁）/ debugOnly（无科技声明）都不是正常玩法可建的。 */
function entryLocked(entry: BuildCatalogEntryView) {
  return entry.visibility === 'locked' || entry.visibility === 'debugOnly';
}

/**
 * 分类页签（有序、去重）；空分类归到「其他」。
 * 同一分类里**已解锁建筑排在前**、未解锁的灰化卡排在后面（试玩 1016 U6），
 * 组内其余顺序沿用目录排序（推荐位 → 普通），保证每次渲染一致。
 */
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
  for (const group of groups) {
    const unlocked = group.entries.filter((entry) => !entryLocked(entry));
    const locked = group.entries.filter(entryLocked);
    group.entries = [...unlocked, ...locked];
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
  /**
   * 未解锁卡被点（试玩 1016 U6）：不进建造模式，只在状态行写「需研究：X」，
   * 并给一个「去科技树」入口（只做路由跳转，不改任何游戏状态）。
   */
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  // 新建筑尚无预渲染缩略图：加载失败则退回图标
  const [missingModels, setMissingModels] = useState<ReadonlySet<string>>(new Set());
  /**
   * 点了缺料的建造卡时记下它（试玩 1016 摩擦 1）：卡片可点但不进建造模式，
   * 底部状态行改为列出这件建筑缺什么。切到别的卡/进入建造模式即清空；
   * 背包补齐（不再缺任何物品）或卡片随分类切走后也会自动收起，避免清单过期。
   */
  const [shortageNotice, setShortageNotice] = useState<string | null>(null);

  const workflow = useMemo(() => deriveBuildWorkflowView({
    catalog,
    planet,
    playerId: session.playerId,
    summary,
  }), [catalog, planet, session.playerId, summary]);

  const activeBuildingType = interactionMode.kind === 'build' ? interactionMode.buildingType : null;
  const buildMode = interactionMode.kind === 'build';
  const beltMode = buildMode && isConveyorBeltBuilding(activeBuildingType ?? '');
  const sorterMode = buildMode && isSorterBuilding({ type: activeBuildingType ?? '' });
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

  /**
   * 朝向复位（试玩 1016 U-1）：R 在 5 档（传送带）/ 4 档（分拣器等）里循环，
   * 误点一次就得再点 3–4 次才能回到默认。Shift+R / 「重置朝向」按钮直接回到默认朝向。
   */
  const resetDirection = () => {
    const mode = usePlanetViewStore.getState().interactionMode;
    if (mode.kind !== 'build') {
      return;
    }
    if (isConveyorBeltBuilding(mode.buildingType)) setInteractionMode({ ...mode, direction: initialBuildDirection(mode.buildingType) });
    else setInteractionMode({ ...mode, rotation: 0 });
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
        // Shift+R = 朝向复位（试玩 1016 U-1）：不参与 5 档循环，直接回默认朝向。
        if (event.shiftKey) {
          event.preventDefault();
          resetDirection();
          return;
        }
        cycleBeltDirection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildMode, setInteractionMode]);

  const inventory = summary?.players?.[session.playerId]?.inventory;
  const activeShortage = useMemo(() => {
    if (!activeBuildingType) {
      return '';
    }
    return describeBuildShortage(
      catalog?.buildings?.find((entry) => entry.id === activeBuildingType),
      inventory,
      (itemId) => getItemDisplayName(catalog, itemId),
    );
  }, [activeBuildingType, catalog, inventory]);

  /**
   * 分类页签里列出的建筑（试玩 1016 U6）：未解锁建筑**按分类**默认可见，
   * 以灰化卡 + 「需研究：科技名」出现，排在本分类已解锁建筑之后。
   * 旧实现整类隐藏，`1 电力` 只有风机一张卡，玩家看不出这一类还有哪些可研究解锁。
   * 「显示未解锁」开关只再放出 debugOnly（无科技声明、正常玩法拿不到的建筑）。
   */
  const visibleEntries = useMemo(() => [
    ...workflow.catalog.recommended,
    ...workflow.catalog.unlocked,
    ...workflow.catalog.locked,
    ...(showLocked ? workflow.catalog.debugOnly : []),
  ], [workflow.catalog, showLocked]);
  const groups = useMemo(() => groupByCategory(visibleEntries), [visibleEntries]);

  // 缺料清单只在「仍然缺料」时成立：背包补齐 / 卡片不可见 / 进入建造模式都自动收起，
  // 否则清单会停在旧数字上（试玩 1016 复核）。
  const shortageEntry = shortageNotice
    ? visibleEntries.find((entry) => entry.id === shortageNotice)
    : undefined;
  const shortageMissing = useMemo(
    () => (shortageEntry ? compareBuildItems(shortageEntry, inventory).filter((item) => item.short) : []),
    [shortageEntry, inventory],
  );
  useEffect(() => {
    if (!shortageNotice) {
      return;
    }
    if (buildMode || !shortageEntry || shortageMissing.length === 0) {
      setShortageNotice(null);
    }
  }, [shortageNotice, buildMode, shortageEntry, shortageMissing.length]);

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

  // 未解锁卡的提示行：卡片随分类切走/科技补齐后自动收起，避免停在过期文案上。
  const lockedNoticeEntry = lockedNotice
    ? visibleEntries.find((entry) => entry.id === lockedNotice && entryLocked(entry))
    : undefined;
  const lockedNoticeUnlock = lockedNoticeEntry
    ? formatUnlockCondition(catalog, lockedNoticeEntry, completedTechIds)
    : '';

  const detailEntry = visibleEntries.find((entry) => entry.id === (hoveredId ?? activeBuildingType));
  const detail = detailEntry ? (() => {
    const locked = detailEntry.visibility === 'locked' || detailEntry.visibility === 'debugOnly';
    const unlockCondition = locked ? formatUnlockCondition(catalog, detailEntry, completedTechIds) : '';
    // 悬停提示明确列出缺什么（§4 契约：「悬停提示缺什么」），与服务端拒绝文案同口径。
    const detailShortage = describeBuildShortage(detailEntry, inventory, (itemId) => getItemDisplayName(catalog, itemId));
    return (
      <div className="planet-build-bar__detail" role="tooltip" data-testid="planet-build-detail">
        <strong>{translateBuildingType(detailEntry.id, detailEntry.name)}</strong>
        {locked ? <span className="is-short">未解锁{unlockCondition ? `：需要科技 ${unlockCondition}` : ''}</span> : null}
        <span className="planet-build-bar__detail-head">背包有 / 需要</span>
        {compareBuildItems(detailEntry, inventory).map((item) => (
          <span key={item.item_id} className={item.short ? 'is-short' : ''}>
            <Icon iconKey={item.item_id} size={12} /> {getItemDisplayName(catalog, item.item_id)} {item.owned} / {item.quantity}
          </span>
        ))}
        {detailShortage ? <span className="is-short">缺：{detailShortage}</span> : null}
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
            const locked = entryLocked(entry);
            const active = entry.id === activeBuildingType;
            const name = translateBuildingType(entry.id, entry.name);
            const cost = formatCost(entry, (itemId) => getItemDisplayName(catalog, itemId));
            const items = compareBuildItems(entry, inventory);
            const unaffordable = !locked && items.some((item) => item.short);
            const unlockCondition = locked ? formatUnlockCondition(catalog, entry, completedTechIds) : '';
            const itemText = items.map((item) => `${getItemDisplayName(catalog, item.item_id)} ${item.owned}/${item.quantity}${item.short ? '（不足）' : ''}`).join('、');
            const title = `${name}${cost ? ` · ${cost}` : ''}${itemText ? ` · 物品（背包有/需要）：${itemText}` : ''}${locked ? ` · 未解锁${unlockCondition ? ` · 需研究：${unlockCondition}` : ''}（点击查看解锁条件）` : ''}`;
            return (
              <button
                key={entry.id}
                className={`planet-build-card${active ? ' planet-build-card--active' : ''}${locked ? ' planet-build-card--locked' : ''}${unaffordable ? ' planet-build-card--unaffordable' : ''}`}
                data-building-id={entry.id}
                type="button"
                // 未解锁卡**原生可点**（试玩 1016 U6）：点了不进建造模式，只在状态行写
                // 「需研究：X」并给「去科技树」入口。不用 disabled——灰化卡也要能被读屏器/测试点到，
                // 锁定语义走 data-locked + aria-label 的「未解锁 · 需要科技」。
                data-locked={locked || undefined}
                data-shortage={unaffordable || undefined}
                aria-label={title}
                onMouseEnter={() => setHoveredId(entry.id)}
                onMouseLeave={() => setHoveredId((id) => (id === entry.id ? null : id))}
                onFocus={() => setHoveredId(entry.id)}
                onBlur={() => setHoveredId((id) => (id === entry.id ? null : id))}
                onClick={() => {
                  sfx.uiClick();
                  if (locked) {
                    // 不进建造模式，也不清掉玩家的建造模式：只把「需要哪项科技」摊开。
                    setLockedNotice(entry.id);
                    setShortageNotice(null);
                    return;
                  }
                  setLockedNotice(null);
                  if (unaffordable) {
                    // 不进建造模式：把「还缺什么」直接显示在建造栏底部，并清掉正在进行的建造模式，
                    // 避免玩家以为已经进入放置状态。
                    setShortageNotice(entry.id);
                    if (buildMode) {
                      exitInteractionMode();
                    }
                    return;
                  }
                  setShortageNotice(null);
                  if (active) {
                    exitInteractionMode();
                  } else {
                    setInteractionMode({ kind: 'build', buildingType: entry.id, direction: initialBuildDirection(entry.id) });
                  }
                }}
              >
                <span className="planet-build-card__icon">
                  {dimensional && !missingModels.has(entry.id) ? <img className="planet-build-card__model" src={`/assets/buildings/${entry.id}.png`} alt="" loading="lazy" onError={() => setMissingModels((prev) => new Set(prev).add(entry.id))} /> : <Icon iconKey={entry.icon_key || entry.id} color={entry.color} size={26} />}
                  {locked ? (
                    <Lock aria-hidden="true" className="planet-build-card__lock" size={11} strokeWidth={2.5} />
                  ) : null}
                  {unaffordable ? <span aria-hidden="true" className="planet-build-card__shortage-dot" /> : null}
                  {/* 数字键角标贴在图标左上角（DSP 口径）：只有已解锁建筑参与数字键选卡。 */}
                  {!locked && index < 9 ? <span aria-hidden="true" className="planet-build-card__hotkey">{index + 1}</span> : null}
                </span>
                {/* 未解锁：造价条位置改写成解锁条件（试玩 1016 U6），卡内直接可读，不必悬停。 */}
                {locked ? (
                  <span className="planet-build-card__unlock" aria-hidden="true">
                    {unlockCondition ? `需研究：${unlockCondition}` : '需研究'}
                  </span>
                ) : items.length > 0 ? (
                  <span aria-hidden="true" className="planet-build-card__cost">
                    {items.map((item) => (
                      <span key={item.item_id} className={`planet-build-card__cost-item${item.short ? ' is-short' : ''}`}>
                        <Icon iconKey={item.item_id} size={9} />
                        {item.owned}/{item.quantity}
                      </span>
                    ))}
                  </span>
                ) : null}
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
          {/* 未解锁建筑现在按分类常驻（灰化卡 + 需研究），这个开关只再放出 debugOnly 建筑。 */}
          <button
            aria-expanded={showLocked}
            aria-label={showLocked ? '隐藏调试建筑' : '显示调试建筑'}
            className="planet-build-bar__tool"
            onClick={() => setShowLocked((value) => !value)}
            title={showLocked ? '隐藏调试建筑' : '显示调试建筑（无科技声明、正常玩法拿不到）'}
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
      {/* 未解锁卡被点（试玩 1016 U6）：不进建造模式，状态行写「需研究：科技名」，
          并给一条去科技树的路由入口（纯跳转，不发命令）。 */}
      {!buildMode && lockedNoticeEntry ? (
        <div className="planet-build-bar__footer" data-testid="planet-build-locked">
          <div className="planet-build-bar__status">
            <span className="planet-build-bar__locked" role="status">
              {translateBuildingType(lockedNoticeEntry.id, lockedNoticeEntry.name)} 尚未解锁
              {lockedNoticeUnlock ? `：需研究 ${lockedNoticeUnlock}` : ''}
            </span>
            <button
              className="planet-build-bar__control"
              onClick={() => navigate('/tech')}
              title="打开科技树，查看解锁这项建筑的研究路线"
              type="button"
            >
              去科技树
            </button>
            <button
              className="planet-build-bar__control"
              onClick={() => setLockedNotice(null)}
              type="button"
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}
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
                {sorterMode
                  ? `放置 ${translateBuildingType(activeBuildingType ?? '')}：R 旋转（ghost 上虚线空心箭头 = 取货端，实心箭头 = 放货端），移动鼠标预览，点击放置，右键/Esc 退出`
                  : `放置 ${translateBuildingType(activeBuildingType ?? '')}：移动鼠标预览（ghost 上的箭头 = 物流方向），点击放置，右键/Esc 退出`}
              </span>
            )}
            <button
              className="planet-build-bar__control"
              type="button"
              title="旋转建筑或传送带方向（快捷键 R；Shift+R 复位朝向）"
              onClick={cycleBeltDirection}
              data-testid="planet-build-direction"
            >
              {/* 方位口径统一（试玩 1016 U3）：传送带与分拣器都写中文方位，不再一套显角度一套显方位。
                  分拣器写「朝向 东（从西取 → 往东放）」：朝向 = 放货端（正面），与机械臂/箭头一致。 */}
              {beltMode
                ? `方向：${DIRECTION_LABELS[buildDirection]}`
                : (() => {
                    const facing = ROTATION_FACING[rotationTurns(interactionMode.kind === 'build' ? interactionMode.rotation : 0)];
                    return sorterMode
                      ? `朝向 ${DIRECTION_NAMES[facing]}（从${DIRECTION_NAMES[OPPOSITE_DIRECTION[facing]]}取 → 往${DIRECTION_NAMES[facing]}放）`
                      : `朝向：${DIRECTION_NAMES[facing]}`;
                  })()} · R 旋转
            </button>
            {/* 误点 R 把带子铺反后不必再循环 3–4 次（试玩 1016 U-1）：一键回到默认朝向。 */}
            <button
              className="planet-build-bar__control"
              type="button"
              title="把朝向复位到默认（传送带朝东、分拣器朝北；快捷键 Shift+R）"
              onClick={resetDirection}
              data-testid="planet-build-direction-reset"
            >
              重置朝向
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
      {/* 缺料卡被点：不进建造模式，只把「还缺什么」摊开（试玩 1016 摩擦 1）。 */}
      {shortageNotice && shortageEntry && shortageMissing.length > 0 ? (
        <div className="planet-build-bar__footer" data-testid="planet-build-card-shortage">
          <div className="planet-build-bar__status">
            <span className="planet-build-bar__shortage" role="alert">
              建造 {translateBuildingType(shortageEntry.id, shortageEntry.name)} 还缺：
              {shortageMissing.map((item) => `${getItemDisplayName(catalog, item.item_id)} ×${item.quantity - item.owned}（背包 ${item.owned}/${item.quantity}）`).join('、')}
              。补齐背包物品后再点这张卡。
            </span>
            <button
              className="planet-build-bar__control"
              type="button"
              onClick={() => setShortageNotice(null)}
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
