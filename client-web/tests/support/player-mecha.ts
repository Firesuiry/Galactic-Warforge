import { expect, type APIRequestContext } from '@playwright/test';

/**
 * 玩家背包读取（第 21 轮契约 §6/§7.3）：背包挂在「我的机甲」档案上，
 * `/state/summary` 的 `players[p1]` 不再有 `inventory` / `inventory_slots_*`。
 *
 * 「我的机甲」= `mechas.find(m => m.operator === issuer_id)`；GUI/脚本以玩家本人发令，
 * 所以 operator 等于玩家 ID。未绑定时返回空背包（调用方按场景状态处理）。
 */
export interface PlayerMecha {
  unit_id: string;
  planet_id: string;
  operator: string;
  alive: boolean;
  inventory: Record<string, number>;
  inventory_slots_used: number;
  inventory_slots_total: number;
}

export function myMechaOf(
  summary: { players?: Record<string, { mechas?: PlayerMecha[] }> } | undefined,
  playerId = 'p1',
): PlayerMecha | undefined {
  return summary?.players?.[playerId]?.mechas?.find((mecha) => mecha.operator === playerId);
}

/** 玩家本人（issuer = 玩家 ID）的机甲背包；未绑定时 `{}`。 */
export async function fetchPlayerInventory(
  request: APIRequestContext,
  playerKey: string,
  playerId = 'p1',
): Promise<Record<string, number>> {
  const response = await request.get('/state/summary', {
    headers: { Authorization: `Bearer ${playerKey}` },
  });
  expect(response.ok()).toBe(true);
  return myMechaOf(await response.json(), playerId)?.inventory ?? {};
}
