/**
 * 地表属性图集（第 23 轮 3A 画质地表分支）。
 *
 * 每格烘焙四张 RGBA8 图（全局 overview + 场景窗口 local，同一套通道语义）：
 * - `color`：宏观色（远景/纹理淡出时用，sRGB 编码）；
 * - `properties`：R 水、G 岩、B 已探索、A 可见（与旧版一致）；
 * - `heat`：R 到岩浆的归一化热度、G 到水的归一化距离、B 服务端 height、A 到未知区的格数渐变；
 * - `sdf`：平滑类别场（R 水面 / G 岩性 / B 岩浆 / A 到未知区），格间边界靠它做亚格过渡。
 *
 * 所有值只由玩家可见的服务端数据推导；未知格的 terrain/height 从不写入。
 */
import * as THREE from 'three';
import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import { getFogState, getTerrainTile, type PlanetRenderView } from '../../model';
import type { FogMapView, PlanetSceneView } from '@shared/types';
import { ROCK_TERRAINS, WATER_TERRAINS } from './biome';

export type SurfaceSample = { terrain: string; explored: boolean; visible: boolean; height?: number };
export type SampleAt = (x: number, y: number) => SurfaceSample;

export interface AtlasSet {
  color: THREE.DataTexture;
  properties: THREE.DataTexture;
  heat: THREE.DataTexture;
  /** 平滑类别场（0 为等值线，范围 ±0.5）：R 水面、G 岩性、B 岩浆、A 到未知区。
   *  着色器用它做亚格边界：等值线被均值核磨圆、跨格连续，不再沿格边走方块（L15）。 */
  sdf: THREE.DataTexture;
  /** 增量重建用：三个类别的格级掩码与平滑场（下次构建只重算变化格附近）。 */
  masks?: CategoryMasks;
  waterField?: Float32Array;
  rockField?: Float32Array;
  lavaField?: Float32Array;
  /** 逐格原始数据与逐格字节（增量重建时按脏区拷贝/重算）。 */
  raw?: AtlasRaw;
}

/** 宏观色（线性 0..1）：纹理未就绪/远景时使用；sRGB 编码写进图集。 */
export const FINISH_COLORS: Record<string, [number, number, number]> = {
  buildable: [0.29, 0.35, 0.18], plains: [0.29, 0.35, 0.18], plain: [0.29, 0.35, 0.18],
  grass: [0.33, 0.40, 0.17], grassland: [0.33, 0.40, 0.17], forest: [0.26, 0.34, 0.19],
  blocked: [0.16, 0.16, 0.17], rock: [0.16, 0.16, 0.17], mountain: [0.16, 0.16, 0.17], mountains: [0.16, 0.16, 0.17],
  water: [0.012, 0.055, 0.075], sea: [0.012, 0.055, 0.075], ocean: [0.012, 0.055, 0.075],
  desert: [0.58, 0.51, 0.38], sand: [0.58, 0.51, 0.38],
  ice: [0.62, 0.76, 0.80], snow: [0.86, 0.89, 0.93],
  swamp: [0.24, 0.30, 0.20], lava: [0.62, 0.22, 0.10],
};
export const UNKNOWN_COLOR: [number, number, number] = [0.21, 0.27, 0.33];

/**
 * 属性位：水 = 1；岩 = 0..1 的「岩性占比」（着色器按 > 0.5 选玄武岩，其余当土壤）。
 * 只对已探索格写入：未探索格的两个通道恒为 0，否则水/岩位会泄露隐藏地形。
 */
export function finishFlags(terrain: string): { water: number; rock: number } {
  if (WATER_TERRAINS.has(terrain)) return { water: 1, rock: 0 };
  if (ROCK_TERRAINS.has(terrain)) return { water: 0, rock: 1 };
  if (terrain === 'lava') return { water: 0, rock: 1 };
  return { water: 0, rock: SOIL_ROCK_FRACTION[terrain] ?? 0 };
}

/** 土壤类地形的岩性占比（与旧版 FINISHES 的数值一致，供临水沙泥/焦土与岩脊细节按比例混合）。 */
const SOIL_ROCK_FRACTION: Record<string, number> = {
  buildable: 0.15, plains: 0.15, plain: 0.15, grass: 0.1, grassland: 0.1, forest: 0.2,
  desert: 0.3, sand: 0.2, ice: 0.3, snow: 0.3, swamp: 0.1,
};

/** 单个类别掩码（按格）；1 = 内侧。三个类别各一份，供平滑场与单格保留共用。 */
interface CategoryMasks { water: Uint8Array; rock: Uint8Array; lava: Uint8Array }

function categoryMasks(width: number, height: number, at: (x: number, y: number) => SurfaceSample, knownAt: (x: number, y: number) => boolean): CategoryMasks {
  const water = new Uint8Array(width * height);
  const rock = new Uint8Array(width * height);
  const lava = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!knownAt(x, y)) continue;
      const terrain = at(x, y).terrain;
      const index = y * width + x;
      water[index] = WATER_TERRAINS.has(terrain) ? 1 : 0;
      rock[index] = finishFlags(terrain).rock >= 0.5 ? 1 : 0;
      lava[index] = terrain === 'lava' ? 1 : 0;
    }
  }
  return { water, rock, lava };
}

function srgbByte(value: number) {
  const linear = Math.min(1, Math.max(0, value));
  const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function dataTexture(bytes: Uint8Array, width: number, height: number, linear = false) {
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  // Linear values are baked below; data texture rows follow the six-face atlas.
  texture.colorSpace = THREE.NoColorSpace;
  // 逐格类别数据必须最近邻（插值会造出不存在的类别）；SDF 相反——它的亚格边界
  // 完全靠硬件双线性插值，用最近邻就又退回沿格边的方块（L15）。
  texture.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  texture.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** 跨面邻接的距离场（4 邻接 BFS，只在给定矩形内传播；矩形外当作「无数据」不参与）。 */
function distanceField(
  width: number, height: number, boundsX: number, boundsY: number,
  seed: (x: number, y: number) => boolean, faceSize: number, maxDistance: number,
  crossFace = true,
) {
  const result = new Uint8Array(width * height).fill(255);
  const queue: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (seed(boundsX + x, boundsY + y)) { result[y * width + x] = 0; queue.push(y * width + x); }
  }
  let head = 0;
  const directions: SurfaceDirection[] = ['north', 'east', 'south', 'west'];
  while (head < queue.length) {
    const index = queue[head++];
    const x = index % width, y = Math.floor(index / width);
    const current = result[index];
    if (current >= maxDistance) continue;
    for (const direction of directions) {
      const tile = crossFace
        ? surfaceStep({ x: boundsX + x, y: boundsY + y }, direction, faceSize).tile
        : { x: boundsX + x + (direction === 'east' ? 1 : direction === 'west' ? -1 : 0), y: boundsY + y + (direction === 'south' ? 1 : direction === 'north' ? -1 : 0) };
      const lx = tile.x - boundsX, ly = tile.y - boundsY;
      if (lx < 0 || ly < 0 || lx >= width || ly >= height) continue;
      const next = ly * width + lx;
      if (result[next] <= current + 1) continue;
      result[next] = current + 1;
      queue.push(next);
    }
  }
  return result;
}

/** 每格的超采样倍数：平滑场在这个分辨率上算，线性插值后等值线才不是方格（L15）。 */
export const SDF_SUPERSAMPLE = 8;

/**
 * 平滑类别场（L15 的亚格边界）：把格级掩码超采样后做两遍宽核均值，得到 0..1 的覆盖度场，
 * 再减 0.5 成为以 0 为等值线的有符号场（内侧正、外侧负）。
 *
 * 为什么不用距离变换：距离变换忠实保留输入的形状——格子边界还是格子，只是给了距离。
 * 覆盖度场的 0 等值线则被均值核「磨圆」：拐角变圆角、单格凸起收成小半岛，这正是海岸线
 * 需要的圆润不规则（半径约 1 格），再叠着色器里的噪声弯折成自然的湾与岬。
 *
 * 增量更新（审查 P2-3）：传入上一次的掩码与场时，只重算变化格附近 ±3 格的带，
 * 带外直接沿用旧场（那些像素的卷积支撑里没有任何变化格，值本来就相同）。
 * 地形刷新通常只动几格，一次刷新从 ~120 ms 降到亚毫秒级；首帧/窗口变化时才整张重建。
 */
function smoothField(
  width: number, height: number, cells: Uint8Array,
  previous?: { cells: Uint8Array; field: Float32Array },
) {
  const S = SDF_SUPERSAMPLE;
  const w = width * S, h = height * S;
  const dirty = previous && previous.cells.length === cells.length
    ? dirtyCellRange(width, height, cells, previous.cells) : null;
  // 掩码没变：场原样复用（零成本）。
  if (previous && !dirty && previous.field.length === w * h) return { data: previous.field, width: w, height: h, cells };
  // 卷积的输入必须是「掩码种子」，不能是上一版卷积后的场。种子铺一遍是 O(w·h) 次写，
  // 比卷积本身便宜一个量级；真正省掉的是「距离场/逐格字节」那些更贵的部分。
  const seed = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    seed[y * w + x] = cells[Math.floor(y / S) * width + Math.floor(x / S)];
  }
  const result = new Float32Array(w * h);
  convolveInto(seed, result, w, h, S, { x0: 0, x1: w, y0: 0, y1: h });
  return { data: result, width: w, height: h, cells };
}

/**
 * 三角形核（两遍盒滤波，半径 S）的卷积：把 `input` 卷积后的结果写进 `out` 的矩形带，
 * 带外保持 `out` 原值（增量路径里那里是上一版的最终值）。
 *
 * 盒滤波用滑动累加和：每像素 O(1)。带内每行/每列的窗口和从带起点用 O(S) 次加法起算，
 * 所以重算成本只与带面积成正比（审查 P2-3）。
 */
function convolveInto(input: Float32Array, out: Float32Array, w: number, h: number, S: number, band: { x0: number; x1: number; y0: number; y1: number }) {
  const half = S + 1; // 盒宽 2·half−1 = 2S+1
  let source = input;
  // 两遍 x、两遍 y，共四个缓冲区轮转（输入只读，最后一趟写回 out）。
  const buffers = [new Float32Array(w * h), new Float32Array(w * h)];
  const pass = (axis: 'x' | 'y', target: Float32Array) => {
    const length = axis === 'x' ? w : h;
    const stride = axis === 'x' ? 1 : w;
    const lineStride = axis === 'x' ? w : 1;
    const lines = axis === 'x' ? h : w;
    const from = axis === 'x' ? band.x0 : band.y0;
    const to = axis === 'x' ? band.x1 : band.y1;
    // 带外沿用上一趟的结果（或 out 的旧值），带内重算。
    target.set(axis === 'x' ? source : out);
    for (let line = 0; line < lines; line++) {
      const base = line * lineStride;
      let sum = 0;
      for (let d = from - half + 1; d <= from + half - 1; d++) sum += source[base + Math.min(length - 1, Math.max(0, d)) * stride];
      for (let offset = from; offset < to; offset++) {
        target[base + offset * stride] = sum / (2 * half - 1);
        const add = Math.min(length - 1, offset + half);
        const drop = Math.max(0, offset - half + 1);
        sum += source[base + add * stride] - source[base + drop * stride];
      }
    }
  };
  // x 两遍 → 第一遍写 buf0，第二遍写 buf1；y 两遍 → 第三遍写 buf0，第四遍写 out。
  pass('x', buffers[0]);
  source = buffers[0];
  pass('x', buffers[1]);
  source = buffers[1];
  pass('y', buffers[0]);
  source = buffers[0];
  pass('y', out);
  // 减 0.5（只处理带内；带外 out 里已经是减过的最终值）。
  for (let y = band.y0; y < band.y1; y++) for (let x = band.x0; x < band.x1; x++) out[y * w + x] -= 0.5;
}

/** 变化格的包围盒（含 0 格邻域的保守范围）；没有变化返回 null。 */
function dirtyCellRange(width: number, height: number, cells: Uint8Array, previous: Uint8Array) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (cells[index] === previous[index]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * 单格保留（审查 P2-1）：把「本格自身属于该类别」的格心强制推进内侧。
 *
 * 宽核均值（σ ≈ 1 格）会把孤立 1 格水/岩浆的格心压到 −0.19，着色器阈值 ±0.45
 * 判成外侧 → 服务端说水、画面画成可建造陆地。这里按格抬升（格心满覆盖、格边收回），
 * 所以单格读成圆水洼/熔池而不是方块；着色器另有本格类别守卫兜住域噪声。
 */
function keepOwnCells(field: { data: Float32Array; width: number; height: number }, mask: Uint8Array) {
  const S = SDF_SUPERSAMPLE;
  const cellsWide = field.width / S, cellsHigh = field.height / S;
  // 格内径向核按格内偏移预计算一次（S² 项），内层循环只剩一次 max。
  const kernel = new Float32Array(S * S);
  for (let ty = 0; ty < S; ty++) {
    for (let tx = 0; tx < S; tx++) {
      const distance = Math.min(1, Math.hypot(tx + 0.5 - S / 2, ty + 0.5 - S / 2) / (S / 2));
      // 格心 +0.5（满覆盖），向格边按 0.5 − 0.30·d² 收：格心一圈纹素在 0.46 以上
      // （判定阈值 0.45），格角收回到 0.2 —— 孤立 1 格读成圆水洼而不是方块。
      kernel[ty * S + tx] = 0.5 - 0.30 * distance * distance;
    }
  }
  for (let cellY = 0; cellY < cellsHigh; cellY++) {
    for (let cellX = 0; cellX < cellsWide; cellX++) {
      if (!mask[cellY * cellsWide + cellX]) continue;
      for (let ty = 0; ty < S; ty++) {
        const row = (cellY * S + ty) * field.width + cellX * S;
        for (let tx = 0; tx < S; tx++) {
          const index = row + tx;
          const lifted = kernel[ty * S + tx];
          if (field.data[index] < lifted) field.data[index] = lifted;
        }
      }
    }
  }
}

/** 到未知区（未探索/无数据）的格数渐变：只在已探索格上有值，未探索格恒为 0。 */
function knownEdgeField(width: number, height: number, sample: SampleAt, boundsX: number, boundsY: number) {
  const distance = distanceField(width, height, boundsX, boundsY,
    (x, y) => { const cell = sample(x, y); return !(cell.explored && cell.terrain !== 'unknown'); },
    0, 6, false); // 该场只用于局部渐变：矩形外的格子没有数据，不跨面传播
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = sample(boundsX + x, boundsY + y);
    if (!cell.explored || cell.terrain === 'unknown') { result[y * width + x] = 0; continue; }
    const d = distance[y * width + x];
    result[y * width + x] = Math.min(1, d === 255 ? 1 : d / 3);
  }
  return result;
}

export interface AtlasOptions {
  width: number; height: number;
  boundsX: number; boundsY: number;
  faceSize: number;
  sample: SampleAt;
  /** 上一次构建的图集（尺寸相同）：只重算变化格附近的平滑场，其余沿用旧值。 */
  previous?: AtlasSet;
}

/** 图集内部数据：增量重建时按脏区拷贝/重算。 */
interface AtlasRaw {
  /** 每格地形码（0 未知 / 1 土壤 / 2 水 / 3 岩 / 4 岩浆）。 */
  codes: Uint8Array;
  /** 每格状态位：1 已探索、2 可见。 */
  states: Uint8Array;
  /** 每格高度量化值（0..255，无 height 记 0）。 */
  heights: Uint8Array;
  colors: Uint8Array;
  properties: Uint8Array;
  heat: Uint8Array;
  sdfBytes: Uint8Array;
  edge: Float32Array;
  lavaDistance: Uint8Array;
  waterDistance: Uint8Array;
}

function terrainCode(terrain: string) {
  if (terrain === 'unknown') return 0;
  if (WATER_TERRAINS.has(terrain)) return 2;
  if (terrain === 'lava') return 4;
  if (ROCK_TERRAINS.has(terrain)) return 3;
  return 1;
}

export function buildAtlas({ width, height, boundsX, boundsY, faceSize, sample, previous }: AtlasOptions): AtlasSet {
  // 取样器有跨面查表与对象分配，一次构建里会被调用十几次。先按格取一次缓存下来
  // （审查 P2-3：这是这块最主要的成本）。
  const cells: SurfaceSample[] = new Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = sample(boundsX + x, boundsY + y);
  const at = (x: number, y: number) => cells[y * width + x];
  const knownAt = (x: number, y: number) => { const cell = at(x, y); return cell.explored && cell.terrain !== 'unknown'; };

  const codes = new Uint8Array(width * height);
  const states = new Uint8Array(width * height);
  const heights = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = at(x, y);
      const index = y * width + x;
      codes[index] = terrainCode(cell.terrain);
      states[index] = (cell.explored ? 1 : 0) | (cell.visible ? 2 : 0);
      heights[index] = Math.round(255 * Math.min(1, Math.max(0, cell.height ?? 0.35)));
    }
  }

  // 完全没变化（调用方签名比较漏掉的等价数据）：直接用上一版的字节重建纹理，不重算任何场。
  if (previous?.raw && previous.raw.codes.length === width * height
    && previous.sdf.image.width === width * SDF_SUPERSAMPLE && previous.sdf.image.height === height * SDF_SUPERSAMPLE) {
    const same = previous.raw.codes.every((code, index) => code === codes[index])
      && previous.raw.states.every((state, index) => state === states[index])
      && previous.raw.heights.every((value, index) => value === heights[index]);
    if (same) {
      const raw = previous.raw;
      return {
        color: dataTexture(raw.colors, width, height),
        properties: dataTexture(raw.properties, width, height),
        heat: dataTexture(raw.heat, width, height),
        sdf: dataTexture(raw.sdfBytes, previous.sdf.image.width, previous.sdf.image.height, true),
        masks: previous.masks!, waterField: previous.waterField!, rockField: previous.rockField!, lavaField: previous.lavaField!,
        raw,
      };
    }
  }
  // 增量（审查 P2-3）：尺寸一致且上一版数据可用时，只重算变化格及其邻域，
  // 其余逐格字节直接沿用；整张重建只在首帧、窗口变化或尺寸变化时发生。
  const raw = previous?.raw && previous.raw.codes.length === width * height
    && previous.sdf.image.width === width * SDF_SUPERSAMPLE && previous.sdf.image.height === height * SDF_SUPERSAMPLE
    ? previous.raw : null;
  const dirty = raw ? dirtyCells(width, height, codes, states, heights, raw) : null;
  // 有上一版就能走增量：dirty 为 null 表示数据完全没变（调用方签名相同一般已短路，
  // 这里只重建纹理对象、不重算任何场）。
  const incremental = raw !== null;
  // 完全没变化时（理论上调用方已经短路）仍走整张重建，保证返回的纹理是独立对象。

  const masks = categoryMasks(width, height, at, knownAt);
  // 复用上一版的字节数组（旧纹理随后就 dispose；新纹理从同一块内存重新上传）。
  const colors = incremental ? raw!.colors : new Uint8Array(width * height * 4);
  const properties = incremental ? raw!.properties : new Uint8Array(width * height * 4);
  const heat = incremental ? raw!.heat : new Uint8Array(width * height * 4);

  // 距离场：BFS 是全图扩散，没法按脏区增量；但只在「本类别种子或已探索位变了」时才重跑。
  const reuseEdge = incremental && (!dirty || (!dirty.codesChanged && !dirty.exploredChanged));
  const reuseLava = incremental && (!dirty || (!dirty.lavaChanged && !dirty.exploredChanged));
  const reuseWater = incremental && (!dirty || (!dirty.waterChanged && !dirty.exploredChanged));
  const lavaDistance = reuseLava ? raw!.lavaDistance : distanceField(width, height, boundsX, boundsY,
    (x, y) => { const cell = at(x - boundsX, y - boundsY); return cell.explored && cell.terrain === 'lava'; }, faceSize, 5);
  const waterDistance = reuseWater ? raw!.waterDistance : distanceField(width, height, boundsX, boundsY,
    (x, y) => { const cell = at(x - boundsX, y - boundsY); return cell.explored && WATER_TERRAINS.has(cell.terrain); }, faceSize, 5);
  const reuseDistances = reuseLava && reuseWater;
  const edge = reuseEdge ? raw!.edge : knownEdgeField(width, height, (x, y) => at(x - boundsX, y - boundsY), boundsX, boundsY);

  // 逐格字节：距离场/前沿沿用旧值时只重算脏区；地形码或已探索位变了（距离场整张变了）
  // 就整张重写——heat 的 R/G 与 A 通道都依赖全局距离场。
  const localBytesOnly = incremental && reuseDistances && reuseEdge && dirty !== null;
  const x0 = localBytesOnly ? Math.max(0, dirty!.x0) : 0, x1 = localBytesOnly ? Math.min(width, dirty!.x1 + 1) : width;
  const y0 = localBytesOnly ? Math.max(0, dirty!.y0) : 0, y1 = localBytesOnly ? Math.min(height, dirty!.y1 + 1) : height;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cell = at(x, y);
      const known = knownAt(x, y);
      const color = known ? FINISH_COLORS[cell.terrain] ?? FINISH_COLORS.buildable : UNKNOWN_COLOR;
      const flags = finishFlags(cell.terrain);
      const i = (y * width + x) * 4;
      colors[i] = srgbByte(color[0]); colors[i + 1] = srgbByte(color[1]); colors[i + 2] = srgbByte(color[2]); colors[i + 3] = 255;
      properties[i] = known ? Math.round(flags.water * 255) : 0;
      properties[i + 1] = known ? Math.round(flags.rock * 255) : 0;
      properties[i + 2] = known ? 255 : 0;
      properties[i + 3] = known && cell.visible ? 255 : 0;
      const lavaD = lavaDistance[y * width + x];
      const waterD = waterDistance[y * width + x];
      heat[i] = known ? Math.round(255 * Math.max(0, 1 - (lavaD === 255 ? 5 : lavaD) / 5)) : 0;
      heat[i + 1] = known ? Math.round(255 * Math.max(0, 1 - (waterD === 255 ? 5 : waterD) / 5)) : 0;
      heat[i + 2] = known ? heights[y * width + x] : 0;
      heat[i + 3] = known ? Math.round(255 * edge[y * width + x]) : 0;
    }
  }

  // 平滑类别场（L15）：只有**已探索**的格参与；未知格恒为外侧，等值线停在探索前沿。
  const reusable = raw && previous!.masks && previous!.waterField && previous!.rockField && previous!.lavaField
    ? { masks: previous!.masks, water: previous!.waterField, rock: previous!.rockField, lava: previous!.lavaField } : undefined;
  const waterGrid = smoothField(width, height, masks.water, reusable && { cells: reusable.masks.water, field: reusable.water });
  const rockGrid = smoothField(width, height, masks.rock, reusable && { cells: reusable.masks.rock, field: reusable.rock });
  const lavaGrid = smoothField(width, height, masks.lava, reusable && { cells: reusable.masks.lava, field: reusable.lava });
  // 单格保留（审查 P2-1）：宽核均值会把孤立 1 格水/岩浆的格心压到阈值以下
  // （实测 1 格水格心 −0.19，着色器要 > 0.45 才算水），服务端说水、画面画成陆地。
  // 这里把「本格自身类别」与平滑场取并集：本格是水/岩浆/岩石时，格心固定推进内侧，
  // 平滑场仍负责格与格之间的圆润过渡与外侧衰减。未探索格不参与（信息诚实不变）。
  keepOwnCells(waterGrid, masks.water);
  keepOwnCells(rockGrid, masks.rock);
  keepOwnCells(lavaGrid, masks.lava);
  // 编码：场值 ±0.5 → 0..255（0.5 = 0）。场本身是覆盖度，范围天然是 ±0.5。
  const encodeSdf = (value: number) => Math.max(0, Math.min(255, Math.round((value + 0.5) * 255)));
  // SDF 图是超采样分辨率（每格 8×8）：只重编码脏区（连同 smoothField 的 ±3 格边带）。
  const sdf = raw ? raw.sdfBytes : new Uint8Array(waterGrid.width * waterGrid.height * 4);
  const supersample = SDF_SUPERSAMPLE;
  const sdfBand = incremental && dirty !== null && reuseDistances && reuseEdge;
  const sx0 = sdfBand ? Math.max(0, dirty!.x0 - 3) * supersample : 0;
  const sx1 = sdfBand ? Math.min(width, dirty!.x1 + 4) * supersample : waterGrid.width;
  const sy0 = sdfBand ? Math.max(0, dirty!.y0 - 3) * supersample : 0;
  const sy1 = sdfBand ? Math.min(height, dirty!.y1 + 4) * supersample : waterGrid.height;
  for (let gy = sy0; gy < sy1; gy++) {
    for (let gx = sx0; gx < sx1; gx++) {
      const i = gy * waterGrid.width + gx;
      sdf[i * 4] = encodeSdf(waterGrid.data[i]);
      sdf[i * 4 + 1] = encodeSdf(rockGrid.data[i]);
      sdf[i * 4 + 2] = encodeSdf(lavaGrid.data[i]);
      // A：到未知区的距离（已探索侧为正）：SDF 版本由 knownEdgeField 放大到超采样分辨率。
      const cellEdge = edge[Math.min(height - 1, Math.floor(gy / supersample)) * width + Math.min(width - 1, Math.floor(gx / supersample))];
      sdf[i * 4 + 3] = encodeSdf(cellEdge * 0.5 - 0.25);
    }
  }
  return {
    color: dataTexture(colors, width, height),
    properties: dataTexture(properties, width, height),
    heat: dataTexture(heat, width, height),
    sdf: dataTexture(sdf, waterGrid.width, waterGrid.height, true),
    masks,
    waterField: waterGrid.data, rockField: rockGrid.data, lavaField: lavaGrid.data,
    raw: { codes, states, heights, colors, properties, heat, sdfBytes: sdf, edge, lavaDistance, waterDistance },
  };
}

/**
 * 与上一版相比发生变化的格包围盒（地形码 / 状态位 / 高度），并记下变化种类：
 * - `codes` 变了 → 距离场/平滑场都要重算；
 * - 只有 `explored` 变了 → 距离场与前沿要重算；
 * - 只有 `visible`/`height` 变了 → 只重写逐格字节。
 */
function dirtyCells(width: number, height: number, codes: Uint8Array, states: Uint8Array, heights: Uint8Array, raw: AtlasRaw) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  let codesChanged = false, exploredChanged = false, lavaChanged = false, waterChanged = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (codes[index] === raw.codes[index] && states[index] === raw.states[index] && heights[index] === raw.heights[index]) continue;
      if (codes[index] !== raw.codes[index]) {
        codesChanged = true;
        const before = raw.codes[index], now = codes[index];
        if (before === 4 || now === 4) lavaChanged = true;
        if (before === 2 || now === 2) waterChanged = true;
      }
      if ((states[index] & 1) !== (raw.states[index] & 1)) exploredChanged = true;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, codesChanged, exploredChanged, lavaChanged, waterChanged };
}

/** 场景窗口（含 surface_patches）的取样器与打包布局。 */
export function localSampler(planet: PlanetRenderView, fog?: FogMapView | PlanetSceneView) {
  return (x: number, y: number): SurfaceSample => {
    const terrain = getTerrainTile(planet, x, y);
    // 补片（surface_patches）自带 explored/visible：北缝的补片不在窗口图集里，
    // 必须从补片自己的迷雾数据读，不能拿窗口矩形坐标去查。
    const patch = 'bounds' in planet
      ? planet.surface_patches?.find(p => x >= p.bounds.x && y >= p.bounds.y && x < p.bounds.x + p.bounds.width && y < p.bounds.y + p.bounds.height)
      : undefined;
    if (patch) {
      const state = getFogState(patch as PlanetSceneView, x, y);
      return { terrain, explored: state.explored, visible: state.visible, height: terrainHeight(planet, x, y) };
    }
    const state = fog ? getFogState(fog, x, y) : { explored: terrain !== 'unknown', visible: terrain !== 'unknown' };
    return { terrain, explored: state.explored, visible: state.visible, height: terrainHeight(planet, x, y) };
  };
}

function terrainHeight(planet: PlanetRenderView, x: number, y: number) {
  if (!planet.height?.length) return undefined;
  if ('bounds' in planet) {
    const patch = planet.surface_patches?.find(p => x >= p.bounds.x && y >= p.bounds.y && x < p.bounds.x + p.bounds.width && y < p.bounds.y + p.bounds.height);
    if (patch) return patch.height?.[y - patch.bounds.y]?.[x - patch.bounds.x];
    return planet.height?.[y - planet.bounds.y]?.[x - planet.bounds.x];
  }
  return planet.height?.[y]?.[x];
}

export function disposeAtlas(atlas: AtlasSet) {
  atlas.color.dispose(); atlas.properties.dispose(); atlas.heat.dispose(); atlas.sdf.dispose();
}
