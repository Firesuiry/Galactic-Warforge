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
 *   但标 `active=false`）；带子在场时再要求 `conveyor.blocked_ticks > 0`，
 *   避免旧告警在已恢复的带格上留红杠（试玩 1016 严重 2）。
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
    // 带子在场时再看现场计数：blocked_ticks 已归零 = 已经在流动，告警是旧噪音。
    // 字段缺失（旧服务端）时不下结论，仍按告警显示。
    const liveBlocked = belt.conveyor?.blocked_ticks;
    if (typeof liveBlocked === 'number' && liveBlocked <= 0) continue;
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
