import { surfaceOffset, surfaceDistanceWithin } from '@shared/surface';
import type { PlanetPathView } from '@shared/types';
import type { Direction } from "@shared/api";
import type {
  BuildingCatalogEntry,
  CatalogView,
  ConstructionTaskView,
  ItemAmount,
  ItemInventory,
  PlanetResource,
  PlanetNetworksView,
  PlanetRuntimeView,
  Position,
  RecipeCatalogEntry,
  StateSummary,
} from "@shared/types";

import type { Building } from "@shared/types";

import type { PlanetRenderView } from "@/features/planet-map/model";
import { beltElevation, clampBeltElevation, isLowLogisticsType, occupiesGround } from "@/features/planet-map/logistics-tier";
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
import { selectMyMecha, type MechaView } from "@/features/mecha/model";
import {
  isBuildingUnlocked,
  isRecipeUnlocked,
  missingUnlockTechIds,
} from "@/features/planet-map/tech-gate";

/**
 * 执行体操作范围兜底值（cell）：summary 的 `mechas[].operate_range` 缺失时用它，
 * 与 `server/data/units.yaml` 的 `executor.mecha.operate_range`（细分网格 ×3 后为 18）一致。
 */
export const DEFAULT_OPERATE_RANGE = 18;

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
  /** 我的机甲档案（未绑定 / 不在本星球时为 undefined）。 */
  executorMecha?: MechaView;
  moveRange?: number;
  operateRange?: number;
  distance?: number;
  inRange: boolean;
}

export interface BuildBlockedTile {
  x: number;
  y: number;
  terrain: string;
  reason: "terrain" | "building" | "resource" | "missing_resource" | "missing_host" | "unexplored" | "overhead_belt" | "invalid_elevation" | "elevated_ground_occupied";
  buildingId?: string;
  resourceId?: string;
  /** 高架带脚下占位者（reason === 'elevated_ground_occupied' 时）：地面层建筑 id。 */
  groundBuildingId?: string;
  groundBuildingType?: string;
  groundBuildingOwn?: boolean;
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
  /**
   * 发令者未绑定机甲（契约 §7.3）：建造由机甲执行，服务端会回 EXECUTOR_UNAVAILABLE。
   * 与「缺料」是两回事——未绑定时背包不存在，不能把所有造价项都算成缺料。
   */
  mechaUnbound?: boolean;
}

/**
 * 阻挡原因的固定优先级：同一格/同一 footprint 同时命中多个原因时，
 * 必须每次给出同一个（否则提示会在「被资源点占用 / 已被建筑占用 / 地形不可建造」
 * 之间随 footprint 遍历顺序跳变，与真实原因不符）。
 * 排序：锚点格优先 > 原因优先级 > 坐标，结果完全确定。
 */
const BLOCK_REASON_ORDER: Record<BuildBlockedTile["reason"], number> = {
  invalid_elevation: 0,
  elevated_ground_occupied: 1,
  building: 2,
  overhead_belt: 3,
  resource: 4,
  missing_host: 5,
  terrain: 6,
  missing_resource: 7,
  unexplored: 8,
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
 * 买不起的原因文案（不看格子，只看造价余额）：只按背包物品算，
 * 与服务端拒绝/本地预检同口径——「缺少 齿轮 1、铁块 6」。
 * 建造栏的缺料提示条与鼠标旁的放置提示都用它，玩家在两处看到同一句话（试玩 1014 层 01 P2）。
 * 第 16 轮契约去掉资金维度后不再有「矿石不足」这一项。
 */
export function describeBuildShortage(
  entry: Pick<BuildingCatalogEntry, 'build_cost'> | undefined,
  inventory: ItemInventory | undefined,
  itemName: (itemId: string) => string = (id) => id,
): string {
  return compareBuildItems(entry, inventory)
    .filter((item) => item.short)
    .map((item) => `${itemName(item.item_id)} ${item.quantity - item.owned}`)
    .join('、');
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
export const MECHA_UNBOUND_REASON = "未绑定机甲：先在行星上接管一台";

export function describeBuildBlock(
  assessment: BuildTileAssessment,
  itemName: (itemId: string) => string = (id) => id,
  buildingName: (buildingType: string) => string = (type) => type,
): string {
  // 未绑定机甲排在缺料之前：背包都不存在，「缺料」是假原因（契约 §7.3）。
  if (assessment.mechaUnbound) return MECHA_UNBOUND_REASON;
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
    case 'overhead_belt': return '上方有高架传送带';
    case 'invalid_elevation': return '只有传送带可以架高';
    // 与服务端 POSITION_OCCUPIED 同字（build_commands.go 高架带放置：地面占用只能是空地或 LowLogistics）。
    case 'elevated_ground_occupied': return '高架传送带不能架在建筑上方';
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
  if (assessment.mechaUnbound) return true;
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
  // 契约 §7.3：建造扣料/走位按「我的机甲」（summary.mechas 里 operator = 自己），
  // 不再读 players[me].executor。档案自带 operate_range（units.yaml executor.mecha）。
  const myMecha = selectMyMecha(summary, playerId);
  const executorUnitId = myMecha?.unit_id;
  const executor = executorUnitId ? planet.units?.[executorUnitId] : undefined;
  const moveRange = executor?.move_range;
  const operateRange = myMecha?.operate_range;
  const distance = executor?.position && selectedPosition
    ? surfaceDistanceWithin(executor.position, selectedPosition, planet.surface.face_size, operateRange ?? DEFAULT_OPERATE_RANGE)
    : undefined;

  return {
    executorUnitId,
    executorPosition: executor?.position,
    executorMecha: myMecha,
    moveRange,
    operateRange,
    distance,
    inRange: !selectedPosition || !executor?.position || operateRange === undefined
      ? true
      : distance !== undefined && distance <= operateRange,
  } satisfies BuildReachability;
}

/**
 * 施工任务的层（第 19 轮 §3.2）：服务端施工任务带 `elevation`（高架传输带 >0），
 * shared-client 的 `ConstructionTaskView` 还没收这个字段（本分支不动 shared-client），
 * 所以在本地按可选字段读，缺省 0（旧数据/地面任务照旧按地面层算）。
 */
function constructionElevation(task: ConstructionTaskView): number {
  return (task as ConstructionTaskView & { elevation?: number }).elevation ?? 0;
}

function findBlockingResource(  resources: PlanetResource[],
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
  /** 第 19 轮多层传送带：目标高度 0–4（缺省 0）。 */
  elevation?: number;
  /** 发令者未绑定机甲（建造由机甲执行，本地直接拦）。 */
  mechaUnbound?: boolean;
}) {
  if (!input.selectedPosition) {
    return undefined;
  }

  const entry = input.catalog?.buildings?.find(
    (candidate) => candidate.id === input.buildingType,
  );
  const anchor = toTilePoint(input.selectedPosition);
  // 未绑定机甲时没有背包：缺料清单留空，由 mechaUnbound 单独说明（不是「所有造价都缺」）。
  const missingItems: BuildItemShortage[] = input.inventory
    ? compareBuildItems(entry, input.inventory).filter((item) => item.short).map(({ short: _short, ...item }) => item)
    : [];
  const footprint = {
    width: Math.max(1, entry?.footprint?.width ?? 1),
    height: Math.max(1, entry?.footprint?.height ?? 1),
  };
  if (input.rotation === 90 || input.rotation === 270) [footprint.width, footprint.height] = [footprint.height, footprint.width];
  // 采集建筑（requires_resource_node）与 ValidateCollectorSite 对齐：覆盖范围是
  // 「占地 + max(1, coverage_radius) 圈」，**范围里任意一格**有矿即合法，锚点格
  // 本身不必是矿（3×3 矿机覆盖 5×5，锚点常落在矿脉外圈）。
  const requiresResourceNode = entry?.requires_resource_node === true;
  const collectorRings = requiresResourceNode ? Math.max(1, entry?.coverage_radius ?? 1) : 0;
  const isFoundation = input.buildingType === "foundation";
  const isDistributor = input.buildingType === "logistics_distributor";
  const canPrepareTerrain = (terrain: string) => isFoundation && ["water", "lava", "blocked"].includes(terrain);
  const blockedTiles: BuildBlockedTile[] = [];
  const resources = getResourceList(input.planet);
  const isBelt = input.buildingType?.startsWith('conveyor_belt') === true;
  // 非传送带给 elevation>0：服务端直接拒（INVALID_ELEVATION「只有传送带可以架高」），本地同口径。
  const invalidElevation = !isBelt && (input.elevation ?? 0) > 0;
  const targetElevation = isBelt ? clampBeltElevation(input.elevation ?? 0) : 0;
  // 施工任务（服务端权威）：同格已有施工预留时，占位回执必须说「施工任务」而不是「建筑」
  // （试玩 1011 E）。施工任务列表只含己方任务，别人的任务只能靠「同一格 + 类型不同」推断。
  // 第 19 轮 §3.2：施工预留**按层**（服务端键 `x:y@e`），所以这里也只认同层的任务——
  // 2 层的施工任务不挡 0 层的建造，反之亦然（M3）。
  const constructionTasks = input.runtime?.construction_tasks?.filter(
    (task) => task.state !== 'cancelled' && task.state !== 'completed',
  ) ?? [];
  const constructionAt = (x: number, y: number) => constructionTasks.find(
    (task) => Math.round(task.position.x) === x && Math.round(task.position.y) === y
      && clampBeltElevation(constructionElevation(task)) === targetElevation,
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
    return { footprint, anchor, terrain, terrainBuildable: true, buildable: blockedTiles.length === 0 && missingItems.length === 0 && !input.mechaUnbound, blockedTiles, unexploredTiles, missingItems, mechaUnbound: input.mechaUnbound, blockingBuildingId: mounted?.id } satisfies BuildTileAssessment;
  }

  // 覆盖格（占地 + 采集圈）：锚点判断与阻挡扫描共用，避免两处坐标推导漂移。
  const footprintCells: { x: number; y: number }[] = [];
  for (let dy = -collectorRings; dy < footprint.height + collectorRings; dy += 1) {
    for (let dx = -collectorRings; dx < footprint.width + collectorRings; dx += 1) {
      const { x, y } = surfaceOffset(input.selectedPosition, dx, dy, input.planet.map_width / 3);
      footprintCells.push({ x, y });
    }
  }
  const footprintCellKeys = new Set(footprintCells.map((cell) => `${cell.x},${cell.y}`));
  // 高架带只压 LowLogistics；地面层带子/其它建筑照旧占格。
  const occupiesLayer = (building: Building) => targetElevation > 0
    ? beltElevation(building) === targetElevation
    : beltElevation(building) === 0;
  const buildings = Object.values(input.planet.buildings ?? {});

  for (let dy = 0; dy < footprint.height; dy += 1) {
    for (let dx = 0; dx < footprint.width; dx += 1) {
      const {x,y} = surfaceOffset(input.selectedPosition, dx, dy, input.planet.map_width / 3);
      const terrain = getTerrainTile(input.planet, x, y);
      const sameLayerBuilding = buildings.find((building) => occupiesLayer(building) && (isFoundation || building.type !== "foundation") && tileContainsBuilding(building, x, y, input.planet.map_width / 3));
      // 高架带（elevation>0）只看同层占用：地面带/分拣器等 LowLogistics 允许压在下面。
      const blockingBuilding = sameLayerBuilding;
      // 高架带脚下只能是空地或 LowLogistics：地面层压着非 LowLogistics 建筑时
      // 服务端回 POSITION_OCCUPIED「高架传送带不能架在建筑上方」（M1，文案与服务端同字）。
      // 地面占用按 occupiesGround 判（服务端 TileBuilding 口径）：地基、物流配送器、
      // z>0 叠层与高架带都不登记地面格，不挡高架带。
      const groundOccupant = targetElevation > 0
        // 服务端按 TileBuilding 判（地基/配送器/z>0 叠层不登记地面格），这里用同一口径。
        ? buildings.find((building) => occupiesGround(building) && tileContainsBuilding(building, x, y, input.planet.map_width / 3))
        : undefined;
      const blockingResource = findBlockingResource(resources, x, y);
      const blockingTask = constructionAt(x, y);
      if (invalidElevation) {
        blockedTiles.push({ x, y, terrain, reason: "invalid_elevation" });
      }
      // 地面建筑（非 LowLogistics）不能建在有高架带的格子上：任一占地格有高架带即拒。
      // 物流配送器不走这里：它在上面有独立分支（只查宿主仓库）并提前返回，因此不需要
      // 在这里再写豁免（旧条件 `!== "logistics_distributor"` 不可达，已删）。
      const overheadBelt = !invalidElevation && targetElevation === 0 && input.buildingType
        && !isLowLogisticsType(input.buildingType)
        ? buildings.find((building) => beltElevation(building) > 0 && tileContainsBuilding(building, x, y, input.planet.map_width / 3))
        : undefined;

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
      if (overheadBelt) {
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "overhead_belt",
          buildingId: overheadBelt.id,
        });
      }
      if (groundOccupant && !isLowLogisticsType(groundOccupant.type)) {
        blockedTiles.push({
          x,
          y,
          terrain,
          reason: "elevated_ground_occupied",
          buildingId: groundOccupant.id,
          groundBuildingId: groundOccupant.id,
          groundBuildingType: groundOccupant.type,
          groundBuildingOwn: Boolean(input.playerId) && groundOccupant.owner_id === input.playerId,
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
  if (requiresResourceNode) {
    const covered = footprintCells.some((cell) => findBlockingResource(resources, cell.x, cell.y));
    if (!covered) {
      blockedTiles.push({
        x: input.selectedPosition.x,
        y: input.selectedPosition.y,
        terrain: primaryTerrain,
        reason: "missing_resource",
      });
    }
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
    buildable: blockedTiles.length === 0 && missingItems.length === 0 && !input.mechaUnbound,
    blockedTiles,
    unexploredTiles,
    missingItems,
    mechaUnbound: input.mechaUnbound,
  } satisfies BuildTileAssessment;
}

function buildApproachPlan(path?: PlanetPathView): BuildApproachPlan | undefined {
  if(!path?.reachable || !path.waypoints.length)return undefined;
  return {distanceGap:path.distance,landingPosition:path.path.at(-1),firstWaypoint:path.waypoints[0],waypoints:path.waypoints};
}

function buildPreflightHints(reachability: BuildReachability) {
  // 未绑定机甲：建造无从扣料/走位（服务端回 EXECUTOR_UNAVAILABLE），先提示去接管。
  if (!reachability.executorUnitId && !reachability.executorMecha) {
    return [{
      tone: "warning" as const,
      title: MECHA_UNBOUND_REASON,
      detail: "建造由你的机甲执行：在行星上选中一台机甲 → 接管。",
      suggestedAction: "move_executor" as const,
    }];
  }
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
  elevation?: number,
  mechaUnbound?: boolean,
): BuildTileAssessment | undefined {
  return buildTileAssessment({ catalog, buildingType, planet, runtime, selectedPosition: position, playerId, rotation, inventory, elevation, mechaUnbound });
}

/** 传送带类建筑：放置时需要指定输出方向（服务端按方向对接输入端口）。 */
export function isConveyorBeltBuilding(buildingType: string) {
  return buildingType.startsWith("conveyor_belt");
}

/** 建造模式下传送带方向的循环顺序（R 键/按钮共用）：从「东」起，auto 只是显式选项。 */
export const BELT_DIRECTION_CYCLE: Direction[] = ["east", "north", "south", "west", "auto"];

/**
 * 传送带单格放置的默认方向。
 *
 * 试玩 1015 §6-4：默认 auto 的带子**不带货**——服务端把 auto 原样存进 conveyor，
 * 自动解析只在「相邻带已给出方向」时才成立，玩家第一次铺线必然踩坑（本段踩了两次）。
 * 单格放置默认用建造栏显示的方向（R 旋转），auto 只作显式选项。
 */
// 类型故意用字面量（不用 `Direction`）：拖拽铺带的第一格要把它当 `SurfaceDirection` 用。
export const DEFAULT_BELT_DIRECTION = "east";

/** 进入建造模式时的初始方向：传送带默认「东」，其他建筑的 direction 无意义（保持 auto）。 */
export function initialBuildDirection(buildingType: string): Direction {
  return isConveyorBeltBuilding(buildingType) ? DEFAULT_BELT_DIRECTION : "auto";
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  auto: "自动（不解析方向，带子不带货）",
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
