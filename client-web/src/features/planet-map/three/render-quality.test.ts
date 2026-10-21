import { parseRenderQuality, renderQualitySettings } from './render-quality';

describe('planet rendering budget', () => {
  it('falls back to balanced for absent or invalid saved settings', () => {
    expect(parseRenderQuality(null)).toBe('balanced');
    expect(parseRenderQuality('ultra')).toBe('balanced');
    expect(parseRenderQuality('high')).toBe('high');
  });

  it('caps mobile offscreen pixel count while preserving multisample antialiasing', () => {
    const mobile = renderQualitySettings('balanced', 390, 3, 4);
    expect(mobile).toEqual({
      pixelRatio: 1.25, samples: 2, shadowMapSize: 1024, bloom: true,
      ao: 'half', grade: true, flare: false, softShadows: true, envSize: 256,
    });
    expect(renderQualitySettings('balanced', 1920, 3, 4).samples).toBe(4);
  });

  it('respects hardware sample limits and keeps high resolution explicitly opt-in', () => {
    expect(renderQualitySettings('high', 390, 3, 2)).toEqual({
      pixelRatio: 2, samples: 2, shadowMapSize: 4096, bloom: true,
      ao: 'full', grade: true, flare: true, softShadows: true, envSize: 512,
    });
    expect(renderQualitySettings('high', 1920, 1, 0).samples).toBe(0);
    expect(renderQualitySettings('low', 1920, 3, 4)).toEqual({
      pixelRatio: 1, samples: 0, shadowMapSize: 1024, bloom: false,
      ao: 'off', grade: true, flare: false, softShadows: true, envSize: 128,
    });
  });

  it('第 23 轮：low 档也要有天空、雾、调色（便宜的效果三档都开）', () => {
    for (const quality of ['low', 'balanced', 'high'] as const) {
      const settings = renderQualitySettings(quality, 1200, 1, 4);
      expect(settings.grade).toBe(true);
      expect(settings.softShadows).toBe(true);
    }
    // 贵的效果按档位递进。
    expect(renderQualitySettings('low', 1200, 1, 4).ao).toBe('off');
    expect(renderQualitySettings('balanced', 1200, 1, 4).ao).toBe('half');
    expect(renderQualitySettings('high', 1200, 1, 4).ao).toBe('full');
    expect(renderQualitySettings('balanced', 1200, 1, 4).flare).toBe(false);
    expect(renderQualitySettings('high', 1200, 1, 4).flare).toBe(true);
  });
});
