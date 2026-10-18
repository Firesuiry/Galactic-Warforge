import { describe, expect, it } from 'vitest';

import type { Building } from '@shared/types';

import { beltDeadEnds } from './sorter-filter';

function belt(id: string, x: number, y: number, output: 'north' | 'east' | 'south' | 'west', cargo: number, state: string = 'running', elevation = 0): Building {
  return {
    id, type: 'conveyor_belt_mk1', owner_id: 'p1', position: { x, y, z: 0 },
    runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 } }, state },
    conveyor: { input: 'auto', output, elevation, buffer: cargo > 0 ? [{ item_id: 'iron_ingot', quantity: cargo }] : [] },
  } as unknown as Building;
}

/** 分拣器：rotation 0/90/180/270 = 放货朝北/东/南/西，取货端在反方向。 */
const sorter = (id: string, x: number, y: number, rotation: number, range = 3): Building => ({
  id, type: 'sorter_mk1', owner_id: 'p1', position: { x, y, z: 0 }, rotation,
  runtime: { params: { energy_consume: 1, energy_generate: 0, capacity: 0, footprint: { width: 1, height: 1 } }, state: 'running' },
  sorter: { range, cycle_ticks: 6 },
} as unknown as Building);

const machine = (id: string, x: number, y: number): Building => ({
  id, type: 'arc_smelter', owner_id: 'p1', position: { x, y, z: 0 },
  runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 3, height: 3 } }, state: 'running' },
} as unknown as Building);

describe('传送带死端告警（试玩 1016 U7）', () => {
  it('带上有货 + 前方一格没建筑 = 死端，报出带子格与前方格', () => {
    const lane = belt('b1', 5, 5, 'east', 2);
    expect(beltDeadEnds([lane], 16)).toEqual([
      { id: 'b1', tile: { x: 5, y: 5 }, aheadTile: { x: 6, y: 5 }, direction: 'east', elevation: 0 },
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

  it('带尾被分拣器夹货（含隔一空格的跨格取货）不算死端', () => {
    // 同 cp-belt-dsp 的铁收货口：带尾朝南，下一格空着，再下一格的分拣器朝南从 2 格外取货。
    const tail = belt('b1', 5, 4, 'south', 3);
    expect(beltDeadEnds([tail, sorter('s1', 5, 6, 180)], 16)).toEqual([]);
    // 分拣器朝向反了（取货端朝南）就不是在夹这条带，带尾照样报。
    expect(beltDeadEnds([tail, sorter('s1', 5, 6, 0)], 16).map((entry) => entry.id)).toEqual(['b1']);
    // 超出取货距离（range 1 只看相邻格，相邻格是空的）也照报。
    expect(beltDeadEnds([tail, sorter('s1', 5, 6, 180, 1)], 16).map((entry) => entry.id)).toEqual(['b1']);
  });

  it('分层口径：高架带只接带子，地面建筑收不到它的货', () => {
    const high = belt('b1', 5, 5, 'east', 2, 'running', 1);
    expect(beltDeadEnds([high, machine('m1', 6, 3)], 16)).toEqual([
      { id: 'b1', tile: { x: 5, y: 5 }, aheadTile: { x: 6, y: 5 }, direction: 'east', elevation: 1 },
    ]);
    // 同层带子接上；前方地面带直行延续 = 下坡，也接上。
    expect(beltDeadEnds([high, belt('b2', 6, 5, 'east', 0, 'running', 1)], 16)).toEqual([]);
    expect(beltDeadEnds([high, belt('b2', 6, 5, 'east', 0)], 16)).toEqual([]);
    // 地面带转弯（朝北）不是坡道的直行延续 → 死端；隔两层也接不上。
    expect(beltDeadEnds([high, belt('b2', 6, 5, 'north', 0)], 16).map((entry) => entry.id)).toEqual(['b1']);
    expect(beltDeadEnds([belt('b1', 5, 5, 'east', 2, 'running', 2), belt('b2', 6, 5, 'east', 0)], 16).map((entry) => entry.id)).toEqual(['b1']);
  });

  it('分层口径：地面带前方只有高架带时，直行延续算上坡，否则是死端', () => {
    const lane = belt('b1', 5, 5, 'east', 2);
    expect(beltDeadEnds([lane, belt('b2', 6, 5, 'east', 0, 'running', 1)], 16)).toEqual([]);
    // 高架带从头顶横穿（朝南）：地面带过不去，前方地面格是空的 → 死端。
    expect(beltDeadEnds([lane, belt('b2', 6, 5, 'south', 0, 'running', 1)], 16).map((entry) => entry.id)).toEqual(['b1']);
  });
});
