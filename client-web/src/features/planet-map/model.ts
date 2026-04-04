import type {
  AlertEntry,
  Building,
  CatalogView,
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
  translateBuildingState,
  translateBuildingType,
  translateEventType,
  translateItemId,
  translateTechId,
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

export type SelectedEntity =
  | { kind: "building"; id: string; position: Position }
  | { kind: "unit"; id: string; position: Position }
  | { kind: "resource"; id: string; position: Position }
  | { kind: "tile"; position: Position };

export interface SelectionExportPayload {
  selection: SelectedEntity | null;
  entity: Building | Unit | PlanetResource | null;
}

export type PlanetLayerVisibility = Record<PlanetLayerKey, boolean>;

export interface PlanetCameraSnapshot {
  offsetX: number;
  offsetY: number;
  zoomIndex: number;
}

export interface ViewportTileBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
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
    const localX = x - planet.bounds.x;
    const localY = y - planet.bounds.y;
    return planet.terrain?.[localY]?.[localX] ?? "unknown";
  }
  return planet.terrain?.[y]?.[x] ?? "unknown";
}

export function getFogState(
  fog: FogMapView | PlanetSceneView | undefined,
  x: number,
  y: number,
) {
  if (fog && "bounds" in fog) {
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

export function getBuildingFootprint(building: Building) {
  const footprint = building.runtime?.params?.footprint;
  return {
    width: Math.max(1, footprint?.width ?? 1),
    height: Math.max(1, footprint?.height ?? 1),
  };
}

export function tileContainsBuilding(building: Building, x: number, y: number) {
  const { width, height } = getBuildingFootprint(building);
  const origin = toTilePoint(building.position);
  return (
    x >= origin.x &&
    x < origin.x + width &&
    y >= origin.y &&
    y < origin.y + height
  );
}

export function resolveSelectionAtTile(
  planet: PlanetRenderView,
  x: number,
  y: number,
): SelectedEntity | null {
  const building = getBuildingList(planet).find((candidate) =>
    tileContainsBuilding(candidate, x, y),
  );
  if (building) {
    return {
      kind: "building",
      id: building.id,
      position: building.position,
    };
  }

  const unit = getUnitList(planet).find((candidate) => {
    const position = toTilePoint(candidate.position);
    return position.x === x && position.y === y;
  });
  if (unit) {
    return {
      kind: "unit",
      id: unit.id,
      position: unit.position,
    };
  }

  const resource = getResourceList(planet).find((candidate) => {
    const position = toTilePoint(candidate.position);
    return position.x === x && position.y === y;
  });
  if (resource) {
    return {
      kind: "resource",
      id: resource.id,
      position: resource.position,
    };
  }

  return null;
}

export function findSelectionEntity(
  planet: PlanetRenderView,
  selection: SelectedEntity | null,
) {
  if (!selection) {
    return null;
  }
  switch (selection.kind) {
    case "building":
      return (planet.buildings ?? {})[selection.id] ?? null;
    case "unit":
      return (planet.units ?? {})[selection.id] ?? null;
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
  return translateItemId(itemId, getItemCatalogEntry(catalog, itemId)?.name);
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

export function getViewportTileBounds(
  planet: PlanetRenderView,
  camera: PlanetCameraSnapshot,
  tileSize: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewportTileBounds {
  const minX = clamp(
    Math.floor(-camera.offsetX / tileSize),
    0,
    Math.max(planet.map_width - 1, 0),
  );
  const minY = clamp(
    Math.floor(-camera.offsetY / tileSize),
    0,
    Math.max(planet.map_height - 1, 0),
  );
  const maxX = clamp(
    Math.ceil((viewportWidth - camera.offsetX) / tileSize) - 1,
    0,
    Math.max(planet.map_width - 1, 0),
  );
  const maxY = clamp(
    Math.ceil((viewportHeight - camera.offsetY) / tileSize) - 1,
    0,
    Math.max(planet.map_height - 1, 0),
  );
  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: Number(((minX + maxX) / 2 || 0).toFixed(2)),
    centerY: Number(((minY + maxY) / 2 || 0).toFixed(2)),
  };
}

function isInsideBounds(position: Position, bounds: ViewportTileBounds) {
  const point = toTilePoint(position);
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
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
  const direct = asRecord(payload.position);
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

export function summarizeEvent(event: GameEventDetail) {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case "command_result":
      return (
        asString(payload.message) ||
        `${asString(payload.command_type) || "command"} ${asString(payload.status) || "updated"}`
      );
    case "entity_created":
      return `${asString(payload.entity_id) || "entity"} 已创建`;
    case "entity_moved":
      return `${asString(payload.entity_id) || "entity"} 移动到 ${formatPosition(extractPayloadPosition(payload))}`;
    case "entity_destroyed":
      return `${asString(payload.entity_id) || "entity"} 已销毁`;
    case "entity_updated":
      return `${asString(payload.entity_id) || "entity"} 属性已更新`;
    case "building_state_changed":
      return `${translateEventType(event.event_type)} · ${asString(payload.building_id) || "building"} ${translateBuildingState(asString(payload.prev_state) || "unknown")} -> ${translateBuildingState(asString(payload.next_state) || "unknown")}`;
    case "resource_changed":
      return `${asString(payload.resource_id) || "resource"} 储量变化`;
    case "production_alert": {
      const alert = asRecord(payload.alert);
      return alert
        ? asString(alert.message) || `${asString(alert.building_id)} 触发告警`
        : "产线告警";
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

export function summarizeAlert(alert: AlertEntry) {
  return `${alert.building_id} · ${alert.message}`;
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
    "entity_destroyed",
    "building_state_changed",
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

  return {
    x: clamp(alignedX, 0, Math.max(planet.map_width - width, 0)),
    y: clamp(alignedY, 0, Math.max(planet.map_height - height, 0)),
    width,
    height,
  };
}
