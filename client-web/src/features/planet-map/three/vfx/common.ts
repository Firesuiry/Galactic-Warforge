/**
 * VFX 基础：确定性随机、平滑曲线、档位表。
 *
 * 硬约束（docs/guide/3A画质.md §2）：所有新动画/噪声/粒子遵守 `?freeze=1` 与
 * reduced-motion；冻结后画面是时间的纯函数（固定相位、固定随机种子）。
 * 因此粒子系统不使用 `Math.random()`：随机数一律由 `hash01(seed)` 得出，
 * 同一次发射在任何机器上都是同一组初速/寿命/颜色。
 */

import type { PlanetRenderQuality } from '../render-quality';

/** 32 位整数哈希 → [0, 1)。与 `scripts/gen-vfx-atlas.mjs` 同一套乘子。 */
export function hash01(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 374761393) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 第 index 个「随机」值（同 seed 同 index 恒定）。 */
export function rand(seed: number, index: number): number {
  return hash01(Math.imul(seed | 0, 0x27d4eb2d) + Math.imul(index | 0, 0x165667b1));
}

/** 对称随机 [-1, 1]。 */
export function randSigned(seed: number, index: number): number {
  return rand(seed, index) * 2 - 1;
}

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/**
 * 每档粒子上限与发射率系数。`low` 只砍开销大的项（数量、点光源、序列帧），
 * 画面构成不变：每种特效至少保留 1 个发射器与最小粒子数。
 */
export interface VfxQualitySettings {
  /** 全局粒子池上限（所有发射器共享）。 */
  particleLimit: number;
  /** 发射数量系数（0..1）。 */
  emissionScale: number;
  /** 枪口/爆炸点光源上限（0 = 不启用）。 */
  dynamicLights: number;
  /** 工业氛围发射器是否开启。 */
  industry: boolean;
  /** 地面焦痕贴花上限（战斗焦痕池容量）。 */
  decals: number;
}

export const VFX_QUALITY: Record<PlanetRenderQuality, VfxQualitySettings> = {
  low: { particleLimit: 900, emissionScale: 0.45, dynamicLights: 0, industry: true, decals: 12 },
  balanced: { particleLimit: 2600, emissionScale: 0.8, dynamicLights: 2, industry: true, decals: 24 },
  high: { particleLimit: 5000, emissionScale: 1, dynamicLights: 4, industry: true, decals: 32 },
};
