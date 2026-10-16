import { describe, expect, it } from 'vitest';

import { describePickNotice, offscreenPickNotice, PICK_MISS_NOTICE } from './pick-feedback';

describe('3D 点选落空反馈（试玩 1016 B4）', () => {
  it('视口外目标格：提示里带坐标，并说明镜头已移动', () => {
    const notice = offscreenPickNotice({ x: 60.4, y: 145.6 });
    expect(notice).toEqual({ kind: 'offscreen', tile: { x: 60, y: 146 } });
    expect(describePickNotice(notice)).toBe('目标格 (60, 146) 不在视野内，已移动镜头');
  });

  it('点不到星球表面：给可执行的下一步，而不是静默', () => {
    expect(describePickNotice(PICK_MISS_NOTICE)).toContain('不在星球表面');
    expect(describePickNotice(PICK_MISS_NOTICE)).not.toBe(describePickNotice(offscreenPickNotice({ x: 1, y: 2 })));
  });

  it('坐标取整后再显示：与 tile 坐标系一致（不出现小数）', () => {
    expect(describePickNotice(offscreenPickNotice({ x: 0.2, y: 0.8 }))).toContain('(0, 1)');
  });
});
