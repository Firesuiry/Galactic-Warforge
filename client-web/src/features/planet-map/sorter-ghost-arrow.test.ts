import { describe, expect, it } from 'vitest';

import { directionVector } from '@/features/planet-map/logistics-direction';
import { dashSegments, resolveSorterGhostArrows, sorterGhostArrowStyle } from '@/features/planet-map/planet-scene';

/**
 * §4 建造幽灵：分拣器两支箭头（取 → 放）必须**背向分开**摆在格子的前后半格。
 * 叠在格心会糊成一个「叉」，玩家看不出哪端取货、哪端放货（试玩 1015 反馈）。
 * 箭头几何与朝向推导在 3D/2D 两处共用同一份端点（logistics-direction），
 * 这里只校验 2D 那一份的坐标。
 */
describe('2D 分拣器幽灵箭头', () => {
  const center = { x: 100, y: 200 };
  const ts = 40;

  it('每个 rotation 产出取（背面）/放（正面）两支，端点背向分开', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const arrows = resolveSorterGhostArrows('sorter_mk1', rotation, center, ts)!;
      expect(arrows).toHaveLength(2);
      const [take, drop] = arrows;
      expect(take.role).toBe('take');
      expect(drop.role).toBe('drop');
      // 取货端在背面、放货端在正面：两端的矢量方向相反。
      const takeVector = directionVector(take.direction);
      const dropVector = directionVector(drop.direction);
      expect(takeVector.x).toBeCloseTo(-dropVector.x, 9);
      expect(takeVector.y).toBeCloseTo(-dropVector.y, 9);
      // 尾端都在格心附近（不跨过格心画到对面半格）。
      for (const arrow of arrows) {
        expect(Math.hypot(arrow.tail.x - center.x, arrow.tail.y - center.y)).toBeLessThan(ts * .2);
        // 尖端朝各自方向伸出半格以内，两支不重叠。
        expect(Math.hypot(arrow.tip.x - center.x, arrow.tip.y - center.y)).toBeLessThanOrEqual(ts * .5);
      }
      // 两支的尖端在格心的相反两侧。
      const dropSide = (drop.tip.x - center.x) * dropVector.x + (drop.tip.y - center.y) * dropVector.y;
      const takeSide = (take.tip.x - center.x) * takeVector.x + (take.tip.y - center.y) * takeVector.y;
      expect(dropSide).toBeGreaterThan(0);
      expect(takeSide).toBeGreaterThan(0);
      expect(Math.hypot(drop.tip.x - take.tip.x, drop.tip.y - take.tip.y)).toBeGreaterThan(ts * .5);
    }
  });

  it('非分拣器没有箭头', () => {
    expect(resolveSorterGhostArrows('conveyor_belt_mk1', 0, center, ts)).toBeNull();
    expect(resolveSorterGhostArrows('arc_smelter', 90, center, ts)).toBeNull();
  });

  it('rotation 决定朝向（0 北 / 90 东 / 180 南 / 270 西）', () => {
    expect(resolveSorterGhostArrows('sorter_mk1', 0, center, ts)!.map((arrow) => arrow.direction)).toEqual(['south', 'north']);
    expect(resolveSorterGhostArrows('sorter_mk1', 90, center, ts)!.map((arrow) => arrow.direction)).toEqual(['west', 'east']);
    expect(resolveSorterGhostArrows('sorter_mk1', 180, center, ts)!.map((arrow) => arrow.direction)).toEqual(['north', 'south']);
    expect(resolveSorterGhostArrows('sorter_mk1', 270, center, ts)!.map((arrow) => arrow.direction)).toEqual(['east', 'west']);
  });

  it('试玩 1016 U1：取货端空心虚线 + 「取」，放货端实心粗线 + 「放」（不只靠颜色）', () => {
    const take = sorterGhostArrowStyle('take');
    const drop = sorterGhostArrowStyle('drop');
    expect(take.filled).toBe(false);
    expect(drop.filled).toBe(true);
    expect(take.label).toBe('取');
    expect(drop.label).toBe('放');
    // 线型差异：取货端虚线、放货端实线（与 3D 纹理的 dashed 同口径）。
    expect(take.dash).toBeGreaterThan(0);
    expect(drop.dash).toBe(0);
    // 粗细必须拉开：空心端描边细、实心端粗，低缩放档也读得出形状差异。
    expect(drop.shaftWidth).toBeGreaterThan(take.shaftWidth * 1.5);
    // 取货端也不能细到看不见（旧版 1.5px 在小格宽下与实心端一样糊）。
    expect(take.shaftWidth).toBeGreaterThanOrEqual(2);
  });

  it('虚线切段：沿线段方向等距切分，首尾都落在线上，缺口不会被误算进实线', () => {
    const pieces = dashSegments({ x: 0, y: 0 }, { x: 20, y: 0 }, 5, 3);
    expect(pieces.length).toBeGreaterThan(1);
    for (const [start, end] of pieces) {
      expect(end.x).toBeGreaterThan(start.x);
      expect(end.x - start.x).toBeLessThanOrEqual(5 + 1e-9);
      expect(start.y).toBe(0);
    }
    // 第一段从尾端开始，最后一段在尖端收尾（不会因为取整丢掉末段）。
    expect(pieces[0][0]).toEqual({ x: 0, y: 0 });
    expect(pieces[pieces.length - 1][1].x).toBeCloseTo(20, 9);
    // dash ≤ 0 退化为整段（实心端走这条）。
    expect(dashSegments({ x: 0, y: 0 }, { x: 3, y: 4 }, 0, 0)).toEqual([[{ x: 0, y: 0 }, { x: 3, y: 4 }]]);
  });
});
