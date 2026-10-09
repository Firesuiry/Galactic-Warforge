import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPersistedHistory,
  deserializeHistory,
  HISTORY_STORAGE_PREFIX,
  historyStorageKey,
  parsePersistedHistory,
  readPersistedHistory,
  resetNotificationHistoryScope,
  restorePersistedHistory,
  serializeHistory,
  useNotificationHistoryPersistence,
  writePersistedHistory,
} from '@/features/notifications/persistence';
import {
  HISTORY_SIZE,
  resetNotificationsStore,
  useNotificationsStore,
  type Toast,
} from '@/features/notifications/store';
import { useSessionStore } from '@/stores/session';

function historyToast(overrides: Partial<Toast> = {}): Toast {
  return {
    id: 1,
    kind: 'danger',
    title: '单位阵亡：士兵',
    body: '被黑雾击毁',
    at: 1000,
    count: 1,
    tick: 42,
    mergeKey: 'entity_destroyed:own:unit:士兵',
    expiresAt: 6000,
    leaving: true,
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  resetNotificationsStore();
  resetNotificationHistoryScope();
  useSessionStore.getState().clearSession();
});

describe('通知历史持久化 key 按会话隔离', () => {
  it('key 带 serverUrl 与 playerId，不同玩家互不读取', () => {
    const p1Key = historyStorageKey('http://a.example', 'p1');
    const p2Key = historyStorageKey('http://a.example', 'p2');
    expect(p1Key).toBe(`${HISTORY_STORAGE_PREFIX}::http://a.example::p1`);
    expect(p1Key).not.toBe(p2Key);
    // 不同服务器同一玩家也不串
    expect(historyStorageKey('http://b.example', 'p1')).not.toBe(p1Key);

    writePersistedHistory(p1Key, [historyToast({ title: '甲' })]);
    expect(readPersistedHistory(p1Key).map((entry) => entry.title)).toEqual(['甲']);
    expect(readPersistedHistory(p2Key)).toEqual([]);

    // 不同会话各自恢复：p1 恢复 1 条，p2 恢复 0 条
    resetNotificationsStore();
    expect(restorePersistedHistory(p1Key)).toBe(1);
    expect(useNotificationsStore.getState().history.map((entry) => entry.title)).toEqual(['甲']);

    resetNotificationsStore();
    expect(restorePersistedHistory(p2Key)).toBe(0);
    expect(useNotificationsStore.getState().history).toEqual([]);
  });
});

describe('通知历史序列化/恢复', () => {
  it('round-trip 保留标题/正文/类型，恢复条目为历史条目（非可见 toast）', () => {
    const toasts = [
      historyToast({ id: 7, kind: 'warning', title: '产线告警', body: '风力涡轮机：原料短缺', count: 3, tick: 90 }),
      historyToast({ id: 8, kind: 'success', title: '研究完成：科技', body: undefined, count: 1, tick: 91 }),
    ];
    const serialized = serializeHistory(toasts);
    expect(serialized).toEqual([
      { kind: 'warning', title: '产线告警', body: '风力涡轮机：原料短缺', count: 3, at: 1000, tick: 90, mergeKey: 'entity_destroyed:own:unit:士兵' },
      { kind: 'success', title: '研究完成：科技', count: 1, at: 1000, tick: 91, mergeKey: 'entity_destroyed:own:unit:士兵' },
    ]);

    const raw = JSON.stringify(serialized);
    const restored = deserializeHistory(raw, 100);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ id: 100, kind: 'warning', title: '产线告警', body: '风力涡轮机：原料短缺', count: 3, leaving: true });
    expect(restored[1]).toMatchObject({ id: 101, kind: 'success', title: '研究完成：科技', leaving: true });
    // 恢复条目不带消退计时字段——不会作为可见 toast 弹出
    for (const entry of restored) {
      expect(entry.expiresAt).toBeUndefined();
      expect(entry.pausedAt).toBeUndefined();
    }

    // 落盘 JSON 里也不含计时字段
    expect(raw).not.toContain('expiresAt');
    expect(raw).not.toContain('pausedAt');
    expect(raw).not.toContain('leaving');
  });

  it('写入上限为 HISTORY_SIZE，脏数据/旧格式一律丢弃', () => {
    const many = Array.from({ length: HISTORY_SIZE + 6 }, (_, index) => historyToast({ id: index + 1, title: `t${index}` }));
    expect(serializeHistory(many)).toHaveLength(HISTORY_SIZE);

    expect(parsePersistedHistory('not json')).toEqual([]);
    expect(parsePersistedHistory('{"a":1}')).toEqual([]);
    expect(parsePersistedHistory(JSON.stringify([null, 5, { kind: 'nope', title: 'x' }, { kind: 'info', title: '' }]))).toEqual([]);
  });

  it('恢复后与 restoreHistory 去重口径一致：同 mergeKey 的服务端回填不会重复出现', () => {
    const key = historyStorageKey('http://a.example', 'p1');
    writePersistedHistory(key, [historyToast({ title: '建筑被摧毁：风力涡轮机' })]);
    expect(restorePersistedHistory(key)).toBe(1);

    // 服务端回填同一 mergeKey 的条目（模拟刷新后的 SSE/快照补拉）
    useNotificationsStore.getState().restoreHistory([
      { ...historyToast({ id: 0, title: '建筑被摧毁：风力涡轮机' }) },
    ]);
    const history = useNotificationsStore.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0].title).toBe('建筑被摧毁：风力涡轮机');
  });
});

describe('持久化不可用时不炸', () => {
  it('sessionStorage 抛异常：读写清除都静默降级，store 照常工作', () => {
    const key = historyStorageKey('http://a.example', 'p1');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => writePersistedHistory(key, [historyToast()])).not.toThrow();
    expect(() => readPersistedHistory(key)).not.toThrow();
    expect(readPersistedHistory(key)).toEqual([]);
    expect(() => restorePersistedHistory(key)).not.toThrow();
    expect(restorePersistedHistory(key)).toBe(0);
    expect(() => clearPersistedHistory(key)).not.toThrow();

    // store 本身不依赖存储
    expect(() => useNotificationsStore.getState().push({ kind: 'info', title: '仍然可用' }, 1)).not.toThrow();
    expect(useNotificationsStore.getState().history[0].title).toBe('仍然可用');

    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
  });

  it('window.sessionStorage 取值即抛（隐私模式）时模块仍可读写', () => {
    const original = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      const key = historyStorageKey('http://a.example', 'p1');
      expect(() => writePersistedHistory(key, [historyToast()])).not.toThrow();
      expect(readPersistedHistory(key)).toEqual([]);
      expect(restorePersistedHistory(key)).toBe(0);
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: original });
    }
  });
});

describe('useNotificationHistoryPersistence 挂载行为', () => {
  it('挂载即恢复本会话历史，并在 history 变化时写回 sessionStorage', () => {
    const key = historyStorageKey('http://a.example', 'p1');
    writePersistedHistory(key, [historyToast({ title: '刷新前的通知' })]);
    useSessionStore.getState().setSession({ serverUrl: 'http://a.example', playerId: 'p1', playerKey: 'k1' });

    const { unmount } = renderHook(() => useNotificationHistoryPersistence());
    expect(useNotificationsStore.getState().history.map((entry) => entry.title)).toEqual(['刷新前的通知']);
    // 恢复不产生未读
    expect(useNotificationsStore.getState().unread).toBe(0);

    useNotificationsStore.getState().push({ kind: 'info', title: '刷新后的通知' }, 2000);
    const persisted = readPersistedHistory(key);
    expect(persisted[0].title).toBe('刷新后的通知');
    expect(persisted[1].title).toBe('刷新前的通知');
    unmount();
  });

  it('切换玩家：清空上一局内存历史并恢复新会话的历史', () => {
    const p1Key = historyStorageKey('http://a.example', 'p1');
    const p2Key = historyStorageKey('http://a.example', 'p2');
    writePersistedHistory(p2Key, [historyToast({ title: '玩家乙的通知' })]);
    useSessionStore.getState().setSession({ serverUrl: 'http://a.example', playerId: 'p1', playerKey: 'k1' });

    const { unmount } = renderHook(() => useNotificationHistoryPersistence());
    act(() => {
      useNotificationsStore.getState().push({ kind: 'info', title: '玩家甲的通知' }, 1000);
    });
    expect(readPersistedHistory(p1Key).map((entry) => entry.title)).toContain('玩家甲的通知');

    // 切到玩家乙
    act(() => {
      useSessionStore.getState().setSession({ serverUrl: 'http://a.example', playerId: 'p2', playerKey: 'k2' });
    });
    // 重新挂载（会话变化 → scope 变化触发 effect）
    unmount();
    const second = renderHook(() => useNotificationHistoryPersistence());
    const titles = useNotificationsStore.getState().history.map((entry) => entry.title);
    expect(titles).toContain('玩家乙的通知');
    expect(titles).not.toContain('玩家甲的通知');
    second.unmount();
  });
});
