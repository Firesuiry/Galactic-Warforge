import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameEventDetail } from '@shared/types';

import { sfx } from '@/engine/audio';
import { isPowerAlertToast, isPowerAlertType, toastFromGameEvent } from '@/features/notifications/event-toasts';
import { groupHistoryByPower } from '@/features/notifications/NotificationBell';
import { historyFromEvents, notifyGameEvent } from '@/features/notifications/notify';
import {
  HISTORY_SIZE,
  MAX_VISIBLE_TOASTS,
  resetNotificationsStore,
  STICKY_TTL_MS,
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
  it('battle_report_generated：击毁/交火 danger，带 damage 文案且不暴露目标 id', () => {
    const destroyed = toastFromGameEvent(gameEvent('battle_report_generated', {
      report: { target_destroyed: true, target_id: 'fleet-enemy-1', target_type: 'enemy_force', fleet_id: 'f1' },
    }));
    expect(destroyed?.toast.kind).toBe('danger');
    expect(destroyed?.toast.title).toBe('击毁目标：黑雾');
    expect(destroyed?.toast.href).toBe('/war');

    const skirmish = toastFromGameEvent(gameEvent('battle_report_generated', {
      report: { target_destroyed: false, target_id: 'fleet-enemy-1', target_type: 'enemy_force', target_strength_loss: 37, fleet_id: 'f1' },
    }));
    expect(skirmish?.toast.kind).toBe('danger');
    expect(skirmish?.toast.body).toBe('黑雾 · -37');
    // 战斗总线已播 explosion，toast 不再配音
    expect(skirmish?.sfx).toBeUndefined();
    expect(skirmish?.toast.mergeKey).toBe('battle:f1');
  });

  it('battle_report_generated：无中文名可用时也不把原始 id 拼进文案', () => {
    const mapped = toastFromGameEvent(gameEvent('battle_report_generated', {
      report: { target_destroyed: false, target_id: 'fleet-enemy-1', target_strength_loss: 12, fleet_id: 'f1' },
    }));
    expect(mapped?.toast.title).toBe('舰队交火');
    expect(mapped?.toast.body).toBe('-12');
    expect(mapped?.toast.title).not.toContain('fleet-enemy-1');
    expect(mapped?.toast.body).not.toContain('fleet-enemy-1');
    expect(mapped?.toast.mergeKey).toBe('battle:f1');
  });

  it('entity_destroyed → danger（不配音，总线已播大爆炸）', () => {
    const mapped = toastFromGameEvent(gameEvent('entity_destroyed', { entity_id: 'e1' }));
    expect(mapped?.toast.kind).toBe('danger');
    expect(mapped?.sfx).toBeUndefined();
  });

  it('entity_destroyed：己方建筑写中文名，别家伤亡不弹，旧事件按 id 前缀推断', () => {
    const own = toastFromGameEvent(gameEvent('entity_destroyed', { entity_id: 'b-6', entity_kind: 'building', entity_type: 'wind_turbine', owner_id: 'p1' }), 'p1');
    expect(own?.toast.title).toBe('建筑被摧毁：风力涡轮机');
    expect(own?.toast.title).not.toContain('b-6');
    expect(toastFromGameEvent(gameEvent('entity_destroyed', { entity_id: 'u-3', entity_kind: 'unit', entity_type: 'soldier', owner_id: 'p2' }), 'p1')).toBeNull();
    expect(toastFromGameEvent(gameEvent('entity_destroyed', { entity_id: 'b-9' }), 'p1')?.toast.title).toBe('建筑被摧毁：建筑');
  });

  it('entity_destroyed：己方机甲被毁写「机甲被击毁」，标题不含实体 id', () => {
    const mecha = toastFromGameEvent(gameEvent('entity_destroyed', {
      entity_id: 'u-7', entity_kind: 'unit', entity_type: 'executor', owner_id: 'p1', killed_by: 'df-1', source: 'combat',
    }), 'p1');
    expect(mecha?.toast.kind).toBe('danger');
    expect(mecha?.toast.title).toBe('机甲被击毁：玩家机甲');
    expect(mecha?.toast.title).not.toContain('u-7');
    expect(mecha?.toast.body ?? '').not.toContain('u-7');
    // 服务端 payload 无复活信息时不得编造倒计时
    expect(mecha?.toast.body ?? '').not.toMatch(/复活|重生|秒/);
    expect(mecha?.toast.mergeKey).toBe('entity_destroyed:own:unit:玩家机甲');

    // mecha 别名同属机甲
    expect(toastFromGameEvent(gameEvent('entity_destroyed', {
      entity_id: 'u-8', entity_kind: 'unit', entity_type: 'mecha', owner_id: 'p1',
    }), 'p1')?.toast.title).toBe('机甲被击毁：机甲');
  });

  it('entity_destroyed：己方普通单位仍写「单位阵亡：中文名」', () => {
    const soldier = toastFromGameEvent(gameEvent('entity_destroyed', {
      entity_id: 'u-9', entity_kind: 'unit', entity_type: 'soldier', owner_id: 'p1',
    }), 'p1');
    expect(soldier?.toast.title).toBe('单位阵亡：士兵');
    expect(soldier?.toast.title).not.toContain('u-9');

    const worker = toastFromGameEvent(gameEvent('entity_destroyed', {
      entity_id: 'u-10', entity_kind: 'unit', entity_type: 'worker', owner_id: 'p1',
    }), 'p1');
    expect(worker?.toast.title).toBe('单位阵亡：工人');

    // 未知类型回退「单位」，仍不出现 id
    const unknown = toastFromGameEvent(gameEvent('entity_destroyed', {
      entity_id: 'u-11', entity_kind: 'unit', owner_id: 'p1',
    }), 'p1');
    expect(unknown?.toast.title).toBe('单位阵亡：单位');
    expect(unknown?.toast.title).not.toContain('u-11');
  });

  it('dark_fog_provoked 只对自己弹显眼提示并换算分钟', () => {
    const event = { ...gameEvent('dark_fog_provoked', { player_id: 'p1', until_tick: 3200 }), tick: 200 };
    const mine = toastFromGameEvent(event, 'p1');
    expect(mine?.toast.title).toBe('你激怒了黑雾');
    expect(mine?.toast.body).toContain('5 分钟内会遭到报复');
    expect(mine?.toast.sticky).toBe(true);
    expect(toastFromGameEvent(event, 'p2')).toBeNull();
    expect(toastFromGameEvent(gameEvent('dark_fog_calmed', { player_id: 'p1' }), 'p1')?.toast.title).toBe('黑雾已恢复中立');
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
    expect(mapped?.toast.body).toBe('建筑：电力不足');
    expect(mapped?.toast.mergeKey).toBe('production_alert:b7:unknown');
    expect(mapped?.toast.throttleMs).toBeGreaterThan(0);
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
    expect(mapped?.toast.body).toBe('风力涡轮机：原料短缺');
    expect(mapped?.toast.body).not.toContain('detected');
    // 合并键含建筑实例 id：同一建筑的同类告警合并计数（不同建筑分开显示）
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
    expect(power?.toast.kind).toBe('danger');
    expect(power?.toast.body).toBe('矩阵研究站：电力不足');
  });

  it('production_alert：断电类 → danger + sticky 且不节流（试玩报告 F）', () => {
    for (const alertType of ['power_shortage', 'power_low']) {
      const mapped = toastFromGameEvent(gameEvent('production_alert', {
        alert: {
          alert_id: `a-${alertType}`,
          building_id: 'b-77',
          building_type: 'mining_machine',
          alert_type: alertType,
          message: 'building b-77 power shortage',
        },
      }));
      expect(mapped?.toast.kind).toBe('danger');
      expect(mapped?.toast.title).toBe('建筑断电');
      expect(mapped?.toast.sticky).toBe(true);
      // 不套用产线 60s 节流：否则第二次断电提醒会被吞掉
      expect(mapped?.toast.throttleMs).toBeUndefined();
      expect(mapped?.toast.body).toBe('采矿机：电力不足');
      // 合并粒度仍按建筑分开
      expect(mapped?.toast.mergeKey).toBe(`production_alert:b-77:${alertType}`);
      expect(isPowerAlertToast(mapped!.toast)).toBe(true);
    }
    expect(isPowerAlertType('power_shortage')).toBe(true);
    expect(isPowerAlertType('power_low')).toBe(true);
    expect(isPowerAlertType('input_shortage')).toBe(false);
  });

  it('production_alert：payload 无位置时不编造坐标，有位置才补上', () => {
    const withoutPosition = toastFromGameEvent(gameEvent('production_alert', {
      alert: { alert_id: 'a5', building_id: 'b-5', building_type: 'mining_machine', alert_type: 'power_shortage' },
    }));
    expect(withoutPosition?.toast.body).toBe('采矿机：电力不足');

    const withPosition = toastFromGameEvent(gameEvent('production_alert', {
      alert: {
        alert_id: 'a6', building_id: 'b-6', building_type: 'mining_machine',
        alert_type: 'power_shortage', position: { x: 12.4, y: 7.6 },
      },
    }));
    expect(withPosition?.toast.body).toBe('采矿机：电力不足：(12, 8)');
  });

  it('production_alert：吞吐类仍是 warning + 60s 节流（不被断电优先级波及）', () => {
    const mapped = toastFromGameEvent(gameEvent('production_alert', {
      alert: {
        alert_id: 'a7',
        building_id: 'b-9',
        building_type: 'mining_machine',
        alert_type: 'output_blocked',
        message: 'building b-9 output blocked',
      },
    }));
    expect(mapped?.toast.kind).toBe('warning');
    expect(mapped?.toast.title).toBe('产线告警');
    expect(mapped?.toast.sticky).toBeUndefined();
    expect(mapped?.toast.throttleMs).toBeGreaterThan(0);
    expect(isPowerAlertToast(mapped!.toast)).toBe(false);
  });

  it('rocket_launched → info（不配音）', () => {
    const mapped = toastFromGameEvent(gameEvent('rocket_launched', { count: 2 }));
    expect(mapped?.toast.kind).toBe('info');
    expect(mapped?.toast.body).toBe('×2');
    expect(mapped?.sfx).toBeUndefined();
  });

  it('command_result 执行期失败 → danger toast（中文原文直出），成功 → null', () => {
    const failed = toastFromGameEvent(gameEvent('command_result', {
      request_id: 'req-1',
      code: 'INSUFFICIENT_RESOURCES',
      message: '建造还需要 1 个齿轮',
    }));
    expect(failed?.toast.kind).toBe('danger');
    expect(failed?.toast.title).toBe('命令执行失败');
    expect(failed?.toast.body).toBe('建造还需要 1 个齿轮');
    expect(failed?.toast.mergeKey).toBe('command_result_fail:INSUFFICIENT_RESOURCES');
    expect(failed?.sfx).toBe('alert');

    expect(toastFromGameEvent(gameEvent('command_result', {
      request_id: 'req-2',
      code: 'OK',
      message: 'done',
    }))).toBeNull();

    const finished = toastFromGameEvent(gameEvent('command_result', {
      request_id: 'req-3',
      code: 'GAME_FINISHED',
      message: 'game finished: victory already declared, commands are no longer accepted',
    }));
    expect(finished?.toast.title).toBe('对局已结束');
    expect(finished?.toast.body).toContain('对局已结束');
    expect(finished?.toast.href).toBe('/settlement');
  });

  it('damage_applied / 无关事件 → null', () => {
    expect(toastFromGameEvent(gameEvent('damage_applied', { damage: 5 }))).toBeNull();
    expect(toastFromGameEvent(gameEvent('tick_completed', {}))).toBeNull();
    expect(toastFromGameEvent(gameEvent('resource_changed', {}))).toBeNull();
  });

  it('舰队类事件：此前无音效 → toast 补一声', () => {
    expect(toastFromGameEvent(gameEvent('fleet_commissioned', { fleet_id: 'f1' }))?.sfx).toBe('uiClick');
    expect(toastFromGameEvent(gameEvent('fleet_attack_started', { fleet_id: 'f1' }))?.sfx).toBe('alert');
    expect(toastFromGameEvent(gameEvent('theater_zone_alert', { theater_id: 't1' }))?.sfx).toBe('alert');
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

  it('断电 toast 停留 STICKY_TTL_MS（比普通 toast 久），且节流窗口内仍会再弹', () => {
    const store = useNotificationsStore.getState();
    const power = {
      kind: 'danger' as const,
      title: '建筑断电',
      mergeKey: 'production_alert:b-1:power_shortage',
      sticky: true,
    };
    const first = store.push(power, 1_000);
    expect(first.expiresAt).toBe(1_000 + STICKY_TTL_MS);

    // 消退 + 120s 后再来一条断电：必须重新弹出（不能被 60s 产线节流吞掉）
    const later = 1_000 + TOAST_TTL_MS + 120_000;
    store.sweep(later);
    const second = store.push(power, later);
    const visible = useNotificationsStore.getState().toasts.filter((toast) => !toast.leaving);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(second.id);
    expect(second.id).not.toBe(first.id);
    expect(visible[0].at).toBe(later);
    expect(visible[0].expiresAt).toBe(later + STICKY_TTL_MS);
  });
});

describe('通知历史断电分组', () => {
  it('断电类归到顶部组，其余保持原顺序；两组为空时不渲染', () => {
    const store = useNotificationsStore.getState();
    store.push({ kind: 'warning', title: '产线告警', mergeKey: 'production_alert:b-1:output_blocked' }, 1_000);
    store.push({ kind: 'danger', title: '建筑断电', mergeKey: 'production_alert:b-2:power_shortage' }, 1_100);
    store.push({ kind: 'info', title: '火箭发射' }, 1_200);
    store.push({ kind: 'danger', title: '建筑断电', mergeKey: 'production_alert:b-3:power_low' }, 1_300);

    const { power, others } = groupHistoryByPower(useNotificationsStore.getState().history);
    expect(power.map((toast) => toast.mergeKey)).toEqual([
      'production_alert:b-3:power_low',
      'production_alert:b-2:power_shortage',
    ]);
    expect(others.map((toast) => toast.title)).toEqual(['火箭发射', '产线告警']);

    const onlyThroughput = groupHistoryByPower([{ ...others[1] }]);
    expect(onlyThroughput.power).toHaveLength(0);
    expect(onlyThroughput.others).toHaveLength(1);

    const onlyPower = groupHistoryByPower([{ ...power[0] }]);
    expect(onlyPower.power).toHaveLength(1);
    expect(onlyPower.others).toHaveLength(0);
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

it('traffic monitor alarms report blockage and clearing without repeating a warning', () => {
  const alarm = toastFromGameEvent(gameEvent('traffic_monitor_alert', { building_id: 'm1', planet_id: 'planet-1-1', alert_active: true, state: 'blocked' }));
  expect(alarm?.toast.kind).toBe('warning');
  expect(alarm?.toast.body).toContain('积货且无物料流出');
  const cleared = toastFromGameEvent(gameEvent('traffic_monitor_alert', { building_id: 'm1', planet_id: 'planet-1-1', alert_active: false, state: 'flowing' }));
  expect(cleared?.toast.kind).toBe('info');
  expect(cleared?.toast.title).toContain('已解除');
  expect(cleared?.toast.mergeKey).toBe(alarm?.toast.mergeKey);
});

describe('产线告警节流与历史回填', () => {
  beforeEach(() => resetNotificationsStore());

  it('同 mergeKey 消退后节流期内只并入历史，不再弹出', () => {
    const store = useNotificationsStore.getState();
    const input = { kind: 'warning' as const, title: '产线告警', mergeKey: 'production_alert:x:y', throttleMs: 60_000 };
    store.push(input, 1_000);
    store.push(input, 1_000 + TOAST_TTL_MS + 1000);
    const state = useNotificationsStore.getState();
    expect(state.toasts.filter((toast) => !toast.leaving)).toHaveLength(1);
    expect(state.history[0].count).toBe(2);
  });

  it('历史面板里同一 mergeKey 只留一条并累计计数（同类告警不刷屏）', () => {
    const store = useNotificationsStore.getState();
    const input = { kind: 'warning' as const, title: '产线告警', body: '采矿机：产物阻塞', mergeKey: 'production_alert:b-9:output_blocked', throttleMs: 60_000 };
    // 三条跨越节流窗口的同键告警：toast 层可能弹两条，但历史只应留一条 ×3
    store.push(input, 1_000);
    store.push(input, 1_000 + TOAST_TTL_MS + 1000);
    store.push(input, 1_000 + (TOAST_TTL_MS + 1000) * 2);
    const history = useNotificationsStore.getState().history;
    expect(history.filter((toast) => toast.mergeKey === input.mergeKey)).toHaveLength(1);
    expect(history[0].count).toBe(3);
  });

  it('不同建筑的同类告警在历史里各自一条（键含建筑 id）', () => {
    const store = useNotificationsStore.getState();
    const base = { kind: 'warning' as const, title: '产线告警', throttleMs: 60_000 };
    store.push({ ...base, mergeKey: 'production_alert:b-1:output_blocked' }, 1_000);
    store.push({ ...base, mergeKey: 'production_alert:b-2:output_blocked' }, 1_100);
    const keys = useNotificationsStore.getState().history.map((toast) => toast.mergeKey);
    expect(keys).toEqual(['production_alert:b-2:output_blocked', 'production_alert:b-1:output_blocked']);
  });

  it('服务端事件历史回填铃铛：合并计数、不弹 toast、不计未读', () => {
    const events = [
      { event_id: 'h1', tick: 10, event_type: 'entity_destroyed', visibility_scope: 'all', payload: { entity_id: 'b-1', entity_kind: 'building', entity_type: 'wind_turbine', owner_id: 'p1' } },
      { event_id: 'h2', tick: 12, event_type: 'entity_destroyed', visibility_scope: 'all', payload: { entity_id: 'b-2', entity_kind: 'building', entity_type: 'wind_turbine', owner_id: 'p1' } },
      { event_id: 'h3', tick: 15, event_type: 'research_completed', visibility_scope: 'p1', payload: {} },
    ];
    const entries = historyFromEvents(events, 'p1');
    expect(entries.map((entry) => entry.title)).toEqual(['研究完成：科技', '建筑被摧毁：风力涡轮机']);
    expect(entries[1].count).toBe(2);
    useNotificationsStore.getState().restoreHistory(entries);
    const state = useNotificationsStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.toasts).toHaveLength(0);
    expect(state.unread).toBe(0);
    // SSE 重放同一事件不再弹出
    notifyGameEvent(events[0]);
    expect(useNotificationsStore.getState().toasts).toHaveLength(0);
  });
});
