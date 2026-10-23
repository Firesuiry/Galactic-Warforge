import * as THREE from 'three';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';

/**
 * GTAO 降噪噪声纹理的确定性版本（`fix/3a-freeze-determinism`）。
 *
 * three r186 的 `GTAOPass` 构造时用 `new SimplexNoise()`（默认 `Math`）生成
 * `pdNoiseTexture`：置乱表 `p[256]` 由 `Math.random()` 填，**每次构造都不同**。
 * 这张噪声决定降噪时每个像素的采样旋转角，于是同一场景跨两次运行截图不逐字节一致
 * （high / balanced 档，差异约 2–18% 像素，最大通道差 ~100）。low 档关 AO 所以本来
 * 就是确定的。
 *
 * 这里用固定种子重建同一张 RGBA8 噪声贴图（格式与 `GTAOPass._generateNoise` 一致），
 * 并换掉 `pdNoiseTexture` 与 `pdMaterial.uniforms.tNoise`：
 *
 * - 冻结（`?freeze=1`）下画面是时间的纯函数，跨运行逐字节一致；
 * - 非冻结时观感不变——噪声只用于给降噪采样一个逐像素的旋转角，具体图案不可见。
 *
 * GTAO 的另一张噪声（`gtaoNoiseTexture`）由 `generateMagicSquareNoise()` 生成，
 * 是纯算术的魔方阵，本来就是确定的，不动它。
 */

/** 固定种子（黄金分割常数，与 VFX 的 `hash01` 无耦合，只是习惯取值）。 */
export const AO_NOISE_SEED = 0x9e3779b9;

/** 与 `GTAOPass._generateNoise()` 的默认边长一致。 */
export const AO_NOISE_SIZE = 64;

/** mulberry32：32 位状态的确定性伪随机，返回 [0, 1)。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 固定种子的 GTAO 降噪噪声贴图。
 *
 * 数据布局与 `GTAOPass._generateNoise(size)` 逐字节同构：四个通道各采一次 2D simplex
 * 噪声（x/y 偏移 0 / size），映射到 0–255。同 seed 同 size 永远得到同一张图。
 */
export function createSeededNoiseTexture(size = AO_NOISE_SIZE, seed = AO_NOISE_SEED): THREE.DataTexture {
  const simplex = new SimplexNoise({ random: mulberry32(seed) });
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const offset = (i * size + j) * 4;
      data[offset] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[offset + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[offset + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
      data[offset + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** 只依赖用到的字段，单测可以用普通对象代替真实的 GTAOPass。 */
interface GtaoNoiseTarget {
  pdNoiseTexture?: THREE.Texture | null;
  pdMaterial: { uniforms: Record<string, { value: unknown }> };
}

/**
 * 把 GTAO 的降噪噪声换成固定种子版本，并同步 `pdMaterial` 的 `tNoise`。
 * 旧纹理（构造时随机生成的那张）立即释放，`GTAOPass.dispose()` 之后释放的是新纹理，
 * 不会重复释放。返回新纹理（调试探针 / 单测断言用）。
 */
export function useDeterministicAoNoise(gtao: GtaoNoiseTarget, seed = AO_NOISE_SEED): THREE.DataTexture {
  const texture = createSeededNoiseTexture(AO_NOISE_SIZE, seed);
  const previous = gtao.pdNoiseTexture;
  gtao.pdNoiseTexture = texture;
  gtao.pdMaterial.uniforms.tNoise.value = texture;
  previous?.dispose();
  return texture;
}
