import { describe, expect, it } from 'vitest';
import { surfaceStep } from '@shared/surface';

import {
  assignBeltElevations,
  resolveBeltStartElevation,
  stepBeltElevation,
  traceBeltStroke,
  type BeltPlacement,
  type ExistingBeltLike,
} from './belt-stroke';

describe('belt stroke', () => {
 it('fills skipped pointer tiles and turns continuously', () => {
  const path=traceBeltStroke({x:2,y:2},{x:5,y:4},16);
  expect(path[0].tile).toEqual({x:2,y:2});
  expect(path.at(-1)?.tile).toEqual({x:5,y:4});
  for(let i=0;i<path.length-1;i++) expect(surfaceStep(path[i].tile,path[i].direction,16).tile).toEqual(path[i+1].tile);
 });
 it('carries direction across cube faces', () => {
  const from={x:3,y:1};
  const edge=surfaceStep(from,'east',4);
  const path=traceBeltStroke(from,edge.tile,4);
  expect(path).toEqual([{tile:from,direction:'east'},{tile:edge.tile,direction:edge.direction}]);
 });
 it('does not place duplicate tiles for a stationary pointer', () => {
  expect(traceBeltStroke({x:2,y:2},{x:2,y:2},16)).toEqual([]);
 });
});

/** 一条向东的直线路径：tile 0..n-1，每格输出方向都是 east。 */
function straightEast(count: number, startX = 0, y = 0): BeltPlacement[] {
  return Array.from({ length: count }, (_, index) => ({ tile: { x: startX + index, y }, direction: 'east' as const }));
}

describe('拖拽铺带高度（§3.5）', () => {
  const belts: ExistingBeltLike[] = [
    // 地面带 (4,0) 向东输出 → 下一格 (5,0)
    { position: { x: 4, y: 0 }, type: 'conveyor_belt_mk1', conveyor: { output: 'east', elevation: 0 } },
    // 高架带 (4,2) 向东输出 → 下一格 (5,2)
    { position: { x: 4, y: 2 }, type: 'conveyor_belt_mk2', conveyor: { output: 'east', elevation: 2 } },
    // 反向的带子（向西输出，指向 (3,4)，不指向 (5,0)）
    { position: { x: 4, y: 4 }, type: 'conveyor_belt_mk1', conveyor: { output: 'west', elevation: 3 } },
    // 非传送带
    { position: { x: 3, y: 0 }, type: 'sorter_mk1', conveyor: { output: 'east', elevation: 4 } },
  ];

  it('第一格无上游直接取目标高度', () => {
    expect(resolveBeltStartElevation({ x: 20, y: 20 }, 2, belts, 16)).toBe(2);
  });

  it('第一格接现成上游带的高度（地面带 → 从 0 起）', () => {
    expect(resolveBeltStartElevation({ x: 5, y: 0 }, 2, belts, 16)).toBe(0);
    expect(resolveBeltStartElevation({ x: 5, y: 2 }, 0, belts, 16)).toBe(2);
  });

  it('他人的带子不决定起始高度（只看己方上游带）', () => {
    const mixed: ExistingBeltLike[] = [
      { ...belts[0], owner_id: 'enemy' },      // (4,0) 向东输出，(5,0) 是别人的带子
      { position: { x: 4, y: 2 }, type: 'conveyor_belt_mk2', owner_id: 'p1', conveyor: { output: 'east', elevation: 2 } },
    ];
    // 别人的带子（0 层）不参与 → 取目标高度 2，而不是 0
    expect(resolveBeltStartElevation({ x: 5, y: 0 }, 2, mixed, 16, 'p1')).toBe(2);
    // 己方的带子照旧决定起始高度
    expect(resolveBeltStartElevation({ x: 5, y: 2 }, 0, mixed, 16, 'p1')).toBe(2);
    // 不给 playerId 时保持旧行为（几何判定，不看归属）
    expect(resolveBeltStartElevation({ x: 5, y: 0 }, 2, mixed, 16)).toBe(0);
  });

  it('从地面带接着拉到 2 层：第一格 0，之后直行每格 +1', () => {
    const start = resolveBeltStartElevation({ x: 5, y: 0 }, 2, belts, 16);
    const path = assignBeltElevations(straightEast(6, 5, 0), start, 2);
    expect(path.map(part => part.elevation)).toEqual([0, 1, 2, 2, 2, 2]);
  });

  it('拖拽中途把目标降回 0：后续直行格自动落坡，每格 -1', () => {
    const path = assignBeltElevations(straightEast(6), 3, 0);
    expect(path.map(part => part.elevation)).toEqual([3, 2, 1, 0, 0, 0]);
  });

  it('转弯格保持上一格高度（坡道上不转弯）', () => {
    const stroke: BeltPlacement[] = [
      { tile: { x: 0, y: 0 }, direction: 'east' },
      { tile: { x: 1, y: 0 }, direction: 'east' },
      { tile: { x: 2, y: 0 }, direction: 'south' },
      { tile: { x: 2, y: 1 }, direction: 'south' },
    ];
    const path = assignBeltElevations(stroke, 0, 4);
    // 第一格 0；直行 +1；转弯格保持 1；转弯后直行继续 +1。
    expect(path.map(part => part.elevation)).toEqual([0, 1, 1, 2]);
  });

  it('同方向但已到目标高度时不再变化；目标越界被钳到 0–4', () => {
    expect(stepBeltElevation({ direction: 'east', elevation: 2 }, { direction: 'east' }, 2)).toBe(2);
    expect(stepBeltElevation({ direction: 'east', elevation: 4 }, { direction: 'east' }, 9)).toBe(4);
    expect(stepBeltElevation({ direction: 'east', elevation: 0 }, { direction: 'east' }, -3)).toBe(0);
    expect(assignBeltElevations(straightEast(2), 0, 9).map(part => part.elevation)).toEqual([0, 1]);
  });

  it('每格最多 ±1：从 0 到 4 需要 4 格直行', () => {
    const path = assignBeltElevations(straightEast(5), 0, 4);
    expect(path.map(part => part.elevation)).toEqual([0, 1, 2, 3, 4]);
  });
});
