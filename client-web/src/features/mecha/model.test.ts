import { describe, expect, it } from 'vitest';
import type { StateSummary } from '@shared/types';
import {
  mechaOperatorLabel,
  mechaSlotUsage,
  mechaStatusLabel,
  selectMechaById,
  selectMyMecha,
  selectPlayerMechas,
  type MechaView,
} from './model';

function mecha(overrides: Partial<MechaView>): MechaView {
  return {
    unit_id: 'u-1',
    planet_id: 'planet-1-1',
    operator: 'p1',
    alive: true,
    respawn_at_tick: 0,
    inventory: {},
    inventory_slots_used: 0,
    inventory_slots_total: 40,
    operate_range: 18,
    concurrent_tasks: 2,
    construction_active: 0,
    construction_pending: 0,
    ...overrides,
  };
}

function summary(mechas: MechaView[]): StateSummary {
  return {
    surface: { topology: 'cube_sphere', face_size: 8 },
    tick: 10,
    active_planet_id: 'planet-1-1',
    map_width: 24,
    map_height: 16,
    players: {
      p1: { player_id: 'p1', is_alive: true, mechas },
    },
  };
}

describe('selectMyMecha', () => {
  it('按 operator 找自己的机甲（不是玩家的背包字段）', () => {
    const mine = mecha({ unit_id: 'u-2', operator: 'p1' });
    const other = mecha({ unit_id: 'u-1', operator: 'builder-a' });
    const idle = mecha({ unit_id: 'u-3', operator: '' });
    const data = summary([other, idle, mine]);
    expect(selectMyMecha(data, 'p1')?.unit_id).toBe('u-2');
    // 玩家列表按 unit_id 排序（与服务端一致）
    expect(selectPlayerMechas(data, 'p1').map((entry) => entry.unit_id)).toEqual(['u-1', 'u-2', 'u-3']);
  });

  it('未绑定时返回 undefined（UI 显示「未绑定机甲」）', () => {
    expect(selectMyMecha(summary([mecha({ operator: 'builder-a' })]), 'p1')).toBeUndefined();
    expect(selectMyMecha(undefined, 'p1')).toBeUndefined();
    expect(selectMyMecha(summary([]), '')).toBeUndefined();
  });

  it('按单位 ID 找档案（MechaControls 用）', () => {
    const data = summary([mecha({ unit_id: 'u-1' }), mecha({ unit_id: 'u-2', operator: '' })]);
    expect(selectMechaById(data, 'p1', 'u-2')?.operator).toBe('');
    expect(selectMechaById(data, 'p1', 'u-9')).toBeUndefined();
  });
});

describe('显示口径', () => {
  it('操作者：自己是「我」，别人原样，空串「空闲」', () => {
    expect(mechaOperatorLabel('p1', 'p1')).toBe('我');
    expect(mechaOperatorLabel('builder-a', 'p1')).toBe('builder-a');
    expect(mechaOperatorLabel('', 'p1')).toBe('空闲');
  });

  it('状态：存活 / 复活于 tick N', () => {
    expect(mechaStatusLabel(mecha({}))).toBe('存活');
    expect(mechaStatusLabel(mecha({ alive: false, respawn_at_tick: 512 }))).toBe('复活于 tick 512');
    expect(mechaStatusLabel(mecha({ alive: false, respawn_at_tick: 0 }))).toBe('阵亡');
  });

  it('格数：上限缺失/为 0 时返回 null，已用截到上限', () => {
    expect(mechaSlotUsage(mecha({ inventory_slots_used: 3, inventory_slots_total: 40 }))).toEqual({ used: 3, total: 40 });
    expect(mechaSlotUsage(mecha({ inventory_slots_used: 99, inventory_slots_total: 40 }))).toEqual({ used: 40, total: 40 });
    expect(mechaSlotUsage(mecha({ inventory_slots_total: 0 }))).toBeNull();
    expect(mechaSlotUsage(undefined)).toBeNull();
  });
});
