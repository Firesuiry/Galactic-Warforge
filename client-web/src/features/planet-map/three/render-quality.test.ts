import { parseRenderQuality, renderQualitySettings } from './render-quality';

describe('planet rendering budget', () => {
  it('falls back to balanced for absent or invalid saved settings', () => {
    expect(parseRenderQuality(null)).toBe('balanced');
    expect(parseRenderQuality('ultra')).toBe('balanced');
    expect(parseRenderQuality('high')).toBe('high');
  });

  it('caps mobile offscreen pixel count while preserving multisample antialiasing', () => {
    const mobile = renderQualitySettings('balanced', 390, 3, 4);
    expect(mobile).toEqual({ pixelRatio: 1.25, samples: 2, shadowMapSize: 1024, bloom: true });
    expect(renderQualitySettings('balanced', 1920, 3, 4).samples).toBe(4);
  });

  it('respects hardware sample limits and keeps high resolution explicitly opt-in', () => {
    expect(renderQualitySettings('high', 390, 3, 2)).toEqual({ pixelRatio: 2, samples: 2, shadowMapSize: 4096, bloom: true });
    expect(renderQualitySettings('high', 1920, 1, 0).samples).toBe(0);
    expect(renderQualitySettings('low', 1920, 3, 4)).toEqual({ pixelRatio: 1, samples: 0, shadowMapSize: 1024, bloom: false });
  });
});
