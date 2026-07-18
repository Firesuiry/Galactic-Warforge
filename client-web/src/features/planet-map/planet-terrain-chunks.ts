import { getTerrainTile, wrapMod, type PlanetRenderView } from '@/features/planet-map/model';
import { SHADING_TERRAINS, TERRAIN_RGB, shadeFactor } from '@/features/planet-map/planet-base-map';

/**
 * 行星地表分块高分辨率渲染（scene 模式，tileSize ≥ 4 时启用）。
 *
 * - 世界按 64×64 tile 切块，每块按 8px/tile 烘焙成 canvas（满块 512×512px，
 *   地图边缘的残块按实际 tile 数收窄），Pixi 侧 Texture → Sprite 拼入 world 容器。
 * - 只生成可见区域（含 1 圈余量）的块；LRU 上限 64 块，逐出时销毁纹理；
 *   地形数据变化按块签名（FNV-1a 变体 hash）标记脏重生成。
 * - 每格 8×8px 内的噪色/生态过渡全部确定性（(x,y,px,py) hash 种子），截图可复现：
 *   基底沿用 planet-base-map 色板 + 明暗抖动，叠加亚像素细噪；水岸泡沫按边过渡
 *   （只在水格与陆格相邻的边画，水-水边无缝融合，大片水域内部均匀只有轮廓有岸线）、
 *   岩浆发光描边与暗壳、blocked 隆起浮雕只查 4 邻居，纯函数可测。
 * - 1px/2px 档（有效 tileSize < 4）与 overview 模式维持 planet-base-map 的低成本整图画布。
 */

/** chunk 边长（tile 数）。 */
export const TERRAIN_CHUNK_TILES = 64;
/** chunk 内每 tile 的烘焙像素数。 */
export const TERRAIN_CHUNK_TILE_PX = 8;
/** LRU 缓存上限（块）。 */
export const TERRAIN_CHUNK_CACHE_LIMIT = 64;
/** 每帧惰性补块上限（拖拽时防卡顿；frozen 模式不受限，一次性补齐保证截图确定）。 */
export const TERRAIN_CHUNK_BUILD_BUDGET_PER_FRAME = 2;
/** 启用分块路径的最低有效 tileSize（MAX_PLANET_SCENE_TILES_PER_AXIS=320 保证可见块数 ≤ 7×7 < 缓存上限）。 */
export const TERRAIN_CHUNK_MIN_TILE_SIZE = 4;
/** 可见块集合外扩的余量圈数。 */
export const TERRAIN_CHUNK_MARGIN = 1;

/** scene 模式且有效 tileSize 足够时走分块路径。 */
export function useChunkedTerrain(overviewMode: boolean, tileSize: number) {
  return !overviewMode && tileSize >= TERRAIN_CHUNK_MIN_TILE_SIZE;
}

export function chunkKey(cx: number, cy: number) {
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): readonly [number, number] {
  const [cx, cy] = key.split(',').map(Number);
  return [cx, cy] as const;
}

/** 单轴 chunk 数（0 尺寸的轴没有 chunk）。 */
export function chunkCountAxis(mapTiles: number) {
  return mapTiles > 0 ? Math.ceil(mapTiles / TERRAIN_CHUNK_TILES) : 0;
}

/** chunk 在单轴上覆盖的 tile 数（地图边缘残块收窄）。 */
export function chunkSpanAxis(origin: number, mapTiles: number) {
  return Math.max(Math.min(TERRAIN_CHUNK_TILES, mapTiles - origin), 0);
}

export interface TerrainChunkVisibilityInput {
  mapWidth: number;
  mapHeight: number;
  /** 相机（world 容器）偏移，px。 */
  offsetX: number;
  offsetY: number;
  tileSize: number;
  viewportWidth: number;
  viewportHeight: number;
  /** 可见范围外扩的余量圈数（默认 TERRAIN_CHUNK_MARGIN）。 */
  margin?: number;
  /** 环绕轴：该轴 chunk 不钳进地图，取样按 mod 回绕（渲染接缝另一侧的内容）。 */
  wrapX?: boolean;
  wrapY?: boolean;
}

/** 单轴可见 chunk 区间：环绕轴不钳（unwrapped），非环绕轴钳进地图（无交集返回 null）。 */
function visibleChunkRangeAxis(rawMin: number, rawMax: number, mapTiles: number, wrap: boolean) {
  if (wrap) {
    return { min: rawMin, max: rawMax };
  }
  const maxChunk = chunkCountAxis(mapTiles) - 1;
  if (rawMax < 0 || rawMin > maxChunk) {
    return null;
  }
  const min = Math.min(Math.max(rawMin, 0), maxChunk);
  const max = Math.min(Math.max(rawMax, 0), maxChunk);
  return min > max ? null : { min, max };
}

/**
 * 计算可见 chunk 键集合（含余量圈），按到视口中心的距离升序返回
 * ——惰性补块时优先生成视口中心附近的块。
 * 环绕轴上键为 unwrapped chunk 坐标（可 ≥ 地图 chunk 数），内容取样 mod 回绕。
 */
export function computeVisibleChunkKeys(input: TerrainChunkVisibilityInput): string[] {
  const { mapWidth, mapHeight, offsetX, offsetY, tileSize, viewportWidth, viewportHeight } = input;
  if (mapWidth <= 0 || mapHeight <= 0 || tileSize <= 0) {
    return [];
  }
  const margin = input.margin ?? TERRAIN_CHUNK_MARGIN;
  const wrapX = input.wrapX ?? false;
  const wrapY = input.wrapY ?? false;

  const rangeX = visibleChunkRangeAxis(
    Math.floor(Math.floor(-offsetX / tileSize) / TERRAIN_CHUNK_TILES) - margin,
    Math.floor(Math.floor((viewportWidth - offsetX) / tileSize) / TERRAIN_CHUNK_TILES) + margin,
    mapWidth,
    wrapX,
  );
  const rangeY = visibleChunkRangeAxis(
    Math.floor(Math.floor(-offsetY / tileSize) / TERRAIN_CHUNK_TILES) - margin,
    Math.floor(Math.floor((viewportHeight - offsetY) / tileSize) / TERRAIN_CHUNK_TILES) + margin,
    mapHeight,
    wrapY,
  );
  if (!rangeX || !rangeY) {
    return [];
  }

  const centerTileX = (viewportWidth / 2 - offsetX) / tileSize;
  const centerTileY = (viewportHeight / 2 - offsetY) / tileSize;
  const keys: Array<{ key: string; distance: number }> = [];
  for (let cy = rangeY.min; cy <= rangeY.max; cy += 1) {
    for (let cx = rangeX.min; cx <= rangeX.max; cx += 1) {
      const chunkCenterX = (cx + 0.5) * TERRAIN_CHUNK_TILES;
      const chunkCenterY = (cy + 0.5) * TERRAIN_CHUNK_TILES;
      const dx = chunkCenterX - centerTileX;
      const dy = chunkCenterY - centerTileY;
      keys.push({ key: chunkKey(cx, cy), distance: dx * dx + dy * dy });
    }
  }
  keys.sort((left, right) => left.distance - right.distance || left.key.localeCompare(right.key));
  return keys.map((entry) => entry.key);
}

/** 地形种类的签名编码（避免 buildable/blocked 首字母碰撞）。 */
const TERRAIN_KIND_CODES: Record<string, number> = {
  buildable: 1,
  blocked: 2,
  water: 3,
  lava: 4,
  unknown: 5,
};

/**
 * chunk 取样环绕配置：环绕轴上取样坐标 mod 回绕（同一真实 tile 在接缝两侧
 * 渲染出完全一致的像素，包括噪色/明暗种子）；非环绕轴行为不变。
 */
export interface TerrainWrapSampling {
  wrapX: boolean;
  wrapY: boolean;
}

function wrapSampleAxis(value: number, mapTiles: number, wrap: boolean) {
  return wrap ? wrapMod(value, Math.max(mapTiles, 1)) : value;
}

/** 环绕取样的地形查询：wrap 轴 mod 回绕，等价于在接缝另一侧看到同一格。 */
export function sampleTerrainTile(planet: PlanetRenderView, x: number, y: number, wrap?: TerrainWrapSampling) {
  if (!wrap) {
    return getTerrainTile(planet, x, y);
  }
  return getTerrainTile(
    planet,
    wrapSampleAxis(x, planet.map_width, wrap.wrapX),
    wrapSampleAxis(y, planet.map_height, wrap.wrapY),
  );
}

/**
 * chunk 内地形数据的签名（FNV-1a 变体）：数据引用变化后逐块重算比对，
 * 不一致的块标记脏重生成（对齐 planet-scene overview 纹理的签名比对模式）。
 * 环绕轴上按 unwrapped chunk 原点取样（mod 回绕），键入环绕标记避免切换时脏校验漏判。
 */
export function terrainChunkSignature(planet: PlanetRenderView, cx: number, cy: number, wrap?: TerrainWrapSampling): string {
  const x0 = cx * TERRAIN_CHUNK_TILES;
  const y0 = cy * TERRAIN_CHUNK_TILES;
  const tilesX = wrap?.wrapX ? TERRAIN_CHUNK_TILES : Math.max(Math.min(TERRAIN_CHUNK_TILES, planet.map_width - x0), 0);
  const tilesY = wrap?.wrapY ? TERRAIN_CHUNK_TILES : Math.max(Math.min(TERRAIN_CHUNK_TILES, planet.map_height - y0), 0);
  let hash = (2166136261 ^ (x0 * 73856093) ^ (y0 * 19349663) ^ (planet.map_width << 9) ^ planet.map_height
    ^ (wrap?.wrapX ? 0x9e37 : 0) ^ (wrap?.wrapY ? 0x79b9 : 0)) >>> 0;
  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      hash = (hash ^ (TERRAIN_KIND_CODES[sampleTerrainTile(planet, x0 + tx, y0 + ty, wrap)] ?? 0)) >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(36);
}

/** 四邻接掩码：某方向的邻居存在且满足条件时为 true（越界邻居视为 'unknown'）。 */
export interface TerrainEdgeMask {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const EMPTY_EDGE_MASK: TerrainEdgeMask = { up: false, down: false, left: false, right: false };

export function terrainNeighborMask(planet: PlanetRenderView, x: number, y: number, targetKind: string, wrap?: TerrainWrapSampling): TerrainEdgeMask {
  return {
    up: sampleTerrainTile(planet, x, y - 1, wrap) === targetKind,
    down: sampleTerrainTile(planet, x, y + 1, wrap) === targetKind,
    left: sampleTerrainTile(planet, x - 1, y, wrap) === targetKind,
    right: sampleTerrainTile(planet, x + 1, y, wrap) === targetKind,
  };
}

/** 陆邻掩码：某方向的邻居是陆格（buildable/blocked）时为 true（非环绕时越界不算陆，地图边缘不产生泡沫）。 */
export function terrainLandMask(planet: PlanetRenderView, x: number, y: number, wrap?: TerrainWrapSampling): TerrainEdgeMask {
  const isLand = (tx: number, ty: number) => {
    const kind = sampleTerrainTile(planet, tx, ty, wrap);
    return kind === 'buildable' || kind === 'blocked';
  };
  return {
    up: isLand(x, y - 1),
    down: isLand(x, y + 1),
    left: isLand(x - 1, y),
    right: isLand(x + 1, y),
  };
}

/** 掩码取反：邻居不是 targetKind 的方向为 true（岩浆描边/blocked 浮雕用）。 */
export function invertEdgeMask(mask: TerrainEdgeMask): TerrainEdgeMask {
  return { up: !mask.up, down: !mask.down, left: !mask.left, right: !mask.right };
}

/** tile 内像素到"掩码为 true 的最近一条边"的距离（px，0 = 贴边）；无匹配边时为 Infinity。 */
export function edgeDistancePx(px: number, py: number, mask: TerrainEdgeMask, tilePx = TERRAIN_CHUNK_TILE_PX): number {
  let distance = Infinity;
  if (mask.left) {
    distance = Math.min(distance, px);
  }
  if (mask.right) {
    distance = Math.min(distance, tilePx - 1 - px);
  }
  if (mask.up) {
    distance = Math.min(distance, py);
  }
  if (mask.down) {
    distance = Math.min(distance, tilePx - 1 - py);
  }
  return distance;
}

/** 亚像素确定性 hash：同 (x,y,px,py,salt) 必得同值（截图可复现）。 */
export function subPixelHash(x: number, y: number, px: number, py: number, salt = 0): number {
  return ((x * 73856093) ^ (y * 19349663) ^ (px * 83492791) ^ (py * 2654435761) ^ salt) >>> 0;
}

/** [-1, 1] 的亚像素噪色因子。 */
export function subPixelNoise(x: number, y: number, px: number, py: number, salt = 0): number {
  return ((subPixelHash(x, y, px, py, salt) % 1024) / 1024) * 2 - 1;
}

// ---------- 生态过渡/噪色规则（纯函数，输入 tile 种类 + 邻接掩码 + 像素坐标） ----------

/** 水岸泡沫向水侧渗入的宽度（px）。 */
export const SHORELINE_WIDTH_PX = 3;
/** 泡沫色（浅蓝白）。 */
export const SHORELINE_FOAM_RGB: readonly [number, number, number] = [0xd7, 0xec, 0xf5];
/** 岩浆边缘发光色（亮橙）。 */
export const LAVA_EDGE_GLOW_RGB: readonly [number, number, number] = [0xff, 0x7a, 0x28];

/**
 * 按边过渡的水岸泡沫混合量 [0, 1]：只在水格与陆格相邻的边画泡沫——水格贴陆一侧
 * SHORELINE_WIDTH_PX 内由边向内递减（0.55 / 0.3 / 0.12），其余为 0。
 * 陆格不再描泡沫（避免散点水域"每格全边白框"的瓷砖感），水-水相邻边无缝融合。
 */
export function shorelineFoamMix(kind: string, landMask: TerrainEdgeMask, px: number, py: number, tilePx = TERRAIN_CHUNK_TILE_PX): number {
  if (kind !== 'water') {
    return 0;
  }
  const distance = edgeDistancePx(px, py, landMask, tilePx);
  if (distance >= SHORELINE_WIDTH_PX) {
    return 0;
  }
  return [0.55, 0.3, 0.12][distance] ?? 0;
}

/** 岩浆边缘发光混合量 [0, 1]：贴非岩浆边 1px 强发光、第 2px 减弱。 */
export function lavaEdgeGlowMix(kind: string, nonLavaMask: TerrainEdgeMask, px: number, py: number, tilePx = TERRAIN_CHUNK_TILE_PX): number {
  if (kind !== 'lava') {
    return 0;
  }
  const distance = edgeDistancePx(px, py, nonLavaMask, tilePx);
  if (distance === 0) {
    return 0.75;
  }
  if (distance === 1) {
    return 0.35;
  }
  return 0;
}

/**
 * blocked 隆起浮雕系数：与非 blocked 相邻的边做上/左高光（×1.35→×1.12 两档）、
 * 下/右投影（×0.6→×0.85 两档），群山内部 tile（四邻皆 blocked）只有细噪。
 */
export function blockedReliefFactor(kind: string, reliefMask: TerrainEdgeMask, px: number, py: number, tilePx = TERRAIN_CHUNK_TILE_PX): number {
  if (kind !== 'blocked') {
    return 1;
  }
  let factor = 1;
  if (reliefMask.up && py === 0) {
    factor *= 1.35;
  } else if (reliefMask.up && py === 1) {
    factor *= 1.12;
  }
  if (reliefMask.left && px === 0) {
    factor *= 1.35;
  } else if (reliefMask.left && px === 1) {
    factor *= 1.12;
  }
  if (reliefMask.down && py === tilePx - 1) {
    factor *= 0.6;
  } else if (reliefMask.down && py === tilePx - 2) {
    factor *= 0.85;
  }
  if (reliefMask.right && px === tilePx - 1) {
    factor *= 0.6;
  } else if (reliefMask.right && px === tilePx - 2) {
    factor *= 0.85;
  }
  return factor;
}

// 噪色 salt：不同特征用不同盐，避免相关性。
const SALT_SOIL_FINE = 0x9e3779b9;
const SALT_SOIL_COARSE = 0x85ebca6b;
const SALT_WATER_FINE = 0xc2b2ae35;
const SALT_WATER_STREAK = 0x27d4eb2f;
const SALT_LAVA_CRUST = 0x165667b1;
const SALT_BLOCKED_FINE = 0xd3a2646d;
const SALT_UNKNOWN_FINE = 0x9fb21c65;

/** buildable 土壤细噪：逐像素 ±7% + 2×2 斑块 ±5%（不连片、不闪烁）。 */
export function soilNoiseFactor(x: number, y: number, px: number, py: number): number {
  const fine = subPixelNoise(x, y, px, py, SALT_SOIL_FINE) * 0.07;
  const coarse = subPixelNoise(x, y, px >> 1, py >> 1, SALT_SOIL_COARSE) * 0.05;
  return 1 + fine + coarse;
}

/** 水面静态底噪：逐像素 ±6% + 2px 横条纹 ±4%（动效由遮罩层负责，纹理本身不动）。 */
export function waterNoiseFactor(x: number, y: number, px: number, py: number): number {
  const fine = subPixelNoise(x, y, px, py, SALT_WATER_FINE) * 0.06;
  const streak = subPixelNoise(x, y, 0, py >> 1, SALT_WATER_STREAK) * 0.04;
  return 1 + fine + streak;
}

/** 岩浆内部暗壳：2×2 斑块约 3/8 概率压暗到 0.55。 */
export function lavaCrustFactor(kind: string, x: number, y: number, px: number, py: number): number {
  if (kind !== 'lava') {
    return 1;
  }
  return (subPixelHash(x, y, px >> 1, py >> 1, SALT_LAVA_CRUST) % 8) < 3 ? 0.55 : 1;
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export interface TerrainChunkPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * 计算一个 chunk 的地表像素（tileSize=8px/tile；非环绕轴在地图边缘按实际 tile 数收窄，
 * 环绕轴恒满 64 tile、取样 mod 回绕）。不依赖 canvas，纯函数可测；全部确定性：
 * 同一份地形数据必得同一份像素（噪色/明暗种子用回绕后的真实坐标，接缝两侧一致）。
 */
export function computeTerrainChunkPixels(planet: PlanetRenderView, cx: number, cy: number, wrap?: TerrainWrapSampling): TerrainChunkPixels {
  const x0 = cx * TERRAIN_CHUNK_TILES;
  const y0 = cy * TERRAIN_CHUNK_TILES;
  const tilesX = wrap?.wrapX ? TERRAIN_CHUNK_TILES : chunkSpanAxis(x0, planet.map_width);
  const tilesY = wrap?.wrapY ? TERRAIN_CHUNK_TILES : chunkSpanAxis(y0, planet.map_height);
  const width = Math.max(tilesX * TERRAIN_CHUNK_TILE_PX, 1);
  const height = Math.max(tilesY * TERRAIN_CHUNK_TILE_PX, 1);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      // 取样坐标：环绕轴 mod 回绕到真实 tile，保证同一格在任何副本里像素一致。
      const x = wrapSampleAxis(x0 + tx, planet.map_width, wrap?.wrapX ?? false);
      const y = wrapSampleAxis(y0 + ty, planet.map_height, wrap?.wrapY ?? false);
      const kind = getTerrainTile(planet, x, y);
      const base = TERRAIN_RGB[kind] ?? TERRAIN_RGB.unknown;
      const shade = SHADING_TERRAINS.has(kind) ? shadeFactor(x, y) : 1;

      // 邻接掩码只查一次（4 邻居）：水侧泡沫（陆邻方向）/ 岩浆描边 / blocked 浮雕各取所需。
      const landMask = kind === 'water'
        ? terrainLandMask(planet, x, y, wrap)
        : EMPTY_EDGE_MASK;
      const nonLavaMask = kind === 'lava'
        ? invertEdgeMask(terrainNeighborMask(planet, x, y, 'lava', wrap))
        : EMPTY_EDGE_MASK;
      const reliefMask = kind === 'blocked'
        ? invertEdgeMask(terrainNeighborMask(planet, x, y, 'blocked', wrap))
        : EMPTY_EDGE_MASK;

      for (let py = 0; py < TERRAIN_CHUNK_TILE_PX; py += 1) {
        for (let px = 0; px < TERRAIN_CHUNK_TILE_PX; px += 1) {
          let factor = shade;
          if (kind === 'buildable') {
            factor *= soilNoiseFactor(x, y, px, py);
          } else if (kind === 'water') {
            factor *= waterNoiseFactor(x, y, px, py);
          } else if (kind === 'lava') {
            factor *= lavaCrustFactor(kind, x, y, px, py)
              * (1 + subPixelNoise(x, y, px, py, SALT_LAVA_CRUST ^ 0xff) * 0.05);
          } else if (kind === 'blocked') {
            factor *= blockedReliefFactor(kind, reliefMask, px, py)
              * (1 + subPixelNoise(x, y, px, py, SALT_BLOCKED_FINE) * 0.05);
          } else {
            factor *= 1 + subPixelNoise(x, y, px, py, SALT_UNKNOWN_FINE) * 0.03;
          }

          let r = base[0] * factor;
          let g = base[1] * factor;
          let b = base[2] * factor;

          const foam = shorelineFoamMix(kind, landMask, px, py);
          if (foam > 0) {
            r += (SHORELINE_FOAM_RGB[0] - r) * foam;
            g += (SHORELINE_FOAM_RGB[1] - g) * foam;
            b += (SHORELINE_FOAM_RGB[2] - b) * foam;
          }
          const glow = lavaEdgeGlowMix(kind, nonLavaMask, px, py);
          if (glow > 0) {
            r += (LAVA_EDGE_GLOW_RGB[0] - r) * glow;
            g += (LAVA_EDGE_GLOW_RGB[1] - g) * glow;
            b += (LAVA_EDGE_GLOW_RGB[2] - b) * glow;
          }

          const offset = ((ty * TERRAIN_CHUNK_TILE_PX + py) * width + tx * TERRAIN_CHUNK_TILE_PX + px) * 4;
          data[offset] = clampByte(r);
          data[offset + 1] = clampByte(g);
          data[offset + 2] = clampByte(b);
          data[offset + 3] = 255;
        }
      }
    }
  }

  return { width, height, data };
}

/**
 * 烘焙一个 chunk 的地表 canvas（像素由 computeTerrainChunkPixels 提供）。
 */
export function renderTerrainChunkCanvas(planet: PlanetRenderView, cx: number, cy: number, wrap?: TerrainWrapSampling): HTMLCanvasElement {
  const { width, height, data } = computeTerrainChunkPixels(planet, cx, cy, wrap);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('canvas 2d context unavailable');
  }
  const image = context.createImageData(width, height);
  image.data.set(data);
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 通用 LRU 容器（Map 迭代序 = 使用序，get/set 触达提到最新）。
 * 逐出走 evictToCapacity(protect)：跳过受保护键（如当前可见集合），全受保护时允许超限。
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get size() {
    return this.map.size;
  }

  has(key: K) {
    return this.map.has(key);
  }

  /** 读取并触达（提到最新）。 */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined || this.map.has(key)) {
      this.map.delete(key);
      this.map.set(key, value as V);
    }
    return value;
  }

  /** 读取但不改变使用序（签名比对等内部路径用）。 */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
  }

  delete(key: K) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  keys(): K[] {
    return [...this.map.keys()];
  }

  values(): V[] {
    return [...this.map.values()];
  }

  /** 逐出最久未用且未受保护的条目，直到 size ≤ capacity。 */
  evictToCapacity(protect?: (key: K) => boolean) {
    for (const [key, value] of [...this.map]) {
      if (this.map.size <= this.capacity) {
        break;
      }
      if (protect?.(key)) {
        continue;
      }
      this.map.delete(key);
      this.onEvict?.(key, value);
    }
  }
}
