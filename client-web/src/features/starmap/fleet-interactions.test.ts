import { beforeEach, describe, expect, it } from 'vitest';

import type { SensorContact } from '@shared/types';

import {
  fleetStateLabel,
  pickFleetInSystem,
  resolveFleetAttackTarget,
  resolveFleetMoveTarget,
  computeSystemLanes,
} from '@/features/starmap/model';
import { resetStarmapViewStore, useStarmapViewStore } from '@/features/starmap/store';

describe('pickFleetInSystem（徽标循环点选）', () => {
  const fleets = [
    { fleet_id: 'fleet-1', system_id: 'sys-1' },
    { fleet_id: 'fleet-2', system_id: 'sys-1' },
    { fleet_id: 'fleet-3', system_id: 'sys-2' },
  ];

  it('星系无舰队返回 null', () => {
    expect(pickFleetInSystem(fleets, 'sys-9', null)).toBeNull();
    expect(pickFleetInSystem([], 'sys-1', null)).toBeNull();
  });

  it('首次点选取该星系第一艘', () => {
    expect(pickFleetInSystem(fleets, 'sys-1', null)).toBe('fleet-1');
  });

  it('重复点选在该星系舰队内循环', () => {
    expect(pickFleetInSystem(fleets, 'sys-1', 'fleet-1')).toBe('fleet-2');
    expect(pickFleetInSystem(fleets, 'sys-1', 'fleet-2')).toBe('fleet-1');
  });

  it('单艘舰队循环回自身', () => {
    expect(pickFleetInSystem(fleets, 'sys-2', 'fleet-3')).toBe('fleet-3');
  });

  it('跃迁中的舰队不参与徽标点选循环', () => {
    const withTransit = [
      { fleet_id: 'fleet-1', system_id: 'sys-1' },
      {
        fleet_id: 'fleet-t',
        system_id: 'sys-1',
        transit: { from_system_id: 'sys-1', target_system_id: 'sys-2', total_ticks: 10, remaining_ticks: 6 },
      },
    ];
    expect(pickFleetInSystem(withTransit, 'sys-1', null)).toBe('fleet-1');
    expect(pickFleetInSystem(withTransit, 'sys-1', 'fleet-1')).toBe('fleet-1');
  });
});

describe('resolveFleetAttackTarget（fleet_attack 目标解析）', () => {
  const contacts: SensorContact[] = [
    {
      id: 'contact-1',
      scope_type: 'system',
      scope_id: 'sys-1',
      contact_kind: 'enemy_force',
      entity_id: 'enemy-fleet-3',
      planet_id: 'planet-1-2',
      level: 'confirmed_type',
      last_updated_tick: 319,
    } as SensorContact,
    {
      id: 'contact-2',
      scope_type: 'system',
      scope_id: 'sys-1',
      contact_kind: 'enemy_force',
      // 无 entity_id 的接触不可作为 target_id
      planet_id: 'planet-1-1',
      level: 'unknown_signal',
      last_updated_tick: 318,
    } as SensorContact,
  ];

  it('目标行星有可锁定接触 → 取其 entity_id', () => {
    const resolution = resolveFleetAttackTarget(contacts, 'planet-1-2');
    expect(resolution).toEqual({ ok: true, targetId: 'enemy-fleet-3' });
  });

  it('目标行星无可锁定接触 → 本地拦截', () => {
    const resolution = resolveFleetAttackTarget(contacts, 'planet-1-1');
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain('没有可锁定');
    }
  });

  it('无接触数据 → 本地拦截', () => {
    expect(resolveFleetAttackTarget(undefined, 'planet-1-2').ok).toBe(false);
    expect(resolveFleetAttackTarget([], 'planet-1-2').ok).toBe(false);
  });
});

describe('resolveFleetMoveTarget（fleet_move 目标解析）', () => {
  // 直线四星系 a-b-c-d，k=1：a-b、b-c、c-d 相连，a-c 不连
  const lanes = computeSystemLanes([
    { system_id: 'a', discovered: true, position: { x: 0, y: 0 } },
    { system_id: 'b', discovered: true, position: { x: 10, y: 0 } },
    { system_id: 'c', discovered: true, position: { x: 20, y: 0 } },
    { system_id: 'd', discovered: true, position: { x: 30, y: 0 } },
  ], 1);
  const idleFleet = { system_id: 'a', state: 'idle' as const };

  it('有航线连接的邻接星系 → 放行', () => {
    expect(resolveFleetMoveTarget(lanes, idleFleet, 'b')).toEqual({ ok: true });
  });

  it('无航线连接的星系 → 本地拦截', () => {
    const resolution = resolveFleetMoveTarget(lanes, idleFleet, 'c');
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain('无航线连接');
    }
  });

  it('目标 = 当前星系 → 拦截', () => {
    expect(resolveFleetMoveTarget(lanes, idleFleet, 'a').ok).toBe(false);
  });

  it('交战中 / 跃迁中 / 舰队缺失 → 拦截', () => {
    expect(resolveFleetMoveTarget(lanes, { system_id: 'a', state: 'attacking' }, 'b').ok).toBe(false);
    expect(resolveFleetMoveTarget(lanes, {
      system_id: 'a',
      state: 'idle',
      transit: { from_system_id: 'a', target_system_id: 'b', total_ticks: 10, remaining_ticks: 5 },
    }, 'b').ok).toBe(false);
    expect(resolveFleetMoveTarget(lanes, undefined, 'b').ok).toBe(false);
  });
});

describe('fleetStateLabel', () => {
  it('idle/attacking 映射中文标签', () => {
    expect(fleetStateLabel({ state: 'idle' })).toBe('待命');
    expect(fleetStateLabel({ state: 'attacking' })).toBe('交战中');
    expect(fleetStateLabel(undefined)).toBe('待命');
  });

  it('transit 非空即跃迁中（state 保持 idle）', () => {
    expect(fleetStateLabel({
      state: 'idle',
      transit: { from_system_id: 'sys-1', target_system_id: 'sys-2', total_ticks: 10, remaining_ticks: 4 },
    })).toBe('跃迁中');
  });
});

describe('starmap store 舰队直选状态机', () => {
  beforeEach(() => {
    resetStarmapViewStore();
  });

  it('selectFleet 选中后 selectFleet(null) 取消并退出交互模式', () => {
    const store = useStarmapViewStore.getState();
    store.selectFleet('fleet-1');
    store.setInteractionMode({ kind: 'attack', fleetId: 'fleet-1' });
    expect(useStarmapViewStore.getState().interactionMode.kind).toBe('attack');

    useStarmapViewStore.getState().selectFleet(null);
    expect(useStarmapViewStore.getState().selectedFleetId).toBeNull();
    expect(useStarmapViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('exitInteractionMode 回 inspect，舰队选中保持', () => {
    const store = useStarmapViewStore.getState();
    store.selectFleet('fleet-1');
    store.setInteractionMode({ kind: 'attack', fleetId: 'fleet-1' });

    useStarmapViewStore.getState().exitInteractionMode();
    expect(useStarmapViewStore.getState().interactionMode.kind).toBe('inspect');
    expect(useStarmapViewStore.getState().selectedFleetId).toBe('fleet-1');
  });

  it('focusSystem/exitToGalaxy 清星系选中但保留舰队选中（attack 模式跨层级）', () => {
    const store = useStarmapViewStore.getState();
    store.selectFleet('fleet-1');
    store.select({ kind: 'system', id: 'sys-1' });

    useStarmapViewStore.getState().focusSystem('sys-1');
    expect(useStarmapViewStore.getState().selected).toBeNull();
    expect(useStarmapViewStore.getState().selectedFleetId).toBe('fleet-1');

    useStarmapViewStore.getState().exitToGalaxy();
    expect(useStarmapViewStore.getState().selectedFleetId).toBe('fleet-1');
  });
});
