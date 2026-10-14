import { describe, expect, it } from 'vitest';
import type { Unit } from '@shared/types';

import {
  HAUL_PHASE_LABELS,
  canSetHaul,
  describeHaul,
  haulPhaseLabel,
  haulRouteReady,
  isTransportRobot,
  transportCargo,
  transportHaulRoute,
} from '@/features/planet-map/transport-haul';

function robot(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'robot-1',
    type: 'transport_robot',
    owner_id: 'p1',
    position: { x: 2, y: 2, z: 0 },
    hp: 60,
    max_hp: 60,
    attack: 0,
    defense: 0,
    attack_range: 0,
    move_range: 0,
    vision_range: 4,
    ...overrides,
  } as Unit;
}

const label = (itemId: string) => ({ iron_ingot: '铁块', gear: '齿轮' }[itemId] ?? itemId);

describe('运输机器人契约（§4）', () => {
  it('type=transport_robot 才是运输机器人，与 haul 字段无关', () => {
    expect(isTransportRobot(robot())).toBe(true);
    expect(isTransportRobot({ type: 'soldier' })).toBe(false);
    expect(isTransportRobot(undefined)).toBe(false);
  });

  it('无 haul 字段 = 未设路线（不画路线、不显示货物）', () => {
    const idle = robot();
    expect(transportHaulRoute(idle)).toBeNull();
    expect(transportCargo(idle)).toBeNull();
    expect(describeHaul(idle, label)).toBeNull();
  });

  it('haul 路线两端齐全才算有效', () => {
    const broken = robot({ haul: { from_building_id: '', to_building_id: 'b2', phase: 'to_source', delivered_total: 0 } } as never);
    expect(transportHaulRoute(broken)).toBeNull();
  });

  it('阶段文案覆盖 6 个阶段，未知阶段回退「未设路线」', () => {
    expect(HAUL_PHASE_LABELS.to_source).toBe('前往取货');
    expect(HAUL_PHASE_LABELS.loading).toBe('装货中');
    expect(HAUL_PHASE_LABELS.to_target).toBe('运送中');
    expect(HAUL_PHASE_LABELS.unloading).toBe('卸货中');
    expect(HAUL_PHASE_LABELS.waiting_source).toBe('等待取货');
    expect(HAUL_PHASE_LABELS.waiting_target).toBe('等待卸货');
    expect(haulPhaseLabel('nonsense')).toBe('未设路线');
    expect(haulPhaseLabel(undefined)).toBe('未设路线');
  });

  it('摘要含阶段、已送达累计与载货；空载时回落到运送物品', () => {
    const carrying = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ingot', phase: 'to_target', cargo: { item_id: 'iron_ingot', quantity: 4 }, delivered_total: 12 },
    } as never);
    expect(describeHaul(carrying, label)).toBe('运送中 · 已送达 12 · 载 铁块 ×4');
    expect(transportCargo(carrying)).toEqual({ item_id: 'iron_ingot', quantity: 4 });

    const empty = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', item_id: 'gear', phase: 'to_source', delivered_total: 3 },
    } as never);
    expect(describeHaul(empty, label)).toBe('前往取货 · 已送达 3 · 运送 齿轮');
    expect(transportCargo(empty)).toBeNull();
  });

  it('数量为 0 的 cargo 不显示（车顶无货）', () => {
    const zero = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', phase: 'loading', cargo: { item_id: 'iron_ingot', quantity: 0 }, delivered_total: 0 },
    } as never);
    expect(transportCargo(zero)).toBeNull();
  });

  it('卸货阶段服务端已把 cargo 扣空，车顶仍显示这一趟的货物（按 item_id 兜底 1 件）', () => {
    // 服务端 haulUnloadAtTarget 每 tick 扣减，卸完即清空 cargo；玩家眼里这一趟还没结束。
    const unloading = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', item_id: 'copper_ore', phase: 'unloading', cargo: { item_id: '', quantity: 0 }, delivered_total: 7 },
    } as never);
    expect(transportCargo(unloading)).toEqual({ item_id: 'copper_ore', quantity: 1 });
    // 终点收不下、货还在车上：照实显示剩余件数。
    const waiting = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', item_id: 'copper_ore', phase: 'waiting_target', cargo: { item_id: 'copper_ore', quantity: 2 }, delivered_total: 7 },
    } as never);
    expect(transportCargo(waiting)).toEqual({ item_id: 'copper_ore', quantity: 2 });
    // 空车返程 / 前往取货：车顶无货。
    const returning = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', item_id: 'copper_ore', phase: 'to_source', cargo: { item_id: '', quantity: 0 }, delivered_total: 7 },
    } as never);
    expect(transportCargo(returning)).toBeNull();
  });

  it('卸货中的摘要不写渲染兜底的「载 ×1」', () => {
    const unloading = robot({
      haul: { from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ingot', phase: 'unloading', cargo: { item_id: '', quantity: 0 }, delivered_total: 7 },
    } as never);
    expect(describeHaul(unloading, label)).toBe('卸货中 · 已送达 7 · 运送 铁块');
  });
});

describe('「设置运输」草稿与命令前置条件', () => {
  it('两端都选好才算 ready（物品可选）', () => {
    expect(haulRouteReady(null)).toBe(false);
    expect(haulRouteReady({ fromBuildingId: 'b1' })).toBe(false);
    expect(haulRouteReady({ fromBuildingId: 'b1', toBuildingId: 'b2' })).toBe(true);
    expect(haulRouteReady({ fromBuildingId: 'b1', toBuildingId: 'b2', itemId: 'gear' })).toBe(true);
  });

  it('多选里至少一台运输机器人 + 两端已选 → 可一次设同一路线', () => {
    const soldier = { type: 'soldier' } as Unit;
    expect(canSetHaul([soldier], { fromBuildingId: 'b1', toBuildingId: 'b2' })).toBe(false);
    expect(canSetHaul([soldier, robot()], { fromBuildingId: 'b1', toBuildingId: 'b2' })).toBe(true);
    expect(canSetHaul([robot()], { fromBuildingId: 'b1' })).toBe(false);
  });
});
