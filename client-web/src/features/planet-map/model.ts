import { surfaceOffset } from '@shared/surface';
import type {
  AlertEntry,
  Building,
  CatalogView,
  CombatSquad,
  FogMapView,
  GameEventDetail,
  ItemInventory,
  LogisticsStationItemSetting,
  PlanetNetworksView,
  PlanetResource,
  PlanetSceneView,
  PlanetRuntimeView,
  PlanetView,
  Position,
  Unit,
} from "@shared/types";

import type { PlanetSceneWindow } from "@/features/planet-map/store";
import {
  translateAlertType,
  translateBuildingState,
  translateBuildingType,
  translateBuildingTypeOrNull,
  translateEventType,
  translateItemId,
  translateItemIdSafe,
  translateRecipeId,
  translateTechId,
  translateUnitType,
  translateUnitTypeOrNull,
  translateUnitTypeWithName,
} from "@/i18n/translate";

export type PlanetLayerKey =
  | "terrain"
  | "resources"
  | "buildings"
  | "units"
  | "fog"
  | "grid"
  | "selection"
  | "logistics"
  | "power"
  | "pipelines"
  | "construction"
  | "threat";

export const PLANET_LAYER_LABELS: Record<PlanetLayerKey, string> = {
  terrain: "地形",
  resources: "资源",
  buildings: "建筑",
  units: "单位",
  fog: "迷雾",
  grid: "网格",
  selection: "选中",
  logistics: "物流",
  power: "电网",
  pipelines: "管网",
  construction: "施工",
  threat: "敌情",
};

export interface TilePoint {
  x: number;
  y: number;
}

/**
 * 单位实时移动派生：服务器只下发路径与进度，客户端据此展示移动状态与目的地。
 */
export function unitIsMoving(unit: Pick<Unit, 'path' | 'path_index'>): boolean {
  if (!unit.path) return false;
  return (unit.path_index ?? 0) < unit.path.length;
}

export function unitMoveDestination(unit: Pick<Unit, 'path' | 'order_pos'>): Position | undefined {
  if (unit.order_pos) return unit.order_pos;
  if (unit.path && unit.path.length > 0) return unit.path[unit.path.length - 1];
  return undefined;
}

export type SelectedEntity =
  | { kind: "building"; id: string; position: Position }
  | { kind: "unit"; id: string; position: Position }
  | { kind: "squad"; id: string; position: Position }
  | { kind: "resource"; id: string; position: Position }
  | { kind: "tile"; position: Position };

export interface SelectionExportPayload {
  selection: SelectedEntity | null;
  entity: Building | Unit | CombatSquad | PlanetResource | null;
}

export type PlanetLayerVisibility = Record<PlanetLayerKey, boolean>;

export interface PlanetCameraSnapshot {
  offsetX: number;
  offsetY: number;
  zoomIndex: number;
}

export interface ViewportTileBounds {
  /** 可见展开图坐标范围，限制在地图内；跨面邻接由球面拓扑决定。 */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** 视口中心的展开图坐标。 */
  centerX: number;
  centerY: number;
  /** 渲染批次的轴环绕标志；六面展开图始终设为 false。 */
  wrapX?: boolean;
  wrapY?: boolean;
  mapWidth?: number;
  mapHeight?: number;
}

export type PlanetRenderView = PlanetView | PlanetSceneView;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function toTilePoint(position: Position): TilePoint {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
  };
}

export function formatPosition(position?: Position | null) {
  if (!position) {
    return "-";
  }
  return `(${position.x}, ${position.y}, ${position.z ?? 0})`;
}

function hasSceneBounds(planet: PlanetRenderView): planet is PlanetSceneView {
  return "bounds" in planet;
}

export function getTerrainTile(planet: PlanetRenderView, x: number, y: number) {
  if (hasSceneBounds(planet)) {
    const patch = planet.surface_patches?.find(p => x >= p.bounds.x && y >= p.bounds.y && x < p.bounds.x + p.bounds.width && y < p.bounds.y + p.bounds.height);
    if (patch) return patch.terrain?.[y-patch.bounds.y]?.[x-patch.bounds.x] ?? "unknown";
    const localX = x - planet.bounds.x;
    const localY = y - planet.bounds.y;
    return planet.terrain?.[localY]?.[localX] ?? "unknown";
  }
  return planet.terrain?.[y]?.[x] ?? "unknown";
}

/**
 * 该格是否「确知从未探索」：只在迷雾数据覆盖到该格时才下结论。
 * 场景窗口跟着镜头异步移动，窗口外的格子没有数据——那是「未知」不是「未探索」，返回 false，
 * 避免镜头刚飞过去、窗口还没跟上时误报。
 */
export function isTileUncharted(
  fog: FogMapView | PlanetSceneView | undefined,
  x: number,
  y: number,
): boolean {
  if (!fog) return false;
  if ("bounds" in fog) {
    const inPatch = fog.surface_patches?.some(p => x >= p.bounds.x && y >= p.bounds.y && x < p.bounds.x + p.bounds.width && y < p.bounds.y + p.bounds.height);
    const inWindow = x >= fog.bounds.x && y >= fog.bounds.y && x < fog.bounds.x + fog.bounds.width && y < fog.bounds.y + fog.bounds.height;
    if (!inPatch && !inWindow) return false;
  } else if (!fog.explored?.[y]) {
    return false;
  }
  return !getFogState(fog, x, y).explored;
}

export function getFogState(
  fog: FogMapView | PlanetSceneView | undefined,
  x: number,
  y: number,
) {
  if (fog && "bounds" in fog) {
    const patch = fog.surface_patches?.find(p => x >= p.bounds.x && y >= p.bounds.y && x < p.bounds.x + p.bounds.width && y < p.bounds.y + p.bounds.height);
    if (patch) return {visible: Boolean(patch.visible?.[y-patch.bounds.y]?.[x-patch.bounds.x]), explored: Boolean(patch.explored?.[y-patch.bounds.y]?.[x-patch.bounds.x])};
    const localX = x - fog.bounds.x;
    const localY = y - fog.bounds.y;
    return {
      visible: Boolean(fog.visible?.[localY]?.[localX]),
      explored: Boolean(fog.explored?.[localY]?.[localX]),
    };
  }
  return {
    visible: Boolean(fog?.visible?.[y]?.[x]),
    explored: Boolean(fog?.explored?.[y]?.[x]),
  };
}

export function getBuildingList(planet: PlanetRenderView) {
  return Object.values(planet.buildings ?? {}).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function getUnitList(planet: PlanetRenderView) {
  return Object.values(planet.units ?? {}).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function getResourceList(planet: PlanetRenderView) {
  return [...(planet.resources ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

/** 基地/HQ：相机「回家」的首要落点。 */
const HOME_BUILDING_TYPE = 'battlefield_analysis_base';
/** 机甲/执行体：HQ 未建成时它们总在基地附近，比任意一座建筑更接近"家"。 */
const HOME_UNIT_TYPES = new Set(['executor', 'mecha']);

/** 图集环面坐标差：按图集跨度取最短绕行，避免接缝两侧被算成很远。 */
function wrappedDelta(left: number, right: number, span: number) {
  if (span <= 0) return Math.abs(left - right);
  const delta = Math.abs(left - right) % span;
  return Math.min(delta, span - delta);
}

/** 图集平面距离（带环面绕行）：只用于「离质心最近」这类相对排序。 */
function atlasDistance(left: TilePoint, right: TilePoint, mapWidth: number, mapHeight: number) {
  return Math.hypot(
    wrappedDelta(left.x, right.x, mapWidth),
    wrappedDelta(left.y, right.y, mapHeight),
  );
}

/** 质心（图集坐标平均，取整）：己方建筑群的中心，用于挑"最靠近基地"的落点。 */
function centroidOf(points: TilePoint[]): TilePoint | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: Math.round(sum.x / points.length), y: Math.round(sum.y / points.length) };
}

/**
 * 玩家"家"的位置：用于首次进入行星页的相机定位与 ⌂（回到基地）。
 *
 * 优先级：己方基地（战情分析基站，HP>0）→ 己方机甲/执行体 → 离己方建筑质心最近的建筑
 * → 任意己方单位。**绝不按 id 排序取第一个**：建筑 id 是字符串，`b-113` < `b-12`，
 * 玩家在远处建一段传送带后「聚焦基地」就会飞到荒郊（试玩 1011 A）。
 */
export function resolveHomeTile(
  planet: PlanetRenderView,
  playerId: string,
): TilePoint | null {
  const ownBuildings = getBuildingList(planet).filter(
    (building) => building.owner_id === playerId && building.hp > 0,
  );
  const ownUnits = getUnitList(planet).filter(
    (unit) => unit.owner_id === playerId && unit.hp > 0,
  );
  const centroid = centroidOf(ownBuildings.map((building) => toTilePoint(building.position)));
  const nearestToCentroid = <T,>(candidates: T[], position: (candidate: T) => TilePoint): T | undefined => {
    if (candidates.length === 0 || !centroid) return candidates[0];
    let best = candidates[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = atlasDistance(position(candidate), centroid, planet.map_width, planet.map_height);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  };
  const home = nearestToCentroid(
    ownBuildings.filter((building) => building.type === HOME_BUILDING_TYPE),
    (building) => toTilePoint(building.position),
  ) ?? nearestToCentroid(
    ownUnits.filter((unit) => unit.mecha != null || HOME_UNIT_TYPES.has(unit.type)),
    (unit) => toTilePoint(unit.position),
  ) ?? nearestToCentroid(ownBuildings, (building) => toTilePoint(building.position))
    ?? nearestToCentroid(ownUnits, (unit) => toTilePoint(unit.position));
  return home ? toTilePoint(home.position) : null;
}

export function getBuildingFootprint(building: Building) {
  const footprint = building.runtime?.params?.footprint;
  return {
    width: Math.max(1, footprint?.width ?? 1),
    height: Math.max(1, footprint?.height ?? 1),
  };
}

export function tileContainsBuilding(building: Building, x: number, y: number, faceSize: number) {
  const {width,height}=getBuildingFootprint(building);
  for(let dy=0;dy<height;dy++) for(let dx=0;dx<width;dx++) {
    const tile=surfaceOffset(toTilePoint(building.position),dx,dy,faceSize);
    if(tile.x===x&&tile.y===y)return true;
  }
  return false;
}

/**
 * 点格选中：建筑 > 单位 > 资源。同一格再次点击时轮换到下一层
 * （机甲站在矿上时，第二次点击选中矿点）。
 */
export function resolveSelectionAtTile(
  planet: PlanetRenderView,
  x: number,
  y: number,
  current?: SelectedEntity | null,
): SelectedEntity | null {
  const atTile = (position: Position) => {
    const tile = toTilePoint(position);
    return tile.x === x && tile.y === y;
  };
  const buildings = getBuildingList(planet).filter((candidate) =>
    tileContainsBuilding(candidate, x, y, planet.map_width / 3),
  );
  const building = buildings.find((candidate) => candidate.type === "logistics_distributor")
    ?? buildings.find((candidate) => candidate.type !== "foundation") ?? buildings[0];
  const unit = getUnitList(planet).find((candidate) => atTile(candidate.position));
  const resource = getResourceList(planet).find((candidate) => atTile(candidate.position));
  const stack: SelectedEntity[] = [
    ...(building ? [{ kind: "building" as const, id: building.id, position: building.position }] : []),
    ...(unit ? [{ kind: "unit" as const, id: unit.id, position: unit.position }] : []),
    ...(resource ? [{ kind: "resource" as const, id: resource.id, position: resource.position }] : []),
  ];
  if (stack.length === 0) return null;
  const index = current && current.kind !== "tile"
    ? stack.findIndex((entry) => entry.kind === current.kind && "id" in entry && entry.id === current.id)
    : -1;
  return stack[(index + 1) % stack.length];
}

/** Resolve current authoritative coordinates; a missing entity has no selection marker. */
export function resolveSelectionPosition(
  planet: PlanetRenderView,
  selection: SelectedEntity | null,
  runtime?: PlanetRuntimeView,
): Position | null {
  if (!selection) return null;
  if (selection.kind === 'tile') return selection.position;
  // 小队实体在 runtime.combat_squads（不在 planet.units）：调用侧未传 runtime 时
  // 用点击时的快照坐标（地图选中环由小队标记层自绘，这里仅兜底）。
  if (selection.kind === 'squad') {
    const squad = runtime?.combat_squads?.find((candidate) => candidate.id === selection.id);
    return squad?.position ?? selection.position;
  }
  return findSelectionEntity(planet, selection)?.position ?? null;
}

export function findSelectionEntity(
  planet: PlanetRenderView,
  selection: SelectedEntity | null,
  runtime?: PlanetRuntimeView,
) {
  if (!selection) {
    return null;
  }
  switch (selection.kind) {
    case "building":
      return (planet.buildings ?? {})[selection.id] ?? null;
    case "unit":
      return (planet.units ?? {})[selection.id] ?? null;
    case "squad":
      return (
        runtime?.combat_squads?.find(
          (candidate) => candidate.id === selection.id,
        ) ?? null
      );
    case "resource":
      return (
        getResourceList(planet).find(
          (candidate) => candidate.id === selection.id,
        ) ?? null
      );
    case "tile":
      return null;
    default:
      return null;
  }
}

export function selectionLabel(selection: SelectedEntity | null) {
  if (!selection) {
    return "未选中对象";
  }
  switch (selection.kind) {
    case "building":
      return `建筑 ${selection.id}`;
    case "unit":
      return `单位 ${selection.id}`;
    case "squad":
      return `小队 ${selection.id}`;
    case "resource":
      return `资源 ${selection.id}`;
    case "tile":
      return `地块 ${formatPosition(selection.position)}`;
    default:
      return "未选中对象";
  }
}

export function selectionEntityId(selection: SelectedEntity | null) {
  if (!selection || selection.kind === "tile") {
    return "";
  }
  return selection.id;
}

function asCatalogMap<T extends { id: string }>(entries?: T[]) {
  const map = new Map<string, T>();
  (entries ?? []).forEach((entry) => {
    map.set(entry.id, entry);
  });
  return map;
}

export function getBuildingCatalogEntry(
  catalog: CatalogView | undefined,
  buildingType: string,
) {
  return asCatalogMap(catalog?.buildings).get(buildingType);
}

export function getItemCatalogEntry(
  catalog: CatalogView | undefined,
  itemId: string,
) {
  return asCatalogMap(catalog?.items).get(itemId);
}

export function getRecipeCatalogEntry(
  catalog: CatalogView | undefined,
  recipeId: string,
) {
  return asCatalogMap(catalog?.recipes).get(recipeId);
}

export function getTechCatalogEntry(
  catalog: CatalogView | undefined,
  techId: string,
) {
  return asCatalogMap(catalog?.techs).get(techId);
}

export function getBuildingDisplayName(
  catalog: CatalogView | undefined,
  buildingType: string,
) {
  return translateBuildingType(
    buildingType,
    getBuildingCatalogEntry(catalog, buildingType)?.name,
  );
}

export function getItemDisplayName(
  catalog: CatalogView | undefined,
  itemId: string,
) {
  // 界面用：词典 > 目录中文名 > 中性词，绝不回退 ammo_bullet 这类裸 id。
  return translateItemIdSafe(itemId, getItemCatalogEntry(catalog, itemId)?.name);
}

/** 单位造价文案：「钢材 × 2、电路板 × 1 · 30 tick」；无造价返回空串。 */
export function formatUnitCost(
  catalog: CatalogView | undefined,
  unit: { cost?: { item_id: string; quantity: number }[]; production_ticks?: number },
): string {
  const items = (unit.cost ?? []).map((c) => `${getItemDisplayName(catalog, c.item_id)} × ${c.quantity}`).join('、');
  if (!items) return '';
  return unit.production_ticks ? `${items} · ${unit.production_ticks} tick` : items;
}

/**
 * 量产单位下拉的整行文案：「步兵 · 铁块 × 2、电路板 × 1 · 40 tick」。
 * 单位名与物品名一律中文（词典优先，catalog 中文名兜底），不出现 soldier / iron_ingot 这类裸 id。
 */
export function formatUnitOptionLabel(
  catalog: CatalogView | undefined,
  unit: { id: string; name?: string; cost?: { item_id: string; quantity: number }[]; production_ticks?: number },
): string {
  const name = translateUnitTypeWithName(unit.id, unit.name);
  const cost = formatUnitCost(catalog, unit);
  return [name, cost].filter(Boolean).join(' · ');
}

export function getRecipeDisplayName(
  catalog: CatalogView | undefined,
  recipeId: string,
) {
  return translateRecipeId(recipeId, getRecipeCatalogEntry(catalog, recipeId)?.name);
}

export function getTechDisplayName(
  catalog: CatalogView | undefined,
  techId: string,
) {
  return translateTechId(techId, getTechCatalogEntry(catalog, techId)?.name);
}

export function isLogisticsStationBuildingType(buildingType: string) {
  return (
    buildingType === "planetary_logistics_station" ||
    buildingType === "interstellar_logistics_station"
  );
}

export function findLogisticsStation(
  runtime: PlanetRuntimeView | undefined,
  buildingId: string,
) {
  return (
    (runtime?.logistics_stations ?? []).find(
      (station) => station.building_id === buildingId,
    ) ?? null
  );
}

export function listOwnLogisticsStations(
  planet: PlanetRenderView,
  runtime: PlanetRuntimeView | undefined,
  playerId: string,
) {
  return (runtime?.logistics_stations ?? [])
    .filter(
      (station) =>
        station.owner_id === playerId &&
        Boolean(planet.buildings?.[station.building_id]),
    )
    .sort((left, right) => left.building_id.localeCompare(right.building_id));
}

export interface LogisticsStationSettingRow extends LogisticsStationItemSetting {
  item_name: string;
}

export function listLogisticsStationSettings(
  catalog: CatalogView | undefined,
  settings?: Record<string, LogisticsStationItemSetting>,
): LogisticsStationSettingRow[] {
  return Object.values(settings ?? {})
    .sort((left, right) => {
      const itemNameCompare = getItemDisplayName(
        catalog,
        left.item_id,
      ).localeCompare(getItemDisplayName(catalog, right.item_id), "zh-CN");
      if (itemNameCompare !== 0) {
        return itemNameCompare;
      }
      return left.item_id.localeCompare(right.item_id);
    })
    .map((setting) => ({
      ...setting,
      item_name: getItemDisplayName(catalog, setting.item_id),
    }));
}

export function formatItemInventorySummary(
  catalog: CatalogView | undefined,
  inventory?: ItemInventory | null,
) {
  const entries = Object.entries(inventory ?? {})
    .filter(([, amount]) => amount !== 0)
    .sort(([leftId], [rightId]) => {
      const itemNameCompare = getItemDisplayName(catalog, leftId).localeCompare(
        getItemDisplayName(catalog, rightId),
        "zh-CN",
      );
      if (itemNameCompare !== 0) {
        return itemNameCompare;
      }
      return leftId.localeCompare(rightId);
    })
    .map(
      ([itemId, amount]) => `${getItemDisplayName(catalog, itemId)} ${amount}`,
    );
  return entries.length > 0 ? entries.join(" · ") : "-";
}

export function serializeEnabledLayers(layers: PlanetLayerVisibility) {
  return (Object.entries(layers) as [PlanetLayerKey, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .join(",");
}

export function parseEnabledLayers(
  encoded: string | null,
  fallback: PlanetLayerVisibility,
): Partial<PlanetLayerVisibility> | null {
  if (!encoded) {
    return null;
  }
  const enabled = new Set(
    encoded.split(",").filter(Boolean) as PlanetLayerKey[],
  );
  const nextEntries = (Object.keys(fallback) as PlanetLayerKey[]).map(
    (key) => [key, enabled.has(key)] as const,
  );
  return Object.fromEntries(nextEntries) as Partial<PlanetLayerVisibility>;
}

export function selectionToQueryValue(selection: SelectedEntity | null) {
  if (!selection) {
    return "";
  }
  if (selection.kind === "tile") {
    return `tile:${selection.position.x},${selection.position.y}`;
  }
  return `${selection.kind}:${selection.id}`;
}

export function resolveSelectionFromQueryValue(
  planet: PlanetRenderView,
  raw: string | null,
): SelectedEntity | null {
  if (!raw) {
    return null;
  }
  const [kind, rest] = raw.split(":", 2);
  if (!kind || !rest) {
    return null;
  }
  if (kind === "tile") {
    const [xText, yText] = rest.split(",", 2);
    const x = Number(xText);
    const y = Number(yText);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      kind: "tile",
      position: { x, y, z: 0 },
    };
  }
  if (kind === "building" && planet.buildings?.[rest]) {
    return {
      kind: "building",
      id: rest,
      position: planet.buildings[rest].position,
    };
  }
  if (kind === "unit" && planet.units?.[rest]) {
    return {
      kind: "unit",
      id: rest,
      position: planet.units[rest].position,
    };
  }
  if (kind === "resource") {
    const resource = getResourceList(planet).find(
      (candidate) => candidate.id === rest,
    );
    if (!resource) {
      return null;
    }
    return {
      kind: "resource",
      id: resource.id,
      position: resource.position,
    };
  }
  return null;
}

/**
 * 小图轴（世界像素尺寸 < 视口）的居中偏移。
 * 用于初始相机与"聚焦/缩放"路径：小图在视口中居中而非顶左锚定。
 */
export function centerCameraAxisOffset(worldPx: number, viewportPx: number) {
  return (viewportPx - worldPx) / 2;
}

/**
 * 单轴相机偏移钳位：小图轴（worldPx < viewportPx）不允许地图中心被拖出视口
 * （偏移钳在 [center - viewport/2, center + viewport/2]，即地图中心 ∈ [0, viewport]）；
 * 大图轴维持现状不钳（自由拖拽）。
 */
export function clampCameraAxisOffset(worldPx: number, viewportPx: number, offset: number) {
  if (worldPx >= viewportPx) {
    return offset;
  }
  const center = centerCameraAxisOffset(worldPx, viewportPx);
  return clamp(offset, center - viewportPx / 2, center + viewportPx / 2);
}

/** 小图轴取居中、大图轴保留聚焦目标的相机偏移（聚焦基地/小图居中通用）。 */
export function resolveFocusCameraAxisOffset(worldPx: number, viewportPx: number, focusedOffset: number) {
  return worldPx < viewportPx ? centerCameraAxisOffset(worldPx, viewportPx) : focusedOffset;
}

/** 非负取模：(-4, 1000) → 996。 */
export function wrapMod(value: number, size: number) {
  if (size <= 0) {
    return value;
  }
  return ((value % size) + size) % size;
}

/** Camera movement in the cut atlas never wraps to an unrelated cube face. */
export function resolveCameraAxisOffset(worldPx: number, viewportPx: number, offset: number) {
  return clampCameraAxisOffset(worldPx,viewportPx,offset);
}

/**
 * tile 的规范（unwrapped）坐标：映射到以 cut 为起点的一个周期 [cut, cut + size) 内。
 * 渲染层用它把真实 tile 摆到屏幕位置（如 cut=996 时 tile 2 → 1002）。
 */
export function canonicalTileIndex(tile: number, cut: number, size: number) {
  return cut + wrapMod(tile - cut, size);
}

export function getViewportTileBounds(
  planet: PlanetRenderView,
  camera: PlanetCameraSnapshot,
  tileSize: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewportTileBounds {
  const mapWidth = Math.max(planet.map_width, 0);
  const mapHeight = Math.max(planet.map_height, 0);
  const wrapX = false;
  const wrapY = false;
  // 六面展开图的可见区域限制在 atlas 边界内。
  const minX = wrapX
    ? Math.floor(-camera.offsetX / tileSize)
    : clamp(Math.floor(-camera.offsetX / tileSize), 0, Math.max(mapWidth - 1, 0));
  const minY = wrapY
    ? Math.floor(-camera.offsetY / tileSize)
    : clamp(Math.floor(-camera.offsetY / tileSize), 0, Math.max(mapHeight - 1, 0));
  const maxX = wrapX
    ? Math.ceil((viewportWidth - camera.offsetX) / tileSize) - 1
    : clamp(Math.ceil((viewportWidth - camera.offsetX) / tileSize) - 1, 0, Math.max(mapWidth - 1, 0));
  const maxY = wrapY
    ? Math.ceil((viewportHeight - camera.offsetY) / tileSize) - 1
    : clamp(Math.ceil((viewportHeight - camera.offsetY) / tileSize) - 1, 0, Math.max(mapHeight - 1, 0));
  const rawCenterX = (minX + maxX) / 2 || 0;
  const rawCenterY = (minY + maxY) / 2 || 0;
  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: Number((wrapX ? wrapMod(rawCenterX, mapWidth || 1) : rawCenterX).toFixed(2)),
    centerY: Number((wrapY ? wrapMod(rawCenterY, mapHeight || 1) : rawCenterY).toFixed(2)),
    wrapX,
    wrapY,
    mapWidth,
    mapHeight,
  };
}

function isInsideBounds(position: Position, bounds: ViewportTileBounds) {
  const point = toTilePoint(position);
  const inX = bounds.wrapX && bounds.mapWidth
    ? wrapMod(point.x - bounds.minX, bounds.mapWidth) <= bounds.maxX - bounds.minX
    : point.x >= bounds.minX && point.x <= bounds.maxX;
  const inY = bounds.wrapY && bounds.mapHeight
    ? wrapMod(point.y - bounds.minY, bounds.mapHeight) <= bounds.maxY - bounds.minY
    : point.y >= bounds.minY && point.y <= bounds.maxY;
  return inX && inY;
}

export function buildViewLinkSearchParams(
  selection: SelectedEntity | null,
  layers: PlanetLayerVisibility,
  bounds: ViewportTileBounds,
  zoom: number,
) {
  const params = new URLSearchParams();
  params.set("x", String(bounds.centerX));
  params.set("y", String(bounds.centerY));
  params.set("zoom", String(zoom));
  params.set("layers", serializeEnabledLayers(layers));
  const selectionValue = selectionToQueryValue(selection);
  if (selectionValue) {
    params.set("select", selectionValue);
  }
  return params;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractPayloadPosition(payload: Record<string, unknown>) {
  // entity_moved 的载荷用 to（含 from/path），先读它，否则摘要会退化成 "-"。
  const direct = asRecord(payload.position) ?? asRecord(payload.to);
  if (direct) {
    const x = asNumber(direct.x);
    const y = asNumber(direct.y);
    if (x !== undefined && y !== undefined) {
      return { x, y, z: asNumber(direct.z) ?? 0 };
    }
  }

  const x = asNumber(payload.x);
  const y = asNumber(payload.y);
  if (x !== undefined && y !== undefined) {
    return { x, y, z: asNumber(payload.z) ?? 0 };
  }

  return null;
}

function translateAlertIssue(alert: Pick<AlertEntry, "alert_type" | "message">) {
  return translateAlertType(alert.alert_type, alert.message || "产线告警");
}

function buildAlertRecommendation(alert: AlertEntry) {
  switch (alert.alert_type) {
    case "throughput_drop":
      return "优先补原料，并检查供电与输出链路";
    case "input_shortage":
      return "优先补原料，并检查输入物流是否断链";
    case "output_blocked":
      return "优先清理产物，并检查仓储与输出物流";
    case "power_shortage":
    case "power_low":
      return "优先补发电设施，并确认电网覆盖是否接通";
    case "backlog":
      return "优先疏通输出链路，并检查是否有堆积节点";
    default:
      return "优先定位建筑状态，再检查供电、原料与输出链路";
  }
}

export interface AlertPresentation {
  buildingLabel: string;
  issueLabel: string;
  recommendationLabel: string;
  metricsLabel: string;
}

export function describeAlert(
  planet: PlanetRenderView,
  alert: AlertEntry,
  catalog?: CatalogView,
): AlertPresentation {
  const building = planet.buildings?.[alert.building_id];
  const buildingName = getBuildingDisplayName(
    catalog,
    building?.type ?? alert.building_type,
  );
  const buildingLabel = building
    ? `${buildingName} · ${formatPosition(building.position)}`
    : buildingName;

  return {
    buildingLabel,
    issueLabel: `问题：${translateAlertIssue(alert)}`,
    recommendationLabel: `建议：${buildAlertRecommendation(alert)}`,
    metricsLabel: `吞吐 ${alert.metrics.throughput} · 堆积 ${alert.metrics.backlog} · 效率 ${Math.round((alert.metrics.efficiency ?? 0) * 100)}%`,
  };
}

/** 事件摘要里的实体名：不裸露 u-7 / b-92 这类内部 id，也不裸露 enemy_force 这类枚举 id。 */
function eventEntityLabel(payload: Record<string, unknown>, fallback: string) {
  const type = asString(payload.entity_type);
  const kind = asString(payload.entity_kind);
  if (kind === 'building' && type) return translateBuildingType(type);
  if (kind === 'unit' && type) return translateUnitTypeWithName(type);
  if (type) {
    // 词典命中才用中文名；未命中（如 enemy_force 这类势力枚举）不裸显 id。
    const asUnit = translateUnitTypeOrNull(type);
    if (asUnit) return asUnit;
    const asBuilding = translateBuildingTypeOrNull(type);
    if (asBuilding) return asBuilding;
  }
  const id = asString(payload.entity_id);
  if (id.startsWith('b-')) return '建筑';
  if (id.startsWith('u-')) return '单位';
  if (id.startsWith('enemy-') || id.startsWith('df-')) return '黑雾单位';
  return fallback;
}

export function summarizeEvent(event: GameEventDetail) {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case "command_result":
      return (
        asString(payload.message) ||
        `${asString(payload.command_type) || "command"} ${asString(payload.status) || "updated"}`
      );
    case "entity_created":
      return `${eventEntityLabel(payload, "实体")} 已创建`;
    case "entity_moved":
      return `${eventEntityLabel(payload, "实体")} 移动到 ${formatPosition(extractPayloadPosition(payload))}`;
    case "entity_destroyed":
      return `${eventEntityLabel(payload, "实体")} 已销毁`;
    case "entity_updated":
      return `${asString(payload.entity_id) || "entity"} 属性已更新`;
    case "building_state_changed":
      return `${translateEventType(event.event_type)} · ${asString(payload.building_id) || "building"} ${translateBuildingState(asString(payload.prev_state) || "unknown")} -> ${translateBuildingState(asString(payload.next_state) || "unknown")}`;
    case "resource_changed":
      return `${asString(payload.resource_id) || "resource"} 储量变化`;
    case "production_alert": {
      const alert = extractAlertFromEvent(event);
      if (!alert) {
        return "产线告警";
      }
      const issue = translateAlertIssue(alert);
      const buildingLabel = translateBuildingType(alert.building_type);
      return `${buildingLabel} ${issue}`;
    }
    case "research_completed":
      return `${asString(payload.tech_id) || "research"} 研究完成`;
    case "threat_level_changed":
      return `威胁等级 -> ${String(payload.threat_level ?? payload.next_threat_level ?? "?")}`;
    case "construction_paused":
      return `${asString(payload.task_id) || "construction"} 已暂停`;
    case "construction_resumed":
      return `${asString(payload.task_id) || "construction"} 已恢复`;
    case "damage_applied":
      return `${asString(payload.target_id) || "target"} 受到伤害`;
    case "loot_dropped":
      return `${asString(payload.entity_id) || "entity"} 掉落战利品`;
    case "tick_completed":
      return `tick ${String(payload.tick ?? event.tick)} 完成`;
    default:
      return "事件已记录";
  }
}

export function summarizeAlert(
  planet: PlanetRenderView,
  alert: AlertEntry,
  catalog?: CatalogView,
) {
  return describeAlert(planet, alert, catalog).buildingLabel;
}

export function extractAlertFromEvent(
  event: GameEventDetail,
): AlertEntry | null {
  if (event.event_type !== "production_alert") {
    return null;
  }
  const alert = asRecord(event.payload?.alert);
  if (!alert) {
    return null;
  }

  const metrics = asRecord(alert.metrics) ?? {};
  return {
    alert_id: asString(alert.alert_id) || event.event_id,
    tick: asNumber(alert.tick) ?? event.tick,
    player_id: asString(alert.player_id),
    building_id: asString(alert.building_id),
    building_type: asString(alert.building_type),
    alert_type: asString(alert.alert_type),
    severity: asString(alert.severity),
    message: asString(alert.message),
    metrics: {
      throughput: asNumber(metrics.throughput) ?? 0,
      backlog: asNumber(metrics.backlog) ?? 0,
      idle_ratio: asNumber(metrics.idle_ratio) ?? 0,
      efficiency: asNumber(metrics.efficiency) ?? 0,
      input_shortage: Boolean(metrics.input_shortage),
      output_blocked: Boolean(metrics.output_blocked),
      power_state: asString(metrics.power_state),
    },
    details: asRecord(alert.details) ?? {},
  };
}

export function resolveSelectionFromEvent(
  planet: PlanetRenderView,
  event: GameEventDetail,
): SelectedEntity | null {
  const payload = event.payload ?? {};
  const buildingId = asString(payload.building_id);
  if (buildingId && planet.buildings?.[buildingId]) {
    return {
      kind: "building",
      id: buildingId,
      position: planet.buildings[buildingId].position,
    };
  }

  const entityId = asString(payload.entity_id) || asString(payload.target_id);
  if (entityId && planet.buildings?.[entityId]) {
    return {
      kind: "building",
      id: entityId,
      position: planet.buildings[entityId].position,
    };
  }
  if (entityId && planet.units?.[entityId]) {
    return {
      kind: "unit",
      id: entityId,
      position: planet.units[entityId].position,
    };
  }

  const resourceId = asString(payload.resource_id);
  if (resourceId) {
    const resource = getResourceList(planet).find(
      (candidate) => candidate.id === resourceId,
    );
    if (resource) {
      return {
        kind: "resource",
        id: resourceId,
        position: resource.position,
      };
    }
  }

  const position = extractPayloadPosition(payload);
  if (position) {
    const selection = resolveSelectionAtTile(
      planet,
      Math.round(position.x),
      Math.round(position.y),
    );
    return (
      selection ?? {
        kind: "tile",
        position,
      }
    );
  }

  return null;
}

export function resolveSelectionFromAlert(
  planet: PlanetRenderView,
  alert: AlertEntry,
): SelectedEntity | null {
  const building = planet.buildings?.[alert.building_id];
  if (!building) {
    return null;
  }
  return {
    kind: "building",
    id: building.id,
    position: building.position,
  };
}

export function mergeRecentEvents(
  current: GameEventDetail[],
  incoming: GameEventDetail[],
  limit = 40,
) {
  const merged = new Map<string, GameEventDetail>();
  [...incoming, ...current].forEach((event) => {
    merged.set(event.event_id, event);
  });
  return [...merged.values()]
    .sort((left, right) => {
      if (left.tick !== right.tick) {
        return right.tick - left.tick;
      }
      return right.event_id.localeCompare(left.event_id);
    })
    .slice(0, limit);
}

export function mergeRecentAlerts(
  current: AlertEntry[],
  incoming: AlertEntry[],
  limit = 24,
) {
  const merged = new Map<string, AlertEntry>();
  [...incoming, ...current].forEach((alert) => {
    merged.set(alert.alert_id, alert);
  });
  return [...merged.values()]
    .sort((left, right) => {
      if (left.tick !== right.tick) {
        return right.tick - left.tick;
      }
      return right.alert_id.localeCompare(left.alert_id);
    })
    .slice(0, limit);
}

export function eventAffectsPlanet(event: GameEventDetail, planetId: string) {
  const payload = event.payload ?? {};
  const payloadPlanetId = asString(payload.planet_id);
  if (payloadPlanetId) {
    return payloadPlanetId === planetId;
  }
  return true;
}

export function shouldRefreshPlanet(event: GameEventDetail, planetId: string) {
  if (!eventAffectsPlanet(event, planetId)) {
    return false;
  }
  return [
    "entity_created",
    "entity_moved",
    "damage_applied",
    "mecha_state_changed",
    "resource_changed",
    "entity_destroyed",
    "building_state_changed",
    "traffic_monitor_alert",
    "construction_paused",
    "construction_resumed",
    "entity_updated",
    "loot_dropped",
  ].includes(event.event_type);
}

export function shouldRefreshFog(event: GameEventDetail, planetId: string) {
  if (!eventAffectsPlanet(event, planetId)) {
    return false;
  }
  return [
    "entity_created",
    "entity_moved",
    "entity_destroyed",
    "entity_updated",
  ].includes(event.event_type);
}

export function shouldRefreshAlerts(event: GameEventDetail) {
  return event.event_type === "production_alert";
}

export function shouldRefreshSummary(event: GameEventDetail) {
  return [
    "resource_changed",
    "mecha_state_changed",
    "tick_completed",
    "research_completed",
    "threat_level_changed",
    "command_result",
  ].includes(event.event_type);
}

export function shouldRefreshStats(event: GameEventDetail) {
  return [
    "tick_completed",
    "production_alert",
    "research_completed",
    "threat_level_changed",
  ].includes(event.event_type);
}

export function buildSelectionExport(
  planet: PlanetRenderView,
  selection: SelectedEntity | null,
): SelectionExportPayload {
  return {
    selection,
    entity: findSelectionEntity(planet, selection),
  };
}

export function buildViewportExport(options: {
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  networks?: PlanetNetworksView;
  catalog?: CatalogView;
  selection: SelectedEntity | null;
  layers: PlanetLayerVisibility;
  camera: PlanetCameraSnapshot;
  tileSize: number;
  viewportWidth: number;
  viewportHeight: number;
  shareUrl: string;
}) {
  const bounds = getViewportTileBounds(
    options.planet,
    options.camera,
    options.tileSize,
    options.viewportWidth,
    options.viewportHeight,
  );

  const buildings = getBuildingList(options.planet)
    .filter((building) => isInsideBounds(building.position, bounds))
    .map((building) => ({
      ...building,
      display_name: getBuildingDisplayName(options.catalog, building.type),
    }));
  const units = getUnitList(options.planet).filter((unit) =>
    isInsideBounds(unit.position, bounds),
  );
  const resources = getResourceList(options.planet)
    .filter((resource) => isInsideBounds(resource.position, bounds))
    .map((resource) => ({
      ...resource,
      display_name: getItemDisplayName(options.catalog, resource.kind),
    }));
  const logisticsDrones = (options.runtime?.logistics_drones ?? []).filter(
    (drone) => isInsideBounds(drone.position, bounds),
  );
  const logisticsShips = (options.runtime?.logistics_ships ?? []).filter(
    (ship) => isInsideBounds(ship.position, bounds),
  );
  const constructionTasks = (options.runtime?.construction_tasks ?? [])
    .filter((task) => isInsideBounds(task.position, bounds))
    .map((task) => ({
      ...task,
      display_name: getBuildingDisplayName(options.catalog, task.building_type),
    }));
  const enemyForces = (options.runtime?.enemy_forces ?? []).filter((force) =>
    isInsideBounds(force.position, bounds),
  );
  const powerCoverage = (options.networks?.power_coverage ?? [])
    .filter((coverage) => isInsideBounds(coverage.position, bounds))
    .map((coverage) => ({
      ...coverage,
      display_name: getBuildingDisplayName(
        options.catalog,
        coverage.building_type,
      ),
    }));
  const pipelineNodes = (options.networks?.pipeline_nodes ?? []).filter(
    (node) => isInsideBounds(node.position, bounds),
  );

  return {
    tick: options.planet.tick,
    planet_id: options.planet.planet_id,
    share_url: options.shareUrl,
    viewport: {
      ...bounds,
      zoom: options.tileSize,
      width: options.viewportWidth,
      height: options.viewportHeight,
    },
    layers: serializeEnabledLayers(options.layers).split(",").filter(Boolean),
    selection: options.selection,
    selected_entity: findSelectionEntity(options.planet, options.selection),
    visible: {
      buildings,
      units,
      resources,
      logistics_drones: logisticsDrones,
      logistics_ships: logisticsShips,
      construction_tasks: constructionTasks,
      enemy_forces: enemyForces,
      power_coverage: powerCoverage,
      pipeline_nodes: pipelineNodes,
    },
  };
}

const SCENE_WINDOW_ALIGNMENT = 32;
const SCENE_WINDOW_PADDING = 24;
const MIN_SCENE_WINDOW_SIZE = 96;
const MAX_SCENE_WINDOW_SIZE = 320;

export function buildSceneWindow(
  planet: PlanetRenderView,
  camera: PlanetCameraSnapshot,
  tileSize: number,
  viewportWidth: number,
  viewportHeight: number,
): PlanetSceneWindow {
  const bounds = getViewportTileBounds(
    planet,
    camera,
    tileSize,
    viewportWidth,
    viewportHeight,
  );
  const visibleWidth = Math.max(1, bounds.maxX - bounds.minX + 1);
  const visibleHeight = Math.max(1, bounds.maxY - bounds.minY + 1);

  const width = clamp(
    visibleWidth + SCENE_WINDOW_PADDING * 2,
    MIN_SCENE_WINDOW_SIZE,
    Math.min(MAX_SCENE_WINDOW_SIZE, planet.map_width),
  );
  const height = clamp(
    visibleHeight + SCENE_WINDOW_PADDING * 2,
    MIN_SCENE_WINDOW_SIZE,
    Math.min(MAX_SCENE_WINDOW_SIZE, planet.map_height),
  );

  const centerX = Math.floor((bounds.minX + bounds.maxX) / 2);
  const centerY = Math.floor((bounds.minY + bounds.maxY) / 2);
  const rawX = centerX - Math.floor(width / 2);
  const rawY = centerY - Math.floor(height / 2);
  const alignedX =
    Math.floor(rawX / SCENE_WINDOW_ALIGNMENT) * SCENE_WINDOW_ALIGNMENT;
  const alignedY =
    Math.floor(rawY / SCENE_WINDOW_ALIGNMENT) * SCENE_WINDOW_ALIGNMENT;

  // 环绕轴跨接缝时（可见范围越出地图任一侧），服务端窗口无法表达
  // "尾部 + 头部"两段并集，退化为整轴拉取（仅贴边浏览时触发）。
  const crossX = Boolean(bounds.wrapX) && (bounds.minX < 0 || bounds.maxX >= planet.map_width);
  const crossY = Boolean(bounds.wrapY) && (bounds.minY < 0 || bounds.maxY >= planet.map_height);

  return {
    x: crossX ? 0 : clamp(alignedX, 0, Math.max(planet.map_width - width, 0)),
    y: crossY ? 0 : clamp(alignedY, 0, Math.max(planet.map_height - height, 0)),
    width: crossX ? planet.map_width : width,
    height: crossY ? planet.map_height : height,
  };
}

/**
 * 建造任务排队原因的中文说明（服务端 construction_tasks[].wait_reason）。
 * 第三台风机「点了没反应」其实是任务已入队但没开工：把原因显式写出来，
 * 玩家才知道是缺料、执行体忙，还是这块 8×8 区域已到并发上限。
 */
export function describeConstructionWait(
  reason: string | undefined,
  catalog?: CatalogView,
): string | null {
  switch (reason) {
    case 'insufficient_materials':
      return '材料未到齐（执行体正在从背包/仓库补齐）';
    case 'executor_concurrent_limit':
      return '执行体正在施工其他任务，排队等待';
    case 'region_concurrent_limit':
      return '该区域同时在施工的工程已达上限，排队等待';
    case '':
    case undefined:
      return null;
    default:
      return reason;
  }
}

/** 建造任务展示名：中文建筑名（服务端 building_name / 目录名），不露 b-92 这类内部 id。 */
export function constructionTaskLabel(
  task: { id: string; building_type: string; building_name?: string },
  catalog?: CatalogView,
): string {
  return task.building_name || getBuildingDisplayName(catalog, task.building_type);
}
