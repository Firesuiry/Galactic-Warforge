/**
 * 地表属性图集（第 23 轮 3A 画质地表分支）。
 *
 * 每格烘焙四张 RGBA8 图（全局 overview + 场景窗口 local，同一套通道语义）：
 * - `color`：宏观色（远景/纹理淡出时用，sRGB 编码）；
 * - `properties`：R 水、G 岩、B 已探索、A 可见（与旧版一致）；
 * - `coast`：四向「已知陆/水相邻」标志（跨面邻接，未知边界不出泡沫）；
 * - `heat`：R 到岩浆的归一化热度、G 到水的归一化距离、B 服务端 height、A 到未知区的格数渐变。
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
  coast: THREE.DataTexture;
  heat: THREE.DataTexture;
  /** 平滑类别场（0 为等值线，范围 ±0.5）：R 水面、G 岩性、B 岩浆、A 到未知区。
   *  着色器用它做亚格边界：等值线被均值核磨圆、跨格连续，不再沿格边走方块（L15）。 */
  sdf: THREE.DataTexture;
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
 */
function smoothField(width: number, height: number, mask: (x: number, y: number) => boolean) {
  const S = SDF_SUPERSAMPLE;
  const w = width * S, h = height * S;
  let field = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    field[y * w + x] = mask(Math.floor(x / S), Math.floor(y / S)) ? 1 : 0;
  }
  // 两遍 [1 2 1]/4 分离卷积 ≈ σ ≈ 1 格：核宽正好让等值线圆润到「一个格子的尺度」。
  const radius = S;
  const pass = (axis: 'x' | 'y') => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let d = -radius; d <= radius; d++) {
        const nx = axis === 'x' ? x + d : x, ny = axis === 'y' ? y + d : y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = radius + 1 - Math.abs(d);
        sum += field[ny * w + nx] * k; weight += k;
      }
      out[y * w + x] = sum / weight;
    }
    field = out;
  };
  pass('x'); pass('y');
  for (let i = 0; i < field.length; i++) field[i] -= 0.5;
  return { data: field, width: w, height: h };
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
  /** 跨补片/跨窗口的邻格取样（海岸标志用）：默认与 `sample` 相同。 */
  neighborSample?: SampleAt;
}

export function buildAtlas({ width, height, boundsX, boundsY, faceSize, sample, neighborSample = sample }: AtlasOptions): AtlasSet {
  const colors = new Uint8Array(width * height * 4);
  const properties = new Uint8Array(width * height * 4);
  const coast = new Uint8Array(width * height * 4);
  const heat = new Uint8Array(width * height * 4);
  const lavaDistance = distanceField(width, height, boundsX, boundsY,
    (x, y) => { const cell = sample(x, y); return cell.explored && cell.terrain === 'lava'; }, faceSize, 5);
  const waterDistance = distanceField(width, height, boundsX, boundsY,
    (x, y) => { const cell = sample(x, y); return cell.explored && WATER_TERRAINS.has(cell.terrain); }, faceSize, 5);
  const edge = knownEdgeField(width, height, sample, boundsX, boundsY);
  const knownCell = (x: number, y: number) => { const cell = sample(x, y); return cell.explored && cell.terrain !== 'unknown'; };
  // 外侧只数**已探索的非该类格**：未探索格既不是水也不是陆，不能把水面距离场往探索区外推。
  // 未知格一律算「外侧」：等值线停在探索前沿，不会把地形色推进未探索区（信息诚实）。
  const waterGrid = smoothField(width, height, (x, y) => {
    const cell = sample(boundsX + x, boundsY + y);
    return cell.explored && cell.terrain !== 'unknown' && WATER_TERRAINS.has(cell.terrain);
  }, 3);
  const rockGrid = smoothField(width, height, (x, y) => {
    const cell = sample(boundsX + x, boundsY + y);
    return cell.explored && cell.terrain !== 'unknown' && finishFlags(cell.terrain).rock >= 0.5;
  }, 3);
  const lavaGrid = smoothField(width, height, (x, y) => {
    const cell = sample(boundsX + x, boundsY + y);
    return cell.explored && cell.terrain !== 'unknown' && cell.terrain === 'lava';
  }, 3);
  // 编码：场值 ±0.5 → 0..255（0.5 = 0）。场本身是覆盖度，范围天然是 ±0.5。
  const encodeSdf = (value: number) => Math.max(0, Math.min(255, Math.round((value + 0.5) * 255)));
  const directionOrder: SurfaceDirection[] = ['north', 'east', 'south', 'west'];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = sample(boundsX + x, boundsY + y);
      const known = cell.explored && cell.terrain !== 'unknown';
      const color = known ? FINISH_COLORS[cell.terrain] ?? FINISH_COLORS.buildable : UNKNOWN_COLOR;
      const flags = finishFlags(cell.terrain);
      const i = (y * width + x) * 4;
      colors[i] = srgbByte(color[0]); colors[i + 1] = srgbByte(color[1]); colors[i + 2] = srgbByte(color[2]); colors[i + 3] = 255;
      properties[i] = known ? Math.round(flags.water * 255) : 0;
      properties[i + 1] = known ? Math.round(flags.rock * 255) : 0;
      properties[i + 2] = known ? 255 : 0;
      properties[i + 3] = known && cell.visible ? 255 : 0;
      if (known && flags.water === 1) {
        // Cardinal shore flags use real cube-sphere neighbors, including rotated face seams.
        const flags4 = directionOrder.map((direction) => {
          const { tile } = surfaceStep({ x: boundsX + x, y: boundsY + y }, direction, faceSize);
          const neighbor = neighborSample(tile.x, tile.y);
          return neighbor.explored && neighbor.terrain !== 'unknown' && !WATER_TERRAINS.has(neighbor.terrain) ? 255 : 0;
        });
        coast.set(flags4, i);
      }
      const lavaD = lavaDistance[y * width + x];
      const waterD = waterDistance[y * width + x];
      heat[i] = known ? Math.round(255 * Math.max(0, 1 - (lavaD === 255 ? 5 : lavaD) / 5)) : 0;
      heat[i + 1] = known ? Math.round(255 * Math.max(0, 1 - (waterD === 255 ? 5 : waterD) / 5)) : 0;
      heat[i + 2] = known ? Math.round(255 * Math.min(1, Math.max(0, cell.height ?? 0.35))) : 0;
      heat[i + 3] = known ? Math.round(255 * edge[y * width + x]) : 0;
    }
  }
  // SDF 图是超采样分辨率（每格 4×4）：直接在它的格点上编码。
  const sdf = new Uint8Array(waterGrid.width * waterGrid.height * 4);
  for (let i = 0; i < waterGrid.data.length; i++) {
    sdf[i * 4] = encodeSdf(waterGrid.data[i]);
    sdf[i * 4 + 1] = encodeSdf(rockGrid.data[i]);
    sdf[i * 4 + 2] = encodeSdf(lavaGrid.data[i]);
    // A：到未知区的距离（已探索侧为正）：SDF 版本由 knownEdgeField 放大到超采样分辨率。
    const gx = i % waterGrid.width, gy = Math.floor(i / waterGrid.width);
    const cellEdge = edge[Math.min(height - 1, Math.floor(gy / SDF_SUPERSAMPLE)) * width + Math.min(width - 1, Math.floor(gx / SDF_SUPERSAMPLE))];
    sdf[i * 4 + 3] = encodeSdf(cellEdge * 0.5 - 0.25);
  }
  return {
    color: dataTexture(colors, width, height),
    properties: dataTexture(properties, width, height),
    coast: dataTexture(coast, width, height),
    heat: dataTexture(heat, width, height),
    sdf: dataTexture(sdf, waterGrid.width, waterGrid.height, true),
  };
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
  atlas.color.dispose(); atlas.properties.dispose(); atlas.coast.dispose(); atlas.heat.dispose(); atlas.sdf.dispose();
}
