import { useLayoutEffect, type RefObject } from 'react';

/**
 * 把语义实体层容器随相机做变换，**不触发 React 重渲染**。
 *
 * 实体节点用 tile 空间定位（`left/top/width/height: calc(var(--tile) * N)`），平移与缩放只改这个容器：
 * - 平移：写 `transform: translate(offsetX, offsetY)`（GPU 合成，零 layout、零 React 提交）。
 * - 缩放：写 `--tile` CSS 变量（一次 style 重算，节点尺寸随之变化）。
 *
 * 用 useLayoutEffect 在浏览器绘制前同步写入，避免首帧错位闪烁。
 * 实体层是 pointer-events:none 的只读语义层，命中检测仍走 canvas 的 pointToTile。
 */
export function useImperativeCameraTransform(
  layerRef: RefObject<HTMLDivElement | null>,
  offsetX: number,
  offsetY: number,
  tileSize: number,
) {
  useLayoutEffect(() => {
    const el = layerRef.current;
    if (!el) {
      return;
    }
    el.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    el.style.setProperty('--tile', `${tileSize}px`);
  }, [layerRef, offsetX, offsetY, tileSize]);
}
