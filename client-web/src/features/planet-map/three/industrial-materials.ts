import * as THREE from 'three';

/** 材质族 → 贴图组名（`public/assets/textures/materials/<组>-{albedo,orm,normal}.webp`）。 */
export type PbrFamily = 'ceramic' | 'alloy' | 'graphite' | 'plate' | 'rubber' | 'plastic';
const FILES: Record<PbrFamily, string> = {
  ceramic: 'painted_metal',
  alloy: 'brushed_metal',
  graphite: 'plate_metal',
  plate: 'diamond_plate',
  rubber: 'rubber',
  plastic: 'plastic',
};

const ROOT = '/assets/textures/materials/';
/**
 * 各套 albedo 的平均色（sRGB，1024² 取样均值）。贴图是「中性」细节层：
 * 材质把 `albedo * tint` 画出来，tint = 目标色 / 均值，于是平均色正好等于调色板的阵营色，
 * 换贴图只需要改这张表（assets 改动时重算一次）。
 */
const MEAN_ALBEDO: Record<PbrFamily, string> = {
  ceramic: '#c2e3e8',
  alloy: '#848b92',
  graphite: '#81878d',
  plate: '#767c7e',
  rubber: '#1a1c1d',
  plastic: '#eeeae9',
};
/** 纹素密度：世界坐标 1 格 = 1 次贴图重复（三平面映射在 `applyTriplanar` 里）。 */
const TILE_WORLD = 1;

interface LoadedSet {
  albedo: THREE.Texture;
  orm: THREE.Texture;
  normal: THREE.Texture;
}

const textures = new Map<PbrFamily, LoadedSet>();
const failed = new Set<PbrFamily>();
let loading: Promise<boolean> | undefined;
let listeners: (() => void)[] = [];

function textureOf(image: THREE.Texture, colorSpace: THREE.ColorSpace) {
  image.wrapS = image.wrapT = THREE.RepeatWrapping;
  image.colorSpace = colorSpace;
  image.anisotropy = 4;
  image.generateMipmaps = true;
  image.minFilter = THREE.LinearMipmapLinearFilter;
  image.magFilter = THREE.LinearFilter;
  image.needsUpdate = true;
  return image;
}

/**
 * 预加载 PBR 材质贴图（异步，模块级单例）。与 GLB 预加载同一模式：
 * 期间继续用程序纹理，完成后场景调 `reloadModels()` 重建实体。
 * 单套失败只回退该材质族的程序纹理，不抛错（`?procedural-textures` 可整体跳过）。
 */
export function preloadIndustrialMaterials(): Promise<boolean> {
  if (loading) return loading;
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('procedural-textures')) {
    loading = Promise.resolve(false);
    return loading;
  }
  const loader = new THREE.TextureLoader();
  const load = (file: string, colorSpace: THREE.ColorSpace) => new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(`${ROOT}${file}`, (texture) => resolve(textureOf(texture, colorSpace)), undefined, () => reject(new Error(file)));
  });
  loading = Promise.all((Object.keys(FILES) as PbrFamily[]).map(async (family) => {
    const file = FILES[family];
    try {
      const [albedo, orm, normal] = await Promise.all([
        load(`${file}-albedo.webp`, THREE.SRGBColorSpace),
        load(`${file}-orm.webp`, THREE.NoColorSpace),
        load(`${file}-normal.webp`, THREE.NoColorSpace),
      ]);
      textures.set(family, { albedo, orm, normal });
    } catch {
      failed.add(family);
    }
  })).then(() => {
    const ready = textures.size > 0;
    const callbacks = listeners; listeners = [];
    for (const callback of callbacks) callback();
    return ready;
  });
  return loading;
}

/** 贴图是否就绪（同步查询）。 */
export function industrialMaterialsReady(): boolean {
  return textures.size > 0;
}

/** 场景在构造时注册：贴图加载完成后重建实体（与 GLB 预加载的 reload 合并调用）。 */
export function onIndustrialMaterialsLoaded(callback: () => void) {
  if (loading && textures.size === 0 && !failed.size) listeners.push(callback);
  else if (textures.size > 0) callback();
}

/**
 * 三平面映射注入：不依赖几何 UV，按对象空间位置采样三张贴图并按法线混合，
 * 所以任意几何体（RoundedBox、圆柱、挤出刀片、GLB）的纹素密度一致（1 格 = 1 次重复）。
 *
 * 用 `onBeforeCompile` 改 `MeshStandardMaterial` 的着色器；uniform 存在
 * `material.userData.triplanar` 里，材质共享时所有实例共用同一组 uniform（同一材质族）。
 * `instanceMatrix` 在 `begin_vertex` 之前已乘进 `transformed`（three 的 project_vertex 之前），
 * 所以这里拿到的对象坐标已含实例矩阵，同类实例的纹理相位一致。
 */
export function applyTriplanar(material: THREE.MeshStandardMaterial, set: LoadedSet, scale = TILE_WORLD) {
  const uniforms = {
    uTriAlbedo: { value: set.albedo },
    uTriOrm: { value: set.orm },
    uTriNormal: { value: set.normal },
    uTriScale: { value: scale },
    uTriTint: { value: new THREE.Color(1, 1, 1) },
  };
  material.userData.triplanar = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTriPosition;
        varying vec3 vTriNormal;
        varying vec3 vTriViewNormal;
        varying vec3 vTriViewTangent;
        varying vec3 vTriViewBitangent;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        // 对象坐标（含实例矩阵）：三平面映射的采样空间，保证同类实例纹理相位一致。
        vTriPosition = transformed;
        #ifdef USE_INSTANCING
          vTriPosition = (instanceMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        vTriNormal = objectNormal;
        // 解析切线基：主法线轴决定另外两轴（不依赖 UV/tangent 属性）。
        vec3 an = abs(objectNormal);
        vec3 triTangent, triBitangent;
        if (an.x > an.y && an.x > an.z) { triTangent = vec3(0.0, 1.0, 0.0); triBitangent = vec3(0.0, 0.0, 1.0); }
        else if (an.y > an.z) { triTangent = vec3(1.0, 0.0, 0.0); triBitangent = vec3(0.0, 0.0, 1.0); }
        else { triTangent = vec3(1.0, 0.0, 0.0); triBitangent = vec3(0.0, 1.0, 0.0); }
        // 法线贴图在视图空间求解：normalMatrix 只在顶点着色器可用。
        vTriViewNormal = normalize(normalMatrix * objectNormal);
        vTriViewTangent = normalize(normalMatrix * triTangent);
        vTriViewBitangent = normalize(normalMatrix * triBitangent);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uTriAlbedo;
        uniform sampler2D uTriOrm;
        uniform sampler2D uTriNormal;
        uniform float uTriScale;
        uniform vec3 uTriTint;
        varying vec3 vTriPosition;
        varying vec3 vTriNormal;
        varying vec3 vTriViewNormal;
        varying vec3 vTriViewTangent;
        varying vec3 vTriViewBitangent;
        vec4 triplanarSample(sampler2D tex, vec3 weights) {
          vec3 p = vTriPosition * uTriScale;
          vec4 x = texture2D(tex, p.zy);
          vec4 y = texture2D(tex, p.xz);
          vec4 z = texture2D(tex, p.xy);
          return x * weights.x + y * weights.y + z * weights.z;
        }`)
      .replace('#include <map_fragment>', `
        vec3 triWeights = pow(abs(normalize(vTriNormal)), vec3(4.0));
        triWeights /= (triWeights.x + triWeights.y + triWeights.z);
        vec4 triAlbedo = triplanarSample(uTriAlbedo, triWeights);
        vec4 triOrm = triplanarSample(uTriOrm, triWeights);
        diffuseColor.rgb *= triAlbedo.rgb * uTriTint;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * triOrm.g;`)
      .replace('#include <metalnessmap_fragment>', `
        float metalnessFactor = metalness * triOrm.b;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 triN = triplanarSample(uTriNormal, triWeights).xyz * 2.0 - 1.0;
        vec3 triMapped = normalize(vTriViewTangent * triN.x + vTriViewBitangent * triN.y + vTriViewNormal * triN.z);
        #ifdef DOUBLE_SIDED
          triMapped *= faceDirection;
        #endif
        normal = triMapped;`);
  };
  material.customProgramCacheKey = () => 'industrial-triplanar';
}

/**
 * 构造一个带 PBR 贴图的工业材质（同一材质族只建一次，所有建筑/单位共享）。
 * 贴图未就绪或该族加载失败时返回 null，调用方回退程序纹理（`industrial-finishes.ts`）。
 */
export function createPbrMaterial(
  family: PbrFamily,
  color: string,
  parameters: Omit<THREE.MeshStandardMaterialParameters, 'color' | 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap'> = {},
  scale = TILE_WORLD,
): THREE.MeshStandardMaterial | null {
  const set = textures.get(family);
  if (!set) return null;
  const material = new THREE.MeshStandardMaterial({ ...parameters, color: 0xffffff });
  applyTriplanar(material, set, scale);
  const uniforms = material.userData.triplanar as { uTriTint: { value: THREE.Color } };
  const target = new THREE.Color(color).convertSRGBToLinear();
  const mean = new THREE.Color(MEAN_ALBEDO[family]).convertSRGBToLinear();
  uniforms.uTriTint.value.setRGB(
    target.r / Math.max(mean.r, 1e-3),
    target.g / Math.max(mean.g, 1e-3),
    target.b / Math.max(mean.b, 1e-3),
  );
  return material;
}

/** 释放共享贴图（场景销毁时调用；重复调用安全）。 */
export function disposeIndustrialMaterials() {
  for (const set of textures.values()) { set.albedo.dispose(); set.orm.dispose(); set.normal.dispose(); }
  textures.clear();
  listeners = [];
  loading = undefined;
  failed.clear();
}
