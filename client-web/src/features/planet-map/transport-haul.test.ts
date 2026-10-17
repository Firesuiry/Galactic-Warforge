import { describe, expect, it } from 'vitest';
import type { Unit } from '@shared/types';

import {
  HAUL_MODE_LABELS,
  HAUL_PHASE_LABELS,
  allAutoHaul,
  autoHaulActive,
  canSetHaul,
  describeAutoHaul,
  describeHaul,
  describeHaulIdle,
  haulPhaseLabel,
  haulRouteReady,
  hasTransportRobot,
  isTransportRobot,
  transportCargo,
  transportHaulMode,
  transportHaulRoute,
  transportHaulTask,
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

/** 固定路线（route 模式）机器人。 */
function routeRobot(haul: Record<string, unknown>): Unit {
  return robot({ haul: { mode: 'route', ...haul } } as never);
}

const label = (itemId: string) => ({ iron_ingot: '铁块', gear: '齿轮', iron_ore: '铁矿' }[itemId] ?? itemId);
const buildingName = (buildingId: string) => ({ b2: '电弧熔炉' }[buildingId]);

describe('运输机器人契约（§2.1）', () => {
  it('type=transport_robot 才是运输机器人，与 haul 字段无关', () => {
    expect(isTransportRobot(robot())).toBe(true);
    expect(isTransportRobot({ type: 'soldier' })).toBe(false);
    expect(isTransportRobot(undefined)).toBe(false);
  });

  it('没有 haul 字段的旧快照按出厂默认 auto 处理', () => {
    const idle = robot();
    expect(transportHaulMode(idle)).toBe('auto');
    expect(transportHaulTask(idle)).toBeNull();
    expect(transportHaulRoute(idle)).toBeNull();
    expect(transportCargo(idle)).toBeNull();
    expect(describeHaul(idle, label)).toBe('自动待命');
    expect(autoHaulActive(idle)).toBe(false);
  });

  it('模式与阶段文案', () => {
    expect(HAUL_MODE_LABELS).toEqual({ auto: '自动搬运', route: '固定路线', idle: '已停止' });
    expect(HAUL_PHASE_LABELS.to_source).toBe('前往取货');
    expect(HAUL_PHASE_LABELS.loading).toBe('装货中');
    expect(HAUL_PHASE_LABELS.to_target).toBe('运送中');
    expect(HAUL_PHASE_LABELS.unloading).toBe('卸货中');
    expect(HAUL_PHASE_LABELS.waiting_source).toBe('等待取货');
    expect(HAUL_PHASE_LABELS.waiting_target).toBe('等待卸货');
    expect(HAUL_PHASE_LABELS.idle).toBe('自动待命');
    expect(haulPhaseLabel('nonsense')).toBe('自动待命');
    expect(haulPhaseLabel(undefined)).toBe('自动待命');
  });

  it('固定路线：两端齐全才算有效，自动模式的任务不算固定路线', () => {
    const broken = routeRobot({ from_building_id: '', to_building_id: 'b2', phase: 'to_source', delivered_total: 0 });
    expect(transportHaulRoute(broken)).toBeNull();
    const auto = robot({
      haul: { mode: 'auto', from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ore', phase: 'to_source', delivered_total: 0 },
    } as never);
    expect(transportHaulRoute(auto)).toBeNull();
    expect(transportHaulTask(auto)).not.toBeNull();
  });

  it('固定路线摘要含阶段、已送达累计与载货；空载时回落到运送物品', () => {
    const carrying = routeRobot({
      from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ingot', phase: 'to_target',
      cargo: { item_id: 'iron_ingot', quantity: 4 }, delivered_total: 12,
    });
    expect(describeHaul(carrying, label)).toBe('运送中 · 已送达 12 · 载 铁块 ×4');
    expect(transportCargo(carrying)).toEqual({ item_id: 'iron_ingot', quantity: 4 });

    const empty = routeRobot({ from_building_id: 'b1', to_building_id: 'b2', item_id: 'gear', phase: 'to_source', delivered_total: 3 });
    expect(describeHaul(empty, label)).toBe('前往取货 · 已送达 3 · 运送 齿轮');
    expect(transportCargo(empty)).toBeNull();
  });

  it('数量为 0 的 cargo 不显示（车顶无货）', () => {
    const zero = routeRobot({
      from_building_id: 'b1', to_building_id: 'b2', phase: 'loading',
      cargo: { item_id: 'iron_ingot', quantity: 0 }, delivered_total: 0,
    });
    expect(transportCargo(zero)).toBeNull();
  });

  it('卸货阶段服务端已把 cargo 扣空，车顶仍显示这一趟的货物（按 item_id 兜底 1 件）', () => {
    const unloading = routeRobot({
      from_building_id: 'b1', to_building_id: 'b2', item_id: 'copper_ore', phase: 'unloading',
      cargo: { item_id: '', quantity: 0 }, delivered_total: 7,
    });
    expect(transportCargo(unloading)).toEqual({ item_id: 'copper_ore', quantity: 1 });
    const waiting = routeRobot({
      from_building_id: 'b1', to_building_id: 'b2', item_id: 'copper_ore', phase: 'waiting_target',
      cargo: { item_id: 'copper_ore', quantity: 2 }, delivered_total: 7,
    });
    expect(transportCargo(waiting)).toEqual({ item_id: 'copper_ore', quantity: 2 });
    const returning = routeRobot({
      from_building_id: 'b1', to_building_id: 'b2', item_id: 'copper_ore', phase: 'to_source',
      cargo: { item_id: '', quantity: 0 }, delivered_total: 7,
    });
    expect(transportCargo(returning)).toBeNull();
  });

  it('卸货中的摘要不写渲染兜底的「载 ×1」', () => {
    const unloading = routeRobot({
      from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ingot', phase: 'unloading',
      cargo: { item_id: '', quantity: 0 }, delivered_total: 7,
    });
    expect(describeHaul(unloading, label)).toBe('卸货中 · 已送达 7 · 运送 铁块');
  });
});

describe('自动模式（§2.1 出厂默认）', () => {
  it('有任务时摘要与胶囊文案是「自动：送 铁矿 → 电弧熔炉」', () => {
    const auto = robot({
      haul: {
        mode: 'auto', from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ore', phase: 'to_source',
        delivered_total: 0, claim: { supply_building_id: 'b1', demand_building_id: 'b2', item_id: 'iron_ore', quantity: 4 },
      },
    } as never);
    expect(describeAutoHaul(auto, label, buildingName)).toBe('自动：送 铁矿 → 电弧熔炉');
    expect(describeHaul(auto, label, buildingName)).toBe('自动：送 铁矿 → 电弧熔炉');
    expect(autoHaulActive(auto)).toBe(true);
    // 缺建筑名时退化成「自动：送 铁矿」。
    expect(describeAutoHaul(auto, label)).toBe('自动：送 铁矿');
    expect(autoHaulActive(robot())).toBe(false);
  });

  it('车上带货改派（没有取货端）仍算有任务，摘要只写物品', () => {
    const rerouted = robot({
      haul: {
        mode: 'auto', from_building_id: '', to_building_id: 'b2', item_id: 'iron_ore', phase: 'to_target',
        cargo: { item_id: 'iron_ore', quantity: 4 }, delivered_total: 0,
        claim: { demand_building_id: 'b2', item_id: 'iron_ore', quantity: 4 },
      },
    } as never);
    expect(transportHaulTask(rerouted)).not.toBeNull();
    expect(autoHaulActive(rerouted)).toBe(true);
    expect(describeHaul(rerouted, label, buildingName)).toBe('自动：送 铁矿 → 电弧熔炉');
    expect(transportCargo(rerouted)).toEqual({ item_id: 'iron_ore', quantity: 4 });
  });

  it('无任务时显示「自动待命」；idle 模式显示已停止', () => {
    const waiting = robot({ haul: { mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0 } } as never);
    expect(describeHaul(waiting, label)).toBe('自动待命');
    expect(autoHaulActive(waiting)).toBe(false);
    const stopped = robot({ haul: { mode: 'idle', from_building_id: '', to_building_id: '', phase: '', delivered_total: 0 } } as never);
    expect(describeHaul(stopped, label)).toBe('已停止（点「自动搬运」恢复）');
    expect(transportHaulMode(stopped)).toBe('idle');
  });

  it('空闲原因（haul.idle_reason）写明为什么没活干', () => {
    // 车上有货、无处可送。
    const carrying = robot({
      haul: {
        mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0,
        cargo: { item_id: 'iron_ore', quantity: 4 }, idle_reason: 'cargo_no_destination',
      },
    } as never);
    expect(describeHaulIdle(carrying, label)).toBe('带着 4 铁矿 待命：没有可送的地方');
    expect(describeHaul(carrying, label)).toBe('带着 4 铁矿 待命：没有可送的地方');

    // 上一单中止：带原因。
    const aborted = robot({
      haul: {
        mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0,
        idle_reason: 'last_aborted', idle_detail: '运输终点建筑已不存在（拆除或被摧毁），运输路线已清空',
      },
    } as never);
    expect(describeHaul(aborted, label)).toBe('上一单中止：运输终点建筑已不存在（拆除或被摧毁），运输路线已清空');

    // 有需求但都到不了 / 没有需求。
    const unreachable = robot({ haul: { mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0, idle_reason: 'no_reachable_demand' } } as never);
    expect(describeHaul(unreachable, label)).toBe('自动待命：缺料建筑都到不了');
    const noDemand = robot({ haul: { mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0, idle_reason: 'no_demand' } } as never);
    expect(describeHaul(noDemand, label)).toBe('自动待命：没有缺料的建筑');

    // 有任务时 idle_reason 不参与（服务端有任务会清空，双保险）。
    const working = robot({
      haul: {
        mode: 'auto', from_building_id: 'b1', to_building_id: 'b2', item_id: 'iron_ore', phase: 'to_target',
        delivered_total: 0, idle_reason: 'last_aborted', idle_detail: 'x',
      },
    } as never);
    expect(describeHaulIdle(working, label)).toBeNull();
    expect(describeHaul(working, label, buildingName)).toBe('自动：送 铁矿 → 电弧熔炉');

    // 旧快照没有 idle_reason：回落到「自动待命」。
    const legacy = robot({ haul: { mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0 } } as never);
    expect(describeHaulIdle(legacy, label)).toBeNull();
  });

  it('多选：至少一台运输机器人 / 全都在自动模式', () => {
    const soldier = { type: 'soldier' } as Unit;
    const auto = robot({ haul: { mode: 'auto', from_building_id: '', to_building_id: '', phase: 'idle', delivered_total: 0 } } as never);
    const stopped = robot({ id: 'robot-2', haul: { mode: 'idle', from_building_id: '', to_building_id: '', phase: '', delivered_total: 0 } } as never);
    expect(hasTransportRobot([soldier])).toBe(false);
    expect(hasTransportRobot([soldier, auto])).toBe(true);
    expect(allAutoHaul([auto])).toBe(true);
    expect(allAutoHaul([auto, stopped])).toBe(false);
    expect(allAutoHaul([soldier])).toBe(false);
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
