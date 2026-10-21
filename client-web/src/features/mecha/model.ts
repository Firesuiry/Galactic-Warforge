import { selectMyMechaFromSummary, sortMechas } from '@shared/mecha';
import type { MechaView, PlayerState, StateSummary } from '@shared/types';

/**
 * 机甲档案的界面口径（契约 §7.3）：类型与「我的机甲」选择器直接复用
 * `@gw/shared`（`shared-client/src/mecha.ts`，与 CLI / agent-gateway 同源），
 * 这里只保留展示文案与背包格数换算。
 */

export type { MechaView };

/** 某玩家的全部机甲（按 unit_id 排序，与服务端口径一致）。 */
export function playerMechas(player?: Pick<PlayerState, 'mechas'> | null): MechaView[] {
  return sortMechas(player?.mechas);
}

/**
 * 「我的机甲」= 操作者等于自己的那台（契约 §7.3）。
 * shared-client 的版本取玩家那一层，这里包一层 summary，省得每个调用点自己拆。
 *
 * 一个发令者可以绑多台机甲（可能在不同行星），传 `planetId` 时优先取那颗行星上的那台。
 */
export function selectMyMecha(
  summary: StateSummary | undefined,
  playerId: string,
  planetId?: string,
): MechaView | undefined {
  return selectMyMechaFromSummary(summary, playerId, playerId, planetId);
}

/** 玩家的全部机甲（从 summary 取）。 */
export function selectPlayerMechas(summary: StateSummary | undefined, playerId: string): MechaView[] {
  return playerMechas(summary?.players?.[playerId]);
}

/** 按单位 ID 找机甲档案（只含自己玩家的档案；别人的机甲不在 summary 里）。 */
export function selectMechaById(
  summary: StateSummary | undefined,
  playerId: string,
  unitId: string,
): MechaView | undefined {
  return selectPlayerMechas(summary, playerId).find((mecha) => mecha.unit_id === unitId);
}

/**
 * 本玩家名下、但已绑定给其他发令者的机甲 unit_id 集合（契约 §3.1：move/attack
 * 对别人绑定的机甲逐个拒绝 NOT_OPERATOR）。框选/编队/右键批量指令都要先把它们排除，
 * 否则一条命令里混着会被拒的单位，玩家看到的是「部分失败」。
 */
export function foreignOperatedMechaIds(
  summary: StateSummary | undefined,
  playerId: string,
): Set<string> {
  return new Set(
    selectPlayerMechas(summary, playerId)
      .filter((mecha) => Boolean(mecha.operator) && mecha.operator !== playerId)
      .map((mecha) => mecha.unit_id),
  );
}

/** 背包格数占用（契约 §6 的 inventory_slots_used/total）。 */
export function mechaSlotUsage(mecha: MechaView | undefined): { used: number; total: number } | null {
  const total = mecha?.inventory_slots_total ?? 0;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const used = Math.max(0, mecha?.inventory_slots_used ?? 0);
  return { used: Math.min(used, total), total };
}

/** 操作者显示名：自己显示「我」，其它原样（agent 名 / 玩家 ID）。 */
export function mechaOperatorLabel(operator: string | undefined, playerId: string): string {
  if (!operator) {
    return '空闲';
  }
  return operator === playerId ? '我' : operator;
}

/** 状态文案：存活 / 复活于 tick N（阵亡且无复活 tick 时退回「阵亡」）。 */
export function mechaStatusLabel(mecha: MechaView): string {
  if (mecha.alive) {
    return '存活';
  }
  return mecha.respawn_at_tick > 0 ? `复活于 tick ${mecha.respawn_at_tick}` : '阵亡';
}
