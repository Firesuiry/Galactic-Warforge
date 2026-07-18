import { useEffect, useMemo, useRef } from "react";

import type { FogMapView, PlanetOverviewView, PlanetSceneView } from "@shared/types";
import { useShallow } from "zustand/react/shallow";

import {
  getFogState,
  getTerrainTile,
  getViewportTileBounds,
  type PlanetRenderView,
  type ViewportTileBounds,
  wrapMod,
} from "@/features/planet-map/model";
import { usePlanetViewStore } from "@/features/planet-map/store";

/**
 * PlanetMinimap：浮在地图右下角的全图缩略图（V2 布局）。
 *
 * 数据来源：
 * - 地形/迷雾：复用主场景 planet/fog 的全图 terrain/visible/explored（始终可用）。
 * - 密度热力：当 overview（overviewQuery）存在时叠加资源/建筑/单位密度点。
 * - 视口矩形：由 store 的 mapProjection（主画布像素视口 + tile 边长）+ camera 计算。
 *
 * 交互：点击缩略图 → requestFocus(tile)，相机居中到该 tile（scene 模式保持缩放，overview 模式放大进入）。
 *
 * 隔离：本组件渲染在 PlanetPage（.planet-map-shell 内），独立 canvas，
 * 不参与 PlanetMapPixi 的拖拽热路径。
 * 底图（地形+迷雾）缓存到离屏 canvas，仅在 planet/fog/overview 变化时重建；
 * 相机移动只触发"清屏 + 贴底图 + 画视口框"（3 次调用），极轻量。
 */

interface PlanetMinimapProps {
  planet: PlanetRenderView;
  fog?: FogMapView | PlanetSceneView;
  overview?: PlanetOverviewView;
}

const MINI_CSS = 152;

const terrainColors: Record<string, string> = {
  buildable: "#27344d",
  blocked: "#0f1625",
  water: "#225b87",
  lava: "#9a4624",
  unknown: "#1a2236",
};

/** 迷雾叠加 alpha（与主地图一致：未探索近全黑，已探索未可见半暗）。 */
const FOG_UNEXPLORED_ALPHA = 0.86;
const FOG_EXPLORED_ALPHA = 0.42;

function terrainFill(tile: string): string {
  return terrainColors[tile] ?? terrainColors.unknown;
}

/** 把 #rrggbb 叠加一层黑色（按 alpha 混合到近黑），用于迷雾压暗地形。 */
function darken(hex: string, alpha: number): string {
  let h = hex;
  if (h.startsWith("#")) {
    h = h.slice(1);
  }
  if (h.length !== 6) {
    return h;
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return hex;
  }
  const mix = 1 - alpha;
  return `rgb(${Math.round(r * mix)}, ${Math.round(g * mix)}, ${Math.round(b * mix)})`;
}

interface MinimapLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
}

function computeLayout(mapWidth: number, mapHeight: number): MinimapLayout {
  const scale = Math.min(MINI_CSS / Math.max(mapWidth, 1), MINI_CSS / Math.max(mapHeight, 1));
  const drawWidth = mapWidth * scale;
  const drawHeight = mapHeight * scale;
  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (MINI_CSS - drawWidth) / 2,
    offsetY: (MINI_CSS - drawHeight) / 2,
  };
}

export function PlanetMinimap({ planet, fog, overview }: PlanetMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const { camera, mapProjection, requestFocus } = usePlanetViewStore(
    useShallow((state) => ({
      camera: state.camera,
      mapProjection: state.mapProjection,
      requestFocus: state.requestFocus,
    })),
  );

  const mapWidth = planet.map_width;
  const mapHeight = planet.map_height;
  const layout = useMemo(
    () => computeLayout(mapWidth, mapHeight),
    [mapWidth, mapHeight],
  );

  // 视口矩形（tile 范围）；主画布尚未上报投影时不绘制。
  const viewportBounds: ViewportTileBounds | null = useMemo(() => {
    if (
      !camera.ready
      || mapProjection.tileSize <= 0
      || mapProjection.viewportWidth <= 0
      || mapProjection.viewportHeight <= 0
    ) {
      return null;
    }
    return getViewportTileBounds(
      planet,
      camera,
      mapProjection.tileSize,
      mapProjection.viewportWidth,
      mapProjection.viewportHeight,
    );
  }, [camera, mapProjection, planet]);

  // 底图（地形 + 迷雾 + overview 密度）缓存：仅在 planet/fog/overview 变化时重建。
  useEffect(() => {
    if (mapWidth <= 0 || mapHeight <= 0) {
      return;
    }
    const canvas = baseCanvasRef.current ?? document.createElement("canvas");
    baseCanvasRef.current = canvas;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(MINI_CSS * dpr));
    canvas.height = Math.max(1, Math.floor(MINI_CSS * dpr));
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, MINI_CSS, MINI_CSS);
    // 太空底
    context.fillStyle = "#05080f";
    context.fillRect(0, 0, MINI_CSS, MINI_CSS);

    const { scale, offsetX, offsetY } = layout;
    // 采样步长：每个 block 覆盖约 1px（scale 通常 < 1，stride 放大采样间隔以控制绘制量）。
    const stride = Math.max(1, Math.floor(1 / scale));
    const block = Math.max(scale * stride, 0.75);

    for (let ty = 0; ty < mapHeight; ty += stride) {
      for (let tx = 0; tx < mapWidth; tx += stride) {
        const tile = getTerrainTile(planet, tx, ty);
        const fogState = getFogState(fog, tx, ty);
        let fill = terrainFill(tile);
        if (!fogState.visible) {
          fill = darken(fill, fogState.explored ? FOG_EXPLORED_ALPHA : FOG_UNEXPLORED_ALPHA);
        }
        context.fillStyle = fill;
        context.fillRect(
          offsetX + tx * scale,
          offsetY + ty * scale,
          block,
          block,
        );
      }
    }

    // overview 密度热力（资源/建筑/单位），有 overview 时叠加细点。
    if (overview) {
      const cellsW = overview.cells_width || 0;
      const cellsH = overview.cells_height || 0;
      const step = Math.max(overview.step || 1, 1);
      const cellPx = Math.max(scale * step, 1.25);
      const drawDensity = (counts: number[][] | undefined, color: string) => {
        if (!counts || counts.length === 0) {
          return;
        }
        const max = counts.reduce((best, row) => Math.max(best, ...row), 0);
        if (max <= 0) {
          return;
        }
        for (let cy = 0; cy < cellsH; cy += 1) {
          for (let cx = 0; cx < cellsW; cx += 1) {
            const value = counts[cy]?.[cx] ?? 0;
            if (value <= 0) {
              continue;
            }
            context.globalAlpha = 0.25 + (value / max) * 0.55;
            context.fillStyle = color;
            context.fillRect(
              offsetX + cx * cellPx,
              offsetY + cy * cellPx,
              Math.max(cellPx - 0.5, 1),
              Math.max(cellPx - 0.5, 1),
            );
          }
        }
        context.globalAlpha = 1;
      };
      drawDensity(overview.resource_counts, "#d2c06f");
      drawDensity(overview.building_counts, "#2bd6c6");
      drawDensity(overview.unit_counts, "#91ff70");
    }

    // 全图边框
    context.strokeStyle = "rgba(57, 230, 208, 0.35)";
    context.lineWidth = 1;
    context.strokeRect(offsetX + 0.5, offsetY + 0.5, layout.drawWidth - 1, layout.drawHeight - 1);
  }, [fog, layout, mapHeight, mapWidth, overview, planet]);

  // 主层：清屏 → 贴底图 → 画当前视口框。相机移动时触发（极轻量）。
  useEffect(() => {
    const canvas = canvasRef.current;
    const base = baseCanvasRef.current;
    if (!canvas || !base) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, MINI_CSS, MINI_CSS);
    context.drawImage(base, 0, 0, MINI_CSS, MINI_CSS);

    if (!viewportBounds) {
      return;
    }
    const { scale, offsetX, offsetY } = layout;
    // 环绕轴上可见范围可能跨接缝（minX<0 或 maxX≥map），拆成轴向上的 1~2 段，
    // 两轴组合出最多 4 个矩形，保证视口框在小地图上形状正确。
    const axisSegments = (min: number, max: number, mapSize: number, wrap: boolean) => {
      if (!wrap || mapSize <= 0) {
        return [[Math.max(min, 0), Math.min(max, mapSize - 1)] as const];
      }
      const start = wrapMod(min, mapSize);
      const span = max - min;
      const first: readonly [number, number] = [start, Math.min(start + span, mapSize - 1)];
      const remainder = span - (first[1] - start);
      return remainder > 0 ? [first, [0, remainder - 1] as const] : [first];
    };
    const segmentsX = axisSegments(viewportBounds.minX, viewportBounds.maxX, mapWidth, viewportBounds.wrapX ?? false);
    const segmentsY = axisSegments(viewportBounds.minY, viewportBounds.maxY, mapHeight, viewportBounds.wrapY ?? false);

    // 视口框：半透明填充 + accent 描边 + 四角直角强调
    for (const [minX, maxX] of segmentsX) {
      for (const [minY, maxY] of segmentsY) {
        const rectX = offsetX + minX * scale;
        const rectY = offsetY + minY * scale;
        const rectW = Math.max((maxX - minX + 1) * scale, 2);
        const rectH = Math.max((maxY - minY + 1) * scale, 2);
        context.fillStyle = "rgba(57, 230, 208, 0.12)";
        context.fillRect(rectX, rectY, rectW, rectH);
        context.strokeStyle = "#39e6d0";
        context.lineWidth = 1.25;
        context.strokeRect(rectX + 0.5, rectY + 0.5, rectW - 1, rectH - 1);
      }
    }
  }, [layout, mapHeight, mapWidth, viewportBounds]);

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (mapWidth <= 0 || mapHeight <= 0) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const px = ((event.clientX - rect.left) / rect.width) * MINI_CSS;
    const py = ((event.clientY - rect.top) / rect.height) * MINI_CSS;
    const { scale, offsetX, offsetY } = layout;
    const tx = Math.floor((px - offsetX) / scale);
    const ty = Math.floor((py - offsetY) / scale);
    if (tx < 0 || ty < 0 || tx >= mapWidth || ty >= mapHeight) {
      return;
    }
    requestFocus({ x: tx, y: ty });
  }

  if (mapWidth <= 0 || mapHeight <= 0) {
    return null;
  }

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const devSize = Math.floor(MINI_CSS * dpr);

  return (
    <div
      className="planet-minimap"
      aria-hidden={false}
      data-camera-zoom-index={camera.zoomIndex}
    >
      <canvas
        aria-label="行星缩略地图"
        className="planet-minimap__canvas"
        height={devSize}
        onClick={handleClick}
        ref={canvasRef}
        role="img"
        width={devSize}
      />
      <span className="planet-minimap__label">缩略</span>
    </div>
  );
}
