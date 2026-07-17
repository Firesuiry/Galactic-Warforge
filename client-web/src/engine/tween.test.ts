import { describe, expect, it } from 'vitest';

import { createTween, easeInOutCubic, easeOutCubic, lerp } from '@/engine/tween';

describe('tween', () => {
  it('lerp 线性插值', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it('缓动函数边界为 0/1 且单调', () => {
    for (const ease of [easeOutCubic, easeInOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      let prev = 0;
      for (let t = 0.05; t <= 1; t += 0.05) {
        const v = ease(t);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
    }
  });

  it('createTween 按 dt 推进并在结束时钳制到 1', () => {
    const tween = createTween(100, (t) => t);
    expect(tween.step(40)).toBeCloseTo(0.4);
    expect(tween.done).toBe(false);
    expect(tween.step(80)).toBe(1);
    expect(tween.done).toBe(true);
    expect(tween.step(10)).toBe(1);
  });

  it('duration 为 0 时立即完成', () => {
    const tween = createTween(0);
    expect(tween.done).toBe(true);
    expect(tween.step(16)).toBe(1);
  });
});
