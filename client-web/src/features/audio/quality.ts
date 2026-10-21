/**
 * 画质档位对音频的影响（第 23 轮 3A 音频，第二轮步骤 14）。
 *
 * `render-quality.ts` 归光照分支所有（见 3A 画质文档 §7），音频分支不改它，
 * 只按同一份存储键 / 查询参数读档位：
 * - low：不预载配乐，进入对应配乐状态时再懒加载（省常驻解码内存）；
 * - balanced / high：行星页挂载时预载三首配乐，切状态不出现「先静音再淡入」。
 */

import type { PlanetRenderQuality } from '@/features/planet-map/three/render-quality';

/** 与 PlanetMapThree 的画质选择同一个键（`siliconworld-planet-quality`）。 */
export const AUDIO_QUALITY_STORAGE_KEY = 'siliconworld-planet-quality';

/** 当前画质档位（URL `?quality=` 优先，其次 localStorage，缺省 balanced）。 */
export function readAudioQuality(): PlanetRenderQuality {
  if (typeof window === 'undefined') return 'balanced';
  const query = new URLSearchParams(window.location.search).get('quality');
  if (query === 'low' || query === 'balanced' || query === 'high') return query;
  try {
    const saved = window.localStorage.getItem(AUDIO_QUALITY_STORAGE_KEY);
    if (saved === 'low' || saved === 'balanced' || saved === 'high') return saved;
  } catch {
    // 隐私模式下 localStorage 不可用：按缺省档
  }
  return 'balanced';
}

/** 该档位是否在页面挂载时预载配乐（low 档懒加载）。 */
export function shouldPreloadMusic(quality: PlanetRenderQuality): boolean {
  return quality !== 'low';
}
