/**
 * 左下 HUD 竖排图标栏的「顶边距壳底高度」发布器。
 *
 * 调试面板要浮在图标栏**上方**（§3.2 复核：调试不再是顶部一个突兀的文字按钮，
 * 而是图标栏里的一格 + 浮在栏上的面板）。栏高随 2D/3D 与视口变化，
 * 写死偏移会在 3D（栏底边 150px）或窄屏下把面板压到图标上。
 *
 * 这里把实测值写进 :root 的 --planet-hud-rail-top，面板用
 * `bottom: calc(var(--planet-hud-rail-top) + 8px)` 定位；没有实测值时面板退回默认位置。
 */

import { useEffect, type RefObject } from 'react';

export const HUD_RAIL_TOP_VAR = '--planet-hud-rail-top';

export function useHudRailTop(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []) {
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const publish = () => {
      const shell = element.closest('.planet-map-shell');
      if (!shell) {
        return;
      }
      const top = shell.getBoundingClientRect().bottom - element.getBoundingClientRect().top;
      document.documentElement.style.setProperty(HUD_RAIL_TOP_VAR, `${Math.round(top)}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
