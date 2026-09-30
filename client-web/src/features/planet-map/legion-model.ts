/**
 * 军团（3.4）纯逻辑：军团 = 指令容器（CombatSquad 的 member_ids 形态），无共享血条。
 * 不依赖 React：列表、地图标记位置、指令箭头、编队候选、缺弹统计。
 */

import type { CombatSquad, Position, SquadOrderKind, Unit } from '@shared/types';

export type LegionUnits = Record<string, Unit> | undefined;

export const LEGION_ORDER_LABEL: Record<SquadOrderKind, string> = {
  idle: '待命',
  attack: '进攻',
  defend: '防守',
  retreat: '撤退',
  resupply: '补给优先',
};

/** 需要地图目标点的军团指令。 */
export type LegionTargetOrder = 'attack' | 'defend' | 'retreat';
export const LEGION_TARGET_ORDERS: LegionTargetOrder[] = ['attack', 'defend', 'retreat'];

export function isLegion(squad: CombatSquad): boolean {
  return (squad.member_ids?.length ?? 0) > 0;
}

/** 己方存活军团（旧式 HP 池小队不算）。 */
export function ownLegions(squads: readonly CombatSquad[] | undefined, playerId: string): CombatSquad[] {
  return (squads ?? []).filter(
    (squad) => squad.owner_id === playerId && squad.state !== 'destroyed' && isLegion(squad),
  );
}

/** 仍存活的成员单位 id。 */
export function legionAliveMemberIds(legion: CombatSquad, units: LegionUnits): string[] {
  return (legion.member_ids ?? []).filter((id) => (units?.[id]?.hp ?? 0) > 0);
}

/** 军团标记位置：存活成员质心，无成员数据时回退军团自身 position。 */
export function legionCenter(legion: CombatSquad, units: LegionUnits): Position {
  const members = legionAliveMemberIds(legion, units).map((id) => units![id].position);
  if (members.length === 0) {
    return legion.position;
  }
  const sum = members.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / members.length, y: sum.y / members.length, z: 0 };
}

export interface LegionArrow {
  from: Position;
  to: Position;
  order: LegionTargetOrder;
}

/** 指令箭头：仅 attack/defend/retreat 且有目标点时存在。 */
export function legionArrow(legion: CombatSquad, units: LegionUnits): LegionArrow | null {
  const order = legion.order;
  if (!legion.target || (order !== 'attack' && order !== 'defend' && order !== 'retreat')) {
    return null;
  }
  return { from: legionCenter(legion, units), to: legion.target, order };
}

export const LEGION_ARROW_COLOR: Record<LegionTargetOrder, string> = {
  attack: '#ff6b6b',
  defend: '#5fb0ff',
  retreat: '#ffb454',
};

/** 军团内弹药耗尽（combat_state=no_ammunition）的单位数。 */
export function legionOutOfAmmoCount(legion: CombatSquad, units: LegionUnits): number {
  return legionAliveMemberIds(legion, units).filter(
    (id) => units?.[id]?.combat_state === 'no_ammunition',
  ).length;
}

/** 可编入军团的单位：己方存活军事单位（非机甲/工程兵/执行体），且尚未在军团中。 */
export function formableUnitIds(
  units: LegionUnits,
  candidateIds: readonly string[],
  playerId: string,
): string[] {
  return candidateIds.filter((id) => {
    const unit = units?.[id];
    return Boolean(
      unit
        && unit.hp > 0
        && unit.owner_id === playerId
        && !unit.mecha
        && unit.type !== 'executor'
        && unit.type !== 'worker'
        && !unit.squad_id,
    );
  });
}
