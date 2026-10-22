import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MIX, type MixSettings } from '@/engine/audio';
import { AudioMixSliders } from '@/widgets/TopNav';

/**
 * 设置面板的音量混音（第 23 轮）：五条滑条（主音量/音乐/环境/音效/界面）+ 静音开关。
 * 只测组件契约（滑条存在、数值显示、回调参数），持久化在 engine/audio.test.ts 覆盖。
 */
function renderSliders(overrides: { mix?: Partial<MixSettings>; muted?: boolean } = {}) {
  const mix = { ...DEFAULT_MIX, ...overrides.mix };
  const onChange = vi.fn();
  const onToggleMute = vi.fn();
  render(
    <AudioMixSliders mix={mix} muted={overrides.muted ?? false} onChange={onChange} onToggleMute={onToggleMute} />,
  );
  return { onChange, onToggleMute };
}

describe('AudioMixSliders 音量混音', () => {
  it('五条滑条齐全，按 0–100 显示当前值', () => {
    renderSliders({ mix: { master: 1, music: 0.35, ambient: 0.6, sfx: 1, ui: 0.8 } });
    for (const label of ['主音量', '音乐', '环境', '音效', '界面']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('音乐')).toHaveValue('35');
    expect(screen.getByLabelText('主音量')).toHaveValue('100');
    expect(screen.getByLabelText('界面')).toHaveValue('80');
  });

  it('拖动滑条回传 0..1 的浮点值（按总线区分）', async () => {
    const { onChange } = renderSliders();
    // range 输入在 jsdom 里用 fireEvent.change 更稳
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByLabelText('音乐'), { target: { value: '50' } });
    expect(onChange).toHaveBeenCalledWith('music', 0.5);
    fireEvent.change(screen.getByLabelText('音效'), { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith('sfx', 0);
  });

  it('静音开关反映状态并可切换', async () => {
    const { onToggleMute } = renderSliders({ muted: true });
    const button = screen.getByRole('button', { name: '取消静音' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });
});
