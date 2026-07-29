/**
 * MiniGalaxyMap：总览页左栏的 mini 星图（纯 Canvas2D，不嵌 Pixi）。
 *
 * - 数据复用星图模型（galaxyWorldRect / computeSystemLanes / starColorOf），
 *   把恒星系画成发光点阵 + 星座连线，活跃行星所在恒星系加 accent 环。
 * - 纯静态绘制：无动画、无随机（布局由确定性哈希/近邻规则决定），截图稳定。
 * - 画布随容器尺寸与 DPR 重绘；jsdom 等无布局环境下（clientWidth=0）静默跳过。
 */

import { useEffect, useRef } from 'react';

import type { GalaxyView, SystemRef } from '@shared/types';

import {
  computeSystemLanes,
  galaxyWorldRect,
  starColorOf,
} from '@/features/starmap/model';

const ACCENT_CSS = '#39e6d0';

export interface MiniGalaxyMapProps {
  galaxy: GalaxyView | undefined;
  /** 活跃行星所在恒星系（画 accent 定位环）；未知时传 null。 */
  activeSystemId?: string | null;
}

function starCssColor(system: SystemRef): string {
  const starType = typeof system.star?.type === 'string' ? system.star.type : undefined;
  return `#${starColorOf(starType).toString(16).padStart(6, '0')}`;
}

/** 银河世界坐标 → canvas 坐标投影：保持长宽比 fit 并居中。 */
export function projectGalaxyPoint(
  galaxy: GalaxyView,
  width: number,
  height: number,
): (x: number, y: number) => [number, number] {
  const rect = galaxyWorldRect(galaxy);
  const scale = Math.min(width / rect.width, height / rect.height);
  const offsetX = (width - rect.width * scale) / 2;
  const offsetY = (height - rect.height * scale) / 2;
  return (x, y) => [
    offsetX + (x - rect.x) * scale,
    offsetY + (y - rect.y) * scale,
  ];
}

export function drawMiniGalaxy(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  galaxy: GalaxyView | undefined,
  activeSystemId?: string | null,
): void {
  ctx.clearRect(0, 0, width, height);
  const systems = (galaxy?.systems ?? []).filter((system) => system.position);
  if (!galaxy || systems.length === 0) {
    return;
  }
  const project = projectGalaxyPoint(galaxy, width, height);

  // 星座连线（与星图同一 k 近邻规则）
  ctx.strokeStyle = 'rgba(57, 230, 208, 0.12)';
  ctx.lineWidth = 1;
  computeSystemLanes(systems).forEach((lane) => {
    const [x1, y1] = project(lane.from.x, lane.from.y);
    const [x2, y2] = project(lane.to.x, lane.to.y);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  // 恒星发光点阵：radial 光晕 + 实心星点；未探明星系压暗
  systems.forEach((system) => {
    const position = system.position!;
    const [x, y] = project(position.x, position.y);
    const color = starCssColor(system);
    ctx.globalAlpha = system.discovered ? 1 : 0.35;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, 7);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, system.discovered ? 2.4 : 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // 活跃行星所在恒星系：accent 定位环
  if (activeSystemId) {
    const active = systems.find((system) => system.system_id === activeSystemId);
    if (active?.position) {
      const [x, y] = project(active.position.x, active.position.y);
      ctx.strokeStyle = ACCENT_CSS;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export function MiniGalaxyMap({ galaxy, activeSystemId }: MiniGalaxyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMiniGalaxy(ctx, width, height, galaxy, activeSystemId);
    };

    draw();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => draw());
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [galaxy, activeSystemId]);

  return <canvas ref={canvasRef} className="mini-galaxy-map" aria-hidden="true" />;
}
