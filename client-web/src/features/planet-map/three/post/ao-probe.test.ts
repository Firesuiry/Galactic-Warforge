import { describe, expect, it } from 'vitest';

import { aoStats } from './ao-probe';

describe('AO 探针统计（审查 P1-3 验收）', () => {
  it('全 1.0（无遮蔽）时 min/mean/max 都是 1', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const stats = aoStats(pixels, 4, { x: 0, y: 0, width: 1, height: 1 });
    expect(stats.min).toBe(1);
    expect(stats.mean).toBeCloseTo(1, 5);
    expect(stats.max).toBe(1);
    expect(stats.samples).toBe(16);
  });

  it('带遮蔽的像素被正确统计（min < 0.85 判据成立）', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    // 四个像素写 0.5（128/255 ≈ 0.502）。
    for (let i = 0; i < 4; i++) pixels[i * 4] = 128;
    const stats = aoStats(pixels, 4, { x: 0, y: 0, width: 1, height: 1 });
    expect(stats.min).toBeCloseTo(128 / 255, 5);
    expect(stats.max).toBe(1);
    expect(stats.mean).toBeCloseTo((12 * 1 + 4 * (128 / 255)) / 16, 5);
  });
});
