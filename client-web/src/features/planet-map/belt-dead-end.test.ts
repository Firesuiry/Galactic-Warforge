import { describe, expect, it } from 'vitest';

import type { Building } from '@shared/types';

import { beltDeadEnds } from './sorter-filter';

function belt(id: string, x: number, y: number, output: 'north' | 'east' | 'south' | 'west', cargo: number, state: string = 'running'): Building {
  return {
    id, type: 'conveyor_belt_mk1', owner_id: 'p1', position: { x, y, z: 0 },
    runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 } }, state },
    conveyor: { input: 'auto', output, buffer: cargo > 0 ? [{ item_id: 'iron_ingot', quantity: cargo }] : [] },
  } as unknown as Building;
}

const machine = (id: string, x: number, y: number): Building => ({
  id, type: 'arc_smelter', owner_id: 'p1', position: { x, y, z: 0 },
  runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 3, height: 3 } }, state: 'running' },
} as unknown as Building);

describe('传送带死端告警（试玩 1016 U7）', () => {
  it('带上有货 + 前方一格没建筑 = 死端，报出带子格与前方格', () => {
    const lane = belt('b1', 5, 5, 'east', 2);
    expect(beltDeadEnds([lane], 16)).toEqual([
      { id: 'b1', tile: { x: 5, y: 5 }, aheadTile: { x: 6, y: 5 }, direction: 'east' },
    ]);
  });

  it('前方是建筑（含 3×3 占地边缘）不算死端', () => {
    const lane = belt('b1', 5, 5, 'east', 2);
    // 熔炉占地从 (6,3) 到 (8,5)，(6,5) 是它的左下角。
    expect(beltDeadEnds([lane, machine('m1', 6, 3)], 16)).toEqual([]);
  });

  it('空带子不报（还没货，谈不上堵）', () => {
    expect(beltDeadEnds([belt('b1', 5, 5, 'east', 0)], 16)).toEqual([]);
  });

  it('停机的带子不报（缺电/停机另有状态提示）', () => {
    expect(beltDeadEnds([belt('b1', 5, 5, 'east', 2, 'no_power')], 16)).toEqual([]);
  });

  it('前方是另一条带子（连续带尾接带首）不算死端；下游那条自己是死端', () => {
    const lane = belt('b1', 5, 5, 'east', 2);
    const next = belt('b2', 6, 5, 'east', 1);
    // b1 前方是 b2 → 不是死端；b2 前方是空地 → 报 b2。
    expect(beltDeadEnds([lane, next], 16).map((entry) => entry.id)).toEqual(['b2']);
    expect(beltDeadEnds([next], 16).map((entry) => entry.id)).toEqual(['b2']);
  });

  it('auto / 未解析输出的带子不报（方向未知，交给服务端）', () => {
    const unknown = belt('b1', 5, 5, 'auto' as never, 2);
    expect(beltDeadEnds([unknown], 16)).toEqual([]);
  });
});
