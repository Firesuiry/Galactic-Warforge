/**
 * 通知历史持久化（sessionStorage）——刷新页面后铃铛历史不再清空。
 *
 * 设计：
 * - 只持久化铃铛历史面板需要的可序列化字段（kind/title/body/href/mergeKey/count/tick/at）；
 *   expiresAt/pausedAt/leaving 等计时字段不落盘——恢复出来的条目一律是「历史条目」
 *   （leaving: true，不再作为可见 toast 弹出），与 store.restoreHistory 的语义一致。
 * - key 按会话隔离：`siliconworld-notifications-history::<serverUrl>::<playerId>`，
 *   换服务器/换玩家不会把上一局的通知串到新会话。
 * - 所有 sessionStorage 访问都包 try/catch（隐私模式/禁用存储会抛异常），
 *   持久化不可用时静默降级，store 照常工作；同时 guard `typeof window === 'undefined'`。
 * - 写入时机：订阅 store，仅当 history 引用变化时写（不是每次渲染/输入都写），
 *   写入条数上限 HISTORY_SIZE。
 */

import { useEffect } from 'react';

import {
  HISTORY_SIZE,
  useNotificationsStore,
  type Toast,
  type ToastKind,
} from '@/features/notifications/store';
import { useSessionSnapshot } from '@/hooks/use-session';

export const HISTORY_STORAGE_PREFIX = 'siliconworld-notifications-history';

/** 会话级存储 key（serverUrl + playerId 共同定位一局）。 */
export function historyStorageKey(serverUrl: string, playerId: string): string {
  return `${HISTORY_STORAGE_PREFIX}::${serverUrl}::${playerId}`;
}

/** 落盘条目：只含铃铛面板渲染所需的可序列化字段。 */
export interface PersistedHistoryEntry {
  kind: ToastKind;
  title: string;
  body?: string;
  href?: string;
  /** 合并键（内部用）：恢复后与 restoreHistory 的去重口径保持一致。 */
  mergeKey?: string;
  count: number;
  tick?: number;
  at: number;
}

const TOAST_KINDS: readonly ToastKind[] = ['info', 'success', 'warning', 'danger'];

function isToastKind(value: unknown): value is ToastKind {
  return typeof value === 'string' && (TOAST_KINDS as readonly string[]).includes(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** history（最新在前）→ 可落盘条目；上限 HISTORY_SIZE。 */
export function serializeHistory(history: readonly Toast[]): PersistedHistoryEntry[] {
  return history.slice(0, HISTORY_SIZE).flatMap((toast) => {
    if (!toast.title) {
      return [];
    }
    const entry: PersistedHistoryEntry = {
      kind: toast.kind,
      title: toast.title,
      count: toast.count > 0 ? toast.count : 1,
      at: asFiniteNumber(toast.at) ?? 0,
    };
    if (toast.body) entry.body = toast.body;
    if (toast.href) entry.href = toast.href;
    if (toast.mergeKey) entry.mergeKey = toast.mergeKey;
    const tick = asFiniteNumber(toast.tick);
    if (tick !== undefined) entry.tick = tick;
    return [entry];
  });
}

/** 落盘 JSON → 校验后的条目（脏数据/旧格式一律丢弃，不抛）。 */
export function parsePersistedHistory(raw: string | null): PersistedHistoryEntry[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.slice(0, HISTORY_SIZE).flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.title !== 'string' || record.title === '' || !isToastKind(record.kind)) {
      return [];
    }
    const entry: PersistedHistoryEntry = {
      kind: record.kind,
      title: record.title,
      count: asFiniteNumber(record.count) && (record.count as number) > 0 ? (record.count as number) : 1,
      at: asFiniteNumber(record.at) ?? 0,
    };
    if (typeof record.body === 'string' && record.body) entry.body = record.body;
    if (typeof record.href === 'string' && record.href) entry.href = record.href;
    if (typeof record.mergeKey === 'string' && record.mergeKey) entry.mergeKey = record.mergeKey;
    const tick = asFiniteNumber(record.tick);
    if (tick !== undefined) entry.tick = tick;
    return [entry];
  });
}

/** 条目 → 历史条目（不再是可见 toast：无 expiresAt/pausedAt，leaving: true）。 */
export function deserializeHistory(raw: string | null, nextId: number): Toast[] {
  return parsePersistedHistory(raw).map((entry, index) => ({
    ...entry,
    id: nextId + index,
    leaving: true,
  }));
}

function storage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readPersistedHistory(key: string): PersistedHistoryEntry[] {
  const store = storage();
  if (!store) {
    return [];
  }
  try {
    return parsePersistedHistory(store.getItem(key));
  } catch {
    return [];
  }
}

export function writePersistedHistory(key: string, history: readonly Toast[]): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.setItem(key, JSON.stringify(serializeHistory(history)));
  } catch {
    // 配额/隐私模式写不进去：静默降级，本页 store 仍是唯一真源。
  }
}

export function clearPersistedHistory(key: string): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(key);
  } catch {
    // 忽略
  }
}

/** 读取并回填到 store（幂等：restoreHistory 自带去重，可重复调用）。 */
export function restorePersistedHistory(key: string): number {
  const store = storage();
  if (!store) {
    return 0;
  }
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return 0;
  }
  const state = useNotificationsStore.getState();
  const entries = deserializeHistory(raw, state.nextId);
  if (entries.length === 0) {
    return 0;
  }
  state.restoreHistory(entries);
  return entries.length;
}

/** 当前内存历史归属的会话 key（换会话时用于判断是否需要先清空）。 */
let activeScope: string | null = null;

/** 测试用：重置模块级会话记录。 */
export function resetNotificationHistoryScope(): void {
  activeScope = null;
}

/**
 * 挂载在铃铛上：恢复本会话的持久化历史，并订阅 store 把后续变化写回。
 * 换会话（serverUrl/playerId 变）时先清空上一局的内存历史，避免串台。
 */
export function useNotificationHistoryPersistence(): void {
  const { serverUrl, playerId } = useSessionSnapshot();
  const scope = playerId ? historyStorageKey(serverUrl, playerId) : '';

  useEffect(() => {
    if (!scope) {
      return undefined;
    }
    if (activeScope !== null && activeScope !== scope) {
      useNotificationsStore.getState().resetNotifications();
    }
    activeScope = scope;
    restorePersistedHistory(scope);
    let lastHistory = useNotificationsStore.getState().history;
    return useNotificationsStore.subscribe((state) => {
      if (state.history === lastHistory) {
        return;
      }
      lastHistory = state.history;
      writePersistedHistory(scope, state.history);
    });
  }, [scope]);
}
