import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { SHADER_COLOR, SHADER_HEADER, createPlanetSurface, disposePlanetSurface, setPlanetSurfaceFog, updatePlanetSurface } from './terrain';

function scene(): PlanetSceneView {
  return {
    planet_id: 'p', discovered: true, tick: 1, surface: { topology: 'cube_sphere' as const, face_size: 512 }, map_width: 1536, map_height: 1024,
    bounds: { x: 123, y: 76, width: 2, height: 2 },
    terrain: [['water', 'blocked'], ['buildable', 'lava']],
    explored: [[true, false], [true, false]], visible: [[true, false], [false, false]],
  };
}

function uniforms(mesh: ReturnType<typeof createPlanetSurface>) {
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' } as Parameters<typeof mesh.material.onBeforeCompile>[0];
  mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.uniforms;
}

describe('3D player-visible terrain', () => {
  it('does not encode the biome of unexplored server cells in GPU textures', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const shader = uniforms(mesh);
    const color = shader.swLocalColor.value as THREE.DataTexture;
    const properties = shader.swLocalProperties.value as THREE.DataTexture;
    const bytes = properties.image.data!;
    expect(Array.from(bytes.slice(0, 4))).toEqual([255, 0, 255, 255]);
    expect(Array.from(bytes.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(Array.from(bytes.slice(8, 12))).toEqual([0, 38, 255, 0]);
    expect(Array.from(color.image.data!.slice(4, 8))).toEqual(Array.from(color.image.data!.slice(12, 16)));
    disposePlanetSurface(mesh);
  });

  it('keeps local scene resolution and places it at the server bounds on large planets', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const shader = uniforms(mesh);
    expect(shader.swPatchBounds.value[0].toArray()).toEqual([123/1536,76/1024,2/1536,2/1024]);
    expect(shader.swLocalColor.value.image.width).toBe(2);
    expect(shader.swLocalColor.value.image.height).toBe(2);
    expect(mesh.geometry.parameters.radius).toBe(100);
    disposePlanetSurface(mesh);
  });

  it('retains textures across tick updates and disposes old textures when exploration changes', () => {
    const mesh = createPlanetSurface(100);
    const planet = scene();
    updatePlanetSurface(mesh, { planet });
    const shader = uniforms(mesh);
    const original = shader.swLocalColor.value;
    const disposed = vi.fn();
    original.addEventListener('dispose', disposed);
    updatePlanetSurface(mesh, { planet: { ...planet, tick: 2 } });
    expect(shader.swLocalColor.value).toBe(original);
    updatePlanetSurface(mesh, { planet: { ...planet, explored: [[true, true], [true, false]] } });
    expect(shader.swLocalColor.value).not.toBe(original);
    expect(disposed).toHaveBeenCalledOnce();
    disposePlanetSurface(mesh);
  });

  it('encodes only explored dry neighbors as shores and never smooths through fog', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const coast = uniforms(mesh).swLocalCoast.value as THREE.DataTexture;
    // Water at (123,76): south is known land, east is hidden rock.
    expect(Array.from(coast.image.data!.slice(0, 4))).toEqual([0, 0, 255, 0]);
    expect(Array.from(coast.image.data!.slice(4))).toEqual(Array(12).fill(0));
    disposePlanetSurface(mesh);
  });

  it('paints unexplored cells as a visible slate survey veil, never near-black space', () => {
    // Old semantics mixed an almost-black (0.004, 0.011, 0.023) veil, which ACES
    // tonemapped into the starfield, so the planet vanished when the camera moved
    // into unexplored space. The base must stay a clearly readable dark slate.
    const veil = /vec3 swVeil = (vec3\([^)]*\))/.exec(SHADER_COLOR);
    expect(veil).not.toBeNull();
    const base = veil![1].slice('vec3('.length, -1).split(',').map((value) => Number(value.trim()));
    expect(base[0]).toBeGreaterThanOrEqual(0.04);
    expect(base[0]).toBeLessThanOrEqual(0.08);
    expect(base[2]).toBeGreaterThan(base[0]);
    // Veil detail must be deterministic: no animation time may leak into unknown cells.
    const veilBlock = SHADER_COLOR.slice(SHADER_COLOR.indexOf('float swVeilPatch'), SHADER_COLOR.indexOf('swAlbedo = mix(swVeil'));
    expect(veilBlock).toContain('swFbm');
    expect(veilBlock).not.toContain('swTime');
    // Close ground view must not be a flat wash: tile-scale survey grid + fine
    // relief, both faded out with camera distance so the globe view stays clean.
    expect(veilBlock).toContain('swSurveyGrid');
    expect(veilBlock).toContain('swVeilRelief');
    expect(veilBlock).toContain('swGridFade');
    expect(SHADER_COLOR).toContain('fwidth(swGridUV)');
    // Terrain relief stays exclusive to known cells for explored terrain, while
    // unknown cells get their own relief gated by (1.0 - swKnown).
    expect(SHADER_COLOR).toContain('* swKnown;');
    expect(SHADER_COLOR).toContain('swVeilRelief * 0.010 * (1.0 - swKnown) * swFog');
    const mesh = createPlanetSurface(100);
    expect(mesh.material.customProgramCacheKey()).toBe('siliconworld-planet-surface-v8');
    disposePlanetSurface(mesh);
  });

  it('迷雾开关 uniform 在着色器里声明（漏声明会让整个片元着色器编译失败）', () => {
    expect(SHADER_HEADER).toContain('uniform float swFog;');
  });

  it('updatePlanetSurface 的 fogLayer 同步到 swFog uniform（局部曲面重建后开关同样生效）', () => {
    const mesh = createPlanetSurface(100);
    const shader = uniforms(mesh);
    updatePlanetSurface(mesh, { planet: scene(), fogLayer: false });
    expect(shader.swFog.value).toBe(0);
    updatePlanetSurface(mesh, { planet: scene(), fogLayer: true });
    expect(shader.swFog.value).toBe(1);
    // 不带 fogLayer 的刷新不改开关（实时数据更新不会把玩家的图层选择重置）。
    updatePlanetSurface(mesh, { planet: scene(), fogLayer: false });
    updatePlanetSurface(mesh, { planet: { ...scene(), tick: 2 } });
    expect(shader.swFog.value).toBe(0);
    disposePlanetSurface(mesh);
  });

  it('迷雾图层开关：swFog uniform 默认 1，setPlanetSurfaceFog(false) 后未探索格不再盖测绘面纱', () => {
    // 着色器里面纱与已知地形按 swFog 混合：关掉 = 未探索格按已知地形显示（与 2D layers.fog 同义）。
    expect(SHADER_COLOR).toContain('swAlbedo = mix(mix(swAlbedo, mix(swUnknownBase, swVeil, swFog), swFog), swAlbedo, swKnown);');
    const mesh = createPlanetSurface(100);
    expect(() => setPlanetSurfaceFog(mesh, false)).not.toThrow();
    expect(() => setPlanetSurfaceFog(mesh, true)).not.toThrow();
    // 没有 uniform 的网格（已销毁/非本模块创建）也不抛。
    expect(() => setPlanetSurfaceFog({} as never, false)).not.toThrow();
    disposePlanetSurface(mesh);
  });

  it('lights the fog frontier from explored neighbours without reading hidden biomes', () => {
    // The frontier glow is derived from the same properties atlas the surface
    // samples: unknown cells (b < 0.5) inspect their 8 atlas neighbours' known bit
    // and never read hidden terrain/colour data.
    const edgeBlock = SHADER_COLOR.slice(SHADER_COLOR.indexOf('if(swProps.b < 0.5)'), SHADER_COLOR.indexOf('float swMapWidth'));
    expect(edgeBlock).toContain('swProps.b < 0.5');
    expect(edgeBlock).toContain('swLocalProperties');
    expect(edgeBlock).not.toContain('swLocalColor');
    expect(SHADER_COLOR).toContain('swKnownEdge *');
    const mesh = createPlanetSurface(100);
    expect(mesh.material.customProgramCacheKey()).toBe('siliconworld-planet-surface-v8');
    disposePlanetSurface(mesh);
  });

  it('follows the physical north seam into its visible patch instead of the atlas neighbor', () => {
    const mesh = createPlanetSurface(100);
    const planet: PlanetSceneView = {
      ...scene(), surface: { topology: 'cube_sphere', face_size: 2 }, map_width: 6, map_height: 4,
      bounds: { x: 1, y: 0, width: 1, height: 1 },
      terrain: [['water']], explored: [[true]], visible: [[true]],
      surface_patches: [{ bounds: { x: 3, y: 3, width: 1, height: 1 }, terrain: [['buildable']], explored: [[true]], visible: [[true]] }],
    };
    updatePlanetSurface(mesh, { planet });
    const shader = uniforms(mesh);
    expect(Array.from(shader.swLocalCoast.value.image.data.slice(0, 4))).toEqual([255, 0, 0, 0]);
    const dispose = vi.fn();
    shader.swLocalCoast.value.addEventListener('dispose', dispose);
    updatePlanetSurface(mesh, { planet: { ...planet, surface_patches: [{ ...planet.surface_patches![0], explored: [[false]] }] } });
    expect(dispose).toHaveBeenCalledOnce();
    expect(Array.from(shader.swLocalCoast.value.image.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    disposePlanetSurface(mesh);
  });

});

describe('3A terrain shader contract', () => {
  it('采样球面三平面而不是立方体面 UV，接缝处纹理连续', () => {
    // 三平面权重由对象空间位置计算，六面接缝两侧坐标连续 → 没有硬缝。
    expect(SHADER_HEADER).toContain('swTriplanarWeights');
    expect(SHADER_HEADER).toContain('texture2D(swAlbedoArray, vec3(p.zy, layer))');
    expect(SHADER_HEADER).toContain('texture2D(swAlbedoArray, vec3(p.xz, layer))');
    expect(SHADER_HEADER).toContain('texture2D(swAlbedoArray, vec3(p.xy, layer))');
  });

  it('岩浆：板块硬壳 + 裂缝自发光，且不用世界轴向 UV（避免纵向拉伸）', () => {
    const lava = SHADER_COLOR.slice(SHADER_COLOR.indexOf('} else if (swLava > 0.5)'), SHADER_COLOR.indexOf('} else {\n      // 陆地'));
    expect(lava).toContain('swCrustMask');
    expect(lava).toContain('swSeam');
    expect(lava).toContain('swLavaEmissive');
    // 自发光只由时间 uniform 推进（冻结 = 固定相位）。
    expect(lava).toContain('swTime');
    expect(lava).not.toContain('swSurfacePosition.xz *');
  });

  it('岩浆与水相邻、岩浆与建筑相邻不穿帮：焦土圈来自已探索邻格的距离场', () => {
    expect(SHADER_COLOR).toContain('swLavaNear');
    expect(SHADER_COLOR).toContain('swScorch');
    // 焦土只在陆地上生效（岩石不叠焦土），水体按 swWater 分支独立着色。
    expect(SHADER_COLOR).toContain('swLavaNear * (1.0 - swRock)');
  });

  it('未探索格没有草/岩石/矿脉几何（装饰只按 explored 生成）', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: { ...scene(), explored: [[false, false], [false, false]] } });
    const bytes = (uniforms(mesh).swLocalProperties.value as THREE.DataTexture).image.data!;
    // 全部未探索：properties 的 B（已探索）通道全为 0。
    for (let i = 0; i < bytes.length; i += 4) expect(bytes[i + 2]).toBe(0);
    disposePlanetSurface(mesh);
  });
});
