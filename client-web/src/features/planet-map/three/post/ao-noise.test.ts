import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  AO_NOISE_SEED,
  AO_NOISE_SIZE,
  createSeededNoiseTexture,
  mulberry32,
  useDeterministicAoNoise,
} from './ao-noise';

/**
 * 冻结确定性（`fix/3a-freeze-determinism`）：GTAOPass 的降噪噪声曾经由 `Math.random()`
 * 播种，同一场景跨两次运行截图差 2–18% 像素。这里锁住三件事：
 * 1. 同种子生成的噪声逐字节一致，不同种子不同；
 * 2. 贴图格式与 `GTAOPass._generateNoise()` 同构（RGBA8、repeat、尺寸）；
 * 3. 换噪声时 `pdMaterial.uniforms.tNoise` 同步指向新纹理，旧纹理被释放。
 */
function pixels(texture: THREE.DataTexture): number[] {
  return Array.from(texture.image.data as Uint8Array);
}

/** 只依赖 `pdNoiseTexture` / `pdMaterial.uniforms.tNoise` 的替身。 */
function fakeGtao() {
  const previous = { disposed: false, dispose() { previous.disposed = true; } };
  return {
    previous,
    gtao: {
      pdNoiseTexture: previous as unknown as THREE.Texture,
      pdMaterial: { uniforms: { tNoise: { value: previous as unknown } } },
    },
  };
}

describe('GTAO 降噪噪声（冻结确定性）', () => {
  it('同种子逐字节一致，不同种子不同（不依赖 Math.random）', () => {
    const a = createSeededNoiseTexture();
    const b = createSeededNoiseTexture();
    expect(pixels(a)).toEqual(pixels(b));
    const other = createSeededNoiseTexture(AO_NOISE_SIZE, AO_NOISE_SEED + 1);
    expect(pixels(other)).not.toEqual(pixels(a));
  });

  it('格式与 GTAOPass._generateNoise 同构：RGBA8、64×64、repeat 平铺', () => {
    const texture = createSeededNoiseTexture();
    expect(texture.image.width).toBe(AO_NOISE_SIZE);
    expect(texture.image.height).toBe(AO_NOISE_SIZE);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.type).toBe(THREE.UnsignedByteType);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect((texture.image.data as Uint8Array).length).toBe(AO_NOISE_SIZE * AO_NOISE_SIZE * 4);
  });

  it('换噪声时 pdMaterial.tNoise 指向新纹理，旧纹理释放一次', () => {
    const { gtao, previous } = fakeGtao();
    const texture = useDeterministicAoNoise(gtao);
    expect(gtao.pdNoiseTexture).toBe(texture);
    expect(gtao.pdMaterial.uniforms.tNoise.value).toBe(texture);
    expect(previous.disposed).toBe(true);
  });

  it('mulberry32 是可复现的 32 位序列（[0, 1) 且同种子同序列）', () => {
    const first = mulberry32(7);
    const second = mulberry32(7);
    const values = Array.from({ length: 8 }, () => first());
    expect(values).toEqual(Array.from({ length: 8 }, () => second()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
