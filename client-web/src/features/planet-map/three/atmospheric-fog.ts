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
  /**
   * 数值型参数一律是 uniform 对象（材质持有引用，场景改这里就改材质）。
   * 裸数字在注入时会被包成新对象，之后改 FogUniforms 就再也传不到 shader。
   */
  density: { value: number };
  /** 高度衰减（0 = 关闭）。 */
  strength: { value: number };
  /** 视线方向偏暖量。 */
  sunScatter: { value: number };
}

/**
 * 贴地雾的默认参数（步骤 4 契约：中心建筑 < 5%、地平线 50–70%）。
 *
 * 距离口径：贴地机位的相机离地只有 7.7 个世界单位，可见地表在 3–40 单位之间
 * （地平线是球面切点，d ≈ sqrt(2·R·altitude) ≈ 39），不是平面地图上的上百单位。
 * 按 `1 - exp(-(density·d)²)`：
 * - d=8（中心建筑）：1 - exp(-(0.0245·8)²) = 3.8%（< 5% ✔）
 * - d=39（地平线）：1 - exp(-(0.0245·39)²) = 60%（50–70% ✔）
 */
export const FOG_TUNING = {
  /** 参考高度（聚焦机位）下的浓度。 */
  density: 0.0245,
  /** 参考高度：浓度按 sqrt(参考高度 / 相机高度) 缩放，见 `fogDensityAtAltitude`。 */
  referenceAltitude: 7.7,
  /** 中空 / 远景（高度 > 25）的浓度倍率：同一口径下再淡一些，读作「轻微空气透视」。 */
  highAltitudeScale: 0.6,
  /** 太阳方向内散射强度（0–1）。 */
  sunScatter: 0.55,
};

/**
 * 雾浓度随相机高度的换算（3A 第二轮 §15）。
 *
 * 可见地表的距离随高度变大（地平线切点 d ≈ sqrt(2·R·altitude)），固定浓度会让
 * 中空机位整片刷成雾色。按 `density ∝ 1/sqrt(altitude)` 缩放，各地平线处的雾化比例
 * 大致恒定：贴地 7.7 → 0.0245（地平线 60%），中空 60 → 0.0087 × 0.6 ≈ 0.0052
 * （60 单位处约 9%、远处边缘约 24%）。
 */
export function fogDensityAtAltitude(altitude: number): number {
  const height = Math.max(altitude, FOG_TUNING.referenceAltitude);
  const scale = altitude > 25 ? FOG_TUNING.highAltitudeScale : 1;
  return FOG_TUNING.density * Math.sqrt(FOG_TUNING.referenceAltitude / height) * scale;
}

/**
 * 雾强度随相机高度的淡出：≤ 60 全强度（中空仍保留轻微空气透视），≥ 160 关闭，
 * 全球视角（300）完全关闭。贴地（≤ 25）不淡出。
 */
export function fogStrengthAtAltitude(altitude: number): number {
  return 1 - THREE.MathUtils.smoothstep(altitude, 60, 160);
}

/**
 * 雾色（线性 HDR）：目标显示色 #b9d3e6（185/211/230），按 ACES（曝光 .92）+ sRGB 反解。
 * 与天空地平线 `SKY_HORIZON_LINEAR`（0.3906/0.7212/1.2695 → 188/211/230）几乎同值，
 * 地平线处地面与天空显示色差 < 3/255（审查 P2-6）。
 */
export const FOG_HORIZON_LINEAR = [0.3620, 0.7211, 1.2704] as const;
/** 内散射色（线性）：暖白，朝太阳一侧的雾霾被照亮。 */
export const FOG_SUN_LINEAR = [1.35, 1.05, 0.78] as const;

export function createFogUniforms(): FogUniforms {
  return {
    color: new THREE.Color().setRGB(...FOG_HORIZON_LINEAR, THREE.LinearSRGBColorSpace),
    sunColor: new THREE.Color().setRGB(...FOG_SUN_LINEAR, THREE.LinearSRGBColorSpace),
    sunDirection: new THREE.Vector3(-0.36, 0.5, 0.82).normalize(),
    density: { value: FOG_TUNING.density },
    strength: { value: 0 },
    sunScatter: { value: FOG_TUNING.sunScatter },
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
  // 注意：这里只替换 fog_fragment 这一段。世界渲染进 HalfFloat RT 时 three 会关掉
  // toneMapping、输出到 working（线性）空间，fog chunk 仍在线性值上执行，之后才由
  // OutputPass 的 ACES + sRGB 统一处理一次——所以雾色必须是**线性**色（审查 P2-6：
  // 以前按显示空间给，ACES 再压一遍，地平线处地面与天空差出一条灰带）。
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
 * 阴影视锥边缘渐隐（3A §7）：把方向光的 `getShadow(...)` 包一层，在阴影坐标靠近视锥边缘的
 * 15% 内把遮蔽度渐变回 1（受光），避免画面里出现一条视锥边界的硬切线。
 *
 * 只作用于方向光（太阳）：阴影坐标的 x/y 在 [0,1] 内是视锥内，靠近 0/1 即边缘。
 */
const SHADOW_FADE = /* glsl */ `
  float swShadowFade(vec4 coord) {
    vec2 c = coord.xy / max(coord.w, 1e-5);
    float edge = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
    return smoothstep(0.0, 0.15, edge);
  }
`;

const SHADOW_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';

/**
 * 打好补丁的 `lights_fragment_begin`。
 *
 * 注意时机：`onBeforeCompile` 拿到的 shader 仍是「带 #include 的模板」（three 在之后才
 * 展开 include），`getShadow(...)` 那一行并不在 `shader.fragmentShader` 里——直接对模板
 * 做字符串替换是无效的。这里把 chunk 自己展开、改好后整段替换 include；辅助函数
 * `swShadowFade` 放在前置声明区（shadowmap_pars_fragment 之后），因为 main 里的
 * lights_fragment_begin 要调用它。
 */
const SHADOW_LINE_FADED = `{
      float swShadow = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      directLight.color *= mix(1.0, swShadow, swShadowFade(vDirectionalShadowCoord[ i ]));
    }`;

const LIGHTS_BEGIN_PATCHED = THREE.ShaderChunk.lights_fragment_begin.replace(SHADOW_LINE, SHADOW_LINE_FADED);

/**
 * 材质是否**真的**能被雾注入：必须是 three 内建、带 `#include <fog_fragment>` 的材质。
 *
 * - `ShaderMaterial` / `RawShaderMaterial` 一律跳过：自定义 shader 里没有 fog include，
 *   替换无效；以前把它们记进 `userData.swFog` 会让 `lightingDebug().fog.materialAudit`
 *   的「已接入」数字失真（审查 P2-8）。
 * - additive 特效（弹道/护盾波纹/爆炸）必须显式 `fog: false`：雾色会染上去。
 */
export function canReceiveFog(material: THREE.Material): boolean {
  const probe = material as THREE.Material & { fog?: boolean; isShaderMaterial?: boolean; isRawShaderMaterial?: boolean };
  if (probe.fog === false) return false;
  if (probe.isShaderMaterial || probe.isRawShaderMaterial) return false;
  return true;
}

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
  if (target.userData.swFog || !canReceiveFog(material)) return;
  target.userData.swFog = uniforms;
  const previous = target.onBeforeCompile.bind(target);
  target.onBeforeCompile = (shader) => {
    previous(shader);


    shader.uniforms.swFogColor = { value: uniforms.color };
    shader.uniforms.swFogSunColor = { value: uniforms.sunColor };
    shader.uniforms.swFogSunDirection = { value: uniforms.sunDirection };
    shader.uniforms.swFogDensity = uniforms.density;
    shader.uniforms.swFogStrength = uniforms.strength;
    shader.uniforms.swFogSunScatter = uniforms.sunScatter;
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', FOG_VERTEX_PARS)
      .replace('#include <fog_vertex>', FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', FOG_PARS)
      .replace('#include <fog_fragment>', FOG_FRAGMENT)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${SHADOW_FADE}`)
      .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN_PATCHED);
  };
  const previousKey = target.customProgramCacheKey.bind(target);
  target.customProgramCacheKey = () => `${previousKey()}|sw-atmosphere-fog-v2`;
  target.needsUpdate = true;
}

/**
 * 场景级雾驱动：只有能接雾的内建材质注入（`fog: false` 的天空/additive 特效、
 * 自定义 `ShaderMaterial` 一律跳过，见 `canReceiveFog`），按相机高度调 `strength` 与
 * `density`（`fogStrengthAtAltitude` / `fogDensityAtAltitude`），并同步太阳方向与雾色。
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

  /** 把一个材质接入空气透视（幂等：同一材质只接一次；不能接的材质直接跳过）。 */
  apply(material: THREE.Material | THREE.Material[]) {
    for (const item of Array.isArray(material) ? material : [material]) {
      if (!item || this.bound.has(item) || !canReceiveFog(item)) continue;
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

  /**
   * 相机高度：强度 ≤60 全开、≥160 关闭；浓度按 `fogDensityAtAltitude` 随高度变淡
   * （中空 60 仍有「远处地表轻微空气透视」，见 3A 第二轮 §15）。
   */
  setAltitude(altitude: number) {
    this.uniforms.strength.value = fogStrengthAtAltitude(altitude);
    this.uniforms.density.value = fogDensityAtAltitude(altitude);
    this.sceneFog.near = 1;
    this.sceneFog.far = 2000;
  }
}
