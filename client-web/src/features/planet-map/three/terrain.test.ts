import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { SHADER_COLOR, SHADER_HEADER, createPlanetSurface, disposePlanetSurface, setPlanetSurfaceFog, updatePlanetSurface } from './terrain';
import { tileNormal } from './projection';
import { surfaceFace, surfaceTile } from '@shared/surface';
import { buildAtlas, disposeAtlas } from './terrain/atlas';

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
    // 局部补片里「本格未知」用补片自己的属性图集判定（local.props.b），不再读 swProps：
    // 双线性采样后 swProps 是四邻加权，不能用来判断「这一格本身是否未知」。
    const edgeBlock = SHADER_COLOR.slice(SHADER_COLOR.indexOf('if(local.props.b < 0.5)'), SHADER_COLOR.indexOf('float swMapWidth'));
    expect(edgeBlock).toContain('local.props.b < 0.5');
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
    // 焦土由连续的「到岩浆格距离」场（heat.r）驱动，不再乘 (1 - swRock)：
    // 岩性权重双线性后是连续场，硬阈值会在岩石/土壤交界重新切出格线（L15）。
    // 水体走 swWater 分支独立着色，陆地的焦土只在这个分支里叠加。
    expect(SHADER_COLOR).toContain('float swScorch = swLavaNear;');
    const landBlock = SHADER_COLOR.slice(SHADER_COLOR.indexOf('} else {\n      // 陆地'));
    expect(landBlock).toContain('swScorch');
    expect(SHADER_COLOR).not.toContain('swLavaNear * (1.0 - swRock)');
  });

  it('亚格边界：未探索格的类别权重恒为「未知」，平滑只在已探索格之间发生', () => {
    // 平滑类别场（sdf 图）只由已探索格生成：未探索格参与 mask 时值为「外侧」（< 0.5），
    // 已探索的水格为「内侧」（> 0.5）。任何未知格都不能在平滑场里变成内侧。
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const shader = uniforms(mesh);
    const sdf = shader.swLocalSdf.value as THREE.DataTexture;
    const bytes = sdf.image.data!;
    const width = sdf.image.width;
    // 局部图集 2×2 格、每格 8×8 超采样：格心 (0,0)=水（已探索）、(1,0)=blocked（未知）。
    const sample = (cellX: number, cellY: number) => {
      const x = cellX * 8 + 4, y = cellY * 8 + 4;
      return Array.from(bytes.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    };
    const water = sample(0, 0), unknown = sample(1, 0), unknownBelow = sample(0, 1);
    expect(water[0]).toBeGreaterThan(128);      // R 水面：已探索水格在内侧
    expect(unknown[0]).toBeLessThan(128);       // 未探索格不参与平滑，恒为外侧
    expect(unknownBelow[0]).toBeLessThan(128);
    disposePlanetSurface(mesh);
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

describe('概览图集采样映射（审查 P1-1）', () => {
  /** 着色器里的概览格坐标公式（surface-shader.ts `swFaceCell`），逐行复刻用于断言。 */
  const overviewCell = (face: number, faceUV: { x: number; y: number }, dims: { x: number; y: number }) => {
    const faceSize = { x: dims.x / 3, y: dims.y / 2 };
    const origin = { x: (face % 3) * faceSize.x, y: Math.floor(face / 3) * faceSize.y };
    const clamp = (v: number) => Math.min(0.999999, Math.max(0.000001, v));
    return { x: origin.x + clamp(faceUV.x) * faceSize.x, y: origin.y + clamp(faceUV.y) * faceSize.y };
  };

  it('六个面都按「面内格数 + 面原点」换算，与 tileNormal 的球面位置一致', () => {
    const dims = { x: 72, y: 48 };
    const faceSize = 24; // face_size：整张图集 3×2 面，每面 24 格
    const faces: [number, number, number, number][] = [
      // face, 面内 u, 面内 v, 采样点在图集里的格坐标（面原点 + u/v × faceSize）
      [0, 0.1, 0.1, 2.4, 2.4],
      [1, 0.25, 0.25, 30, 6],
      [2, 0.9, 0.9, 69.6, 21.6],
      [3, 0.5, 0.5, 12, 36],
      [4, 0.05, 0.95, 25.2, 46.8],
      [5, 0.75, 0.35, 66, 32.4],
    ];
    for (const [face, u, v, cx, cy] of faces) {
      const cell = overviewCell(face, { x: u, y: v }, dims);
      expect(cell.x).toBeCloseTo(cx, 6);
      expect(cell.y).toBeCloseTo(cy, 6);
      // 反推回球面：图集格坐标 → 该面内的格 → 图集全局格，再用 tileNormal 投影回格心。
      const local = { x: Math.floor(cell.x - (face % 3) * faceSize), y: Math.floor(cell.y - Math.floor(face / 3) * faceSize) };
      expect(local.x).toBe(Math.floor(u * faceSize));
      expect(local.y).toBe(Math.floor(v * faceSize));
      const tile = { x: local.x + (face % 3) * faceSize, y: local.y + Math.floor(face / 3) * faceSize };
      expect(surfaceFace(tile, faceSize)).toBe(face);
      // 格心的法线投影回来必须还是同一格（着色位置 = 数据位置）。
      const normal = tileNormal(tile, faceSize, face);
      expect(surfaceTile(normal, faceSize)).toEqual(tile);
    }
  });

  it('面内坐标不再直接乘整张图集格数（旧实现会让面 0 的右下角全采到同一格）', () => {
    const dims = { x: 72, y: 48 };
    const wrong = (u: number, v: number) => ({ x: u * dims.x, y: v * dims.y });
    const fixed = overviewCell(0, { x: 0.9, y: 0.9 }, dims);
    expect(wrong(0.9, 0.9).x).not.toBeCloseTo(fixed.x, 1);
    expect(fixed.x).toBeCloseTo(21.6, 6);
    expect(fixed.y).toBeCloseTo(21.6, 6);
    // 面 0 的两个不同面内点必须落在不同格（旧实现 0.5..1 会夹到同一格）。
    const a = overviewCell(0, { x: 0.55, y: 0.55 }, dims);
    const b = overviewCell(0, { x: 0.95, y: 0.95 }, dims);
    expect(Math.floor(a.x)).not.toBe(Math.floor(b.x));
    expect(SHADER_COLOR).toContain('swFaceOrigin + clamp(swFaceUV');
    expect(SHADER_COLOR).not.toContain('clamp(swFaceUV,0.000001,0.999999) * swOverviewDimensions');
  });

  it('概览图集只把已探索格写成已知，未探索格的四邻权重恒为 0（信息诚实）', () => {
    const mesh = createPlanetSurface(100);
    // 概览 72×48（每面 24 格）：只在 face0 的 (2,2) 已探索。
    const width = 72, height = 48;
    const terrain = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x === 2 && y === 2 ? 'water' : 'unknown')));
    const explored = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 2 && y === 2));
    updatePlanetSurface(mesh, {
      planet: { ...scene(), bounds: { x: 0, y: 0, width: 1, height: 1 }, terrain: [['unknown']], explored: [[false]], visible: [[false]] },
      overview: { cells_width: width, cells_height: height, terrain, explored, visible: explored },
    });
    const shader = uniforms(mesh);
    const props = shader.swOverviewProperties.value as THREE.DataTexture;
    const bytes = props.image.data!;
    const knownAt = (x: number, y: number) => bytes[(y * width + x) * 4 + 2];
    expect(knownAt(2, 2)).toBe(255);
    // 面 0 的其它格、以及其它五个面都必须是未知（旧实现会在这附近读到错位数据）。
    for (const [x, y] of [[3, 3], [23, 23], [24, 2], [48, 2], [2, 24], [60, 40]]) {
      expect(knownAt(x, y)).toBe(0);
    }
    // 面 1 的面内 (0.1,0.1) → 图集格 (24+2.4, 2.4) = (26,2)：旧实现会读到 (7,4) 的错位数据。
    const cell = overviewCell(1, { x: 0.1, y: 0.1 }, { x: width, y: height });
    expect(knownAt(Math.floor(cell.x), Math.floor(cell.y))).toBe(0);
    disposePlanetSurface(mesh);
  });
});

describe('平滑类别场保留单格地形（审查 P2-1）', () => {
  /** 20×20 全已探索窗口，只有给定格是水/岩浆，返回格心 SDF（着色器口径：>0.45 才算内侧）。 */
  const centreSdf = (terrainAt: (x: number, y: number) => string) => {
    const size = 20;
    const atlas = buildAtlas({
      width: size, height: size, boundsX: 0, boundsY: 0, faceSize: size,
      sample: (x, y) => ({ terrain: terrainAt(x, y), explored: true, visible: true }),
    });
    const bytes = atlas.sdf.image.data as Uint8Array;
    const width = atlas.sdf.image.width;
    // 图集是每格 8×8 超采样，格心 = 格号×8 + 4。
    const at = (cellX: number, cellY: number) => {
      const px = cellX * 8 + 4, py = cellY * 8 + 4;
      return (bytes[(py * width + px) * 4] / 255) - 0.5; // R = 水面覆盖度
    };
    disposeAtlas(atlas);
    return at;
  };

  it('孤立 1 格水：格心在平滑场里仍是内侧（旧实现 −0.19 → 陆地）', () => {
    const at = centreSdf((x, y) => (x === 10 && y === 10 ? 'water' : 'buildable'));
    expect(at(10, 10)).toBeGreaterThan(0.45);
    // 周围仍是陆地。
    expect(at(9, 10)).toBeLessThan(0.45);
    expect(at(11, 10)).toBeLessThan(0.45);
  });

  it('孤立 1 格岩浆：格心是内侧', () => {
    const size = 20;
    const atlas = buildAtlas({
      width: size, height: size, boundsX: 0, boundsY: 0, faceSize: size,
      sample: (x, y) => ({ terrain: x === 6 && y === 14 ? 'lava' : 'buildable', explored: true, visible: true }),
    });
    const bytes = atlas.sdf.image.data as Uint8Array;
    const width = atlas.sdf.image.width;
    const at = (cellX: number, cellY: number) => (bytes[((cellY * 8 + 4) * width + cellX * 8 + 4) * 4 + 2] / 255) - 0.5;
    expect(at(6, 14)).toBeGreaterThan(0.45);
    expect(at(5, 14)).toBeLessThan(0.45);
    disposeAtlas(atlas);
  });

  it('斜向 1 格宽的河：每一格格心都在内侧（旧实现 20 格里 18 格画成陆地）', () => {
    const at = centreSdf((x, y) => (y === x ? 'water' : 'buildable'));
    let inside = 0;
    for (let i = 1; i < 19; i++) if (at(i, i) > 0.45) inside += 1;
    expect(inside).toBe(18);
  });

  it('未探索格即使 terrain 是水也不参与平滑（信息诚实）', () => {
    const size = 12;
    const atlas = buildAtlas({
      width: size, height: size, boundsX: 0, boundsY: 0, faceSize: size,
      sample: (x, y) => ({ terrain: x === 6 && y === 6 ? 'water' : 'unknown', explored: x === 6 && y === 6, visible: x === 6 && y === 6 }),
    });
    const bytes = atlas.sdf.image.data as Uint8Array;
    const width = atlas.sdf.image.width;
    const at = (cellX: number, cellY: number) => (bytes[((cellY * 8 + 4) * width + cellX * 8 + 4) * 4] / 255) - 0.5;
    // 唯一的已探索水格本身仍在内侧；它的未探索邻格恒为外侧（不因邻接被带成水）。
    expect(at(6, 6)).toBeGreaterThan(0.45);
    expect(at(5, 6)).toBeLessThan(0);
    expect(at(7, 6)).toBeLessThan(0);
    disposeAtlas(atlas);
  });
});
