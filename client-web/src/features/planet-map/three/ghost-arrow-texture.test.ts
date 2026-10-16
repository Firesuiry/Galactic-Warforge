import { describe, expect, it } from 'vitest';

import { disposeGhostArrowTextures, GHOST_ROLE_LABEL, ghostArrowPaint, ghostArrowTexture, ghostRoleLabelMaterial } from './ghost-arrow-texture';

describe('建造 ghost 箭头纹理（试玩 1016 U1：取/放必须形状可分）', () => {
  it('取货端空心、放货端实心（不靠颜色区分）', () => {
    expect(ghostArrowPaint('take').filled).toBe(false);
    expect(ghostArrowPaint('drop').filled).toBe(true);
    // 空心端线宽必须够粗：缩到 0.62 格时细线会糊掉。
    expect(ghostArrowPaint('take').lineWidth).toBeGreaterThanOrEqual(6);
  });

  it('两个角色各自一张纹理，同角色只创建一次', () => {
    disposeGhostArrowTextures();
    const take = ghostArrowTexture('take');
    const drop = ghostArrowTexture('drop');
    expect(take).not.toBe(drop);
    expect(ghostArrowTexture('take')).toBe(take);
    expect(ghostArrowTexture('drop')).toBe(drop);
    // 两张纹理画的是各自独立的画布（内容由 paint 参数决定，jsdom 没有真实 2d 光栅）。
    expect(take.image).not.toBe(drop.image);
    disposeGhostArrowTextures();
  });

  it('「取」/「放」标签：同角色同色复用材质，颜色不同则不同材质', () => {
    const a = ghostRoleLabelMaterial('take', '#6ee7f7');
    const b = ghostRoleLabelMaterial('take', '#6ee7f7');
    const c = ghostRoleLabelMaterial('take', '#ffd76a');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(GHOST_ROLE_LABEL).toEqual({ take: '取', drop: '放' });
    expect(a.userData.shared).toBe(true);
    disposeGhostArrowTextures();
  });

  it('dispose 后重新取到的是新纹理（场景重挂载不会拿到已释放的纹理）', () => {
    disposeGhostArrowTextures();
    const first = ghostArrowTexture('take');
    disposeGhostArrowTextures();
    const second = ghostArrowTexture('take');
    expect(second).not.toBe(first);
    disposeGhostArrowTextures();
  });
});
