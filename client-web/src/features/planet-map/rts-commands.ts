/**
 * RTS 操作纯逻辑（C1）：多选/框选/双击同类/编队/右键情境指令的判定与选择器推导。
 *
 * 不依赖 React/three/pixi，输入为 planet 视图 + store 选择状态，输出为
 * "选择器（单位 id 数组）+ 命令意图"，由 use-planet-interactions 落地为真实命令。
 */

import type { PlanetRuntimeView, Position, Unit } from '@shared/types';

import {
  getBuildingList,
  getUnitList,
  tileContainsBuilding,
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

/**
 * 相对当前玩家的阵营：黑雾被动，玩家攻击后对其敌对（summary 玩家 dark_fog.hostile），
 * 一段时间不打恢复中立。
 */
export type UnitFaction = 'own' | 'enemy' | 'fog_neutral' | 'fog_hostile';

export function unitFaction(
  unit: Pick<Unit, 'owner_id' | 'type'>,
  playerId: string | undefined,
  darkFogHostile: boolean,
): UnitFaction {
  if (isDarkFogUnit(unit)) return darkFogHostile ? 'fog_hostile' : 'fog_neutral';
  return unit.owner_id === playerId ? 'own' : 'enemy';
}

export const FACTION_LABEL: Record<UnitFaction, string> = {
  own: '己方',
  enemy: '敌方',
  fog_neutral: '黑雾（中立）',
  fog_hostile: '黑雾（敌对）',
};

/** 阵营主色（3D 血条/2D 单位描边/悬停提示共用）。 */
export const FACTION_COLOR: Record<UnitFaction, number> = {
  own: 0x5ef7a1,
  enemy: 0xffa245,
  fog_neutral: 0xa58fd6,
  fog_hostile: 0xff4444,
};

/**
 * 当前选中集合里仍存活且属己方的单位（命令下发的最终选择器）。
 *
 * `knownOwnUnits` 是跨窗口累积的己方单位（见 own-entity-cache）：`/scene` 只返回相机窗口内的
 * 实体，镜头一移开，`planet.units` 里就没有被选中的单位了，早期这里直接把它过滤掉，
 * 于是「右键远处格」变成静默不下发任何命令（试玩 1010 E）。
 */
export function commandableUnitIds(
  planet: PlanetRenderView,
  selectedUnits: readonly string[],
  playerId: string,
  knownOwnUnits?: ReadonlyMap<string, Unit>,
): string[] {
  return selectedUnits.filter((id) => {
    const unit = planet.units?.[id] ?? knownOwnUnits?.get(id);
    return Boolean(unit && unit.owner_id === playerId);
  });
}

/**
 * 可接受 unit_order 的选择器：执行体（玩家机甲，unit.mecha != null）只走 move/attack
 * 单条指令、不受理 unit_order（服务端协议），这里直接过滤，避免无效命令回执。
 */
export function orderEligibleUnitIds(
  planet: PlanetRenderView,
  selectedUnits: readonly string[],
  playerId: string,
  knownOwnUnits?: ReadonlyMap<string, Unit>,
): string[] {
  return commandableUnitIds(planet, selectedUnits, playerId, knownOwnUnits)
    .filter((id) => !(planet.units?.[id] ?? knownOwnUnits?.get(id))?.mecha);
}

/** 己方单位列表 → id 索引（跨窗口累积缓存喂给选择器）。 */
export function indexUnitsById(units: readonly Unit[] | undefined): Map<string, Unit> {
  return new Map((units ?? []).map((unit) => [unit.id, unit]));
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

/**
 * 右键情境指令：点敌=攻击（敌军势力 / 非己方单位 / 非己方建筑），否则=移动到点。
 *
 * 敌方建筑同样属于可攻击目标：服务端 attack 的 resolveCombatTarget 支持
 * unit / building / enemy_force 三类，早期只判定前两类，导致「右键敌方基地 =
 * 移动过去」，与「右键敌方单位 = 开火」语义不一致（试玩报告 G3 截图 47）。
 */
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
  // 建筑可能带 2x2 以上占地：命中判定与 resolveSelectionAtTile 保持一致（按占地包含）。
  const faceSize = planet.map_width / 3;
  const hostileBuilding = getBuildingList(planet).find((building) => {
    if (building.owner_id === playerId) {
      return false;
    }
    return tileContainsBuilding(building, tile.x, tile.y, faceSize);
  });
  if (hostileBuilding) {
    return { type: 'attack', targetId: hostileBuilding.id, targetLabel: hostileBuilding.type };
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
