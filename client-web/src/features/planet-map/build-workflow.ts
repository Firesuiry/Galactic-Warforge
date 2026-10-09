import { surfaceOffset, surfaceDistanceWithin } from '@shared/surface';
import type { PlanetPathView } from '@shared/types';
import type { Direction } from "@shared/api";
import type {
  BuildingCatalogEntry,
  CatalogView,
  ItemAmount,
  ItemInventory,
  PlanetResource,
  PlanetNetworksView,
  PlanetRuntimeView,
  Position,
  RecipeCatalogEntry,
  StateSummary,
} from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import {
  getResourceList,
  getTerrainTile,
  tileContainsBuilding,
  toTilePoint,
} from "@/features/planet-map/model";
import { type PlanetCommandJournalEntry } from "@/features/planet-commands/store";
import {
  executorOutOfRangeHint,
  resolvePlanetCommandHint,
  type PlanetCommandHint,
} from "@/features/planet-commands/error-hints";

import { normalizeCompletedTechIds } from "@/features/planet-map/research-workflow";
import {
  isBuildingUnlocked,
  isRecipeUnlocked,
  missingUnlockTechIds,
} from "@/features/planet-map/tech-gate";

const BUILD_RECOMMENDATION_ORDER = [
  "wind_turbine",
  "matrix_lab",
  "mining_machine",
  "tesla_tower",
  "conveyor_belt_mk1",
  "sorter_mk1",
  "depot_mk1",
  "planetary_logistics_station",
  "em_rail_ejector",
  "vertical_launching_silo",
  "ray_receiver",
] as string[];

const BUILD_RECOMMENDATION_PRIORITY = new Map(
  BUILD_RECOMMENDATION_ORDER.map((buildingId, index) => [buildingId, index]),
);

export interface BuildCatalogEntryView extends BuildingCatalogEntry {
  visibility: "recommended" | "unlocked" | "locked" | "debugOnly";
}

export interface BuildCatalogGroup {
  recommended: BuildCatalogEntryView[];
  unlocked: BuildCatalogEntryView[];
  locked: BuildCatalogEntryView[];
  debugOnly: BuildCatalogEntryView[];
}

export interface BuildReachability {
  executorUnitId?: string;
  executorPosition?: Position;
  moveRange?: number;
  operateRange?: number;
  distance?: number;
  inRange: boolean;
}

export interface BuildBlockedTile {
  x: number;
  y: number;
  terrain: string;
  reason: "terrain" | "building" | "resource" | "missing_resource" | "missing_host" | "unexplored";
  buildingId?: string;
  resourceId?: string;
  /**
   * 占位者信息（reason === 'building' 时）：建筑类型与是否己方，用于本地文案与服务端
   * tileOccupiedMessage 完全同口径（「该格已有你的建筑：风力涡轮机」/「该格已有其他玩家的建筑：X」）。
   * 类型未知（数据缺失）时留空，由文案层回退到「已被建筑占用」。
   */
  blockingBuildingType?: string;
  blockingBuildingOwn?: boolean;
  /** 施工任务信息（reason === 'building' 且该格被施工预留时）。 */
  blockingConstruction?: {
    /** 该施工任务的建筑类型（服务端 constructionReservationMessage 用目录显示名）。 */
    buildingType?: string;
    own: boolean;
    state: string;
  };
}

export interface BuildTileAssessment {
  footprint: {
    width: number;
    height: number;
  };
  /** 评估锚点（footprint 左上角格），用于把提示收敛到玩家真正点的那一格。 */
  anchor: { x: number; y: number };
  terrain: string;
  terrainBuildable: boolean;
  blockingBuildingId?: string;
  blockingResourceId?: string;
  buildable: boolean;
  blockedTiles: BuildBlockedTile[];
  /** footprint 内地形未知（未探索区）的格数；>0 表示本地无法判定，交给服务端。 */
  unexploredTiles: number;
  /** 背包缺少的建造物品（只在传入背包时计算）。 */
  missingItems: BuildItemShortage[];
}

/**
 * 阻挡原因的固定优先级：同一格/同一 footprint 同时命中多个原因时，
 * 必须每次给出同一个（否则提示会在「被资源点占用 / 已被建筑占用 / 地形不可建造」
 * 之间随 footprint 遍历顺序跳变，与真实原因不符）。
 * 排序：锚点格优先 > 原因优先级 > 坐标，结果完全确定。
 */
const BLOCK_REASON_ORDER: Record<BuildBlockedTile["reason"], number> = {
  building: 0,
  resource: 1,
  missing_host: 2,
  terrain: 3,
  missing_resource: 4,
  unexplored: 5,
};

/** 提示要报的那一格阻挡：锚点格优先，其次按原因优先级 + 坐标，保证确定性。 */
export function primaryBlockedTile(assessment: BuildTileAssessment): BuildBlockedTile | undefined {
  const { anchor } = assessment;
  return [...assessment.blockedTiles].sort((left, right) => {
    const leftAnchor = left.x === anchor.x && left.y === anchor.y ? 0 : 1;
    const rightAnchor = right.x === anchor.x && right.y === anchor.y ? 0 : 1;
    if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor;
    const byReason = BLOCK_REASON_ORDER[left.reason] - BLOCK_REASON_ORDER[right.reason];
    if (byReason !== 0) return byReason;
    return left.x - right.x || left.y - right.y;
  })[0];
}

export interface BuildItemShortage extends ItemAmount {
  owned: number;
}

/** 建造物品造价逐项对照背包：owned/quantity，缺的标 short。 */
export function compareBuildItems(entry: Pick<BuildingCatalogEntry, 'build_cost'> | undefined, inventory: ItemInventory | undefined) {
  return (entry?.build_cost?.items ?? []).map((item) => {
    const owned = inventory?.[item.item_id] ?? 0;
    return { ...item, owned, short: owned < item.quantity };
  });
}

/**
 * 预览旁显示的中文原因：缺料优先，其次第一处格子阻挡（原因与锚点格由 primaryBlockedTile 定序）。
 *
 * 占位（reason 'building'）必须与服务端回执完全同口径
 * （server/internal/gamecore/build_commands.go 的 tileOccupiedMessage /
 * constructionReservationMessage）：「该格已有你的建筑：风力涡轮机」/
 * 「该格已有其他玩家的建筑：X」/「该格已有你的施工任务：传送带 Mk.I（排队中）」。
 * 本地仍然拦截（不发命令），但玩家看到的文字与服务端一致（试玩 1011 E）。
 */
export function describeBuildBlock(
  assessment: BuildTileAssessment,
  itemName: (itemId: string) => string = (id) => id,
  buildingName: (buildingType: string) => string = (type) => type,
): string {
  if (assessment.missingItems.length > 0) {
    return `缺少 ${assessment.missingItems.map((item) => `${itemName(item.item_id)} ${item.quantity - item.owned}`).join('、')}`;
  }
  const blocked = primaryBlockedTile(assessment);
  if (!blocked) return '';
  switch (blocked.reason) {
    case 'terrain': return '地形不可建造';
    case 'building': return describeTileOccupant(blocked, buildingName);
    case 'resource': return '被资源点占用';
    case 'missing_host': return '需要建在己方仓库上';
    case 'unexplored': return '未探索区域，是否可建由服务器判定';
    default: return '需要建在资源点上';
  }
}

/** 施工任务状态 → 服务端 constructionReservationMessage 的措辞（排队中 / 建造中）。 */
function constructionStateLabel(state: string) {
  return state === 'in_progress' ? '建造中' : '排队中';
}

/** 占位回执文案：施工任务优先（服务端先查建筑再查施工预留，但同格两者不可能共存）。 */
function describeTileOccupant(
  blocked: BuildBlockedTile,
  buildingName: (buildingType: string) => string,
): string {
  const task = blocked.blockingConstruction;
  if (task) {
    const owner = task.own ? '你的' : '其他玩家的';
    const name = task.buildingType ? buildingName(task.buildingType) : '';
    return `该格已有${owner}施工任务：${name}（${constructionStateLabel(task.state)}）`;
  }
  if (blocked.blockingBuildingType) {
    const owner = blocked.blockingBuildingOwn ? '你的' : '其他玩家的';
    return `该格已有${owner}建筑：${buildingName(blocked.blockingBuildingType)}`;
  }
  return '已被建筑占用';
}

/**
 * 本地预检是否应当拦截建造：
 * 未探索区（地形 unknown）客户端没有地形数据，无法判定——照常把命令发给服务端，以回执为准；
 * 只要锚点格确知不可建（水/岩浆/已占用/资源点）或背包确实缺料，才本地拦截。
 */
export function shouldBlockBuildLocally(assessment: BuildTileAssessment | undefined): boolean {
  if (!assessment) return false;
  if (assessment.missingItems.length > 0) return true;
  const primary = primaryBlockedTile(assessment);
  if (!primary) return false;
  return primary.reason !== 'unexplored';
}

export interface BuildApproachPlan {
  distanceGap?: number;
  landingPosition?: Position;
  firstWaypoint?: Position;
  waypoints: Position[];
}

export interface BuildWorkflowView {
  catalog: BuildCatalogGroup;
  reachability: BuildReachability;
  tileAssessment?: BuildTileAssessment;
  approachPlan?: BuildApproachPlan;
  preflightHints: PlanetCommandHint[];
  postBuildHints: PlanetCommandHint[];
}

function sortCatalogEntries(
  left: BuildCatalogEntryView,
  right: BuildCatalogEntryView,
) {
  const leftPriority = BUILD_RECOMMENDATION_PRIORITY.get(left.id) ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = BUILD_RECOMMENDATION_PRIORITY.get(right.id) ?? Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

function buildCatalogGroups(
  catalog: CatalogView | undefined,
  summary: StateSummary | undefined,
  playerId: string,
): BuildCatalogGroup {
  const completedTechIds = new Set(
    normalizeCompletedTechIds(summary?.players?.[playerId]?.tech),
  );
  const groups: BuildCatalogGroup = {
    recommended: [],
    unlocked: [],
    locked: [],
    debugOnly: [],
  };

  for (const entry of catalog?.buildings ?? []) {
    if (!entry.buildable) {
      continue;
    }

    const unlockTechs = entry.unlock_tech?.filter(Boolean) ?? [];
    const viewEntry: BuildCatalogEntryView = {
      ...entry,
      visibility: "unlocked",
    };

    if (unlockTechs.length === 0) {
      viewEntry.visibility = "debugOnly";
      groups.debugOnly.push(viewEntry);
      continue;
    }

    // 任一已完成科技声明解锁即可（对齐服务端 CanBuildTech）：
    // 早期这里用 every，声明了两个科技的矩阵研究站被硬禁用（试玩报告阻断级 #2）。
    if (!isBuildingUnlocked(entry, completedTechIds)) {
      viewEntry.visibility = "locked";
      groups.locked.push(viewEntry);
      continue;
    }

    if (BUILD_RECOMMENDATION_PRIORITY.has(entry.id)) {
      viewEntry.visibility = "recommended";
      groups.recommended.push(viewEntry);
      continue;
    }

    groups.unlocked.push(viewEntry);
  }

  return {
    recommended: groups.recommended.sort(sortCatalogEntries),
    unlocked: groups.unlocked.sort(sortCatalogEntries),
    locked: groups.locked.sort(sortCatalogEntries),
    debugOnly: groups.debugOnly.sort(sortCatalogEntries),
  };
}

function buildReachability(
  planet: PlanetRenderView,
  summary: StateSummary | undefined,
  playerId: string,
  selectedPosition?: Position,
) {
  const executorState = summary?.players?.[playerId]?.executor;
  const executorUnitId = executorState?.unit_id;
  const executor = executorUnitId ? planet.units?.[executorUnitId] : undefined;
  const moveRange = executor?.move_range;
  const operateRange = executorState?.operate_range;
  const distance = executor?.position && selectedPosition
    ? surfaceDistanceWithin(executor.position, selectedPosition, planet.surface.face_size, operateRange ?? 16)
    : undefined;

  return {
    executorUnitId,
    executorPosition: executor?.position,
    moveRange,
    operateRange,
    distance,
    inRange: !selectedPosition || !executor?.position || operateRange === undefined
      ? true
      : distance !== undefined && distance <= operateRange,
  } satisfies BuildReachability;
}

function findBlockingResource(
  resources: PlanetResource[],
  x: number,
  y: number,
) {
  return resources.find((resource) => {
    const position = toTilePoint(resource.position);
    return position.x === x && position.y === y;
  });
}

function buildTileAssessment(input: {
  playerId?: string;
  rotation?: number;
  inventory?: ItemInventory;
  catalog?: CatalogView;
  buildingType?: string;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  selectedPosition?: Position;
}) {
  if (!input.selectedPosition) {
    return undefined;
  }

  const entry = input.catalog?.buildings?.find(
    (candidate) => candidate.id === input.buildingType,
  );
  const anchor = toTilePoint(input.selectedPosition);
  const missingItems: BuildItemShortage[] = input.inventory
    ? compareBuildItems(entry, input.inventory).filter((item) => item.short).map(({ short: _short, ...item }) => item)
    : [];
  const footprint = {
    width: Math.max(1, entry?.footprint?.width ?? 1),
    height: Math.max(1, entry?.footprint?.height ?? 1),
  };
  if (input.rotation === 90 || input.rotation === 270) [footprint.width, footprint.height] = [footprint.height, footprint.width];
  // 采集建筑（requires_resource_node）必须压在资源点上，与服务端校验对齐：
  // 资源格不算阻挡，但锚点格必须命中资源点，否则本地拦截。
  const requiresResourceNode = entry?.requires_resource_node === true;
  const isFoundation = input.buildingType === "foundation";
  const isDistributor = input.buildingType === "logistics_distributor";
  const canPrepareTerrain = (terrain: string) => isFoundation && ["water", "lava", "blocked"].includes(terrain);
  const blockedTiles: BuildBlockedTile[] = [];
  const resources = getResourceList(input.planet);
  // 施工任务（服务端权威）：同格已有施工预留时，占位回执必须说「施工任务」而不是「建筑」
  // （试玩 1011 E）。施工任务列表只含己方任务，别人的任务只能靠「同一格 + 类型不同」推断。
  const constructionTasks = input.runtime?.construction_tasks?.filter(
    (task) => task.state !== 'cancelled' && task.state !== 'completed',
  ) ?? [];
  const constructionAt = (x: number, y: number) => constructionTasks.find(
    (task) => Math.round(task.position.x) === x && Math.round(task.position.y) === y,
  );
  const constructionBlocker = (task: NonNullable<ReturnType<typeof constructionAt>>) => ({
    buildingType: task.building_type,
    own: Boolean(input.playerId) && task.player_id === input.playerId,
    state: task.state,
  });
  let unexploredTiles = 0;

  if (isDistributor) {
    const buildings = Object.values(input.planet.buildings ?? {});
    const host = buildings.find(building => (building.type === 'depot_mk1' || building.type === 'depot_mk2')
      && building.position.x === input.selectedPosition!.x && building.position.y === input.selectedPosition!.y
      && building.position.z === 0 && building.job?.type !== 'demolish'
      && (!input.playerId || building.owner_id === input.playerId));
    const mounted = buildings.find(building => building.type === 'logistics_distributor'
      && building.position.x === input.selectedPosition!.x && building.position.y === input.selectedPosition!.y);
    const terrain = getTerrainTile(input.planet, input.selectedPosition.x, input.selectedPosition.y);
    if (!host || mounted) blockedTiles.push({
      ...input.selectedPosition,
      terrain,
      reason: mounted ? 'building' : 'missing_host',
      buildingId: mounted?.id,
      ...(mounted ? {
        blockingBuildingType: mounted.type,
        blockingBuildingOwn: Boolean(input.playerId) && mounted.owner_id === input.playerId,
      } : {}),
    });
    return { footprint, anchor, terrain, terrainBuildable: true, buildable: blockedTiles.length === 0 && missingItems.length === 0, blockedTiles, unexploredTiles, missingItems, blockingBuildingId: mounted?.id } satisfies BuildTileAssessment;
  }

  for (let dy = 0; dy < footprint.height; dy += 1) {
    for (let dx = 0; dx < footprint.width; dx += 1) {
      const {x,y} = surfaceOffset(input.selectedPosition, dx, dy, input.planet.map_width / 3);
      const terrain = getTerrainTile(input.planet, x, y);
      const blockingBuilding = Object.values(input.planet.buildings ?? {}).find((building) => (isFoundation || building.type !== "foundation") && tileContainsBuilding(building, x, y, input.planet.map_width / 3));
      const blockingResource = findBlockingResource(resources, x, y);
      const blockingTask = constructionAt(x, y);

      // 未探索格：客户端没有该格地形（unknown），是否可建只有服务端知道——
      // 记为 unexplored（不拦截），让 build 命令照常下发，以服务端回执为准。
      if (terrain === "unknown") {
        unexploredTiles += 1;
        blockedTiles.push({ x, y, terrain, reason: "unexplored" });
      } else if (terrain !== "buildable" && !canPrepareTerrain(terrain)) {
        blockedTiles.push({ x, y, terrain, reason: "terrain" });
      }
      if (blockingBuilding) {
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "building",
          buildingId: blockingBuilding.id,
          blockingBuildingType: blockingBuilding.type,
          blockingBuildingOwn: Boolean(input.playerId) && blockingBuilding.owner_id === input.playerId,
        });
      } else if (blockingTask) {
        // 该格已被施工任务预留：服务端 execBuild 在占位检查之后、Enqueue 之前直接回
        // constructionReservationMessage（IsTileReserved 命中即拒，与建筑类型无关）。
        // 这里据此把该格记为阻挡，文案与服务端同口径（试玩 1011 E）。
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "building",
          blockingConstruction: constructionBlocker(blockingTask),
        });
      }
      if (blockingResource && !requiresResourceNode) {
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "resource",
          resourceId: blockingResource.id,
        });
      }
    }
  }
  const primaryTerrain = getTerrainTile(
    input.planet,
    input.selectedPosition.x,
    input.selectedPosition.y,
  );
  if (
    requiresResourceNode
    && !findBlockingResource(
      resources,
      input.selectedPosition.x,
      input.selectedPosition.y,
    )
  ) {
    blockedTiles.push({
      x: input.selectedPosition.x,
      y: input.selectedPosition.y,
      terrain: primaryTerrain,
      reason: "missing_resource",
    });
  }
  const blockingBuildingId = blockedTiles.find(
    (tile) => tile.reason === "building",
  )?.buildingId;
  const blockingResourceId = blockedTiles.find(
    (tile) => tile.reason === "resource",
  )?.resourceId;

  return {
    footprint,
    anchor,
    terrain: primaryTerrain,
    terrainBuildable: primaryTerrain === "buildable" || canPrepareTerrain(primaryTerrain),
    blockingBuildingId,
    blockingResourceId,
    buildable: blockedTiles.length === 0 && missingItems.length === 0,
    blockedTiles,
    unexploredTiles,
    missingItems,
  } satisfies BuildTileAssessment;
}

function buildApproachPlan(path?: PlanetPathView): BuildApproachPlan | undefined {
  if(!path?.reachable || !path.waypoints.length)return undefined;
  return {distanceGap:path.distance,landingPosition:path.path.at(-1),firstWaypoint:path.waypoints[0],waypoints:path.waypoints};
}

function buildPreflightHints(reachability: BuildReachability) {
  if (
    !reachability.executorUnitId
    || !reachability.executorPosition
    || reachability.operateRange === undefined
    || reachability.inRange
  ) {
    return [];
  }

  if (reachability.distance === undefined) return [{
    tone: "warning" as const,
    title: "当前执行体无法直接建造到目标坐标",
    detail: `目标不在执行体的 ${reachability.operateRange} 格操作范围内，请先移动执行体。`,
    suggestedAction: "move_executor" as const,
  }];
  return [executorOutOfRangeHint(reachability.distance, reachability.operateRange)];
}

function resolveSelectedBuilding(
  planet: PlanetRenderView,
  selectedPosition?: Position,
) {
  if (!selectedPosition) {
    return undefined;
  }
  return Object.values(planet.buildings ?? {}).find((building) =>
    tileContainsBuilding(building, selectedPosition.x, selectedPosition.y, planet.map_width / 3),
  );
}

function buildPostBuildHints(input: {
  journal?: PlanetCommandJournalEntry[];
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  selectedPosition?: Position;
}) {
  const selectedBuilding = resolveSelectedBuilding(
    input.planet,
    input.selectedPosition,
  );

  const journalHint = input.journal?.find(
    (entry) =>
      entry.commandType === "build"
      && entry.focus?.position
      && input.selectedPosition
      && toTilePoint(entry.focus.position).x === toTilePoint(input.selectedPosition).x
      && toTilePoint(entry.focus.position).y === toTilePoint(input.selectedPosition).y
      && entry.nextHint,
  )?.nextHint;

  if (journalHint) {
    return [
      {
        tone: "info",
        title: journalHint,
        detail: "来自服务器命令回执。",
      } satisfies PlanetCommandHint,
    ];
  }

  const networkReason = selectedBuilding
    ? input.networks?.power_coverage?.find(
      (coverage) => coverage.building_id === selectedBuilding.id,
    )?.reason
    : undefined;
  const hint = resolvePlanetCommandHint({
    reason: selectedBuilding?.runtime?.state_reason || networkReason,
  });
  return hint ? [hint] : [];
}

/**
 * 公开的建造格评估（供地图幽灵预览/点击放置预检使用）。
 * 返回 undefined 表示没有目标点。
 */
export function assessBuildTiles(
  catalog: CatalogView | undefined,
  buildingType: string | undefined,
  planet: PlanetRenderView,
  position?: Position,
  playerId?: string,
  rotation?: number,
  inventory?: ItemInventory,
  runtime?: PlanetRuntimeView,
): BuildTileAssessment | undefined {
  return buildTileAssessment({ catalog, buildingType, planet, runtime, selectedPosition: position, playerId, rotation, inventory });
}

/** 传送带类建筑：放置时需要指定输出方向（服务端按方向对接输入端口）。 */
export function isConveyorBeltBuilding(buildingType: string) {
  return buildingType.startsWith("conveyor_belt");
}

/** 建造模式下传送带方向的循环顺序（R 键/按钮共用）。 */
export const BELT_DIRECTION_CYCLE: Direction[] = ["auto", "north", "east", "south", "west"];

export const DIRECTION_LABELS: Record<Direction, string> = {
  auto: "自动",
  north: "北",
  east: "东",
  south: "南",
  west: "西",
};

export function nextBeltDirection(current: Direction): Direction {
  const index = BELT_DIRECTION_CYCLE.indexOf(current);
  return BELT_DIRECTION_CYCLE[(index + 1) % BELT_DIRECTION_CYCLE.length];
}

/**
 * 建筑可携配方列表（建造时选定，写入 interactionMode.recipeId 随 build 命令下发）。
 * 配方归属由 recipe.building_types 声明（与服务端校验一致）；
 * 科技门控判定统一走 tech-gate.isRecipeUnlocked（对齐服务端 CanUseRecipeTech：
 * 无门控 = 基础配方，有门控则任一完成即可）。
 */
export function listBuildingRecipes(
  catalog: CatalogView | undefined,
  buildingType: string,
  completedTechIds: Iterable<string>,
): RecipeCatalogEntry[] {
  const completed = new Set(completedTechIds);
  return (catalog?.recipes ?? []).filter((recipe) => {
    if (!recipe.building_types?.includes(buildingType)) {
      return false;
    }
    return isRecipeUnlocked(recipe, completed);
  });
}

export function deriveBuildWorkflowView(input: {
  pathPlan?: PlanetPathView;
  catalog?: CatalogView;
  buildingType?: string;
  journal?: PlanetCommandJournalEntry[];
  networks?: PlanetNetworksView;
  planet: PlanetRenderView;
  playerId: string;
  runtime?: PlanetRuntimeView;
  selectedPosition?: Position;
  summary?: StateSummary;
}): BuildWorkflowView {
  const catalog = buildCatalogGroups(input.catalog, input.summary, input.playerId);
  const reachability = buildReachability(
    input.planet,
    input.summary,
    input.playerId,
    input.selectedPosition,
  );
  const tileAssessment = buildTileAssessment(input);
  const approachPlan = buildApproachPlan(input.pathPlan);

  return {
    catalog,
    reachability,
    tileAssessment,
    approachPlan,
    preflightHints: buildPreflightHints(reachability),
    postBuildHints: buildPostBuildHints(input),
  };
}
