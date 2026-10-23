/**
 * 页面级环境声床（第 23 轮 3A 音频，第三轮）：给行星页以外的页面接一条声床。
 *
 * 行星页的声床/配乐由 use-planet-audio-scene 负责；恒星系页与银河页没有 3D 行星场景，
 * 只按页面给「轨道低频」（resolveAmbient page='system'）。离开页面时清空声床，
 * 引擎在 1.5s 内交叉淡化（与行星页互相切换时也是同一套）。
 */

import { useEffect } from 'react';

import { setAmbientLayers, tickAudioLoops } from '@/engine/audio';
import { resolveAmbient, type AudioPage } from '@/features/audio/ambient-music';

/** 声床补起轮询间隔（与行星页场景刷新同频）：采样解码完成后靠它起播。 */
export const PAGE_AMBIENT_POLL_MS = 500;

export interface PageAmbientInput {
  /** 'system' = 轨道低频；'other' = 静默（没有页面级声床）。 */
  page: AudioPage;
  /** 深链/截图冻结时不播（?freeze=1），与行星页同一约定。 */
  frozen?: boolean;
}

export function usePageAmbient({ page, frozen = false }: PageAmbientInput): void {
  useEffect(() => {
    if (frozen) {
      setAmbientLayers([]);
      return undefined;
    }
    const apply = () => {
      setAmbientLayers(resolveAmbient({ page, altitude: 0, runningBuildings: 0 }).layers);
      tickAudioLoops();
    };
    apply();
    const timer = window.setInterval(apply, PAGE_AMBIENT_POLL_MS);
    return () => {
      window.clearInterval(timer);
      setAmbientLayers([]);
    };
  }, [page, frozen]);
}
