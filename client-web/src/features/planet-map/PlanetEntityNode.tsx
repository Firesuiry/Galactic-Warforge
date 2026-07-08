import { useEffect, useRef, useState } from 'react';

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
  PlanetResource,
  PowerCoverageView,
  PowerLinkView,
  Unit,
} from '@shared/types';

import { Icon } from '@/common/Icon';
import { getBuildingCatalogEntry, getBuildingDisplayName, getBuildingFootprint, toTilePoint } from '@/features/planet-map/model';
import { getResourceColor } from '@/features/planet-map/entity-draw';

/**
 * V3 juice：当 value 从非 target 变为 target 时返回一次性闪烁标志。
 * 配合 onAnimationEnd 清除，用于建造完成等状态转换动效。
 */
function useTransitionFlash(value: string, target: string): readonly [boolean, () => void] {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value === target && prev !== target) {
      setFlash(true);
    }
  }, [value, target]);
  return [flash, () => setFlash(false)] as const;
}

/**
 * 行星地图实体的 DOM 节点 + 连线层。
 *
 * 节点用 tile 空间定位：盒实体用 left/top/width/height（calc(var(--tile)*N)），
 * 点实体用 transform 平移到 tile 中心并 translate(-50%,-50%) 居中。
 * 尺寸也用 var(--tile) 缩放，故缩放时无需重渲染（只改容器 --tile）。
 * 所有节点都是 pointer-events:none 的只读语义 DOM，带 data-* 供 DevTools / agent 读取。
 * 视觉与 canvas 绘制保持一致（迁移期 canvas 仍画，避免重影）。
 */

export interface BuildingNodeProps {
  building: Building;
  catalog?: CatalogView;
  playerId: string;
  simplify: boolean;
  showLabel: boolean;
  isSelected?: boolean;
}

export function BuildingNode({ building, catalog, playerId, simplify, showLabel, isSelected }: BuildingNodeProps) {
  const { width, height } = getBuildingFootprint(building);
  const point = toTilePoint(building.position);
  const isOwn = building.owner_id === playerId;
  const fill = simplify
    ? (isOwn ? 'rgba(36, 201, 182, 0.4)' : 'rgba(222, 87, 87, 0.38)')
    : (isOwn ? 'rgba(36, 201, 182, 0.26)' : 'rgba(222, 87, 87, 0.22)');
  const stroke = isOwn ? '#57efe0' : '#ff7b7b';
  const catalogEntry = getBuildingCatalogEntry(catalog, building.type);
  const iconColor = catalogEntry?.color ?? (isOwn ? '#39e6d0' : '#ff7b7b');

  return (
    <div
      className="entity-node entity-node--building"
      style={{
        left: `calc(var(--tile) * ${point.x})`,
        top: `calc(var(--tile) * ${point.y})`,
        width: `calc(var(--tile) * ${width})`,
        height: `calc(var(--tile) * ${height})`,
        background: fill,
        border: simplify ? 'none' : `2px solid ${stroke}`,
        borderRadius: 2,
      }}
      data-entity-kind="building"
      data-entity-id={building.id}
      data-selected={isSelected ? '' : undefined}
      data-building-type={building.type}
      data-owner-id={building.owner_id}
      data-owner={isOwn ? 'self' : 'other'}
      data-state={building.runtime?.state ?? ''}
      data-tile-x={point.x}
      data-tile-y={point.y}
      data-hp={building.hp}
      data-max-hp={building.max_hp}
      data-level={building.level}
    >
      <Icon className="entity-node__icon" iconKey={catalogEntry?.icon_key ?? building.type} color={iconColor} fluid />
      {showLabel ? (
        <span className="entity-node__label">{getBuildingDisplayName(catalog, building.type).slice(0, 6)}</span>
      ) : null}
    </div>
  );
}

export interface UnitNodeProps {
  unit: Unit;
  playerId: string;
  simplify: boolean;
  isSelected?: boolean;
}

export function UnitNode({ unit, playerId, simplify, isSelected }: UnitNodeProps) {
  const point = toTilePoint(unit.position);
  const isOwn = unit.owner_id === playerId;
  const sizeFactor = simplify ? 0.32 : 0.44;
  return (
    <div
      className="entity-node entity-node--unit"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: `calc(var(--tile) * ${sizeFactor})`,
        height: `calc(var(--tile) * ${sizeFactor})`,
        background: isOwn ? '#91ff70' : '#ff6262',
        borderRadius: simplify ? 1 : '50%',
      }}
      data-entity-kind="unit"
      data-entity-id={unit.id}
      data-selected={isSelected ? '' : undefined}
      data-unit-type={unit.type}
      data-owner-id={unit.owner_id}
      data-owner={isOwn ? 'self' : 'other'}
      data-tile-x={point.x}
      data-tile-y={point.y}
      data-hp={unit.hp}
      data-max-hp={unit.max_hp}
      data-is-moving={unit.is_moving ? 'true' : 'false'}
      data-target-pos={unit.target_pos ? `${unit.target_pos.x},${unit.target_pos.y}` : undefined}
    >
      <Icon className="entity-node__icon" iconKey={unit.type} color={isOwn ? '#91ff70' : '#ff6262'} fluid />
    </div>
  );
}

export interface ResourceNodeProps {
  resource: PlanetResource;
  isSelected?: boolean;
}

export function ResourceNode({ resource, isSelected }: ResourceNodeProps) {
  const point = toTilePoint(resource.position);
  return (
    <div
      className="entity-node entity-node--resource"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: 'calc(var(--tile) * 0.48)',
        height: 'calc(var(--tile) * 0.48)',
      }}
      data-entity-kind="resource"
      data-entity-id={resource.id}
      data-selected={isSelected ? '' : undefined}
      data-resource-kind={resource.kind}
      data-tile-x={point.x}
      data-tile-y={point.y}
      data-remaining={resource.remaining}
      data-current-yield={resource.current_yield}
    >
      <Icon className="entity-node__icon" iconKey={resource.kind} color={getResourceColor(resource.kind)} fluid />
    </div>
  );
}

export interface DroneNodeProps {
  drone: LogisticsDroneView;
}

export function DroneNode({ drone }: DroneNodeProps) {
  const point = toTilePoint(drone.position);
  return (
    <div
      className="entity-node entity-node--drone"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: 'calc(var(--tile) * 0.36)',
        height: 'calc(var(--tile) * 0.36)',
        background: '#2dd4bf',
        borderRadius: '50%',
      }}
      data-entity-kind="drone"
      data-entity-id={drone.id}
      data-owner-id={drone.owner_id}
      data-station-id={drone.station_id}
      data-status={drone.status}
      data-tile-x={point.x}
      data-tile-y={point.y}
      data-target-pos={drone.target_pos ? `${drone.target_pos.x},${drone.target_pos.y}` : undefined}
    />
  );
}

export interface ShipNodeProps {
  ship: LogisticsShipView;
}

export function ShipNode({ ship }: ShipNodeProps) {
  const point = toTilePoint(ship.position);
  return (
    <div
      className="entity-node entity-node--ship"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: 'calc(var(--tile) * 0.32)',
        height: 'calc(var(--tile) * 0.32)',
        background: '#ffe066',
        borderRadius: 1,
      }}
      data-entity-kind="ship"
      data-entity-id={ship.id}
      data-owner-id={ship.owner_id}
      data-station-id={ship.station_id}
      data-status={ship.status}
      data-warped={ship.warped ? 'true' : 'false'}
      data-tile-x={point.x}
      data-tile-y={point.y}
      data-target-pos={ship.target_pos ? `${ship.target_pos.x},${ship.target_pos.y}` : undefined}
    />
  );
}

export interface ConstructionNodeProps {
  task: ConstructionTaskView;
  catalog?: CatalogView;
  showLabel: boolean;
}

export function ConstructionNode({ task, catalog, showLabel }: ConstructionNodeProps) {
  const [justCompleted, clearCompleted] = useTransitionFlash(task.state, 'completed');
  const point = toTilePoint(task.position);
  const color = task.state === 'in_progress'
    ? 'rgba(255, 224, 102, 0.9)'
    : task.state === 'paused'
      ? 'rgba(255, 146, 43, 0.9)'
      : task.state === 'cancelled'
        ? 'rgba(255, 107, 107, 0.9)'
        : 'rgba(148, 216, 45, 0.9)';
  return (
    <div
      className={`entity-node entity-node--construction${justCompleted ? ' build-complete' : ''}`}
      style={{
        left: `calc(var(--tile) * ${point.x})`,
        top: `calc(var(--tile) * ${point.y})`,
        width: 'calc(var(--tile) * 1)',
        height: 'calc(var(--tile) * 1)',
        border: `3px solid ${color}`,
        borderRadius: 2,
      }}
      onAnimationEnd={clearCompleted}
      data-entity-kind="construction"
      data-entity-id={task.id}
      data-building-type={task.building_type}
      data-state={task.state}
      data-tile-x={point.x}
      data-tile-y={point.y}
      data-remaining-ticks={task.remaining_ticks}
      data-total-ticks={task.total_ticks}
    >
      {showLabel ? <span className="entity-node__label">{getBuildingDisplayName(catalog, task.building_type).slice(0, 6)}</span> : null}
    </div>
  );
}

export interface EnemyForceNodeProps {
  force: EnemyForceView;
}

export function EnemyForceNode({ force }: EnemyForceNodeProps) {
  const point = toTilePoint(force.position);
  return (
    <div
      className="entity-node entity-node--enemy"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%) rotate(45deg)`,
        width: 'calc(var(--tile) * 0.4)',
        height: 'calc(var(--tile) * 0.4)',
        background: 'rgba(255, 107, 107, 0.88)',
      }}
      data-entity-kind="enemy"
      data-entity-id={force.id}
      data-enemy-type={force.type}
      data-strength={force.strength}
      data-threat-level={force.threat_level}
      data-tile-x={point.x}
      data-tile-y={point.y}
    />
  );
}

export interface DetectionNodeProps {
  detection: DetectionView;
  positionIndex: number;
}

export function DetectionNode({ detection, positionIndex }: DetectionNodeProps) {
  const raw = detection.detected_positions?.[positionIndex];
  if (!raw) {
    return null;
  }
  const point = toTilePoint(raw);
  return (
    <div
      className="entity-node entity-node--detection"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: 'calc(var(--tile) * 0.44)',
        height: 'calc(var(--tile) * 0.44)',
        border: '2px solid rgba(255, 212, 59, 0.76)',
        borderRadius: '50%',
      }}
      data-entity-kind="detection"
      data-player-id={detection.player_id}
      data-vision-range={detection.vision_range}
      data-tile-x={point.x}
      data-tile-y={point.y}
    />
  );
}

export interface PowerCoverageNodeProps {
  coverage: PowerCoverageView;
}

export function PowerCoverageNode({ coverage }: PowerCoverageNodeProps) {
  const point = toTilePoint(coverage.position);
  return (
    <div
      className="entity-node entity-node--power-coverage"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: 'calc(var(--tile) * 0.64)',
        height: 'calc(var(--tile) * 0.64)',
        border: `2px solid ${coverage.connected ? 'rgba(116, 192, 252, 0.92)' : 'rgba(255, 107, 107, 0.92)'}`,
        borderRadius: '50%',
      }}
      data-entity-kind="power-coverage"
      data-building-id={coverage.building_id}
      data-connected={coverage.connected ? 'true' : 'false'}
      data-tile-x={point.x}
      data-tile-y={point.y}
    />
  );
}

export interface PipelineNodeProps {
  node: PipelineNodeView;
}

export function PipelineNodeComponent({ node }: PipelineNodeProps) {
  const point = toTilePoint(node.position);
  return (
    <div
      className="entity-node entity-node--pipeline-node"
      style={{
        transform: `translate(calc(var(--tile) * ${point.x + 0.5}), calc(var(--tile) * ${point.y + 0.5})) translate(-50%, -50%)`,
        width: 'calc(var(--tile) * 0.36)',
        height: 'calc(var(--tile) * 0.36)',
        background: node.fluid_id ? getResourceColor(node.fluid_id) : '#63e6be',
        borderRadius: 1,
      }}
      data-entity-kind="pipeline-node"
      data-entity-id={node.id}
      data-fluid-id={node.fluid_id ?? ''}
      data-pressure={node.pressure}
      data-buffer={node.buffer}
      data-tile-x={point.x}
      data-tile-y={point.y}
    />
  );
}

/** 一条连线段（tile 坐标）。用于物流/电力/管道的线段，统一在一个 SVG 里渲染。 */
export interface EntityLinkSegment {
  key: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  width: number;
  dash?: string;
}

export interface EntityLinkLayerProps {
  segments: EntityLinkSegment[];
  tileSize: number;
  kind: 'logistics' | 'power' | 'pipeline';
}

export function EntityLinkLayer({ segments, tileSize, kind }: EntityLinkLayerProps) {
  if (segments.length === 0) {
    return null;
  }
  return (
    <svg className={`entity-layer__svg entity-layer__svg--${kind}`} aria-hidden="true">
      {segments.map((segment) => (
        <line
          key={segment.key}
          x1={(segment.fromX + 0.5) * tileSize}
          y1={(segment.fromY + 0.5) * tileSize}
          x2={(segment.toX + 0.5) * tileSize}
          y2={(segment.toY + 0.5) * tileSize}
          stroke={segment.color}
          strokeWidth={segment.width}
          strokeDasharray={segment.dash}
        />
      ))}
    </svg>
  );
}

/** 由 PowerLinkView[] 构造连线段（与 canvas drawPower 的配色一致）。 */
export function buildPowerLinkSegments(links: PowerLinkView[]): EntityLinkSegment[] {
  return links.map((link) => {
    const from = toTilePoint(link.from_position);
    const to = toTilePoint(link.to_position);
    const wireless = link.kind === 'wireless';
    return {
      key: `power-${link.from_building_id}-${link.to_building_id}`,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      color: wireless ? 'rgba(255, 212, 59, 0.72)' : 'rgba(116, 192, 252, 0.72)',
      width: wireless ? 2 : 3,
      dash: wireless ? '6,6' : undefined,
    };
  });
}

/** 由 PipelineSegmentView[] 构造连线段。 */
export function buildPipelineSegments(segments: PipelineSegmentView[]): EntityLinkSegment[] {
  return segments.map((segment) => {
    const from = toTilePoint(segment.from_position);
    const to = toTilePoint(segment.to_position);
    return {
      key: `pipeline-${segment.id}`,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      color: 'rgba(99, 230, 190, 0.78)',
      width: 3,
    };
  });
}

/** 由物流无人机/船的目标构造连线段（与 canvas drawLogistics 配色一致）。 */
export function buildLogisticsSegments(drones: LogisticsDroneView[], ships: LogisticsShipView[]): EntityLinkSegment[] {
  const droneSegments = drones.flatMap((drone) => {
    if (!drone.target_pos) {
      return [];
    }
    const from = toTilePoint(drone.position);
    const to = toTilePoint(drone.target_pos);
    return [{
      key: `drone-${drone.id}`,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      color: 'rgba(45, 212, 191, 0.72)',
      width: 2,
      dash: '8,6',
    }];
  });
  const shipSegments = ships.flatMap((ship) => {
    if (!ship.target_pos) {
      return [];
    }
    const from = toTilePoint(ship.position);
    const to = toTilePoint(ship.target_pos);
    return [{
      key: `ship-${ship.id}`,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      color: 'rgba(255, 224, 102, 0.68)',
      width: 2,
      dash: '2,8',
    }];
  });
  return [...droneSegments, ...shipSegments];
}
