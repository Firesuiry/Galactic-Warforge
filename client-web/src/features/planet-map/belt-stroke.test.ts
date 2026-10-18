import { describe, expect, it } from 'vitest';
import { surfaceStep } from '@shared/surface';

import {
  applyBeltStrokeStep,
  assignBeltElevations,
  resolveBeltStartElevation,
  stepBeltElevation,
  traceBeltStroke,
  type BeltElevationPlacement,
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

/**
 * 回拖/自交（第 19 轮 §3.5 验收 1–2、R19-WEB-FIX2）：逐格笔迹更新路径。
 * 每个用例都断言 tiles 序列、每格方向，并校验相邻性（surfaceStep(dir) 必须走到下一格）。
 */
describe('拖拽笔迹逐格更新路径（回拖/自交）', () => {
  const SIZE = 8;
  /** 每格方向必须能步进到下一格（末格方向不参与相邻性校验）。 */
  function expectConnected(path: BeltPlacement[]) {
    for (let index = 0; index < path.length - 1; index++) {
      expect(surfaceStep(path[index].tile, path[index].direction, SIZE).tile).toEqual(path[index + 1].tile);
    }
  }
  /** 从 (3,3) 向东拖到 (6,3) 的路径（与 3D 组件里的逐格笔迹同口径）。 */
  function eastLine(): BeltElevationPlacement[] {
    let path: BeltElevationPlacement[] = [{ tile: { x: 3, y: 3 }, direction: 'east', elevation: 0 }];
    const grown = applyBeltStrokeStep(path, { x: 3, y: 3 }, { x: 6, y: 3 }, SIZE);
    expect(grown).not.toBeNull();
    return grown!;
  }

  it('复现 1：回拖笔迹跨过已有格时截断到该格，不生成跳格路径', () => {
    const path = eastLine();
    expect(path.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }]);
    // 指针移到 (5,2)：笔迹经过已有的 (5,3)，旧实现会得到 3,3→4,3→5,3→6,3→5,2 的跳格。
    const next = applyBeltStrokeStep(path, { x: 6, y: 3 }, { x: 5, y: 2 }, SIZE)!;
    expect(next.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 2 }]);
    expect(next.map(part => part.direction)).toEqual(['east', 'east', 'north', 'north']);
    expectConnected(next);
  });

  it('复现 2a：回拖到 (4,3) 后转向北：截断处方向刷新，不留指向已截掉格的断链', () => {
    const backed = applyBeltStrokeStep(eastLine(), { x: 6, y: 3 }, { x: 4, y: 3 }, SIZE)!;
    expect(backed.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }]);
    expect(backed.map(part => part.direction)).toEqual(['east', 'east']);
    const north = applyBeltStrokeStep(backed, { x: 4, y: 3 }, { x: 4, y: 1 }, SIZE)!;
    expect(north.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }]);
    // 旧实现留在 (4,3) 的 east 会指向已截掉的 (5,3)；这里必须刷新成 north。
    expect(north.map(part => part.direction)).toEqual(['east', 'north', 'north', 'north']);
    expectConnected(north);
  });

  it('复现 2b：回拖越过起点到 (2,3)：截断到起点后向前延伸，不跳格', () => {
    const over = applyBeltStrokeStep(eastLine(), { x: 6, y: 3 }, { x: 2, y: 3 }, SIZE)!;
    expect(over.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 2, y: 3 }]);
    expect(over.map(part => part.direction)).toEqual(['west', 'west']);
    expectConnected(over);
  });

  it('U 形绕回穿过自己：穿过已有 (4,3) 后继续到 (4,2)，路径保持首尾相接', () => {
    let path = eastLine();
    path = applyBeltStrokeStep(path, { x: 6, y: 3 }, { x: 6, y: 5 }, SIZE)!;   // 南下
    path = applyBeltStrokeStep(path, { x: 6, y: 5 }, { x: 4, y: 5 }, SIZE)!;   // 西折
    expect(path.map(part => part.tile)).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 },
    ]);
    // 北上，经过已有的 (4,3)（截断）再走到新格 (4,2)。
    const crossed = applyBeltStrokeStep(path, { x: 4, y: 5 }, { x: 4, y: 2 }, SIZE)!;
    expect(crossed.map(part => part.tile)).toEqual([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 2 }]);
    expect(crossed.map(part => part.direction)).toEqual(['east', 'north', 'north']);
    expectConnected(crossed);
  });

  it('指针没动（笔迹为空）时返回 null，调用方保持原路径', () => {
    const path = eastLine();
    expect(applyBeltStrokeStep(path, { x: 6, y: 3 }, { x: 6, y: 3 }, SIZE)).toBeNull();
  });
});

describe('跨面笔迹（立方体接缝）', () => {
  it('跨面追加的格与上一格仍按 surfaceStep 相邻，方向取源面步进方向', () => {
    const size = 8;
    // (20,7) 向南跨到另一面 (19,15)；traceBeltStroke 携带的朝向在目标面会翻转。
    const path: BeltElevationPlacement[] = [{ tile: { x: 20, y: 7 }, direction: 'south', elevation: 0 }];
    const next = applyBeltStrokeStep(path, { x: 20, y: 7 }, { x: 19, y: 15 }, size)!;
    expect(next.map(part => part.tile)).toEqual([{ x: 20, y: 7 }, { x: 19, y: 15 }]);
    expect(next.map(part => part.direction)).toEqual(['south', 'south']);
    expect(surfaceStep(next[0].tile, next[0].direction, size).tile).toEqual(next[1].tile);
  });
});
