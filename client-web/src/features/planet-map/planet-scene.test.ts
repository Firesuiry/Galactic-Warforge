import { describe, expect, it } from 'vitest';

import {
  buildDashSegments,
  smoothingBlend,
  UNIT_SMOOTHING_RATE,
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
