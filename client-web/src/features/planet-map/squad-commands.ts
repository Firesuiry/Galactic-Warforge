/**
 * 小队/战区地图直操纯逻辑（C4）：
 * - 小队 → 所属任务群解析（task_force_deploy 的选择器推导）；
 * - 右键部署计划：选中小队集合 → 按所属任务群分组的部署命令计划；
 * - 战区拖拽几何：矩形拖拽 → theater_define_zone 的 position+radius。
 *
 * 不依赖 React/pixi，输入为 runtime/task force 视图 + 拖拽坐标，输出命令意图，
 * 由 use-planet-interactions / PlanetPage 落地为真实命令。
 */

import type {
  CombatSquad,
  Position,
  WarTaskForceView,
  WarTheaterZoneType,
} from '@shared/types';

/** 小队 id → 所属任务群 id（任务群成员 kind=squad 且 entity_id 命中）。 */
export function findSquadTaskForceId(
  taskForces: readonly WarTaskForceView[],
  squadId: string,
): string | undefined {
  return taskForces.find((taskForce) =>
    (taskForce.members ?? []).some(
      (member) => member.kind === 'squad' && member.entity_id === squadId,
    ),
  )?.id;
}

export interface SquadDeployPlan {
  taskForceId: string;
  squadIds: string[];
}

export interface SquadDeployResolution {
  /** 按任务群分组的部署计划（每个任务群一条 task_force_deploy）。 */
  plans: SquadDeployPlan[];
  /** 未编入任何任务群的小队（无法直接部署，需先在战区面板编组）。 */
  unassignedSquadIds: string[];
}

/**
 * 右键部署推导：选中的己方小队按所属任务群分组；
 * 同一任务群只下一条部署命令（部署是任务群级语义）。
 */
export function resolveSquadDeploy(
  taskForces: readonly WarTaskForceView[],
  squadIds: readonly string[],
): SquadDeployResolution {
  const byTaskForce = new Map<string, string[]>();
  const unassignedSquadIds: string[] = [];
  squadIds.forEach((squadId) => {
    const taskForceId = findSquadTaskForceId(taskForces, squadId);
    if (!taskForceId) {
      unassignedSquadIds.push(squadId);
      return;
    }
    const group = byTaskForce.get(taskForceId) ?? [];
    group.push(squadId);
    byTaskForce.set(taskForceId, group);
  });
  return {
    plans: [...byTaskForce.entries()].map(([taskForceId, ids]) => ({
      taskForceId,
      squadIds: ids,
    })),
    unassignedSquadIds,
  };
}

/** 当前行星上的己方存活小队（地图上可点选/右键部署的集合）。 */
export function ownCombatSquads(
  squads: readonly CombatSquad[] | undefined,
  playerId: string,
): CombatSquad[] {
  return (squads ?? []).filter(
    (squad) => squad.owner_id === playerId && squad.state !== 'destroyed',
  );
}

/** 视口像素拖拽起止点（浮点 tile 坐标）。 */
export interface TileFloatPoint {
  x: number;
  y: number;
}

export interface TheaterZoneGeometry {
  /** 圆心（int tile 坐标，服务端 Position 为 int）。 */
  position: Position;
  /** 半径（tile，≥1，int）。 */
  radius: number;
}

/** 战区半径下限（tile）：拖拽过小时保底，避免 0 半径区域不可见。 */
export const THEATER_ZONE_MIN_RADIUS = 2;

/**
 * 拖拽矩形 → 战区圆几何：圆心 = 矩形中心（四舍五入到 int tile），
 * 半径 = 矩形长短边较大者的一半（保底 THEATER_ZONE_MIN_RADIUS，四舍五入）。
 */
export function theaterZoneFromDragRect(
  from: TileFloatPoint,
  to: TileFloatPoint,
): TheaterZoneGeometry {
  const centerX = (from.x + to.x) / 2;
  const centerY = (from.y + to.y) / 2;
  const halfWidth = Math.abs(to.x - from.x) / 2;
  const halfHeight = Math.abs(to.y - from.y) / 2;
  const radius = Math.max(
    THEATER_ZONE_MIN_RADIUS,
    Math.round(Math.max(halfWidth, halfHeight)),
  );
  return {
    position: { x: Math.round(centerX), y: Math.round(centerY), z: 0 },
    radius,
  };
}

export interface TheaterZoneDraft {
  theaterId: string;
  zoneType: WarTheaterZoneType;
}

/** 战区类型 → 地图圆圈的语义色（与告警态叠加：alerted 一律红）。 */
export function theaterZoneColor(zoneType: WarTheaterZoneType): string {
  switch (zoneType) {
    case 'primary':
    case 'secondary':
      return '#39e6d0';
    case 'no_entry':
      return '#ffb454';
    case 'rally':
      return '#8ab6ff';
    case 'supply_priority':
      return '#6ee7b7';
    default:
      return '#39e6d0';
  }
}

export function theaterZoneTypeLabel(zoneType: WarTheaterZoneType): string {
  switch (zoneType) {
    case 'primary':
      return '主战区';
    case 'secondary':
      return '次战区';
    case 'no_entry':
      return '禁入区';
    case 'rally':
      return '集结点';
    case 'supply_priority':
      return '补给优先区';
    default:
      return zoneType;
  }
}
