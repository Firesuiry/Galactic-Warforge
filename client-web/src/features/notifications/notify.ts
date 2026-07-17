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
import { useNotificationsStore } from '@/features/notifications/store';

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
  const mapped = toastFromGameEvent(event);
  if (!mapped) {
    return;
  }
  useNotificationsStore.getState().push(mapped.toast);
  if (mapped.sfx) {
    sfx[mapped.sfx]();
  }
}
