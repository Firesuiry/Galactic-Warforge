import { describe, expect, it } from 'vitest';

import type { Building } from '@shared/types';

import { sorterEndpointStatuses } from './sorter-filter';

/** 分拣器（rot 90 → 背面西取货、正面东放货）。 */
function sorter(overrides: Partial<Building> = {}): Building {
  return {
    id: 'sorter-1', type: 'sorter_mk1', owner_id: 'p1', position: { x: 5, y: 5, z: 0 }, rotation: '90',
    runtime: { params: { energy_consume: 1, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 } }, state: 'running' },
    sorter: { cycle_ticks: 6, range: 1 },
    ...overrides,
  } as Building;
}

function belt(id: string, x: number, y: number, output: 'north' | 'east' | 'south' | 'west'): Building {
  return {
    id, type: 'conveyor_belt_mk1', owner_id: 'p1', position: { x, y, z: 0 },
    runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 } }, state: 'running' },
    conveyor: { input: 'auto', output },
  } as unknown as Building;
}

function machine(id: string, x: number, y: number, ports: { id: string; direction: 'input' | 'output' | 'both' }[]): Building {
  return {
    id, type: 'arc_smelter', owner_id: 'p1', position: { x, y, z: 0 },
    runtime: {
      params: {
        energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 },
        io_ports: ports.map((port) => ({ ...port, offset: { x: 0, y: 0 }, capacity: 1 })),
      },
      state: 'running',
    },
  } as unknown as Building;
}

describe('分拣器端点连通性提示（试玩 1016 U8）', () => {
  it('两端都接上：取货端是朝东输出的带子、放货端是有输入口的机器', () => {
    const unit = sorter();
    const statuses = sorterEndpointStatuses(unit, [
      unit,
      belt('b-west', 4, 5, 'east'),
      machine('m-east', 6, 5, [{ id: 'in', direction: 'input' }]),
    ], 16);
    expect(statuses).toHaveLength(2);
    expect(statuses.map((status) => [status.side, status.ok])).toEqual([['take', true], ['drop', true]]);
    expect(statuses[0]).toMatchObject({ direction: 'west', tile: { x: 4, y: 5 }, buildingId: 'b-west', kind: 'belt' });
    expect(statuses[1]).toMatchObject({ direction: 'east', tile: { x: 6, y: 5 }, buildingId: 'm-east', kind: 'building' });
  });

  it('反向分拣器（rot 270）：取货端朝东的机器没有输出口、放货端朝西的带子不接收', () => {
    const unit = sorter({ rotation: '270' });
    const statuses = sorterEndpointStatuses(unit, [
      unit,
      // 西侧的带子朝东输出：它的输出侧正对着分拣器，所以放货端不收（与服务端一致）。
      belt('b-west', 4, 5, 'east'),
      machine('m-east', 6, 5, [{ id: 'in', direction: 'input' }]),
    ], 16);
    expect(statuses[0]).toMatchObject({ side: 'take', direction: 'east', ok: false });
    expect(statuses[0].problem).toContain('没有输出口');
    expect(statuses[1]).toMatchObject({ side: 'drop', direction: 'west', ok: false });
    expect(statuses[1].problem).toContain('不接收');
  });

  it('取货端带子流向不对：明确写出「带子朝南输出、分拣器在西侧，要朝东流」', () => {
    const unit = sorter();
    const statuses = sorterEndpointStatuses(unit, [unit, belt('b-west', 4, 5, 'south')], 16);
    expect(statuses[0].ok).toBe(false);
    expect(statuses[0].problem).toContain('流向不对');
    expect(statuses[0].problem).toContain('带子朝南输出');
    expect(statuses[0].problem).toContain('带子得朝东流');
  });

  it('端点是别人的建筑：点名「不属于你」', () => {
    const unit = sorter();
    const foreign = { ...machine('m-east', 6, 5, [{ id: 'in', direction: 'input' }]), owner_id: 'p2' } as Building;
    const statuses = sorterEndpointStatuses(unit, [unit, foreign], 16);
    expect(statuses[1].ok).toBe(false);
    expect(statuses[1].problem).toContain('不属于你');
  });

  it('前方什么都没有：给出「没有可取的物品 / 不接收」', () => {
    const unit = sorter();
    const statuses = sorterEndpointStatuses(unit, [unit], 16, { x: 0, y: 0, width: 32, height: 32 });
    expect(statuses[0].problem).toContain('没有可取的物品');
    expect(statuses[1].problem).toContain('不接收');
    // 端点格仍报出来（玩家据此知道分拣器在看哪一格）。
    expect(statuses[0].tile).toEqual({ x: 4, y: 5 });
    expect(statuses[1].tile).toEqual({ x: 6, y: 5 });
  });

  it('端点格不在本机场景窗口内时不下结论：ok=null（不误报「接不上」）', () => {
    const unit = sorter();
    // 场景窗口在别处（相机移开了）：端点格没有数据，不能断言「前方空着」。
    const statuses = sorterEndpointStatuses(unit, [unit], 16, { x: 100, y: 100, width: 16, height: 16 });
    expect(statuses.map((status) => status.ok)).toEqual([null, null]);
    expect(statuses[0].problem).toContain('不在当前场景窗口内');
  });

  it('建筑没有端口数据（旧存档/采集类）时不下结论：ok=null', () => {
    const unit = sorter();
    const bare = machine('m-east', 6, 5, []);
    const statuses = sorterEndpointStatuses(unit, [unit, bare], 16);
    expect(statuses[1]).toMatchObject({ ok: null, buildingId: 'm-east' });
  });

  it('mk2 的 range=2：端点取朝向轴上最近的非空格，中间空格继续扫', () => {
    const unit = sorter({ sorter: { cycle_ticks: 3, range: 2 } as never });
    const statuses = sorterEndpointStatuses(unit, [unit, machine('m-far', 3, 5, [{ id: 'out', direction: 'output' }])], 16);
    expect(statuses[0]).toMatchObject({ ok: true, buildingId: 'm-far', tile: { x: 3, y: 5 } });
  });
});
