import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 页面级声床（第三轮 M1）：恒星系页 / 银河页给轨道低频，离开页面清空（引擎 1.5s 淡出）。
 * engine 全部 mock，只断言「页面 → 声床层」的接线。
 */
const audio = vi.hoisted(() => ({
  setAmbientLayers: vi.fn(),
  tickAudioLoops: vi.fn(),
}));

vi.mock('@/engine/audio', () => audio);

import { PAGE_AMBIENT_POLL_MS, usePageAmbient } from '@/features/audio/use-page-ambient';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePageAmbient 页面声床', () => {
  it('恒星系页给轨道低频，并轮询补起（采样解码完成后起播）', () => {
    vi.useFakeTimers();
    try {
      renderHook(() => usePageAmbient({ page: 'system' }));
      expect(audio.setAmbientLayers).toHaveBeenCalledWith([{ name: 'space', level: 1 }]);
      const before = audio.tickAudioLoops.mock.calls.length;
      vi.advanceTimersByTime(PAGE_AMBIENT_POLL_MS);
      expect(audio.tickAudioLoops.mock.calls.length).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('卸载清空声床（引擎交叉淡化到无声）', () => {
    const { unmount } = renderHook(() => usePageAmbient({ page: 'system' }));
    unmount();
    expect(audio.setAmbientLayers).toHaveBeenLastCalledWith([]);
  });

  it('frozen（?freeze=1）不播', () => {
    renderHook(() => usePageAmbient({ page: 'system', frozen: true }));
    expect(audio.setAmbientLayers).toHaveBeenCalledWith([]);
    expect(audio.tickAudioLoops).not.toHaveBeenCalled();
  });

  it('other 页静默', () => {
    renderHook(() => usePageAmbient({ page: 'other' }));
    expect(audio.setAmbientLayers).toHaveBeenCalledWith([]);
  });
});
