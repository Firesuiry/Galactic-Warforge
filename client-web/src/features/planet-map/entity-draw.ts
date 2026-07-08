import type {
  Building,
  CatalogView,
  ConstructionTaskView,
  DetectionView,
  EnemyForceView,
  LogisticsDroneView,
  LogisticsShipView,
  PipelineNodeView,
  PipelineSegmentView,
  PlanetNetworksView,
  PlanetResource,
  PlanetRuntimeView,
  PowerCoverageView,
  PowerLinkView,
  Unit,
} from '@shared/types';

import { getBuildingDisplayName, getBuildingFootprint, getResourceList, getUnitList, getViewportTileBounds, getBuildingList, toTilePoint, type PlanetRenderView, type ViewportTileBounds } from '@/features/planet-map/model';
import type { PlanetCameraState } from '@/features/planet-map/store';
import { getPlanetRenderTileSize } from '@/features/planet-map/store';
import { getSceneRenderDetailPolicy } from '@/features/planet-map/render';
import type { SceneRenderDetailPolicy } from '@/features/planet-map/render';
import { isBuildingFootprintVisible, isPositionVisible } from '@/features/planet-map/render';

/**
 * 行星地图实体的 Canvas 2D 绘制函数（纯函数，输入即全部依赖）。
 *
 * 这些函数从 PlanetMapCanvas 的 base-frame effect 里逐字搬迁而来，迁移期仍由 canvas 调用
 * （保证像素与重构前一致、稳住视觉基线），实体迁到 DOM 后由 PNG 导出路径复用以合成全保真截图。
 */

export interface EntityDrawCamera {
  offsetX: number;
  offsetY: number;
}

const resourceColors: Record<string, string> = {
  iron_ore: '#8ea5b8',
  copper_ore: '#e38d4a',
  coal: '#666b73',
  stone: '#c8c0a4',
  oil: '#4d3a89',
  silicon_ore: '#6fc5c2',
};

export function getResourceColor(kind: string) {
  return resourceColors[kind] ?? '#d2c06f';
}

function tileCenter(cameraOffset: number, tile: number, tileSize: number) {
  return cameraOffset + ((tile + 0.5) * tileSize);
}

function drawCenteredLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number) {
  context.save();
  context.fillStyle = 'rgba(5, 12, 22, 0.82)';
  const width = context.measureText(text).width + 8;
  context.fillRect(x - (width / 2), y - 10, width, 14);
  context.fillStyle = '#edf6ff';
  context.fillText(text, x - (width / 2) + 4, y);
  context.restore();
}

export function drawResources(
  context: CanvasRenderingContext2D,
  resources: PlanetResource[],
  camera: EntityDrawCamera,
  tileSize: number,
  detailPolicy: SceneRenderDetailPolicy,
) {
  resources.forEach((resource) => {
    const position = toTilePoint(resource.position);
    const screenX = camera.offsetX + ((position.x + 0.5) * tileSize);
    const screenY = camera.offsetY + ((position.y + 0.5) * tileSize);
    context.fillStyle = getResourceColor(resource.kind);
    context.beginPath();
    context.arc(screenX, screenY, Math.max(2, tileSize * (detailPolicy.simplifyStructures ? 0.18 : 0.24)), 0, Math.PI * 2);
    context.fill();
  });
}

export function drawBuildings(
  context: CanvasRenderingContext2D,
  buildings: Building[],
  camera: EntityDrawCamera,
  tileSize: number,
  catalog: CatalogView | undefined,
  playerId: string,
  detailPolicy: SceneRenderDetailPolicy,
) {
  buildings.forEach((building) => {
    const { width, height } = getBuildingFootprint(building);
    const position = toTilePoint(building.position);
    const screenX = camera.offsetX + (position.x * tileSize);
    const screenY = camera.offsetY + (position.y * tileSize);
    const pixelWidth = width * tileSize;
    const pixelHeight = height * tileSize;

    if (detailPolicy.simplifyStructures) {
      context.fillStyle = building.owner_id === playerId ? 'rgba(36, 201, 182, 0.4)' : 'rgba(222, 87, 87, 0.38)';
      context.fillRect(screenX, screenY, Math.max(pixelWidth, 2), Math.max(pixelHeight, 2));
    } else {
      context.fillStyle = building.owner_id === playerId ? 'rgba(36, 201, 182, 0.26)' : 'rgba(222, 87, 87, 0.22)';
      context.fillRect(screenX + 1, screenY + 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2));
      context.strokeStyle = building.owner_id === playerId ? '#57efe0' : '#ff7b7b';
      context.lineWidth = 2;
      context.strokeRect(screenX + 1, screenY + 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2));
    }

    if (detailPolicy.showBuildingLabels) {
      context.fillStyle = '#edf6ff';
      context.font = '11px sans-serif';
      context.fillText(getBuildingDisplayName(catalog, building.type).slice(0, 6), screenX + 4, screenY + 14);
    }
  });
}

export function drawUnits(
  context: CanvasRenderingContext2D,
  units: Unit[],
  camera: EntityDrawCamera,
  tileSize: number,
  playerId: string,
  detailPolicy: SceneRenderDetailPolicy,
) {
  units.forEach((unit) => {
    const position = toTilePoint(unit.position);
    const screenX = camera.offsetX + ((position.x + 0.5) * tileSize);
    const screenY = camera.offsetY + ((position.y + 0.5) * tileSize);
    context.fillStyle = unit.owner_id === playerId ? '#91ff70' : '#ff6262';
    if (detailPolicy.simplifyStructures) {
      const size = Math.max(3, tileSize * 0.32);
      context.fillRect(screenX - (size / 2), screenY - (size / 2), size, size);
    } else {
      context.beginPath();
      context.arc(screenX, screenY, Math.max(3, tileSize * 0.22), 0, Math.PI * 2);
      context.fill();
    }
  });
}

export function drawLogistics(
  context: CanvasRenderingContext2D,
  drones: LogisticsDroneView[],
  ships: LogisticsShipView[],
  camera: EntityDrawCamera,
  tileSize: number,
) {
  context.save();
  context.lineWidth = 2;
  drones.forEach((drone) => {
    const start = toTilePoint(drone.position);
    const startX = tileCenter(camera.offsetX, start.x, tileSize);
    const startY = tileCenter(camera.offsetY, start.y, tileSize);
    if (drone.target_pos) {
      const target = toTilePoint(drone.target_pos);
      context.setLineDash([8, 6]);
      context.strokeStyle = 'rgba(45, 212, 191, 0.72)';
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(tileCenter(camera.offsetX, target.x, tileSize), tileCenter(camera.offsetY, target.y, tileSize));
      context.stroke();
    }
    context.setLineDash([]);
    context.fillStyle = '#2dd4bf';
    context.beginPath();
    context.arc(startX, startY, Math.max(4, tileSize * 0.18), 0, Math.PI * 2);
    context.fill();
  });
  ships.forEach((ship) => {
    const start = toTilePoint(ship.position);
    const startX = tileCenter(camera.offsetX, start.x, tileSize);
    const startY = tileCenter(camera.offsetY, start.y, tileSize);
    if (ship.target_pos) {
      const target = toTilePoint(ship.target_pos);
      context.setLineDash([2, 8]);
      context.strokeStyle = 'rgba(255, 224, 102, 0.68)';
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(tileCenter(camera.offsetX, target.x, tileSize), tileCenter(camera.offsetY, target.y, tileSize));
      context.stroke();
    }
    context.setLineDash([]);
    context.fillStyle = '#ffe066';
    context.fillRect(startX - Math.max(3, tileSize * 0.16), startY - Math.max(3, tileSize * 0.16), Math.max(6, tileSize * 0.32), Math.max(6, tileSize * 0.32));
  });
  context.restore();
}

export function drawPower(
  context: CanvasRenderingContext2D,
  links: PowerLinkView[],
  coverage: PowerCoverageView[],
  camera: EntityDrawCamera,
  tileSize: number,
) {
  context.save();
  links.forEach((link) => {
    const from = toTilePoint(link.from_position);
    const to = toTilePoint(link.to_position);
    context.beginPath();
    context.setLineDash(link.kind === 'wireless' ? [6, 6] : []);
    context.strokeStyle = link.kind === 'wireless' ? 'rgba(255, 212, 59, 0.72)' : 'rgba(116, 192, 252, 0.72)';
    context.lineWidth = link.kind === 'wireless' ? 2 : 3;
    context.moveTo(tileCenter(camera.offsetX, from.x, tileSize), tileCenter(camera.offsetY, from.y, tileSize));
    context.lineTo(tileCenter(camera.offsetX, to.x, tileSize), tileCenter(camera.offsetY, to.y, tileSize));
    context.stroke();
  });
  context.setLineDash([]);
  coverage.forEach((node) => {
    const point = toTilePoint(node.position);
    const centerX = tileCenter(camera.offsetX, point.x, tileSize);
    const centerY = tileCenter(camera.offsetY, point.y, tileSize);
    context.strokeStyle = node.connected ? 'rgba(116, 192, 252, 0.92)' : 'rgba(255, 107, 107, 0.92)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, Math.max(6, tileSize * 0.32), 0, Math.PI * 2);
    context.stroke();
  });
  context.restore();
}

export function drawPipelines(
  context: CanvasRenderingContext2D,
  segments: PipelineSegmentView[],
  nodes: PipelineNodeView[],
  camera: EntityDrawCamera,
  tileSize: number,
) {
  context.save();
  segments.forEach((segment) => {
    const from = toTilePoint(segment.from_position);
    const to = toTilePoint(segment.to_position);
    context.strokeStyle = 'rgba(99, 230, 190, 0.78)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(tileCenter(camera.offsetX, from.x, tileSize), tileCenter(camera.offsetY, from.y, tileSize));
    context.lineTo(tileCenter(camera.offsetX, to.x, tileSize), tileCenter(camera.offsetY, to.y, tileSize));
    context.stroke();
  });
  nodes.forEach((node) => {
    const point = toTilePoint(node.position);
    const centerX = tileCenter(camera.offsetX, point.x, tileSize);
    const centerY = tileCenter(camera.offsetY, point.y, tileSize);
    context.fillStyle = node.fluid_id ? getResourceColor(node.fluid_id) : '#63e6be';
    context.fillRect(centerX - Math.max(3, tileSize * 0.18), centerY - Math.max(3, tileSize * 0.18), Math.max(6, tileSize * 0.36), Math.max(6, tileSize * 0.36));
  });
  context.restore();
}

export function drawConstruction(
  context: CanvasRenderingContext2D,
  tasks: ConstructionTaskView[],
  camera: EntityDrawCamera,
  tileSize: number,
) {
  context.save();
  tasks.forEach((task) => {
    const point = toTilePoint(task.position);
    const screenX = camera.offsetX + (point.x * tileSize);
    const screenY = camera.offsetY + (point.y * tileSize);
    const color = task.state === 'in_progress'
      ? 'rgba(255, 224, 102, 0.9)'
      : task.state === 'paused'
        ? 'rgba(255, 146, 43, 0.9)'
        : task.state === 'cancelled'
          ? 'rgba(255, 107, 107, 0.9)'
          : 'rgba(148, 216, 45, 0.9)';
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.strokeRect(screenX + 2, screenY + 2, Math.max(tileSize - 4, 4), Math.max(tileSize - 4, 4));
    if (tileSize >= 24) {
      context.font = '11px sans-serif';
      drawCenteredLabel(context, task.state, screenX + (tileSize / 2), screenY + 14);
    }
  });
  context.restore();
}

export function drawThreat(
  context: CanvasRenderingContext2D,
  forces: EnemyForceView[],
  detections: DetectionView[],
  camera: EntityDrawCamera,
  tileSize: number,
  viewportBounds: ViewportTileBounds,
) {
  context.save();
  forces.forEach((force) => {
    const point = toTilePoint(force.position);
    const centerX = tileCenter(camera.offsetX, point.x, tileSize);
    const centerY = tileCenter(camera.offsetY, point.y, tileSize);
    context.fillStyle = 'rgba(255, 107, 107, 0.88)';
    context.beginPath();
    context.moveTo(centerX, centerY - Math.max(6, tileSize * 0.28));
    context.lineTo(centerX + Math.max(6, tileSize * 0.28), centerY);
    context.lineTo(centerX, centerY + Math.max(6, tileSize * 0.28));
    context.lineTo(centerX - Math.max(6, tileSize * 0.28), centerY);
    context.closePath();
    context.fill();
  });
  detections.forEach((detection) => {
    detection.detected_positions?.forEach((position) => {
      if (!isPositionVisible(position, viewportBounds, 1)) {
        return;
      }
      const point = toTilePoint(position);
      const centerX = tileCenter(camera.offsetX, point.x, tileSize);
      const centerY = tileCenter(camera.offsetY, point.y, tileSize);
      context.strokeStyle = 'rgba(255, 212, 59, 0.76)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(centerX, centerY, Math.max(5, tileSize * 0.22), 0, Math.PI * 2);
      context.stroke();
    });
  });
  context.restore();
}

/** 各图层是否绘制（与 store 的 PlanetLayerState 子集对齐）。 */
export interface EntityLayerFlags {
  buildings: boolean;
  units: boolean;
  resources: boolean;
  logistics: boolean;
  construction: boolean;
  threat: boolean;
  power: boolean;
  pipelines: boolean;
}

/** 视口内可见的实体集合（DOM 实体层与 PNG 导出共用，避免两处各算一遍）。 */
export interface VisibleEntities {
  buildings: Building[];
  units: Unit[];
  resources: PlanetResource[];
  logisticsDrones: LogisticsDroneView[];
  logisticsShips: LogisticsShipView[];
  constructionTasks: ConstructionTaskView[];
  enemyForces: EnemyForceView[];
  detections: DetectionView[];
  powerLinks: PowerLinkView[];
  powerCoverage: PowerCoverageView[];
  pipelineSegments: PipelineSegmentView[];
  pipelineNodes: PipelineNodeView[];
}

export function collectVisibleEntities(
  planet: PlanetRenderView,
  runtime: PlanetRuntimeView | undefined,
  networks: PlanetNetworksView | undefined,
  bounds: ViewportTileBounds,
): VisibleEntities {
  const buildings = getBuildingList(planet).filter((building) => isBuildingFootprintVisible(building, bounds, 1));
  const units = getUnitList(planet).filter((unit) => isPositionVisible(unit.position, bounds, 1));
  const resources = getResourceList(planet).filter((resource) => isPositionVisible(resource.position, bounds, 1));

  const logisticsDrones = (runtime?.available ? runtime.logistics_drones ?? [] : []).filter((drone) => (
    isPositionVisible(drone.position, bounds, 1)
    || Boolean(drone.target_pos && isPositionVisible(drone.target_pos, bounds, 1))
  ));
  const logisticsShips = (runtime?.available ? runtime.logistics_ships ?? [] : []).filter((ship) => (
    isPositionVisible(ship.position, bounds, 1)
    || Boolean(ship.target_pos && isPositionVisible(ship.target_pos, bounds, 1))
  ));
  const constructionTasks = (runtime?.available ? runtime.construction_tasks ?? [] : []).filter((task) => isPositionVisible(task.position, bounds, 1));
  const enemyForces = (runtime?.available ? runtime.enemy_forces ?? [] : []).filter((force) => isPositionVisible(force.position, bounds, 1));
  const detections = (runtime?.available ? runtime.detections ?? [] : []).filter((detection) => (
    (detection.detected_positions ?? []).some((position) => isPositionVisible(position, bounds, 1))
  ));
  const powerLinks = (networks?.available ? networks.power_links ?? [] : []).filter((link) => (
    isPositionVisible(link.from_position, bounds, 1) || isPositionVisible(link.to_position, bounds, 1)
  ));
  const powerCoverage = (networks?.available ? networks.power_coverage ?? [] : []).filter((coverage) => isPositionVisible(coverage.position, bounds, 1));
  const pipelineSegments = (networks?.available ? networks.pipeline_segments ?? [] : []).filter((segment) => (
    isPositionVisible(segment.from_position, bounds, 1) || isPositionVisible(segment.to_position, bounds, 1)
  ));
  const pipelineNodes = (networks?.available ? networks.pipeline_nodes ?? [] : []).filter((node) => isPositionVisible(node.position, bounds, 1));

  return {
    buildings,
    units,
    resources,
    logisticsDrones,
    logisticsShips,
    constructionTasks,
    enemyForces,
    detections,
    powerLinks,
    powerCoverage,
    pipelineSegments,
    pipelineNodes,
  };
}

/**
 * 把所有可见实体按图层绘制到给定 canvas 上下文（用于 PNG 导出合成：底图 + 实体）。
 * 与 DOM 实体层共用 collectVisibleEntities，保证导出图与屏幕一致。
 */
export function renderEntitiesToCanvas(
  context: CanvasRenderingContext2D,
  planet: PlanetRenderView,
  runtime: PlanetRuntimeView | undefined,
  networks: PlanetNetworksView | undefined,
  camera: PlanetCameraState,
  viewportWidth: number,
  viewportHeight: number,
  catalog: CatalogView | undefined,
  playerId: string,
  layers: EntityLayerFlags,
) {
  const tileSize = getPlanetRenderTileSize(camera.zoomIndex, viewportWidth, viewportHeight, planet.map_width, planet.map_height);
  const bounds = getViewportTileBounds(planet, camera, tileSize, viewportWidth, viewportHeight);
  const detailPolicy: SceneRenderDetailPolicy = getSceneRenderDetailPolicy(tileSize);
  const visible = collectVisibleEntities(planet, runtime, networks, bounds);
  const cameraOffset: EntityDrawCamera = { offsetX: camera.offsetX, offsetY: camera.offsetY };

  if (layers.resources) {
    drawResources(context, visible.resources, cameraOffset, tileSize, detailPolicy);
  }
  if (layers.buildings) {
    drawBuildings(context, visible.buildings, cameraOffset, tileSize, catalog, playerId, detailPolicy);
  }
  if (layers.units) {
    drawUnits(context, visible.units, cameraOffset, tileSize, playerId, detailPolicy);
  }
  if (layers.logistics) {
    drawLogistics(context, visible.logisticsDrones, visible.logisticsShips, cameraOffset, tileSize);
  }
  if (layers.power) {
    drawPower(context, visible.powerLinks, visible.powerCoverage, cameraOffset, tileSize);
  }
  if (layers.pipelines) {
    drawPipelines(context, visible.pipelineSegments, visible.pipelineNodes, cameraOffset, tileSize);
  }
  if (layers.construction) {
    drawConstruction(context, visible.constructionTasks, cameraOffset, tileSize);
  }
  if (layers.threat) {
    drawThreat(context, visible.enemyForces, visible.detections, cameraOffset, tileSize, bounds);
  }
}
