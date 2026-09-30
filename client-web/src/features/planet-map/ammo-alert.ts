import type { Unit } from '@shared/types';

/** 己方弹药耗尽（combat_state=no_ammunition）的存活单位数（全星球缺弹告警）。 */
export function countOutOfAmmoUnits(units: Record<string, Unit> | undefined, playerId: string): number {
  return Object.values(units ?? {}).filter(
    (unit) => unit.owner_id === playerId && unit.hp > 0 && unit.combat_state === 'no_ammunition',
  ).length;
}
