/**
 * RTS 操作纯逻辑（C1）：多选/框选/双击同类/编队/右键情境指令的判定与选择器推导。
 *
 * 不依赖 React/three/pixi，输入为 planet 视图 + store 选择状态，输出为
 * "选择器（单位 id 数组）+ 命令意图"，由 use-planet-interactions 落地为真实命令。
 */

import type { PlanetRuntimeView, Position, Unit } from '@shared/types';

import {
  getUnitList,
  toTilePoint,
  type PlanetRenderView,
  type TilePoint,
  type ViewportTileBounds,
} from '@/features/planet-map/model';

/** 黑雾单位的属主 id（服务端固定常量，敌对全部玩家）。 */
export const DARK_FOG_OWNER_ID = 'dark_fog';

export function isDarkFogUnit(unit: Pick<Unit, 'owner_id' | 'type'>): boolean {
  return unit.owner_id === DARK_FOG_OWNER_ID || (unit.type as string) === DARK_FOG_OWNER_ID;
}

/** 当前选中集合里仍存活且属己方的单位（命令下发的最终选择器）。 */
export function commandableUnitIds(
  planet: PlanetRenderView,
  selectedUnits: readonly string[],
  playerId: string,
): string[] {
  return selectedUnits.filter((id) => {
    const unit = planet.units?.[id];
    return Boolean(unit && unit.owner_id === playerId);
  });
}

/**
 * 可接受 unit_order 的选择器：执行体（玩家机甲，unit.mecha != null）保留瞬移与
 * 手动一击、不受理 unit_order（服务端协议），这里直接过滤，避免无效命令回执。
 */
export function orderEligibleUnitIds(
  planet: PlanetRenderView,
  selectedUnits: readonly string[],
  playerId: string,
): string[] {
  return commandableUnitIds(planet, selectedUnits, playerId).filter((id) => !planet.units?.[id]?.mecha);
}

export interface TileRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 框选：tile 矩形内的己方单位（按 id 排序保证稳定）。 */
export function ownUnitsInTileRect(
  planet: PlanetRenderView,
  playerId: string,
  rect: TileRect,
): string[] {
  return getUnitList(planet)
    .filter((unit) => {
      if (unit.owner_id !== playerId) {
        return false;
      }
      const pos = toTilePoint(unit.position);
      return pos.x >= rect.minX && pos.x <= rect.maxX && pos.y >= rect.minY && pos.y <= rect.maxY;
    })
    .map((unit) => unit.id);
}

/** 双击选同类：视口内与目标单位同 type 的全部己方单位。 */
export function sameTypeOwnUnitsInView(
  planet: PlanetRenderView,
  playerId: string,
  unitId: string,
  bounds: ViewportTileBounds | null,
): string[] {
  const anchor = planet.units?.[unitId];
  if (!anchor || anchor.owner_id !== playerId) {
    return [];
  }
  return getUnitList(planet)
    .filter((unit) => {
      if (unit.owner_id !== playerId || unit.type !== anchor.type) {
        return false;
      }
      if (!bounds) {
        return true;
      }
      const pos = toTilePoint(unit.position);
      return pos.x >= bounds.minX && pos.x <= bounds.maxX && pos.y >= bounds.minY && pos.y <= bounds.maxY;
    })
    .map((unit) => unit.id);
}

/** 右键情境指令：点敌=攻击（敌军势力优先，其次非己方单位），否则=移动到点。 */
export type ContextCommand =
  | { type: 'move'; position: Position }
  | { type: 'attack'; targetId: string; targetLabel: string };

export function resolveContextCommand(
  planet: PlanetRenderView,
  runtime: PlanetRuntimeView | undefined,
  playerId: string,
  tile: TilePoint,
): ContextCommand {
  const enemy = (runtime?.enemy_forces ?? []).find((force) => {
    const pos = toTilePoint(force.position);
    return pos.x === tile.x && pos.y === tile.y;
  });
  if (enemy) {
    return { type: 'attack', targetId: enemy.id, targetLabel: enemy.type };
  }
  const hostileUnit = getUnitList(planet).find((unit) => {
    if (unit.owner_id === playerId) {
      return false;
    }
    const pos = toTilePoint(unit.position);
    return pos.x === tile.x && pos.y === tile.y;
  });
  if (hostileUnit) {
    return { type: 'attack', targetId: hostileUnit.id, targetLabel: hostileUnit.type };
  }
  return { type: 'move', position: { x: tile.x, y: tile.y, z: 0 } };
}

/** 多选构成摘要：[{ type, count }]，按数量降序 + type 字典序（面板展示用）。 */
export function summarizeUnitSelection(
  planet: PlanetRenderView,
  unitIds: readonly string[],
): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  unitIds.forEach((id) => {
    const unit = planet.units?.[id];
    if (!unit) {
      return;
    }
    counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

/** 读取编队时过滤掉已阵亡/非己方成员。 */
export function pruneControlGroup(
  planet: PlanetRenderView,
  playerId: string,
  unitIds: readonly string[],
): string[] {
  return unitIds.filter((id) => {
    const unit = planet.units?.[id];
    return Boolean(unit && unit.owner_id === playerId);
  });
}
