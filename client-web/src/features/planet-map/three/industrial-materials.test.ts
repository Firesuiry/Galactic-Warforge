import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyTriplanar, createPbrMaterial, industrialMaterialsReady } from './industrial-materials';
import { IndustrialSurfaces } from './industrial-surfaces';

function fakeSet() {
  const make = () => new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  return { albedo: make(), orm: make(), normal: make() };
}

describe('PBR material library', () => {
  it('reports not ready before preload so callers fall back to procedural textures', () => {
    // 单测里不发起网络加载：未调用 preload 时贴图池为空。
    expect(industrialMaterialsReady()).toBe(false);
    expect(createPbrMaterial('ceramic', '#e9edf0')).toBeNull();
  });

  it('injects triplanar sampling into the standard shader without requiring geometry UVs', () => {
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

  it('falls back to procedural finishes when textures are unavailable and keeps one material per family', () => {
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

  it('gives emissive pieces their palette glow and never attaches PBR maps to them', () => {
    const surfaces = new IndustrialSurfaces();
    const glow = surfaces.get('blue');
    expect(glow.emissive.getHexString()).toBe('3fe6ff');
    expect(glow.map).toBeNull();
    expect(surfaces.get('warning').emissive.getHexString()).toBe('ffb04a');
    surfaces.dispose();
  });
});
