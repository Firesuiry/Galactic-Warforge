import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

/**
 * PBR 材质库：纹素密度（每格 1 次）、sRGB 只转一次、贴图失败回退。
 * 贴图池是模块级单例，所以每个用例用 `vi.resetModules()` 拿一份干净模块。
 */
async function loadMaterialModule() {
  vi.resetModules();
  return import('./industrial-materials');
}

/** 假贴图组：DataTexture 即可（单测不发网络请求）。 */
function fakeSet() {
  const make = () => new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  return { albedo: make(), orm: make(), normal: make() };
}

describe('PBR material library', () => {
  afterEach(() => vi.resetModules());

  it('reports not ready before preload so callers fall back to procedural textures', async () => {
    const { industrialMaterialsReady, createPbrMaterial } = await loadMaterialModule();
    // 单测里不发起网络加载：未调用 preload 时贴图池为空。
    expect(industrialMaterialsReady()).toBe(false);
    expect(createPbrMaterial('ceramic', '#e9edf0')).toBeNull();
  });

  it('injects triplanar sampling into the standard shader without requiring geometry UVs', async () => {
    const { applyTriplanar } = await loadMaterialModule();
    const material = new THREE.MeshStandardMaterial();
    applyTriplanar(material, fakeSet(), 1);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>' };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vTriPosition');
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(shader.fragmentShader).toContain('triplanarSample');
    expect(shader.fragmentShader).toContain('uTriTint');
    expect(shader.uniforms.uTriAlbedo).toBeDefined();
    // 不依赖 uv 属性：片元里没有 vMapUv 采样。
    expect(shader.fragmentShader).not.toContain('vMapUv');
    expect(material.customProgramCacheKey()).toBe('industrial-triplanar');
  });

  it('keeps one repeat per tile across map sizes (M1: density is per cell, not per world unit)', async () => {
    const { applyTriplanar, setIndustrialTileScale, industrialTileScale } = await loadMaterialModule();
    // 1 格 = tileScale 个图层空间单位：face 288 → 0.386，face 816 → 0.153（surfaceTileSize）。
    const scales: Record<string, number> = { 288: 100 * Math.PI / (2 * 288) / Math.SQRT2, 816: 100 * Math.PI / (2 * 816) / Math.SQRT2 };
    const repeats = [1, 1.2, 3];
    const materials = repeats.map(repeat => {
      setIndustrialTileScale(scales[288]);
      const material = new THREE.MeshStandardMaterial();
      applyTriplanar(material, fakeSet(), repeat);
      return { material, repeat };
    });
    const perTile = (material: THREE.MeshStandardMaterial) => (material.userData.triplanar as { uTriScale: { value: number } }).uTriScale.value * industrialTileScale();
    for (const { material, repeat } of materials) expect(perTile(material)).toBeCloseTo(repeat, 6);
    // 换地图（face 816）：同一批材质的 uniform 原地更新，每格重复次数不变。
    setIndustrialTileScale(scales[816]);
    expect(industrialTileScale()).toBeCloseTo(scales[816], 9);
    for (const { material, repeat } of materials) expect(perTile(material)).toBeCloseTo(repeat, 6);
    // 两张大图的 uniform 数值不同（之前是同一个世界单位常量，差 5 倍）。
    expect(materials[0].material.userData.triplanar).not.toBe(materials[1].material.userData.triplanar);
    setIndustrialTileScale(1);
  });

  it('converts palette colours to linear exactly once (M2: no double sRGB compression)', async () => {
    const { pbrTint, MEAN_ALBEDO } = await loadMaterialModule();
    const ceramic = pbrTint('ceramic', '#e9edf0');
    const albedoMean = new THREE.Color(MEAN_ALBEDO.ceramic);
    // 材质最终平均 albedo = 贴图均值 × tint，必须 ≤ 1 且等于调色板目标色。
    // 二次 sRGB 转换会把陶瓷红通道推到 1.65（审查实测），白陶瓷过曝成暖白。
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(albedoMean[channel] * ceramic[channel]).toBeLessThanOrEqual(1);
      expect(albedoMean[channel] * ceramic[channel]).toBeCloseTo(new THREE.Color('#e9edf0')[channel], 6);
    }
    // 贴图均值与目标同色时 tint = 1（不再被压暗）。
    const identity = pbrTint('ceramic', MEAN_ALBEDO.ceramic);
    expect(identity.r).toBeCloseTo(1, 6);
    expect(identity.g).toBeCloseTo(1, 6);
    expect(identity.b).toBeCloseTo(1, 6);
    // 目标色 = 调色板白陶瓷 → 贴图均值中性化后平均色回到调色板（线性空间比较）。
    const expected = new THREE.Color('#e9edf0');
    const mean = new THREE.Color(MEAN_ALBEDO.ceramic);
    expect(mean.r * ceramic.r).toBeCloseTo(expected.r, 6);
    expect(mean.g * ceramic.g).toBeCloseTo(expected.g, 6);
    expect(mean.b * ceramic.b).toBeCloseTo(expected.b, 6);
  });

  it('falls back to procedural finishes when textures are unavailable and keeps one material per family', async () => {
    const { IndustrialSurfaces } = await import('./industrial-surfaces');
    const surfaces = new IndustrialSurfaces();
    expect(surfaces.usingPbr).toBe(false);
    const ceramic = surfaces.get('ceramic');
    expect(ceramic.map).toBeTruthy();
    expect(ceramic.normalMap).toBeTruthy();
    // 同一键返回同一对象（合批按材质归并）。
    expect(surfaces.get('ceramic')).toBe(ceramic);
    // 阵营色来自调色板。
    expect(ceramic.color.getHexString()).toBe('e9edf0');
    expect(surfaces.get('enemyCeramic').color.getHexString()).toBe('3b3f45');
    // 贴图未就绪时 upgrade 不改变材质。
    expect(surfaces.upgrade()).toBe(false);
    expect(surfaces.get('ceramic')).toBe(ceramic);
    surfaces.dispose();
  });

  it('gives emissive pieces their palette glow and never attaches PBR maps to them', async () => {
    const { IndustrialSurfaces } = await import('./industrial-surfaces');
    const surfaces = new IndustrialSurfaces();
    const glow = surfaces.get('blue');
    expect(glow.emissive.getHexString()).toBe('3fe6ff');
    expect(glow.map).toBeNull();
    expect(surfaces.get('warning').emissive.getHexString()).toBe('ffb04a');
    surfaces.dispose();
  });
});
