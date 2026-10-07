/**
 * 事件 → toast 通知挂接层（副作用）：
 * 在两路 SSE 回调（use-planet-realtime / use-war-realtime）各调用一次，
 * 与音效挂接同一事件源。
 *
 * - 模块级 event_id 环形缓冲去重：StrictMode 双挂载/双订阅导致同一事件
 *   两次到达回调时只弹一次（与 planet-audio 同一模式）。
 * - ?freeze=1（截图测试确定性约定）不自动弹新 toast。
 * - 音效联动：toastFromGameEvent 返回的 sfx 只覆盖「此前无音效」的事件，
 *   与 use-game-audio / planet-audio 的既有音效不重复。
 */

import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';
import { toastFromGameEvent } from '@/features/notifications/event-toasts';
import { HISTORY_SIZE, useNotificationsStore, type Toast } from '@/features/notifications/store';
import { useSessionStore } from '@/stores/session';

const DEDUP_BUFFER_SIZE = 64;
const recentEventIds: string[] = [];

function isDuplicateEvent(eventId: string): boolean {
  if (!eventId) {
    return false;
  }
  if (recentEventIds.includes(eventId)) {
    return true;
  }
  recentEventIds.push(eventId);
  if (recentEventIds.length > DEDUP_BUFFER_SIZE) {
    recentEventIds.splice(0, recentEventIds.length - DEDUP_BUFFER_SIZE);
  }
  return false;
}

/** ?freeze=1：截图测试冻结动效约定，此时不自动弹新 toast。 */
export function isNotificationsFrozen(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('freeze');
}

export function notifyGameEvent(event: GameEventDetail): void {
  if (isNotificationsFrozen()) {
    return;
  }
  if (isDuplicateEvent(event.event_id)) {
    return;
  }
  const mapped = toastFromGameEvent(event, useSessionStore.getState().playerId);
  if (!mapped) {
    return;
  }
  useNotificationsStore.getState().push({ ...mapped.toast, tick: event.tick });
  if (mapped.sfx) {
    sfx[mapped.sfx]();
  }
}

/** 会产生通知的事件类型（历史回填时向服务端拉取）。 */
export const NOTIFICATION_EVENT_TYPES = [
  'entity_destroyed', 'building_state_changed', 'research_completed', 'production_alert',
  'traffic_monitor_alert', 'command_result', 'dark_fog_provoked', 'dark_fog_calmed',
  'rocket_launched', 'squad_deployed', 'fleet_commissioned', 'theater_zone_alert',
  'supply_line_disrupted', 'victory_declared',
] as const;

/**
 * 服务端事件历史 → 铃铛历史条目（最新在前，同 mergeKey 合并计数）。
 * 回填的事件登记进去重缓冲，SSE 重放时不再弹 toast。
 */
export function historyFromEvents(events: GameEventDetail[], viewerId: string): Toast[] {
  const entries: Toast[] = [];
  const byKey = new Map<string, Toast>();
  for (const event of [...events].sort((a, b) => b.tick - a.tick)) {
    isDuplicateEvent(event.event_id);
    const mapped = toastFromGameEvent(event, viewerId);
    if (!mapped) continue;
    const key = mapped.toast.mergeKey;
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.count += 1;
      continue;
    }
    if (entries.length >= HISTORY_SIZE) continue;
    const entry: Toast = { ...mapped.toast, id: 0, at: 0, count: 1, tick: event.tick };
    entries.push(entry);
    if (key) byKey.set(key, entry);
  }
  return entries;
}
