/**
 * 传送带堵塞告警（服务端 `belt_blocked`）在行星地图上的标记。
 *
 * 告警本身指向**带格**（`details.position` + `queued_items` + `blocked_ticks`），
 * 而不是上游矿机——玩家以前只看到矿机的「产物阻塞」，去查矿机查不出根因
 * （试玩 1016 报告 B1/U7）。地图上沿用 U7 的红色短杠（死端标记）标出被堵的那一格，
 * 与「带尾对着空地」的死端提示同一视觉语言：都是「这条带子走不动了」。
 *
 * 两处口径：
 * - 位置只认 `details.position`，没有就不标（旧服务端/旧告警），绝不编造坐标；
 * - 只标**本行星视口里确实存在的带子格**（服务端告警历史不带行星 id，
 *   也不能凭空给一块空地画红杠）；
 * - 只标**仍然成立**的告警（`active !== false`，第 16 轮契约：恢复流动的告警留在历史里
 *   但标 `active=false`），是否恢复只看服务端的 `active`——现场 `blocked_ticks` 是
 *   `omitempty`，归零时字段直接缺失，不能用来区分「在流动」与「旧服务端」。
 */

import type { AlertEntry, Building } from '@shared/types';

import { alertDetailsPosition, isAlertActive } from '@shared/alerts';

export interface BlockedBeltMark {
  /** 告警 id：同一格可能被不同告警命中，用它做 React key。 */
  alertId: string;
  /** 被堵的带格。 */
  tile: { x: number; y: number };
  /** 带上的货件数（告警 details 直出，缺失为 undefined）。 */
  queuedItems?: number;
  /** 连续没动的 tick 数（缺失为 undefined）。 */
  blockedTicks?: number;
  /** 该格上的带子（画短杠要方向；`output` 可能是 auto）。 */
  belt: Building;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 该格上的传送带建筑（带子/分拣器以外的带上设备不算，只看 conveyor）。 */
export function beltAtTile(
  buildings: readonly Building[],
  tile: { x: number; y: number },
): Building | null {
  return buildings.find((building) =>
    Boolean(building.conveyor)
    && Math.round(building.position.x) === tile.x
    && Math.round(building.position.y) === tile.y,
  ) ?? null;
}

/**
 * 当前有效的传送带堵塞标记：仍然成立的 `belt_blocked` 告警 ∩ 本行星该格仍在堵的带子。
 * 同格只留最新一条（服务端快照可能含同一带格的历史重复条目）。
 */
export function blockedBeltMarks(
  alerts: readonly AlertEntry[] | undefined,
  buildings: readonly Building[],
): BlockedBeltMark[] {
  const byTile = new Map<string, { mark: BlockedBeltMark; tick: number }>();
  for (const alert of alerts ?? []) {
    if (alert.alert_type !== 'belt_blocked') continue;
    // 已解除的告警留在历史里（active=false）：不再画红杠。
    if (!isAlertActive(alert)) continue;
    const position = alertDetailsPosition(alert.details);
    if (!position) continue;
    const belt = beltAtTile(buildings, position);
    if (!belt) continue;
    // 不再看现场 blocked_ticks：服务端 ConveyorState.BlockedTicks 带 omitempty，
    // 0 时字段缺失，「<= 0」守卫永远不会触发；恢复与否以告警的 active 为准。
    const key = `${position.x}:${position.y}`;
    const mark: BlockedBeltMark = {
      alertId: alert.alert_id,
      tile: position,
      queuedItems: asFiniteNumber(alert.details?.queued_items),
      blockedTicks: asFiniteNumber(alert.details?.blocked_ticks),
      belt,
    };
    const existing = byTile.get(key);
    if (!existing || alert.tick >= existing.tick) {
      byTile.set(key, { mark, tick: alert.tick });
    }
  }
  return [...byTile.values()]
    .map((entry) => entry.mark)
    .sort((left, right) => left.tile.x - right.tile.x || left.tile.y - right.tile.y);
}

/** 告警条点击用的深链：跳到本行星并聚焦到被堵的带格。 */
export function blockedBeltHref(planetId: string, tile: { x: number; y: number }): string {
  return `/planet/${planetId}?x=${tile.x}&y=${tile.y}`;
}
