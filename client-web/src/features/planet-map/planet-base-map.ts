import type { FogMapView, PlanetOverviewView, PlanetSceneView } from '@shared/types';

import { getFogState, getTerrainTile, type PlanetRenderView } from '@/features/planet-map/model';

/**
 * 行星地图底图画布生成（纯 Canvas 2D，输出小尺寸画布供 Pixi `Texture.from` 转纹理）。
 *
 * 与旧 PlanetMapCanvas 逐格绘制算法对齐，但改为一次性离屏渲染：
 * - 场景模式：1px/tile 的地形画布（确定性明暗抖动 + water/lava 流光带近似）与迷雾画布，
 *   由 Pixi 精灵按 tileSize 放大（地形 nearest 保硬边、迷雾 linear 得软边界）。
 * - overview 模式：1px/cell 合成画布（地形 + 资源/建筑/单位热力 + 迷雾）。
 */

const TERRAIN_RGB: Record<string, readonly [number, number, number]> = {
  buildable: [0x27, 0x34, 0x4d],
  blocked: [0x0f, 0x16, 0x25],
  water: [0x22, 0x5b, 0x87],
  lava: [0x9a, 0x46, 0x24],
  unknown: [0x1a, 0x22, 0x36],
};

/** 明暗抖动/流光带只作用于这些地形（与旧 SHADING_TERRAINS 一致）。 */
const SHADING_TERRAINS = new Set(['water', 'lava', 'buildable', 'blocked']);

const OVERVIEW_HEAT_COLORS = {
  resource: [210, 192, 111],
  building: [36, 201, 182],
  unit: [145, 255, 112],
} as const;

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(width, 1);
  canvas.height = Math.max(height, 1);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('canvas 2d context unavailable');
  }
  return [canvas, context, context.createImageData(canvas.width, canvas.height)];
}

/** 旧 shadeTerrainColor 的亮度系数：基于 (x,y) 的确定性 hash，±0.16。 */
function shadeFactor(x: number, y: number) {
  const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  return 1 + ((((hash % 1000) / 1000) - 0.5) * 0.32);
}

/** 迷雾 alpha 抖动幅度（±）：仅微扰，两档均值契约不变（未探索 0.9 / 已探索 0.44）。 */
const FOG_ALPHA_JITTER = 0.05;

/** 迷雾抖动的确定性 hash：同 (x,y) 必得同值，保证截图可复现。返回 [-1, 1]。 */
function fogJitterFactor(x: number, y: number) {
  const hash = ((x * 2654435761) ^ (y * 40503)) >>> 0;
  return ((hash % 1000) / 1000) * 2 - 1;
}

/**
 * water/lava 流光带的整格近似：旧实现只在格子上沿 40% 画亮/暗带，
 * 1px/tile 纹理无法表达亚格条带，退化为整格 6% 提亮 / 8% 压暗（相位公式保持一致）。
 */
function flowBandMix(y: number): { color: number; amount: number } | null {
  const phase = ((y * 0.5) + Math.floor(y * 0.25)) % 4;
  if (phase === 0) {
    return { color: 255, amount: 0.06 };
  }
  if (phase === 1) {
    return { color: 0, amount: 0.08 };
  }
  return null;
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** 场景模式地形画布：map_width × map_height，1px/tile。 */
export function renderPlanetTerrainCanvas(planet: PlanetRenderView): HTMLCanvasElement {
  const width = planet.map_width;
  const height = planet.map_height;
  const [canvas, context, image] = createCanvas(width, height);
  const pixels = image.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const kind = getTerrainTile(planet, x, y);
      const base = TERRAIN_RGB[kind] ?? TERRAIN_RGB.unknown;
      let r = base[0];
      let g = base[1];
      let b = base[2];
      if (SHADING_TERRAINS.has(kind)) {
        const factor = shadeFactor(x, y);
        r *= factor;
        g *= factor;
        b *= factor;
      }
      if (kind === 'water' || kind === 'lava') {
        const mix = flowBandMix(y);
        if (mix) {
          r += (mix.color - r) * mix.amount;
          g += (mix.color - g) * mix.amount;
          b += (mix.color - b) * mix.amount;
        }
      }
      const offset = (y * width + x) * 4;
      pixels[offset] = clampByte(r);
      pixels[offset + 1] = clampByte(g);
      pixels[offset + 2] = clampByte(b);
      pixels[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 场景模式迷雾画布：map_width × map_height，1px/tile。
 * 未探索 rgba(0,0,0,~0.9)、已探索 rgba(7,11,20,~0.44)、可见透明；
 * 每格 alpha 叠加 ±0.05 的确定性抖动（(x,y) hash 种子，截图可复现），两档均值不变。
 * Pixi 侧用 linear 过滤放大，visible↔不可见 边界自然形成约 1 tile 的软渐变
 * （替代旧实现的径向渐变软边界）。
 */
export function renderPlanetFogCanvas(
  planet: PlanetRenderView,
  fog: FogMapView | PlanetSceneView | undefined,
): HTMLCanvasElement | null {
  if (!fog) {
    return null;
  }
  const width = planet.map_width;
  const height = planet.map_height;
  const [canvas, context, image] = createCanvas(width, height);
  const pixels = image.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const state = getFogState(fog, x, y);
      if (state.visible) {
        continue;
      }
      const jitter = fogJitterFactor(x, y) * FOG_ALPHA_JITTER;
      const offset = (y * width + x) * 4;
      if (state.explored) {
        pixels[offset] = 7;
        pixels[offset + 1] = 11;
        pixels[offset + 2] = 20;
        pixels[offset + 3] = clampByte((0.44 + jitter) * 255);
      } else {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = clampByte((0.9 + jitter) * 255);
      }
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

export interface OverviewLayerFlags {
  terrain: boolean;
  resources: boolean;
  buildings: boolean;
  units: boolean;
  fog: boolean;
}

function heatMax(counts: number[][] | undefined) {
  if (!counts || counts.length === 0) {
    return 0;
  }
  return counts.reduce((best, row) => Math.max(best, ...row), 0);
}

/** src-over 合成一个 rgba 前景到 ImageData 的指定 texel。 */
function blendPixel(pixels: Uint8ClampedArray, offset: number, r: number, g: number, b: number, alpha: number) {
  const inv = 1 - alpha;
  pixels[offset] = clampByte(r * alpha + pixels[offset] * inv);
  pixels[offset + 1] = clampByte(g * alpha + pixels[offset + 1] * inv);
  pixels[offset + 2] = clampByte(b * alpha + pixels[offset + 2] * inv);
  pixels[offset + 3] = clampByte(255 * (alpha + (pixels[offset + 3] / 255) * inv));
}

/** overview 模式合成画布：cells_width × cells_height，1px/cell（地形 + 热力 + 迷雾）。 */
export function renderPlanetOverviewCanvas(
  overview: PlanetOverviewView,
  layers: OverviewLayerFlags,
): HTMLCanvasElement {
  const width = overview.cells_width;
  const height = overview.cells_height;
  const [canvas, context, image] = createCanvas(width, height);
  const pixels = image.data;

  const resourceMax = layers.resources ? heatMax(overview.resource_counts) : 0;
  const buildingMax = layers.buildings ? heatMax(overview.building_counts) : 0;
  const unitMax = layers.units ? heatMax(overview.unit_counts) : 0;

  for (let cellY = 0; cellY < height; cellY += 1) {
    for (let cellX = 0; cellX < width; cellX += 1) {
      const offset = (cellY * width + cellX) * 4;
      if (layers.terrain) {
        const kind = overview.terrain?.[cellY]?.[cellX] ?? 'unknown';
        const base = TERRAIN_RGB[kind] ?? TERRAIN_RGB.unknown;
        pixels[offset] = base[0];
        pixels[offset + 1] = base[1];
        pixels[offset + 2] = base[2];
        pixels[offset + 3] = 255;
      }

      const paintHeat = (counts: number[][] | undefined, max: number, color: readonly [number, number, number]) => {
        const count = counts?.[cellY]?.[cellX] ?? 0;
        if (count <= 0 || max <= 0) {
          return;
        }
        const alpha = 0.18 + (count / max) * 0.55;
        blendPixel(pixels, offset, color[0], color[1], color[2], alpha);
      };
      paintHeat(overview.resource_counts, resourceMax, OVERVIEW_HEAT_COLORS.resource);
      paintHeat(overview.building_counts, buildingMax, OVERVIEW_HEAT_COLORS.building);
      paintHeat(overview.unit_counts, unitMax, OVERVIEW_HEAT_COLORS.unit);

      if (layers.fog) {
        const isVisible = Boolean(overview.visible?.[cellY]?.[cellX]);
        if (!isVisible) {
          const isExplored = Boolean(overview.explored?.[cellY]?.[cellX]);
          if (isExplored) {
            blendPixel(pixels, offset, 7, 11, 20, 0.4);
          } else {
            blendPixel(pixels, offset, 0, 0, 0, 0.86);
          }
        }
      }
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}
