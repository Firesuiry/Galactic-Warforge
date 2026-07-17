import { describe, expect, it } from 'vitest';

import {
  buildDashSegments,
  constructionProgress,
  entityAnimPhase,
  hpArcParams,
  resolveUnitDirection,
  resourceDecalLayout,
  smoothingBlend,
  UNIT_SMOOTHING_RATE,
  unitWedgePoints,
} from '@/features/planet-map/planet-scene';

describe('planet-scene 纯函数', () => {
  it('smoothingBlend：dt=0 不动，dt 越大越接近 1（帧率无关的指数趋近）', () => {
    expect(smoothingBlend(0)).toBe(0);
    const small = smoothingBlend(1 / 60);
    const large = smoothingBlend(1 / 30);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(large);
    expect(large).toBeLessThan(1);
    // k≈8/s 时 60fps 单帧约 12.5% 的剩余距离被消除
    expect(smoothingBlend(1 / 60)).toBeCloseTo(1 - Math.exp(-UNIT_SMOOTHING_RATE / 60), 6);
  });

  it('buildDashSegments：空 pattern 退化为整条线段', () => {
    expect(buildDashSegments(0, 0, 10, 0, [])).toEqual([[0, 0, 10, 0]]);
  });

  it('buildDashSegments：按画/空交替切段，段落总长不超过原线段', () => {
    // 水平 25px 线段，画 8 空 6：画段 [0,8]、[14,22]，剩 3px 落在"空"档内被截断
    const segments = buildDashSegments(0, 0, 25, 0, [8, 6]);
    expect(segments.length).toBe(2);
    expect(segments[0]).toEqual([0, 0, 8, 0]);
    expect(segments[1]).toEqual([14, 0, 22, 0]);

    // 段落都在线段内部且互不相交
    const drawn = segments.reduce((sum, [ax, , bx]) => sum + (bx - ax), 0);
    expect(drawn).toBeLessThanOrEqual(25);
  });

  it('buildDashSegments：斜线按单位向量投影切段', () => {
    const segments = buildDashSegments(0, 0, 6, 8, [5, 5]); // 长度 10
    expect(segments.length).toBe(1);
    const [ax, ay, bx, by] = segments[0];
    expect(ax).toBe(0);
    expect(ay).toBe(0);
    expect(bx).toBeCloseTo(3, 6);
    expect(by).toBeCloseTo(4, 6);
  });

  it('buildDashSegments：零长线段不产生段落', () => {
    expect(buildDashSegments(3, 3, 3, 3, [4, 4])).toEqual([]);
  });
});

describe('单位楔形与朝向', () => {
  it('unitWedgePoints：顶点朝正上，尾部分叉内凹（能读出朝向）', () => {
    const points = unitWedgePoints(10);
    // 4 个顶点：tip (0,-r)、右后、内凹、左后
    expect(points.length).toBe(8);
    expect(points[0]).toBe(0);
    expect(points[1]).toBe(-10); // tip 在最上方
    const minY = Math.min(...points.filter((_, i) => i % 2 === 1));
    expect(points[1]).toBe(minY);
    // 左右对称
    expect(points[2]).toBeCloseTo(-points[6], 6);
    expect(points[3]).toBeCloseTo(points[7], 6);
  });

  it('resolveUnitDirection：移动中朝 target_pos', () => {
    const dir = resolveUnitDirection(
      { position: { x: 1, y: 1, z: 0 }, is_moving: true, target_pos: { x: 4, y: 5, z: 0 } },
      { x: 0, y: -1 },
      () => null,
    );
    expect(dir.x).toBeCloseTo(3 / 5, 6);
    expect(dir.y).toBeCloseTo(4 / 5, 6);
  });

  it('resolveUnitDirection：无移动时朝 attack_target，都无则保留 fallback', () => {
    const dir = resolveUnitDirection(
      { position: { x: 2, y: 2, z: 0 }, is_moving: false, attack_target: 'b1' },
      { x: 0, y: -1 },
      (id) => (id === 'b1' ? { x: 5, y: 2 } : null),
    );
    expect(dir.x).toBeCloseTo(1, 6);
    expect(dir.y).toBeCloseTo(0, 6);

    const fallback = { x: 0.6, y: -0.8 };
    expect(resolveUnitDirection(
      { position: { x: 2, y: 2, z: 0 }, is_moving: false },
      fallback,
      () => null,
    )).toBe(fallback);
    // 目标与本格重合时也保留 fallback
    expect(resolveUnitDirection(
      { position: { x: 2, y: 2, z: 0 }, is_moving: true, target_pos: { x: 2, y: 2, z: 0 } },
      fallback,
      () => null,
    )).toBe(fallback);
  });
});

describe('HP 弧参数', () => {
  it('满血/无数据不绘制；受伤才绘制', () => {
    expect(hpArcParams(100, 100).visible).toBe(false);
    expect(hpArcParams(undefined, 100).visible).toBe(false);
    expect(hpArcParams(50, 0).visible).toBe(false);
    expect(hpArcParams(50, 100).visible).toBe(true);
  });

  it('ratio 截断到 [0,1]；颜色满血绿、半血黄、残血红', () => {
    expect(hpArcParams(120, 100).ratio).toBe(1);
    expect(hpArcParams(-10, 100).ratio).toBe(0);
    expect(hpArcParams(100, 100).color).toBe(0x69db7c);
    expect(hpArcParams(50, 100).color).toBe(0xffd43b);
    expect(hpArcParams(0, 100).color).toBe(0xe03131);
    // 中间值单调：75% 的绿度高于 25%
    const high = hpArcParams(75, 100).color;
    const low = hpArcParams(25, 100).color;
    expect((high >> 8) & 0xff).toBeGreaterThan((low >> 8) & 0xff);
  });
});

describe('工地进度与资源贴花', () => {
  it('constructionProgress：remaining/total 可算时返回比例，缺数据返回 null', () => {
    expect(constructionProgress({ state: 'completed' })).toBe(1);
    expect(constructionProgress({ state: 'in_progress', remaining_ticks: 30, total_ticks: 100 })).toBeCloseTo(0.7, 6);
    expect(constructionProgress({ state: 'in_progress', remaining_ticks: 0, total_ticks: 100 })).toBe(1);
    expect(constructionProgress({ state: 'pending' })).toBeNull();
    expect(constructionProgress({ state: 'in_progress' })).toBeNull();
    expect(constructionProgress({ state: 'in_progress', remaining_ticks: 5, total_ticks: 0 })).toBeNull();
  });

  it('resourceDecalLayout：同 kind 同形（确定性），3 片晶簇 + 底托', () => {
    const first = resourceDecalLayout('iron_ore', 12);
    const second = resourceDecalLayout('iron_ore', 12);
    expect(first).toEqual(second);
    expect(first.shards.length).toBe(3);
    // 晶簇尖端在底边上方（负 y），底托扁椭圆
    for (const shard of first.shards) {
      expect(shard[5]).toBeLessThan(0);
    }
    expect(first.baseRadiusX).toBeGreaterThan(first.baseRadiusY);
    // 不同 kind 形状不同
    expect(resourceDecalLayout('coal', 12)).not.toEqual(first);
  });

  it('entityAnimPhase：确定性且落在 [0, 2π)', () => {
    expect(entityAnimPhase('bldg-1')).toBe(entityAnimPhase('bldg-1'));
    expect(entityAnimPhase('bldg-1')).not.toBe(entityAnimPhase('bldg-2'));
    for (const id of ['a', 'bb', 'wind-3', '特斯拉']) {
      const phase = entityAnimPhase(id);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
    }
  });
});
