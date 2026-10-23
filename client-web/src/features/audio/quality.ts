/**
 * 画质档位对音频的影响（第 23 轮 3A 音频，第二轮步骤 14）。
 *
 * 档位读取复用行星 3D 的 `readPlanetRenderQuality`（`?quality=` → localStorage →
 * balanced），音频分支不再自己复刻一份读取逻辑；`render-quality.ts` 归光照分支，
 * 不改它，只在 PlanetMapThree 里把读取函数导出复用。
 * - low：不预载配乐，进入对应配乐状态时再懒加载（省常驻解码内存）；
 * - balanced / high：行星页挂载时预载三首配乐，切状态不出现「先静音再淡入」。
 */

import {
  readPlanetRenderQuality,
  type PlanetRenderQuality,
} from '@/features/planet-map/three/render-quality';

/** 与 PlanetMapThree 的画质选择同一个键（`siliconworld-planet-quality`）。 */
export const AUDIO_QUALITY_STORAGE_KEY = 'siliconworld-planet-quality';

/** 当前画质档位（URL `?quality=` 优先，其次 localStorage，缺省 balanced）。 */
export function readAudioQuality(): PlanetRenderQuality {
  return readPlanetRenderQuality();
}

/** 该档位是否在页面挂载时预载配乐（low 档懒加载）。 */
export function shouldPreloadMusic(quality: PlanetRenderQuality): boolean {
  return quality !== 'low';
}
