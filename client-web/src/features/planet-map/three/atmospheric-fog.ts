import * as THREE from 'three';
import type { PlanetRenderQuality } from './render-quality';

/**
 * 空气透视雾（第 23 轮 3A 画质）。
 *
 * 用 `onBeforeCompile` 把 three 自带的 `fog_fragment` 换成「按视线方向着色」的版本：
 * 颜色取视线方向的地平线雾霾色（与 `atmosphere.ts` 的天空同一套色）+ 朝向太阳的内散射，
 * 浓度按距离（指数平方）与相机高度（`fogDensity` 由场景按 altitude 设置，> 60 为 0）变化。
 *
 * 为什么不用 `scene.fog`：three 的 fog 颜色是单一常量（逐帧由 scene.fog 刷新），
 * 做不出「朝太阳一侧偏暖、背光一侧偏冷」的空气透视。这里把三个 fog chunk 整段替换，
 * 着色完全由本模块的 uniform 驱动；`scene.fog` 仍然挂着，只为让 three 保留 fog 的
 * 编译路径（材质 `fog: true` 时才注入；`fog: false` 的材质——天空、additive 特效——不注入）。
 *
 * 只注入 `MeshStandardMaterial` / `MeshPhysicalMaterial` / `MeshBasicMaterial`（工业模型、
 * 地表、建筑都是 Standard；additive 特效材质显式 `fog: false` 不受影响）。
 */

export interface FogUniforms {
  /** 视线方向的雾霾色（地平线色）。 */
  color: THREE.Color;
  /** 朝向太阳的内散射色。 */
  sunColor: THREE.Color;
  /** 太阳方向（世界空间）。 */
  sunDirection: THREE.Vector3;
  /** 距离浓度（1/世界单位）。 */
  density: number;
  /** 高度衰减（0 = 关闭）。 */
  strength: number;
  /** 视线方向偏暖量。 */
  sunScatter: number;
}

/**
 * 贴地雾的默认参数：聚焦高度（7.7）下画面中心建筑 < 5%，地平线（球面切点，约 40 单位）约 60%。
 *
 * 注意距离口径：贴地机位的相机离地只有 7.7 个世界单位，可见地表在 3–40 单位之间
 * （地平线是球面切点，d ≈ sqrt(2·R·altitude) ≈ 39），不是平面地图上的上百单位。
 * 所以浓度按这个量级取：d=39 → 1-exp(-(0.0245·39)²) ≈ 0.60；d=8（中心建筑）→ 3.8%。
 */
export const FOG_TUNING = {
  density: 0.0245,
  /** 太阳方向内散射强度（0–1）。 */
  sunScatter: 0.55,
};

export function createFogUniforms(): FogUniforms {
  return {
    // 雾 chunk 在 tonemapping / colorspace 之后执行（gl_FragColor 已是显示空间），
    // 所以这里给「原始 sRGB 分量」而不是线性值：用 LinearSRGBColorSpace 跳过 three 的颜色转换。
    color: new THREE.Color().setRGB(0.7255, 0.8275, 0.902, THREE.LinearSRGBColorSpace),
    sunColor: new THREE.Color().setRGB(1, 0.886, 0.741, THREE.LinearSRGBColorSpace),
    sunDirection: new THREE.Vector3(-0.36, 0.5, 0.82).normalize(),
    density: FOG_TUNING.density,
    strength: 1,
    sunScatter: FOG_TUNING.sunScatter,
  };
}

const FOG_PARS = /* glsl */ `
  // 注意：不能用 fogColor 这个名字——three 每帧会把 scene.fog.color 刷进同名 uniform。
  // 也不依赖 USE_FOG：scene.fog 只用来让 three 在材质编译时保留 fog 分支的位置，
  // 真正的开关是 swFogStrength（0 = 关闭），所以这里声明是无条件的。
  uniform vec3 swFogColor;
  uniform vec3 swFogSunColor;
  uniform vec3 swFogSunDirection;
  uniform float swFogDensity;
  uniform float swFogStrength;
  uniform float swFogSunScatter;
  varying float vFogDepth;
  varying vec3 vFogWorldDirection;
`;

const FOG_FRAGMENT = /* glsl */ `
  // 注意：这里只替换 fog_fragment 这一段；three 的 Standard 材质把 fog 放在 tonemapping 之后，
  // 所以雾色与输出一样要按「显示空间」给（ACES 已经作用过，fogTint 不再被压一次）。
  if (swFogStrength > 0.001) {
    float fogDistance = max(vFogDepth, 0.0);
    float fogFactor = 1.0 - exp(-swFogDensity * swFogDensity * fogDistance * fogDistance);
    // 朝向太阳的内散射：视线越接近太阳方向，雾色越暖越亮。
    vec3 dir = normalize(vFogWorldDirection);
    float sunAmount = pow(max(dot(dir, swFogSunDirection), 0.0), 4.0);
    vec3 fogTint = mix(swFogColor, swFogSunColor, sunAmount * swFogSunScatter);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, fogFactor * swFogStrength);
  }
`;

/** 顶点侧：除了 three 自带的 vFogDepth，再传一条世界空间的视线方向给雾色用。 */
const FOG_VERTEX_PARS = /* glsl */ `
  varying float vFogDepth;
  varying vec3 vFogWorldDirection;
`;

const FOG_VERTEX = /* glsl */ `
  vFogDepth = - mvPosition.z;
  // 世界空间视线方向：viewMatrix 的旋转部分转置 × 视图空间位置。
  // 不用 modelMatrix * position：实例化合批（StaticBatches）的实例矩阵不在 modelMatrix 里。
  vFogWorldDirection = transpose(mat3(viewMatrix)) * mvPosition.xyz;
`;

/**
 * 把雾注入一个材质。返回的 dispose 只解绑回调，不销毁材质本身。
 *
 * 所有材质共享同一份 `FogUniforms`（对象引用），场景里改一次密度/颜色全部生效。
 */
export function applyAtmosphericFog(material: THREE.Material, uniforms: FogUniforms): void {
  const target = material as THREE.Material & {
    onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
    userData: Record<string, unknown>;
  };
  if (target.userData.swFog) return;
  target.userData.swFog = uniforms;
  const previous = target.onBeforeCompile.bind(target);
  target.onBeforeCompile = (shader) => {
    previous(shader);


    shader.uniforms.swFogColor = { value: uniforms.color };
    shader.uniforms.swFogSunColor = { value: uniforms.sunColor };
    shader.uniforms.swFogSunDirection = { value: uniforms.sunDirection };
    shader.uniforms.swFogDensity = { value: uniforms.density };
    shader.uniforms.swFogStrength = { value: uniforms.strength };
    shader.uniforms.swFogSunScatter = { value: uniforms.sunScatter };
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', FOG_VERTEX_PARS)
      .replace('#include <fog_vertex>', FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', FOG_PARS)
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  };
  const previousKey = target.customProgramCacheKey.bind(target);
  target.customProgramCacheKey = () => `${previousKey()}|sw-atmosphere-fog-v1`;
  target.needsUpdate = true;
}

/**
 * 场景级雾驱动：材质 `fog: true` 时注入（`fog: false` 的天空/特效不注入），
 * 按相机高度调 `strength`（altitude > 60 关闭），并同步太阳方向与雾色。
 *
 * 高度口径与 `atmosphere.ts` 的天空过渡一致：≤ 25 全强度，≥ 60 关闭。
 */
export class AtmosphericFog {
  readonly uniforms = createFogUniforms();
  /** 只为让 three 保留 fog 编译路径（实际着色由替换 chunk 完成）。 */
  readonly sceneFog = new THREE.Fog(0xffffff, 1, 2000);
  private readonly bound = new WeakSet<THREE.Material>();
  private quality: PlanetRenderQuality;

  constructor(quality: PlanetRenderQuality) {
    this.quality = quality;
  }

  setQuality(quality: PlanetRenderQuality) {
    this.quality = quality;
  }

  /** 把一个材质接入空气透视（幂等：同一材质只接一次）。 */
  apply(material: THREE.Material | THREE.Material[]) {
    for (const item of Array.isArray(material) ? material : [material]) {
      if (!item || (item as THREE.Material & { fog?: boolean }).fog === false || this.bound.has(item)) continue;
      this.bound.add(item);
      applyAtmosphericFog(item, this.uniforms);
    }
  }

  /** 场景初始化后把整棵树接上（新加的建筑/单位在 `material()` 缓存处已经接过）。 */
  applyTo(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite) && !(object instanceof THREE.Points)) return;
      this.apply(object.material);
    });
  }

  setSunDirection(direction: THREE.Vector3) {
    this.uniforms.sunDirection.copy(direction).normalize();
  }

  setHorizon(color: THREE.Color) {
    this.uniforms.color.copy(color);
  }

  /** 相机高度：≤ 25 全强度，≥ 60 关闭（中空 / 全球视角没有贴地雾）。 */
  setAltitude(altitude: number) {
    const t = 1 - THREE.MathUtils.smoothstep(altitude, 25, 60);
    this.uniforms.strength = t;
    this.sceneFog.near = 1;
    this.sceneFog.far = 2000;
  }
}
