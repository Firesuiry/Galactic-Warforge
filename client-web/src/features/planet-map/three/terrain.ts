import * as THREE from 'three';
import type { FogMapView, PlanetOverviewView, PlanetSceneView } from '@shared/types';
import { getFogState, getTerrainTile, type PlanetRenderView } from '../model';
import { SHADER_COLOR, SHADER_HEADER } from './terrain/surface-shader';
import { buildAtlas, disposeAtlas, localSampler, UNKNOWN_COLOR, type AtlasSet } from './terrain/atlas';
import { biomeProfile } from './terrain/biome';
import { loadTerrainTextures, createPlaceholderTerrainTextures, type TerrainTextures } from './terrain/texture-library';

export { SHADER_COLOR, SHADER_HEADER };

export type PlanetSurface = THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
export interface PlanetSurfaceData {
  planet: PlanetRenderView;
  overview?: PlanetOverviewView;
  fog?: FogMapView | PlanetSceneView;
  /** 图层「迷雾」开关（与 `setPlanetSurfaceFog` 同一个值）：建面/刷新时同步到 uniform。 */
  fogLayer?: boolean;
}

interface SurfaceState {
  overview: AtlasSet;
  local: AtlasSet;
  textures: TerrainTextures;
  uniforms: {
    swOverviewColor: { value: THREE.DataTexture };
    swOverviewProperties: { value: THREE.DataTexture };
    swLocalColor: { value: THREE.DataTexture };
    swLocalProperties: { value: THREE.DataTexture };
    swOverviewCoast: { value: THREE.DataTexture };
    swLocalCoast: { value: THREE.DataTexture };
    swOverviewHeat: { value: THREE.DataTexture };
    swLocalHeat: { value: THREE.DataTexture };
    swMapDimensions: { value: THREE.Vector2 };
    swLocalDimensions: { value: THREE.Vector2 };
    swOverviewDimensions: { value: THREE.Vector2 };
    swTime: { value: number };
    /** 迷雾/测绘面纱开关（R20-A 图层「迷雾」）：0 = 不盖面纱，未探索格按已知地形显示。 */
    swFog: { value: number };
    swPatchBounds: { value: THREE.Vector4[] };
    swPatchUV: { value: THREE.Vector4[] };
    swWaterNormal: { value: THREE.Texture | null };
    swAlbedoArray: { value: THREE.DataArrayTexture };
    swPackedArray: { value: THREE.DataArrayTexture };
    swLavaEmissionMap: { value: THREE.Texture | null };
    swSoilWeights: { value: THREE.Vector3 };
    swBiomeTint: { value: THREE.Color };
    swBiomeSaturation: { value: number };
    swBiomeBrightness: { value: number };
    swBiomeIce: { value: number };
    swSeed: { value: number };
    swDebug: { value: number };
    swSunObject: { value: THREE.Vector3 };
    swCameraObject: { value: THREE.Vector3 };
  };
  source?: unknown[];
}
const states = new WeakMap<PlanetSurface, SurfaceState>();

/** 纹理库只加载一次（同一页面内所有星球/曲面共用同一组 DataArrayTexture）。 */
let terrainTexturesPromise: Promise<TerrainTextures> | null = null;
const textureListeners = new Set<(textures: TerrainTextures) => void>();
function sharedTerrainTextures() {
  if (!terrainTexturesPromise) {
    terrainTexturesPromise = loadTerrainTextures((textures) => {
      for (const listener of textureListeners) listener(textures);
    });
  }
  return terrainTexturesPromise;
}

/** 水法线贴图（512² webp）：独立于 DataArrayTexture 的普通 2D 图。 */
let waterNormalPromise: Promise<THREE.Texture | null> | null = null;
function loadWaterNormal() {
  if (!waterNormalPromise) {
    waterNormalPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const texture = new THREE.Texture(image);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        // 掠射角下水纹沿视线拉伸，默认各向异性 1 会产生细密条纹：开到硬件上限。
        texture.anisotropy = 8;
        texture.colorSpace = THREE.NoColorSpace;
        texture.needsUpdate = true;
        resolve(texture);
      };
      image.onerror = () => resolve(null);
      image.src = `${import.meta.env.BASE_URL ?? '/'}assets/textures/terrain/water_normal.webp`;
    });
  }
  return waterNormalPromise;
}

export function createPlanetSurface(radius: number): PlanetSurface {
  const empty = () => buildAtlas({ width: 1, height: 1, boundsX: 0, boundsY: 0, faceSize: 1, sample: () => ({ terrain: 'unknown', explored: false, visible: false }) });
  const overview = empty(), local = empty();
  const textures = createPlaceholderTerrainTextures();
  const uniforms = {
    swPatchBounds: { value: Array.from({ length: 7 }, () => new THREE.Vector4()) },
    swPatchUV: { value: Array.from({ length: 7 }, () => new THREE.Vector4()) },
    swOverviewColor: { value: overview.color }, swOverviewProperties: { value: overview.properties },
    swLocalColor: { value: local.color }, swLocalProperties: { value: local.properties },
    swOverviewCoast: { value: overview.coast }, swLocalCoast: { value: local.coast },
    swOverviewHeat: { value: overview.heat }, swLocalHeat: { value: local.heat },
    swAlbedoArray: { value: textures.albedo }, swPackedArray: { value: textures.packed },
    swWaterNormal: { value: null as THREE.Texture | null }, swLavaEmissionMap: { value: null as THREE.Texture | null },
    swMapDimensions: { value: new THREE.Vector2(3, 2) }, swLocalDimensions: { value: new THREE.Vector2(1, 1) }, swOverviewDimensions: { value: new THREE.Vector2(3, 2) },
    swTime: { value: 0 }, swFog: { value: 1 },
    swSoilWeights: { value: new THREE.Vector3(0.55, 0.25, 0.2) }, swBiomeTint: { value: new THREE.Color(1, 1, 1) },
    swBiomeSaturation: { value: 1 }, swBiomeBrightness: { value: 1 }, swBiomeIce: { value: 0 }, swSeed: { value: 0 },
    // 测试钩子（?terrainDebug=1 时 = 1）：把 swKnown / swWater / swLava / swTexDetail / swBiomeNoise 直接输出成颜色。
    swDebug: { value: 0 },
    swSunObject: { value: new THREE.Vector3(0, 1, 0) }, swCameraObject: { value: new THREE.Vector3(0, 0, 200) },
  };
  // envMapIntensity 压低：程序化房间环境图在光滑水面上会映出一大片「云状亮斑」；
  // 水面反射由着色器里的天空渐变 + 太阳高光负责，陆地是粗糙漫反射，几乎不受影响。
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.91, metalness: 0.025, envMapIntensity: 0.18 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 swSurfacePosition;\nvarying vec3 swSurfaceWorldNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nswSurfacePosition = position;\nswSurfaceWorldNormal = normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + SHADER_HEADER)
      .replace('#include <map_fragment>', SHADER_COLOR)
      // 每像素粗糙度：陆地取纹理粗糙度，水 0.075（清晰的环境反射），岩浆 0.62（硬壳）。
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        roughnessFactor = mix(mix(0.94, swSurfaceRough, swKnown), swSurfaceRough, swWaterMask);
        roughnessFactor = mix(roughnessFactor, 0.62, swLavaMask);
      `)
      .replace('#include <metalnessmap_fragment>', /* glsl */`
        #include <metalnessmap_fragment>
        metalnessFactor = mix(mix(0.025, 0.02, swKnown), swWaterMetal, swWaterMask);
      `)
      // 岩浆自发光（被 bloom 吃到）：来自 lava_emissive 图与自发光底色。
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        // 水面：环境反射走解析式（swWaterSky），不走 scene.environment——后者在粗糙度低时
        // 会把整片水映成程序化房间的亮斑（indirectSpecular 在 lights_fragment_end 里清零）。
        totalEmissiveRadiance += swLavaEmissive + swWaterSky * swWaterMask;
      `)
      // 水面：物理镜面项关掉（粗糙球面 + 程序化环境会糊成一片亮斑），太阳高光由
      // map_fragment 段的解析式 swWaterSky 提供。
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= mix(1.0, 0.0, swWaterMask);')
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        // 水面反射：用解析天空色替换环境镜面（陆地保持原环境光照）。
        reflectedLight.indirectSpecular *= mix(1.0, 0.0, swWaterMask);
        reflectedLight.indirectDiffuse *= mix(1.0, 0.55, swWaterMask);
        reflectedLight.directSpecular *= mix(1.0, 0.0, swWaterMask);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #ifdef SW_WATER_TEST_FLAT
        #endif
        #include <normal_fragment_maps>
        vec3 swDx = dFdx(-vViewPosition), swDy = dFdy(-vViewPosition);
        vec3 swR1 = cross(swDy, normal), swR2 = cross(normal, swDx);
        float swDet = dot(swDx, swR1);
        vec3 swGradient = sign(swDet) * (dFdx(swHeightField) * swR1 + dFdy(swHeightField) * swR2);
        normal = normalize(abs(swDet) * normal - swGradient);
        // 水面：两层滚动法线在世界空间扰动球面法线（保留球面光照与太阳高光）。
        if (swWaterMask > 0.001) {
          vec3 swEast = normalize(cross(vec3(0.0, 1.0, 0.0), swP) + vec3(0.0001));
          vec3 swSouth = cross(swP, swEast);
          float swStrength = mix(0.12, 0.55, swWaveDetailOut);
          vec3 swWaterNormal = normalize(swP - swEast * swWaterNormalXY.x * swStrength - swSouth * swWaterNormalXY.y * swStrength);
          // swWaterNormal 是世界空间法线；转到视图空间后替换（three 的 normal 是视图空间）。
          normal = normalize((viewMatrix * vec4(swWaterNormal, 0.0)).xyz);
        }
      `);
  };
  material.customProgramCacheKey = () => 'siliconworld-planet-surface-v8';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 192, 128), material);
  // 阴影自遮挡会在球面斜角处把地表压成大面积灰绿斑（近景整片发暗），地表不接受阴影；
  // 建筑/单位仍正常投影到彼此上。
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.name = 'player-visible-planet-surface';
  const state: SurfaceState = { overview, local, textures, uniforms };
  states.set(mesh, state);
  // 纹理异步加载：同一个 DataArrayTexture 原地换数据，不需要重建材质。
  void sharedTerrainTextures().then((loaded) => {
    state.textures = loaded;
    uniforms.swAlbedoArray.value = loaded.albedo;
    uniforms.swPackedArray.value = loaded.packed;
    uniforms.swLavaEmissionMap.value = loaded.lavaEmissive;
    // 已编译的程序在下一次绘制时自动上传新数据（needsUpdate 已在加载器里置位）。
    material.needsUpdate = true;
  });
  const refresh = (loaded: TerrainTextures) => {
    uniforms.swAlbedoArray.value = loaded.albedo;
    uniforms.swPackedArray.value = loaded.packed;
    uniforms.swLavaEmissionMap.value = loaded.lavaEmissive;
    material.needsUpdate = true;
  };
  textureListeners.add(refresh);
  mesh.userData.terrainTextureRefresh = refresh;
  void loadWaterNormal().then((texture) => { uniforms.swWaterNormal.value = texture; });
  if (new URLSearchParams(window.location.search).get('terrainDebug') === '1') uniforms.swDebug.value = 1;
  return mesh;
}

export function updatePlanetSurface(mesh: PlanetSurface, { planet, overview, fog, fogLayer }: PlanetSurfaceData) {
  const state = states.get(mesh);
  if (!state || planet.map_width < 1 || planet.map_height < 1) return;
  // 迷雾开关是 uniform，不受地形源签名短路影响（局部曲面每次 setData 重建也靠这里接上）。
  if (fogLayer !== undefined) state.uniforms.swFog.value = fogLayer ? 1 : 0;
  const bounds = 'bounds' in planet ? planet.bounds : { x: 0, y: 0, width: planet.map_width, height: planet.map_height };
  const effectiveFog = fog ?? ('bounds' in planet ? planet : undefined);
  const source = [planet.terrain, planet.map_width, planet.map_height, bounds.x, bounds.y, effectiveFog?.explored, effectiveFog?.visible,
    'surface_patches' in planet ? planet.surface_patches : null, overview?.terrain, overview?.explored, overview?.visible, overview?.step,
    planet.kind, planet.height];
  if (state.source?.every((value, i) => value === source[i])) return;
  state.source = source;
  const unknown = { terrain: 'unknown', explored: false, visible: false };
  const overviewWidth = Math.max(1, overview?.cells_width ?? 3);
  const overviewHeight = Math.max(1, overview?.cells_height ?? 2);
  const sampleOverview = (x: number, y: number) => overview ? {
    terrain: overview.terrain?.[y]?.[x] ?? 'unknown',
    explored: Boolean(overview.explored?.[y]?.[x]), visible: Boolean(overview.visible?.[y]?.[x]),
  } : unknown;
  const globalAtlas = buildAtlas({ width: overviewWidth, height: overviewHeight, boundsX: 0, boundsY: 0, faceSize: overviewWidth / 3, sample: sampleOverview });
  const patches = [{ bounds, terrain: planet.terrain, explored: effectiveFog?.explored, visible: effectiveFog?.visible, height: planet.height }, ...('surface_patches' in planet ? planet.surface_patches ?? [] : [])].slice(0, 7);
  const localWidth = Math.max(1, ...patches.map(p => p.bounds.width));
  const localHeight = Math.max(1, patches.reduce((sum, p) => sum + p.bounds.height, 0));
  let offset = 0;
  const packed = patches.map(p => { const result = { ...p, offset }; offset += p.bounds.height; return result; });
  const sampleLocal = localSampler(planet, effectiveFog);
  // 多补片窗口：每个补片单独建图集，再按行拼进一张 local 图集（通道语义相同）。
  const localAtlases = packed.map((patch) => buildAtlas({
    width: patch.bounds.width, height: patch.bounds.height, boundsX: patch.bounds.x, boundsY: patch.bounds.y,
    faceSize: planet.surface.face_size,
    sample: (x, y) => {
      const row = y - patch.bounds.y;
      const terrain = patch.terrain?.[row]?.[x - patch.bounds.x] ?? 'unknown';
      const explored = patch.explored ? Boolean(patch.explored[row]?.[x - patch.bounds.x]) : terrain !== 'unknown';
      const visible = patch.visible ? Boolean(patch.visible[row]?.[x - patch.bounds.x]) : terrain !== 'unknown';
      return { terrain, explored, visible, height: patch.height?.[row]?.[x - patch.bounds.x] ?? sampleLocal(x, y).height };
    },
  }));
  const localAtlas = combineAtlases(localAtlases, packed, localWidth, localHeight);
  for (const atlas of localAtlases) disposeAtlas(atlas);
  state.uniforms.swPatchBounds.value.forEach((v, i) => {
    const p = packed[i];
    if (!p) { v.set(0, 0, 0, 0); return; }
    v.set(p.bounds.x / planet.map_width, p.bounds.y / planet.map_height, p.bounds.width / planet.map_width, p.bounds.height / planet.map_height);
    state.uniforms.swPatchUV.value[i].set(0, p.offset / localHeight, p.bounds.width / localWidth, p.bounds.height / localHeight);
  });
  disposeAtlas(state.overview); disposeAtlas(state.local);
  state.overview = globalAtlas;
  state.local = localAtlas;
  state.uniforms.swOverviewColor.value = globalAtlas.color;
  state.uniforms.swOverviewProperties.value = globalAtlas.properties;
  state.uniforms.swLocalColor.value = localAtlas.color;
  state.uniforms.swLocalProperties.value = localAtlas.properties;
  state.uniforms.swOverviewCoast.value = globalAtlas.coast;
  state.uniforms.swLocalCoast.value = localAtlas.coast;
  state.uniforms.swOverviewHeat.value = globalAtlas.heat;
  state.uniforms.swLocalHeat.value = localAtlas.heat;
  state.uniforms.swMapDimensions.value.set(planet.map_width, planet.map_height);
  state.uniforms.swLocalDimensions.value.set(localWidth, localHeight);
  state.uniforms.swOverviewDimensions.value.set(overviewWidth, overviewHeight);
  // 群落（按星球 kind + ID 种子）：不同星球在同一套材质上一眼可分。
  const profile = biomeProfile(planet.kind, planet.planet_id);
  state.uniforms.swSoilWeights.value.set(...profile.soilWeights);
  const tint = new THREE.Color().setHSL((profile.hueShift + 1) % 1, 0.5, 0.5).lerp(new THREE.Color(1, 1, 1), 0.85);
  state.uniforms.swBiomeTint.value.set(tint.r, tint.g, tint.b);
  state.uniforms.swBiomeSaturation.value = profile.saturation;
  state.uniforms.swBiomeBrightness.value = profile.brightness;
  state.uniforms.swBiomeIce.value = profile.kind === 'ice' ? 1 : 0;
  state.uniforms.swSeed.value = planetSeedValue(planet.planet_id);
}

/** 把多补片图集按行拼成一张（每张 RGBA8 1024 级像素；仅在地表数据变化时调用）。 */
function combineAtlases(atlases: AtlasSet[], packed: { offset: number; bounds: { width: number; height: number } }[], width: number, height: number): AtlasSet {
  if (atlases.length === 1) return atlases[0];
  const make = (pick: (atlas: AtlasSet) => THREE.DataTexture) => {
    const bytes = new Uint8Array(width * height * 4);
    atlases.forEach((atlas, index) => {
      const texture = pick(atlas);
      const source = texture.image.data as Uint8Array;
      const patch = packed[index];
      const rowBytes = patch.bounds.width * 4;
      for (let row = 0; row < patch.bounds.height; row++) {
        const target = ((patch.offset + row) * width) * 4;
        bytes.set(source.subarray(row * rowBytes, row * rowBytes + rowBytes), target);
      }
    });
    const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
  };
  return { color: make(a => a.color), properties: make(a => a.properties), coast: make(a => a.coast), heat: make(a => a.heat) };
}

function planetSeedValue(planetId: string) {
  let hash = 2166136261;
  for (let i = 0; i < planetId.length; i++) { hash ^= planetId.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 1000) / 1000;
}

export function disposePlanetSurface(mesh: PlanetSurface) {
  const state = states.get(mesh);
  if (state) {
    disposeAtlas(state.overview); disposeAtlas(state.local);
    const refresh = mesh.userData.terrainTextureRefresh as ((textures: TerrainTextures) => void) | undefined;
    if (refresh) textureListeners.delete(refresh);
    // 纹理库是跨星球共享的：这里不 dispose，只解除监听。
    states.delete(mesh);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/** Water motion is presentation time, independent of the authoritative simulation tick. */
/** 迷雾图层开关（R20-A D5）：0 = 关闭测绘面纱/未探索遮罩，1 = 开启。 */
export function setPlanetSurfaceFog(mesh: PlanetSurface, enabled: boolean) {
  const state = states.get(mesh);
  if (!state) return;
  state.uniforms.swFog.value = enabled ? 1 : 0;
}

export function updatePlanetSurfaceTime(mesh: PlanetSurface, seconds: number) {
  const state = states.get(mesh);
  if (state) state.uniforms.swTime.value = seconds;
}

/** 水面反射/高光需要对象空间的太阳方向与相机位置（每帧或相机变化时写一次）。 */
export function updatePlanetSurfaceView(mesh: PlanetSurface, sunObject: THREE.Vector3, cameraObject: THREE.Vector3) {
  const state = states.get(mesh);
  if (!state) return;
  state.uniforms.swSunObject.value.copy(sunObject);
  state.uniforms.swCameraObject.value.copy(cameraObject);
}

/** 测试钩子：当前状态（图集与 uniform）便于断言纹理通道语义。 */
export function terrainUniforms(mesh: PlanetSurface) {
  return states.get(mesh)?.uniforms;
}
