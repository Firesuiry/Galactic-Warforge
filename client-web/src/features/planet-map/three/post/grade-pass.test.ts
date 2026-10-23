import { describe, expect, it } from 'vitest';

import { GradePass } from './grade-pass';

/**
 * 冻结确定性（`fix/3a-freeze-determinism`）：调色 pass 的胶片颗粒每帧换相位，
 * 冻结（`?freeze=1`）时必须停在固定相位，否则同一场景跨两次运行截图不逐字节一致。
 *
 * 这里用最小的 renderer / RT 替身跑 `render()`，断言 `frame` uniform：
 * - 冻结：多次 render 后仍为 0（颗粒相位只与屏幕坐标有关）；
 * - 非冻结：每次 render 递增，观感（颗粒闪动）不变。
 */
function fakeRenderer() {
  return {
    targets: [] as unknown[],
    setRenderTarget(target: unknown) { this.targets.push(target); },
    render() { /* 不画，只看 uniform */ },
  } as unknown as Parameters<GradePass['render']>[0] & { targets: unknown[] };
}

const WRITE = {} as Parameters<GradePass['render']>[1];
const READ = {} as Parameters<GradePass['render']>[2];

function frameUniform(pass: GradePass): number {
  return (pass as unknown as { material: { uniforms: { frame: { value: number } } } }).material.uniforms.frame.value;
}

function frozenUniform(pass: GradePass): number {
  return (pass as unknown as { material: { uniforms: { frozen: { value: number } } } }).material.uniforms.frozen.value;
}

describe('调色 pass 颗粒相位（冻结确定性）', () => {
  it('冻结时 frame uniform 不随帧变化（固定相位）', () => {
    const pass = new GradePass({}, true);
    const renderer = fakeRenderer();
    for (let i = 0; i < 5; i++) pass.render(renderer, WRITE, READ);
    expect(frozenUniform(pass)).toBe(1);
    expect(frameUniform(pass)).toBe(0);
  });

  it('非冻结时 frame uniform 每帧递增（颗粒照常闪动，观感不变）', () => {
    const pass = new GradePass({}, false);
    const renderer = fakeRenderer();
    const frames: number[] = [];
    for (let i = 0; i < 4; i++) {
      pass.render(renderer, WRITE, READ);
      frames.push(frameUniform(pass));
    }
    expect(frames).toEqual([1, 2, 3, 4]);
  });

  it('setFrozen 切到冻结后相位停止变化', () => {
    const pass = new GradePass({}, false);
    const renderer = fakeRenderer();
    pass.render(renderer, WRITE, READ);
    pass.render(renderer, WRITE, READ);
    pass.setFrozen(true);
    pass.render(renderer, WRITE, READ);
    const frozenFrame = frameUniform(pass);
    pass.render(renderer, WRITE, READ);
    expect(frameUniform(pass)).toBe(frozenFrame);
  });
});
