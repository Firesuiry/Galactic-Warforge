export type PlanetRenderQuality = 'low' | 'balanced' | 'high';

/** 画质档位的持久化键（PlanetMapThree 的下拉与音频预载共用）。 */
export const RENDER_QUALITY_STORAGE_KEY = 'siliconworld-planet-quality';

export function parseRenderQuality(value: string | null): PlanetRenderQuality {
  return value === 'low' || value === 'high' ? value : 'balanced';
}

/**
 * 当前画质档位：URL `?quality=`（深链截图）优先，其次 localStorage，缺省 balanced。
 * 唯一定义处（PlanetMapThree 与 features/audio/quality 都读这里）。
 */
export function readPlanetRenderQuality(): PlanetRenderQuality {
  if (typeof window === 'undefined') return 'balanced';
  const query = new URLSearchParams(window.location.search).get('quality');
  if (query === 'low' || query === 'balanced' || query === 'high') return query;
  try {
    const saved = window.localStorage.getItem(RENDER_QUALITY_STORAGE_KEY);
    if (saved === 'low' || saved === 'balanced' || saved === 'high') return saved;
  } catch {
    // 隐私模式下 localStorage 不可用：按缺省档
  }
  return 'balanced';
}

/** Bound offscreen color/depth memory on dense displays, especially mobile. */
export function renderQualitySettings(quality: PlanetRenderQuality, width: number, devicePixelRatio: number, maxSamples: number) {
  const compact = width < 768;
  const pixelRatioCap = quality === 'high' ? 2 : quality === 'low' ? 1 : compact ? 1.25 : 1.75;
  const samples = quality === 'low' ? 0 : compact && quality === 'balanced' ? 2 : 4;
  return {
    pixelRatio: Math.min(Math.max(1, devicePixelRatio || 1), pixelRatioCap),
    samples: Math.max(0, Math.min(samples, maxSamples)),
    shadowMapSize: quality === 'high' ? 4096 : quality === 'low' || compact ? 1024 : 2048,
    bloom: quality !== 'low',
  };
}
