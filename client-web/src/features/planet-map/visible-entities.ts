import type {
  Building,
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

import { getResourceList, getUnitList, getBuildingList, type PlanetRenderView, type ViewportTileBounds } from '@/features/planet-map/model';
import { isBuildingFootprintVisible, isPositionVisible } from '@/features/planet-map/render';

/**
 * 行星地图"可见实体集合"与资源调色板。
 *
 * Pixi 场景层（planet-scene.ts）与语义 DOM 层（PlanetEntityLayer/PlanetEntityNode）共用：
 * - collectVisibleEntities 按视口裁剪出需要渲染的实体，避免两处各算一遍；
 * - getResourceColor 是资源配色唯一来源（DOM 节点与 Pixi 节点颜色一致）。
 */

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

/** 资源配色的数值形式（Pixi fill/stroke 用），与 getResourceColor 同源。 */
export function getResourceColorValue(kind: string) {
  return Number.parseInt(getResourceColor(kind).slice(1), 16);
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

/** 视口内可见的实体集合（Pixi 场景层与语义 DOM 层共用，避免两处各算一遍）。 */
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
