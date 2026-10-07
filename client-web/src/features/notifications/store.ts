/**
 * 全局事件通知 store（zustand）：
 * - toasts：当前可见的 toast 栈（上限 MAX_VISIBLE_TOASTS 条，超出挤掉最旧的）；
 * - history：最近 HISTORY_SIZE 条环形历史（铃铛面板用，不持久化）；
 * - unread：未读计数（铃铛角标），打开历史面板时清零。
 *
 * 消退模型：push 时记录 expiresAt = now + TOAST_TTL_MS，组件周期性 sweep(now)
 * 把过期条目标记 leaving（播出场动画），由组件在动画结束后 remove。
 * hover 暂停：pause 记录 pausedAt 并清掉 expiresAt，resume 时按剩余时长重算。
 * 不内置 setTimeout——时间全部由调用方注入，纯数据便于测试。
 */

import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

export interface ToastInput {
  kind: ToastKind;
  title: string;
  body?: string;
  href?: string;
  /**
   * 合并键：同 key 且仍在栈内的 toast 不新增条目，而是 count+1 并刷新
   * 消退计时（高频事件 5s 窗口内合并为 1 条计数，见 event-toasts）。
   */
  mergeKey?: string;
  /**
   * 节流：同 mergeKey 的 toast 消退后此时长内再来，只并入历史计数，不再弹出（产线告警防刷屏）。
   */
  throttleMs?: number;
  /** 重要提示：停留 STICKY_TTL_MS 而非 TOAST_TTL_MS。 */
  sticky?: boolean;
  /** 「定位」按钮：把镜头移到行星上的该位置。 */
  locate?: { planetId: string; x: number; y: number };
  /** 来源事件 tick（历史面板在缺少本地时刻时显示）。 */
  tick?: number;
}

export interface Toast extends ToastInput {
  id: number;
  /** 本地时间戳（Date.now 时基）。 */
  at: number;
  /** 合并计数（1 = 单条）。 */
  count: number;
  /** 到期时间戳；undefined 表示被 hover 暂停。 */
  expiresAt?: number;
  /** hover 暂停时刻（paired with expiresAt === undefined）。 */
  pausedAt?: number;
  /** 出场动画标记（组件播完动画后调 remove 真正删除）。 */
  leaving?: boolean;
}

export const MAX_VISIBLE_TOASTS = 5;
export const TOAST_TTL_MS = 5000;
export const HISTORY_SIZE = 20;
/** 同 mergeKey 合并窗口（ms）：窗口内的重复事件并入已有 toast 计数。 */
export const MERGE_WINDOW_MS = 5000;
export const STICKY_TTL_MS = 12000;

const ttlOf = (input: ToastInput) => (input.sticky ? STICKY_TTL_MS : TOAST_TTL_MS);

interface NotificationsState {
  toasts: Toast[];
  history: Toast[];
  unread: number;
  nextId: number;
  /** mergeKey → 最近一次弹出时刻（节流用）。 */
  lastShown: Record<string, number>;
}

interface NotificationsActions {
  /** 压入一条 toast；同 mergeKey 未消退的合并计数。返回最终条目。 */
  push: (input: ToastInput, now?: number) => Toast;
  /** 过期条目标记 leaving（返回被标记的 id 列表）。 */
  sweep: (now?: number) => number[];
  /** hover 暂停消退计时。 */
  pause: (id: number, now?: number) => void;
  /** 结束 hover，按剩余时长恢复消退计时。 */
  resume: (id: number, now?: number) => void;
  /** 手动关闭（标记 leaving，走出场动画）。 */
  dismiss: (id: number) => void;
  /** 全部忽略：当前栈内所有 toast 标记 leaving（走出场动画）。 */
  dismissAll: () => void;
  /** 真正移除（出场动画结束后由组件调用）。 */
  remove: (id: number) => void;
  /** 清空未读（打开历史面板时）。 */
  markAllRead: () => void;
  /** 页面重载后用服务端事件历史回填铃铛（不弹 toast、不计未读）。 */
  restoreHistory: (entries: Toast[]) => void;
  /** 全部清空（测试/会话切换）。 */
  resetNotifications: () => void;
}

export type NotificationsStore = NotificationsState & NotificationsActions;

const initialState: NotificationsState = {
  toasts: [],
  history: [],
  unread: 0,
  nextId: 1,
  lastShown: {},
};

function upsertHistory(history: Toast[], toast: Toast): Toast[] {
  const index = history.findIndex((entry) => entry.id === toast.id);
  const next = index >= 0
    ? history.map((entry) => (entry.id === toast.id ? toast : entry))
    : [toast, ...history];
  return next.slice(0, HISTORY_SIZE);
}

export const useNotificationsStore = create<NotificationsStore>()((set, get) => ({
  ...initialState,

  push: (input, now = Date.now()) => {
    const state = get();
    const existing = input.mergeKey
      ? state.toasts.find(
          (toast) => !toast.leaving
            && toast.mergeKey === input.mergeKey
            && now - toast.at < MERGE_WINDOW_MS,
        )
      : undefined;

    if (existing) {
      const merged: Toast = {
        ...existing,
        ...input,
        id: existing.id,
        count: existing.count + 1,
        at: now,
        expiresAt: existing.pausedAt !== undefined ? undefined : now + ttlOf(input),
      };
      set({
        toasts: get().toasts.map((toast) => (toast.id === existing.id ? merged : toast)),
        history: upsertHistory(get().history, merged),
        unread: get().unread + 1,
      });
      return merged;
    }

    const shownAt = input.mergeKey ? state.lastShown[input.mergeKey] : undefined;
    if (input.mergeKey && input.throttleMs && shownAt !== undefined && now - shownAt < input.throttleMs) {
      const previous = state.history.find((entry) => entry.mergeKey === input.mergeKey);
      if (previous) {
        const merged: Toast = { ...previous, ...input, id: previous.id, count: previous.count + 1, at: now, leaving: true };
        set({ history: upsertHistory(state.history, merged) });
        return merged;
      }
    }

    const toast: Toast = {
      ...input,
      id: state.nextId,
      at: now,
      count: 1,
      expiresAt: now + ttlOf(input),
    };
    let toasts = [...state.toasts, toast];
    // 超上限：最旧的标记 leaving（出场动画后由组件 remove），不直接删
    const overflow = toasts.filter((entry) => !entry.leaving).length - MAX_VISIBLE_TOASTS;
    if (overflow > 0) {
      let remaining = overflow;
      toasts = toasts.map((entry) => {
        if (remaining > 0 && !entry.leaving && entry.id !== toast.id) {
          remaining -= 1;
          return { ...entry, leaving: true };
        }
        return entry;
      });
    }
    set({
      toasts,
      history: upsertHistory(state.history, toast),
      unread: state.unread + 1,
      nextId: state.nextId + 1,
      lastShown: input.mergeKey ? { ...state.lastShown, [input.mergeKey]: now } : state.lastShown,
    });
    return toast;
  },

  sweep: (now = Date.now()) => {
    const expired = get().toasts.filter(
      (toast) => !toast.leaving && toast.expiresAt !== undefined && now >= toast.expiresAt,
    );
    if (expired.length === 0) {
      return [];
    }
    const ids = expired.map((toast) => toast.id);
    set({
      toasts: get().toasts.map(
        (toast) => (ids.includes(toast.id) ? { ...toast, leaving: true } : toast),
      ),
    });
    return ids;
  },

  pause: (id, now = Date.now()) => {
    set({
      toasts: get().toasts.map((toast) => {
        if (toast.id !== id || toast.expiresAt === undefined) {
          return toast;
        }
        return { ...toast, expiresAt: undefined, pausedAt: now };
      }),
    });
  },

  resume: (id, now = Date.now()) => {
    set({
      toasts: get().toasts.map((toast) => {
        if (toast.id !== id || toast.pausedAt === undefined) {
          return toast;
        }
        // push 时恒有 expiresAt = at + TTL，故暂停时刻的剩余时长
        // = expiresAt - pausedAt = TTL - (pausedAt - at)，按此恢复。
        const remaining = Math.max(ttlOf(toast) - (toast.pausedAt - toast.at), 300);
        return { ...toast, pausedAt: undefined, expiresAt: now + remaining };
      }),
    });
  },

  dismiss: (id) => {
    set({
      toasts: get().toasts.map(
        (toast) => (toast.id === id ? { ...toast, leaving: true } : toast),
      ),
    });
  },

  dismissAll: () => {
    set({
      toasts: get().toasts.map((toast) => ({ ...toast, leaving: true })),
    });
  },

  remove: (id) => {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },

  markAllRead: () => {
    set({ unread: 0 });
  },

  restoreHistory: (entries) => {
    const state = get();
    const known = new Set(state.history.map((entry) => entry.mergeKey ? `k:${entry.mergeKey}` : `t:${entry.title}:${entry.tick}`));
    const restored = entries
      .filter((entry) => !known.has(entry.mergeKey ? `k:${entry.mergeKey}` : `t:${entry.title}:${entry.tick}`))
      .map((entry, index) => ({ ...entry, id: state.nextId + index, leaving: true }));
    set({
      history: [...state.history, ...restored].slice(0, HISTORY_SIZE),
      nextId: state.nextId + restored.length,
    });
  },

  resetNotifications: () => {
    set({ ...initialState });
  },
}));

export function resetNotificationsStore(): void {
  useNotificationsStore.getState().resetNotifications();
}
