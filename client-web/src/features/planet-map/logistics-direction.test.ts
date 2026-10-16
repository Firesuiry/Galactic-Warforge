import { describe, expect, it } from 'vitest';
import type { Building, BuildingSorterState, BuildingSplitterState } from '@shared/types';
import { surfaceStep } from '@shared/surface';

import {
  buildGhostDirection,
  describeFlowNeighbors,
  describeFlowText,
  describeLogisticsDetail,
  directionVector,
  isOmnidirectionalLogistics,
  logisticsArrows,
  resolveLogisticsDirection,
  sorterGhostDirections,
  stepTile,
} from './logistics-direction';

const belt = (id: string, x: number, y: number, output: string, input?: string, owner = 'p'): Building => ({
  id, type: 'conveyor_belt_mk1', position: { x, y, z: 0 }, owner_id: owner,
  conveyor: { input: input ?? 'west', output } as Building['conveyor'],
} as Building);

const sorter = (id: string, x: number, y: number, rotation?: '0' | '90' | '180' | '270', filter?: string[]): Building => ({
  id, type: 'sorter_mk1', position: { x, y, z: 0 }, owner_id: 'p', rotation,
  sorter: { cycle_ticks: 6, range: 1, filter: { mode: 'allow', items: filter ?? [] } } as unknown as BuildingSorterState,
} as Building);

const splitter = (id: string, x: number, y: number, inputs: string[], outputs: string[]): Building => ({
  id, type: 'splitter', position: { x, y, z: 0 }, owner_id: 'p',
  conveyor: { input: 'auto', output: 'auto' },
  splitter: { input_directions: inputs, output_directions: outputs, input_cursor: 0, output_cursor: 0, transferred_items: 0, last_transfer_tick: 0 } as unknown as BuildingSplitterState,
} as Building);

describe('物流方向推导', () => {
  it('直线：传送带取服务端 input/output，输出侧就是流向', () => {
    const straight = belt('a', 5, 5, 'east', 'west');
    expect(logisticsArrows(straight)).toEqual({ arrows: [{ from: 'west', to: 'east' }], omnidirectional: false });
    expect(resolveLogisticsDirection(straight)).toBe('east');
    expect(describeFlowText(straight)).toBe('西→东');
  });

  it('直线：input 缺失时用 output 的反向，不猜 auto', () => {
    const noInput = { id: 'a', type: 'conveyor_belt_mk1', position: { x: 5, y: 5, z: 0 }, owner_id: 'p', conveyor: { input: 'auto', output: 'south' } } as Building;
    expect(logisticsArrows(noInput).arrows).toEqual([{ from: 'north', to: 'south' }]);
    expect(logisticsArrows({ ...noInput, conveyor: { input: 'auto', output: 'auto' } }).arrows).toEqual([]);
    expect(resolveLogisticsDirection({ ...noInput, conveyor: { input: 'auto', output: 'auto' } })).toBeNull();
  });

  it('转角：输入与输出不同侧时保留两端', () => {
    const turn = belt('b', 6, 5, 'south', 'west');
    expect(logisticsArrows(turn)).toEqual({ arrows: [{ from: 'west', to: 'south' }], omnidirectional: false });
    expect(describeFlowText(turn)).toBe('西→南');
  });

  it('分拣器：方向完全由 rotation 决定，取货端=背面、放货端=正面（第 16 轮契约 §2）', () => {
    // 锚点与服务端 model.SorterFacing 一致：0°=北、90°=东、180°=南、270°=西。
    expect(logisticsArrows(sorter('s0', 4, 4, '0'))).toEqual({ arrows: [{ from: 'south', to: 'north' }], omnidirectional: false });
    expect(logisticsArrows(sorter('s90', 4, 4, '90'))).toEqual({ arrows: [{ from: 'west', to: 'east' }], omnidirectional: false });
    expect(logisticsArrows(sorter('s180', 4, 4, '180'))).toEqual({ arrows: [{ from: 'north', to: 'south' }], omnidirectional: false });
    expect(logisticsArrows(sorter('s270', 4, 4, '270'))).toEqual({ arrows: [{ from: 'east', to: 'west' }], omnidirectional: false });
    // rotation 缺失按 0 处理（服务端 normalizePlanRotation 同样落到 "0"）。
    expect(logisticsArrows(sorter('s-missing', 4, 4))).toEqual({ arrows: [{ from: 'south', to: 'north' }], omnidirectional: false });
    expect(resolveLogisticsDirection(sorter('s90', 4, 4, '90'))).toBe('east');
    expect(describeFlowText(sorter('s90', 4, 4, '90'))).toBe('西→东');
    // 分拣器永远有单一方向：不存在「四向皆可」。
    expect(isOmnidirectionalLogistics(sorter('s90', 4, 4, '90'))).toBe(false);
  });

  it('分拣器：状态还没到达（只有 type）时不猜方向，画方向未定', () => {
    const bare = { id: 's', type: 'sorter_mk2', position: { x: 4, y: 4, z: 0 }, owner_id: 'p', rotation: '180' } as Building;
    expect(logisticsArrows(bare)).toEqual({ arrows: [], omnidirectional: false });
    expect(describeFlowText(bare)).toContain('方向未定');
  });

  it('分流器：一进多出各画一支，走 splitter 而非 conveyor', () => {
    const hub = splitter('sp', 6, 6, ['west'], ['east', 'north', 'south']);
    expect(logisticsArrows(hub).arrows).toEqual([
      { from: 'west', to: 'east' }, { from: 'west', to: 'north' }, { from: 'west', to: 'south' },
    ]);
    expect(logisticsArrows(hub).omnidirectional).toBe(false);
  });

  it('非物流建筑没有流向', () => {
    const furnace = { id: 'f', type: 'arc_smelter', position: { x: 1, y: 1, z: 0 }, owner_id: 'p' } as Building;
    expect(logisticsArrows(furnace)).toEqual({ arrows: [], omnidirectional: false });
    expect(describeFlowText(furnace)).toContain('方向未定');
  });
});

describe('跨立方体面接缝', () => {
  it('stepTile 沿服务端 surfaceStep 走，并把翻转后的朝向带出来', () => {
    const size = 4;
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      const from = { x: 3, y: 1 };
      const expected = surfaceStep(from, direction, size);
      const step = stepTile(from, direction, size);
      expect(step.tile).toEqual(expected.tile);
      expect(['north', 'east', 'south', 'west']).toContain(step.direction);
    }
  });

  it('接缝上的一对传送带：流向推导跨面后仍指向真正的下游格', () => {
    const size = 4;
    const from = { x: 3, y: 1 };
    const step = surfaceStep(from, 'east', size);
    const a = belt('a', from.x, from.y, 'east', 'west');
    const b = belt('b', step.tile.x, step.tile.y, step.direction, step.direction === 'east' ? 'west' : 'east');
    expect(stepTile(from, 'east', size).tile).toEqual({ x: step.tile.x, y: step.tile.y });
    // 下游邻居查询必须用 surfaceStep 的落格（不能 x+1 硬算）。
    const neighbors = describeFlowNeighbors(a, [a, b], size);
    expect(neighbors.downstream).toBeTruthy();
  });
});

describe('上下游建筑与详情文案', () => {
  it('直线上推出上游矿机与下游熔炉', () => {
    const miner = { id: 'm', type: 'mining_machine', position: { x: 4, y: 5, z: 0 }, owner_id: 'p' } as Building;
    const lane = belt('a', 5, 5, 'east', 'west');
    const furnace = { id: 'f', type: 'arc_smelter', position: { x: 6, y: 5, z: 0 }, owner_id: 'p' } as Building;
    const neighbors = describeFlowNeighbors(lane, [miner, lane, furnace], 16);
    expect(neighbors.upstream).toContain('采矿机');
    expect(neighbors.downstream).toContain('电弧熔炉');
    const detail = describeLogisticsDetail(lane, [miner, lane, furnace], 16);
    expect(detail).toContain('从 西 (4,5) → 往 东 (6,5)');
    expect(detail).toContain('上游接：');
    expect(detail).toContain('下游接：');
  });

  it('孤立传送带只写流向，不编造上下游', () => {
    const detail = describeLogisticsDetail(belt('a', 5, 5, 'north', 'south'), [], 16);
    expect(detail).toBe('从 南 (5,6) → 往 北 (5,4)');
  });
});

describe('建造 ghost 朝向', () => {
  it('传送带用 direction，auto 不画', () => {
    expect(buildGhostDirection('conveyor_belt_mk1', 'west', 0)).toBe('west');
    expect(buildGhostDirection('conveyor_belt_mk1', 'auto', 90)).toBeNull();
    expect(buildGhostDirection('conveyor_belt_mk1', undefined, 0)).toBeNull();
  });

  it('其他建筑用 rotation（0° = 北，与服务端 model.SorterFacing 同一张锚点表）', () => {
    expect(buildGhostDirection('sorter_mk1', 'auto', 0)).toBe('north');
    expect(buildGhostDirection('sorter_mk1', 'auto', 90)).toBe('east');
    expect(buildGhostDirection('arc_smelter', 'auto', 180)).toBe('south');
    expect(buildGhostDirection('arc_smelter', 'auto', 270)).toBe('west');
  });

  it('分拣器 ghost 给出「取 → 放」两端（背面取货、正面放货）', () => {
    expect(sorterGhostDirections('sorter_mk1', 0)).toEqual({ from: 'south', to: 'north' });
    expect(sorterGhostDirections('sorter_mk1', 90)).toEqual({ from: 'west', to: 'east' });
    expect(sorterGhostDirections('sorter_mk1', 180)).toEqual({ from: 'north', to: 'south' });
    expect(sorterGhostDirections('sorter_mk1', 270)).toEqual({ from: 'east', to: 'west' });
    // rotation 缺失按 0 处理（与服务端 normalizePlanRotation 同口径）
    expect(sorterGhostDirections('sorter_mk1', undefined)).toEqual({ from: 'south', to: 'north' });
    // 非分拣器不画取放端
    expect(sorterGhostDirections('conveyor_belt_mk1', 0)).toBeNull();
    expect(sorterGhostDirections('arc_smelter', 90)).toBeNull();
  });

  it('方向向量与 tile 坐标系一致（y 向南为正）', () => {
    expect(directionVector('north')).toEqual({ x: 0, y: -1 });
    expect(directionVector('east')).toEqual({ x: 1, y: 0 });
    expect(directionVector('south')).toEqual({ x: 0, y: 1 });
    expect(directionVector('west')).toEqual({ x: -1, y: 0 });
  });
});
