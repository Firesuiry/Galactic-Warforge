import type { ItemInventory, PlayerState, Position, StateSummary } from '@shared/types';

/**
 * 机甲档案视图（`/state/summary` 的 `players[me].mechas[]`，契约 §6）。
 *
 * TODO(r21-web)：shared-client 的 `MechaView` 由并行任务 C1 落在 `r21/clients`；
 * 合入后删除本文件里的本地类型，改从 `@shared/types` 导入（选择器函数保留）。
 */
export interface MechaView {
  unit_id: string;
  planet_id: string;
  /** 绑定的 issuer_id；"" = 空闲。GUI 只按玩家 ID 绑定（客户端没有 agent 发令者）。 */
  operator: string;
  alive: boolean;
  respawn_at_tick: number;
  /** 只在存活时下发。 */
  position?: Position;
  inventory?: ItemInventory;
  inventory_slots_used: number;
  inventory_slots_total: number;
  operate_range: number;
  concurrent_tasks: number;
  construction_active: number;
  construction_pending: number;
}

/** 带机甲列表的玩家视图（C1 落地前 shared-client 的 `PlayerState` 还没有 `mechas`）。 */
type PlayerWithMechas = PlayerState & { mechas?: MechaView[] };

/** 某玩家的全部机甲（按 unit_id 排序，与服务端口径一致）。 */
export function playerMechas(player?: PlayerWithMechas | null): MechaView[] {
  return [...(player?.mechas ?? [])].sort((left, right) => left.unit_id.localeCompare(right.unit_id));
}

/** 玩家的全部机甲（从 summary 取）。 */
export function selectPlayerMechas(summary: StateSummary | undefined, playerId: string): MechaView[] {
  return playerMechas(summary?.players?.[playerId] as PlayerWithMechas | undefined);
}

/**
 * 「我的机甲」= 操作者等于自己的那台（契约 §7.3）。
 * 服务端保证一个发令者至多绑一台，这里仍取第一台兜底。
 */
export function selectMyMecha(summary: StateSummary | undefined, playerId: string): MechaView | undefined {
  if (!playerId) {
    return undefined;
  }
  return selectPlayerMechas(summary, playerId).find((mecha) => mecha.operator === playerId);
}

/** 按单位 ID 找机甲档案（只含自己玩家的档案；别人的机甲不在 summary 里）。 */
export function selectMechaById(
  summary: StateSummary | undefined,
  playerId: string,
  unitId: string,
): MechaView | undefined {
  return selectPlayerMechas(summary, playerId).find((mecha) => mecha.unit_id === unitId);
}

/** 我的机甲背包（未绑定时视为空背包，UI 显示「未绑定机甲」而不是「背包空」）。 */
export function mechaInventory(mecha: MechaView | undefined): ItemInventory | undefined {
  return mecha?.inventory;
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
