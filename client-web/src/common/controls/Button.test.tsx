import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Button } from '@/common/controls/Button';
import { sfx } from '@/engine/audio';

vi.mock('@/engine/audio', () => ({ sfx: { uiClick: vi.fn(), uiHover: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Button 控件音', () => {
  it('点击播 uiClick；silent 时不播', () => {
    const { rerender } = render(<Button>确定</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(sfx.uiClick).toHaveBeenCalledTimes(1);

    rerender(<Button silent>确定</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(sfx.uiClick).toHaveBeenCalledTimes(1);
  });

  it('指针悬停播 uiHover，触屏不播，silentHover 关闭', () => {
    const { rerender } = render(<Button>确定</Button>);
    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' });
    expect(sfx.uiHover).toHaveBeenCalledTimes(1);
    // jsdom 没有 PointerEvent：手动补 pointerType 模拟触屏的 pointerenter。
    const touchEnter = new Event('pointerenter', { bubbles: true });
    Object.defineProperty(touchEnter, 'pointerType', { value: 'touch' });
    fireEvent(screen.getByRole('button'), touchEnter);
    expect(sfx.uiHover).toHaveBeenCalledTimes(1);

    rerender(<Button silentHover>确定</Button>);
    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' });
    expect(sfx.uiHover).toHaveBeenCalledTimes(1);
  });
});
