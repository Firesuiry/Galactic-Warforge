export type PlanetRenderQuality = 'low' | 'balanced' | 'high';

export function parseRenderQuality(value: string | null): PlanetRenderQuality {
  return value === 'low' || value === 'high' ? value : 'balanced';
}

/** 环境光遮蔽：off 不渲染 GTAO；half = 半分辨率（降采样后合成）；full = 全分辨率。 */
export type AmbientOcclusion = 'off' | 'half' | 'full';

export interface PlanetRenderSettings {
  pixelRatio: number;
  samples: number;
  shadowMapSize: number;
  bloom: boolean;
  /** 环境光遮蔽档位（第 23 轮 3A 画质）：low 关、balanced 半分辨率、high 全分辨率。 */
  ao: AmbientOcclusion;
  /** 调色 pass（lift/gamma/gain、饱和、对比、分离色调、暗角、颗粒）：三档都开。 */
  grade: boolean;
  /** 太阳镜头光晕：只有 high 开。 */
  flare: boolean;
  /** 软阴影：low 用硬阴影（PCF），balanced/high 用 VSM（带半径模糊）。 */
  softShadows: boolean;
  /** 天空 IBL 的 PMREM 立方体边长（low 128、balanced 256、high 512）。 */
  envSize: number;
}

/**
 * Bound offscreen color/depth memory on dense displays, especially mobile.
 *
 * 第 23 轮 3A 画质把「便宜但出效果」的项（天空、雾、调色、软阴影）放在三档都开，
 * 只砍开销大的项（GTAO 分辨率、光晕、IBL 分辨率、MSAA、像素比）。
 */
export function renderQualitySettings(quality: PlanetRenderQuality, width: number, devicePixelRatio: number, maxSamples: number): PlanetRenderSettings {
  const compact = width < 768;
  const pixelRatioCap = quality === 'high' ? 2 : quality === 'low' ? 1 : compact ? 1.25 : 1.75;
  const samples = quality === 'low' ? 0 : compact && quality === 'balanced' ? 2 : 4;
  return {
    pixelRatio: Math.min(Math.max(1, devicePixelRatio || 1), pixelRatioCap),
    samples: Math.max(0, Math.min(samples, maxSamples)),
    shadowMapSize: quality === 'high' ? 4096 : quality === 'low' || compact ? 1024 : 2048,
    bloom: quality !== 'low',
    ao: quality === 'low' ? 'off' : quality === 'high' ? 'full' : 'half',
    grade: true,
    flare: quality === 'high',
    // 三档都开软阴影：PCFSoft 在低档也只是阴影贴图采样，开销可忽略（阴影贴图尺寸已按档位降）。
    softShadows: true,
    envSize: quality === 'high' ? 512 : quality === 'low' ? 128 : 256,
  };
}
