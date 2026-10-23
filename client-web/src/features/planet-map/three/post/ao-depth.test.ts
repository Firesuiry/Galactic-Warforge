import { describe, expect, it } from 'vitest';

import { aoDepthBoundToReadBuffer, bindAoDepth } from './ao-depth';

/**
 * 审查 P1-3：GTAO 必须绑到 RenderPass 本帧写入的那块 RT 的深度。
 *
 * 这里用最小的替身复刻 composer 的双缓冲语义（swap 后 readBuffer 在 RT1/RT2 之间交替），
 * 断言每帧绑定的都是**当时的** readBuffer 深度，而不是构造时那一块。
 */
function fakeComposer() {
  const rt1 = { depthTexture: { name: 'rt1-depth' } };
  const rt2 = { depthTexture: { name: 'rt2-depth' } };
  const composer = { readBuffer: rt1 as { depthTexture: { name: string } } };
  return {
    composer,
    rt1,
    rt2,
    swap() {
      composer.readBuffer = composer.readBuffer === rt1 ? rt2 : rt1;
    },
  };
}

function fakeGtao() {
  const calls: unknown[] = [];
  const gtao = {
    depthTexture: undefined as unknown,
    setGBuffer(depth: unknown) {
      calls.push(depth);
      gtao.depthTexture = depth;
    },
    calls,
  };
  return gtao;
}

describe('GTAO 深度绑定（审查 P1-3）', () => {
  it('每帧绑定 composer.readBuffer 的深度，swap 之后仍然正确', () => {
    const { composer, rt1, rt2, swap } = fakeComposer();
    const gtao = fakeGtao();
    // 构造时的错误写法（绑 RT1）在第一次 animate 就被纠正。
    gtao.setGBuffer(rt1.depthTexture);
    for (let frame = 0; frame < 6; frame++) {
      expect(bindAoDepth(gtao, composer)).toBe(true);
      expect(aoDepthBoundToReadBuffer(gtao.depthTexture, composer)).toBe(true);
      expect(gtao.depthTexture).toBe(composer.readBuffer.depthTexture);
      swap();
    }
    // 两块 RT 的深度都轮到过。
    expect(new Set(gtao.calls)).toEqual(new Set([rt1.depthTexture, rt2.depthTexture]));
  });

  it('已经绑对时不重复 setGBuffer（避免每帧重设 defines/uniform）', () => {
    const { composer } = fakeComposer();
    const gtao = fakeGtao();
    bindAoDepth(gtao, composer);
    bindAoDepth(gtao, composer);
    expect(gtao.calls).toHaveLength(1);
  });

  it('readBuffer 没有深度纹理时不调用 setGBuffer(undefined)（r186 会新建 GBuffer 目标）', () => {
    const { composer, rt1 } = fakeComposer();
    const gtao = fakeGtao();
    bindAoDepth(gtao, composer);
    gtao.calls.length = 0;
    (composer.readBuffer as { depthTexture: unknown }).depthTexture = null;
    expect(bindAoDepth(gtao, composer)).toBe(false);
    expect(gtao.calls).toHaveLength(0);
    expect(aoDepthBoundToReadBuffer(gtao.depthTexture, composer)).toBe(false);
    void rt1;
  });
});
