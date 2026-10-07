/**
 * 悬停浮动提示：内容随 hoveredTile（已节流）变化；位置直接写 DOM transform 跟随鼠标，
 * 不触发 React 重渲染。指针事件穿透，不挡地图操作。
 */

import { useEffect, useRef, type RefObject } from 'react';

import type { HoverInfo } from '@/features/planet-map/hover-info';

interface PlanetHoverTipProps {
  info: HoverInfo | null;
  /** 监听 pointermove 的地图容器（提示框相对它定位）。 */
  containerRef: RefObject<HTMLElement | null>;
}

export function PlanetHoverTip({ info, containerRef }: PlanetHoverTipProps) {
  const tipRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const place = () => {
      const tip = tipRef.current;
      const point = pointer.current;
      if (!tip || !point) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      // 默认在光标右下，贴边时翻到另一侧。
      const x = point.x + 16 + tip.offsetWidth > width ? point.x - 12 - tip.offsetWidth : point.x + 16;
      const y = point.y + 18 + tip.offsetHeight > height ? point.y - 10 - tip.offsetHeight : point.y + 18;
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    const move = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      place();
    };
    const leave = () => { pointer.current = null; };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerleave', leave);
    return () => {
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerleave', leave);
    };
  }, [containerRef]);

  useEffect(() => {
    const tip = tipRef.current;
    const point = pointer.current;
    if (!tip || !point || !containerRef.current) return;
    tip.style.transform = `translate(${Math.round(point.x + 16)}px, ${Math.round(point.y + 18)}px)`;
  }, [info, containerRef]);

  if (!info) return null;
  return (
    <div className="planet-hover-tip" ref={tipRef} role="tooltip">
      <strong>{info.title}</strong>
      {info.ownerLabel ? <span className={`planet-hover-tip__owner planet-hover-tip__owner--${info.faction}`}>{info.ownerLabel}</span> : null}
      {info.detail ? <small>{info.detail}</small> : null}
    </div>
  );
}
