/**
 * 群落与地形属性（第 23 轮 3A 画质地表分支）。
 *
 * 服务端地形只有 `buildable / blocked / water / lava`（客户端另有 `unknown`）；
 * 行星 `kind` 只有 `rocky / gas_giant / ice`。这里把「服务端事实」翻译成渲染侧的
 * 生物群落参数，**不引入服务端没有的地形信息**：群落差异只是同一套材质上的
 * 色调/湿度偏置（按星球 ID 种子确定性），区块混合权重由世界坐标噪声决定。
 */

export type BiomeKind = 'temperate' | 'ice';

export interface BiomeProfile {
  kind: BiomeKind;
  /** 色相偏移（-1..1，施加在 HSV 色相环上，幅度小）。 */
  hueShift: number;
  /** 饱和度倍率（0.8..1.2）。 */
  saturation: number;
  /** 明度倍率。 */
  brightness: number;
  /** 可建造地三种土的混合中心权重：苔草 / 火山土 / 碎石。 */
  soilWeights: [number, number, number];
  /** 草被密度倍率（ice = 0）。 */
  grassDensity: number;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

/** 按行星 ID 取确定性种子（同一星球每次刷新、每台机器一致）。 */
export function planetSeed(planetId: string) {
  return hashString(planetId);
}

export function biomeProfile(kind: string | undefined, planetId: string): BiomeProfile {
  const seed = planetSeed(planetId);
  if (kind === 'ice') {
    return {
      kind: 'ice', hueShift: (seed - 0.5) * 0.06, saturation: 0.55 + seed * 0.1, brightness: 1.12 + seed * 0.06,
      soilWeights: [0.05, 0.25, 0.7], grassDensity: 0,
    };
  }
  // 温带火山（rocky 及未知 kind 的兜底）：苔草为主，火山土与碎石按大尺度噪声穿插。
  return {
    kind: 'temperate', hueShift: (seed - 0.5) * 0.10, saturation: 0.95 + seed * 0.18, brightness: 0.92 + seed * 0.12,
    soilWeights: [0.55 + seed * 0.1, 0.25, 0.2 - seed * 0.05], grassDensity: 1,
  };
}

/** 服务端 terrain 字符串 → 渲染分类（与 terrain.ts 的 FINISHES 同一口径）。 */
export const ROCK_TERRAINS = new Set(['blocked', 'rock', 'mountain', 'mountains']);
export const WATER_TERRAINS = new Set(['water', 'sea', 'ocean']);
export const LAVA_TERRAINS = new Set(['lava']);
export const SOIL_TERRAINS = new Set(['buildable', 'plains', 'plain', 'grass', 'grassland', 'forest', 'desert', 'sand']);

export function isRock(terrain: string) { return ROCK_TERRAINS.has(terrain); }
export function isWater(terrain: string) { return WATER_TERRAINS.has(terrain); }
export function isLava(terrain: string) { return LAVA_TERRAINS.has(terrain); }
export function isSoil(terrain: string) { return SOIL_TERRAINS.has(terrain); }

/**
 * 着色器里的层号（与 texture-library.ts 的 TERRAIN_LAYER_NAMES 顺序一致）。
 * 0 苔草 / 1 草地 / 2 火山土 / 3 碎石 / 4 泥 / 5 沙泥 / 6 玄武岩 / 7 地衣岩 / 8 雪 / 9 冰 / 10 岩浆
 */
export const LAYER = {
  mossGrass: 0, grass: 1, volcanicSoil: 2, gravel: 3, mud: 4, sandMud: 5,
  basalt: 6, lichenRock: 7, snow: 8, ice: 9, lava: 10,
} as const;
