import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';
import { toastFromGameEvent } from '@/features/notifications/event-toasts';
import { notifyGameEvent } from '@/features/notifications/notify';
import {
  HISTORY_SIZE,
  MAX_VISIBLE_TOASTS,
  resetNotificationsStore,
  TOAST_TTL_MS,
  useNotificationsStore,
} from '@/features/notifications/store';

vi.mock('@/engine/audio', () => ({
  sfx: {
    fire: vi.fn(),
    explosion: vi.fn(),
    intercept: vi.fn(),
    commandOk: vi.fn(),
    commandFail: vi.fn(),
    buildComplete: vi.fn(),
    researchComplete: vi.fn(),
    alert: vi.fn(),
    uiClick: vi.fn(),
  },
}));

let nextEventId = 1;
function gameEvent(eventType: string, payload: Record<string, unknown> = {}, eventId?: string): GameEventDetail {
  const id = eventId ?? `evt-toast-${nextEventId}`;
  nextEventId += 1;
  return {
    event_id: id,
    tick: 100,
    event_type: eventType,
    visibility_scope: 'p1',
    payload,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNotificationsStore();
});

describe('toastFromGameEvent 事件映射', () => {
  it('battle_report_generated：击毁/交火 danger，带 damage 文案', () => {
    const destroyed = toastFromGameEvent(gameEvent('battle_report_generated', {
      report: { target_destroyed: true, target_id: 'fleet-enemy-1', fleet_id: 'f1' },
    }));
    expect(destroyed?.toast.kind).toBe('danger');
    expect(destroyed?.toast.title).toContain('击毁');
    expect(destroyed?.toast.href).toBe('/war');

    const skirmish = toastFromGameEvent(gameEvent('battle_report_generated', {
      report: { target_destroyed: false, target_id: 'fleet-enemy-1', target_strength_loss: 37, fleet_id: 'f1' },
    }));
    expect(skirmish?.toast.kind).toBe('danger');
    expect(skirmish?.toast.body).toContain('-37');
    // 战斗总线已播 explosion，toast 不再配音
    expect(skirmish?.sfx).toBeUndefined();
    expect(skirmish?.toast.mergeKey).toBe('battle:f1');
  });

  it('entity_destroyed → danger（不配音，总线已播大爆炸）', () => {
    const mapped = toastFromGameEvent(gameEvent('entity_destroyed', { entity_id: 'e1' }));
    expect(mapped?.toast.kind).toBe('danger');
    expect(mapped?.sfx).toBeUndefined();
  });

  it('missile_salvo_fired → info 且带 mergeKey（高频合并）', () => {
    const mapped = toastFromGameEvent(gameEvent('missile_salvo_fired', { count: 4 }));
    expect(mapped?.toast.kind).toBe('info');
    expect(mapped?.toast.mergeKey).toBe('missile_salvo_fired');
    expect(mapped?.toast.body).toBe('×4');
  });

  it('building_state_changed：完成态 → success，非完成态 → null', () => {
    const done = toastFromGameEvent(gameEvent('building_state_changed', {
      prev_state: 'idle', next_state: 'running', reason: 'start', building_type: 'wind_turbine',
    }));
    expect(done?.toast.kind).toBe('success');
    expect(done?.toast.title).toContain('建造完成');
    // planet-audio 已播 buildComplete，toast 不重复
    expect(done?.sfx).toBeUndefined();

    const paused = toastFromGameEvent(gameEvent('building_state_changed', {
      prev_state: 'running', next_state: 'paused', reason: 'pause', building_type: 'wind_turbine',
    }));
    expect(paused).toBeNull();
  });

  it('research_completed → success（不配音）', () => {
    const mapped = toastFromGameEvent(gameEvent('research_completed', { tech_id: 't1' }));
    expect(mapped?.toast.kind).toBe('success');
    expect(mapped?.toast.title).toContain('研究完成');
    expect(mapped?.sfx).toBeUndefined();
  });

  it('production_alert → warning，按 building + alert_type 合并，文案本地化', () => {
    const mapped = toastFromGameEvent(gameEvent('production_alert', {
      alert: { alert_id: 'a1', building_id: 'b7', message: '电力不足' },
    }));
    expect(mapped?.toast.kind).toBe('warning');
    expect(mapped?.toast.body).toBe('b7：电力不足');
    expect(mapped?.toast.mergeKey).toBe('production_alert:b7:unknown');
    expect(mapped?.sfx).toBeUndefined();
  });

  it('production_alert：建筑名与告警类型走 i18n，不用 server 英文原文', () => {
    const mapped = toastFromGameEvent(gameEvent('production_alert', {
      alert: {
        alert_id: 'a2',
        building_id: 'b-25',
        building_type: 'wind_turbine',
        alert_type: 'input_shortage',
        message: 'building b-25 input shortage detected',
      },
    }));
    expect(mapped?.toast.body).toBe('风力涡轮机 b-25：原料短缺');
    expect(mapped?.toast.body).not.toContain('detected');
    expect(mapped?.toast.mergeKey).toBe('production_alert:b-25:input_shortage');
  });

  it('production_alert：研究站（空 matrix_lab）吞吐类告警属噪音不弹，断电仍提醒', () => {
    const noise = toastFromGameEvent(gameEvent('production_alert', {
      alert: {
        alert_id: 'a3',
        building_id: 'b-25',
        building_type: 'matrix_lab',
        alert_type: 'throughput_drop',
        message: 'building b-25 throughput drop detected',
      },
    }));
    expect(noise).toBeNull();

    const power = toastFromGameEvent(gameEvent('production_alert', {
      alert: {
        alert_id: 'a4',
        building_id: 'b-25',
        building_type: 'matrix_lab',
        alert_type: 'power_shortage',
        message: 'building b-25 power shortage',
      },
    }));
    expect(power?.toast.kind).toBe('warning');
    expect(power?.toast.body).toBe('矩阵研究站 b-25：电力不足');
  });

  it('rocket_launched → info（不配音）', () => {
    const mapped = toastFromGameEvent(gameEvent('rocket_launched', { count: 2 }));
    expect(mapped?.toast.kind).toBe('info');
    expect(mapped?.toast.body).toBe('×2');
    expect(mapped?.sfx).toBeUndefined();
  });

  it('damage_applied / 无关事件 → null', () => {
    expect(toastFromGameEvent(gameEvent('damage_applied', { damage: 5 }))).toBeNull();
    expect(toastFromGameEvent(gameEvent('tick_completed', {}))).toBeNull();
    expect(toastFromGameEvent(gameEvent('resource_changed', {}))).toBeNull();
  });

  it('舰队类事件：此前无音效 → toast 补一声', () => {
    expect(toastFromGameEvent(gameEvent('fleet_commissioned', { fleet_id: 'f1' }))?.sfx).toBe('uiClick');
    expect(toastFromGameEvent(gameEvent('fleet_attack_started', { fleet_id: 'f1' }))?.sfx).toBe('alert');
    expect(toastFromGameEvent(gameEvent('landing_started', {}))?.sfx).toBe('alert');
    expect(toastFromGameEvent(gameEvent('landing_failed', {}))?.sfx).toBe('explosion');
    expect(toastFromGameEvent(gameEvent('supply_line_disrupted', {}))?.sfx).toBe('alert');
    expect(toastFromGameEvent(gameEvent('victory_declared', {}))?.sfx).toBe('commandOk');
    expect(toastFromGameEvent(gameEvent('victory_declared', {}))?.toast.kind).toBe('success');
  });

  it('fleet_move_started：info + uiClick，标题带起止星系', () => {
    const mapped = toastFromGameEvent(gameEvent('fleet_move_started', {
      fleet_id: 'f1',
      from_system_id: 'sys-1',
      to_system_id: 'sys-2',
      total_ticks: 10,
    }));
    expect(mapped?.toast.kind).toBe('info');
    expect(mapped?.toast.title).toContain('sys-1');
    expect(mapped?.toast.title).toContain('sys-2');
    expect(mapped?.sfx).toBe('uiClick');
  });

  it('fleet_arrived：success + commandOk，标题带抵达星系', () => {
    const mapped = toastFromGameEvent(gameEvent('fleet_arrived', {
      fleet_id: 'f1',
      system_id: 'sys-2',
      from_system_id: 'sys-1',
    }));
    expect(mapped?.toast.kind).toBe('success');
    expect(mapped?.toast.title).toContain('sys-2');
    expect(mapped?.sfx).toBe('commandOk');
  });
});

describe('notifications store', () => {
  it('push：可见上限 5 条，超出挤掉最旧的', () => {
    const store = useNotificationsStore.getState();
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i += 1) {
      store.push({ kind: 'info', title: `t${i}` }, 1000 + i);
    }
    const { toasts } = useNotificationsStore.getState();
    const visible = toasts.filter((toast) => !toast.leaving);
    expect(visible.length).toBe(MAX_VISIBLE_TOASTS);
    // 最旧的两条被标记 leaving
    expect(toasts.filter((toast) => toast.leaving).length).toBe(2);
  });

  it('同 mergeKey 窗口内合并计数，不新增条目', () => {
    const store = useNotificationsStore.getState();
    store.push({ kind: 'info', title: '导弹齐射', mergeKey: 'salvo' }, 1000);
    store.push({ kind: 'info', title: '导弹齐射', mergeKey: 'salvo' }, 2000);
    store.push({ kind: 'info', title: '导弹齐射', mergeKey: 'salvo' }, 4000);
    const { toasts } = useNotificationsStore.getState();
    expect(toasts.length).toBe(1);
    expect(toasts[0].count).toBe(3);
    // 合并刷新消退计时
    expect(toasts[0].expiresAt).toBe(4000 + TOAST_TTL_MS);
  });

  it('mergeKey 超过合并窗口则新增条目', () => {
    const store = useNotificationsStore.getState();
    store.push({ kind: 'info', title: '导弹齐射', mergeKey: 'salvo' }, 1000);
    store.push({ kind: 'info', title: '导弹齐射', mergeKey: 'salvo' }, 1000 + 60_000);
    expect(useNotificationsStore.getState().toasts.length).toBe(2);
  });

  it('sweep：到期标记 leaving，未到期不动', () => {
    const store = useNotificationsStore.getState();
    store.push({ kind: 'info', title: 'a' }, 1000);
    expect(useNotificationsStore.getState().sweep(1000 + TOAST_TTL_MS - 1)).toEqual([]);
    const ids = useNotificationsStore.getState().sweep(1000 + TOAST_TTL_MS);
    expect(ids.length).toBe(1);
    expect(useNotificationsStore.getState().toasts[0].leaving).toBe(true);
  });

  it('hover 暂停/恢复：暂停期间 sweep 不消退，恢复按剩余时长计时', () => {
    const store = useNotificationsStore.getState();
    const toast = store.push({ kind: 'info', title: 'a' }, 1000);
    // 2000ms 后暂停（剩余 3000ms）
    store.pause(toast.id, 3000);
    expect(useNotificationsStore.getState().sweep(1000 + TOAST_TTL_MS + 100)).toEqual([]);
    // 恢复后剩余 ~3000ms
    store.resume(toast.id, 5000);
    const resumed = useNotificationsStore.getState().toasts[0];
    expect(resumed.expiresAt).toBe(5000 + 3000);
    expect(useNotificationsStore.getState().sweep(5000 + 3000)).toEqual([toast.id]);
  });

  it('历史环形缓冲 20 条 + 未读计数', () => {
    const store = useNotificationsStore.getState();
    for (let i = 0; i < HISTORY_SIZE + 5; i += 1) {
      store.push({ kind: 'info', title: `t${i}` }, 1000 + i);
    }
    const state = useNotificationsStore.getState();
    expect(state.history.length).toBe(HISTORY_SIZE);
    // 最新在前
    expect(state.history[0].title).toBe(`t${HISTORY_SIZE + 4}`);
    expect(state.unread).toBe(HISTORY_SIZE + 5);
    state.markAllRead();
    expect(useNotificationsStore.getState().unread).toBe(0);
  });

  it('dismissAll：全部标记 leaving（走出场动画后由组件移除）', () => {
    const store = useNotificationsStore.getState();
    store.push({ kind: 'info', title: 'a' }, 1000);
    store.push({ kind: 'warning', title: 'b' }, 1001);
    useNotificationsStore.getState().dismissAll();
    const { toasts } = useNotificationsStore.getState();
    expect(toasts.length).toBe(2);
    expect(toasts.every((toast) => toast.leaving)).toBe(true);
  });
});

describe('notifyGameEvent 挂接层', () => {
  it('弹 toast 并按映射补音效（无既有音效的事件）', () => {
    notifyGameEvent(gameEvent('fleet_commissioned', { fleet_id: 'f1' }));
    expect(useNotificationsStore.getState().toasts.length).toBe(1);
    expect(sfx.uiClick).toHaveBeenCalledTimes(1);
  });

  it('已有音效覆盖的事件不重复播（research_completed）', () => {
    notifyGameEvent(gameEvent('research_completed', { tech_id: 't1' }));
    expect(useNotificationsStore.getState().toasts.length).toBe(1);
    expect(sfx.researchComplete).not.toHaveBeenCalled();
    expect(sfx.uiClick).not.toHaveBeenCalled();
  });

  it('同一 event_id 重复到达只弹一次（StrictMode 双挂载兜底）', () => {
    const event = gameEvent('fleet_commissioned', { fleet_id: 'f1' }, 'evt-toast-dup');
    notifyGameEvent(event);
    notifyGameEvent(event);
    expect(useNotificationsStore.getState().toasts.length).toBe(1);
    expect(sfx.uiClick).toHaveBeenCalledTimes(1);
  });

  it('不映射的事件不弹', () => {
    notifyGameEvent(gameEvent('tick_completed', {}));
    expect(useNotificationsStore.getState().toasts.length).toBe(0);
  });

  it('?freeze=1（截图测试约定）不自动弹新 toast', () => {
    window.history.replaceState(null, '', '/?freeze=1');
    notifyGameEvent(gameEvent('fleet_commissioned', { fleet_id: 'f1' }));
    expect(useNotificationsStore.getState().toasts.length).toBe(0);
    expect(sfx.uiClick).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});
