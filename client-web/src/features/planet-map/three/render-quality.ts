export type PlanetRenderQuality = 'low' | 'balanced' | 'high';

export function parseRenderQuality(value: string | null): PlanetRenderQuality {
  return value === 'low' || value === 'high' ? value : 'balanced';
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
