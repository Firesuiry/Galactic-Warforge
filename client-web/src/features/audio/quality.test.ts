import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIO_QUALITY_STORAGE_KEY, readAudioQuality, shouldPreloadMusic } from '@/features/audio/quality';
import { RENDER_QUALITY_STORAGE_KEY } from '@/features/planet-map/three/render-quality';

describe('readAudioQuality 画质档位', () => {
  it('与行星 3D 共用同一个存储键（只此一处定义）', () => {
    expect(AUDIO_QUALITY_STORAGE_KEY).toBe(RENDER_QUALITY_STORAGE_KEY);
  });

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('缺省 balanced', () => {
    expect(readAudioQuality()).toBe('balanced');
  });

  it('localStorage 优先于缺省；非法值忽略', () => {
    localStorage.setItem(AUDIO_QUALITY_STORAGE_KEY, 'low');
    expect(readAudioQuality()).toBe('low');
    localStorage.setItem(AUDIO_QUALITY_STORAGE_KEY, 'ultra');
    expect(readAudioQuality()).toBe('balanced');
  });

  it('URL ?quality= 优先于 localStorage（深链截图）', () => {
    localStorage.setItem(AUDIO_QUALITY_STORAGE_KEY, 'low');
    window.history.replaceState({}, '', '/planet?quality=high');
    expect(readAudioQuality()).toBe('high');
  });

  it('low 档不预载配乐，balanced / high 预载', () => {
    expect(shouldPreloadMusic('low')).toBe(false);
    expect(shouldPreloadMusic('balanced')).toBe(true);
    expect(shouldPreloadMusic('high')).toBe(true);
  });
});
