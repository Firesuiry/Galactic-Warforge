import * as THREE from 'three';
import type { PlanetRenderQuality } from './render-quality';
import { FOG_HORIZON_LINEAR } from './atmospheric-fog';

/**
 * 物理天空 / 大气（第 23 轮 3A 画质）。
 *
 * - `SkyDome`：贴地的单次散射天空穹顶（Rayleigh + Mie 的解析近似，太阳方向 = 主光方向），
 *   太阳圆盘与眩光、地平线雾霾、天顶隐约的星；按相机高度在天空与太空之间过渡
 *   （altitude ≤ 25 全天空，≥ 60 纯太空）。
 * - `AtmosphereShell`：全球视角的散射壳（半径 1.025R），边缘增亮、日面瑞利蓝、明暗交界偏橙、
 *   夜面暗而不黑；从贴地机位看不见（相机在壳内、BackSide + 视线越过地表的部分才着色）。
 * - `createSkyEnvironment`：把同一个天空穹顶放进只含天空的临时场景，用
 *   `PMREMGenerator.fromScene` 生成 IBL（只在换星球 / 换档位时重建，不逐帧）。
 *
 * 所有 shader 的噪声与太阳位置都是输入的纯函数：`?freeze=1` 下逐帧一致（天空本身不含时间项）。
 */

/** 天空穹顶的几何半径（远小于星云球 2100，相机 far 3000 内）。 */
const SKY_RADIUS = 1800;

export interface SkyUniforms {
  sunDirection: THREE.Vector3;
  zenith: THREE.Color;
  /** 地平线附近的天空色（HDR，穹顶自身用）。 */
  horizon: THREE.Color;
  /**
   * 地平线雾霾的**线性**色（目标显示色 #b9d3e6 的 ACES 反解值，见 atmospheric-fog 的
   * `FOG_HORIZON_LINEAR`）：世界渲染进 HalfFloat RT 时雾 chunk 在线性空间执行、之后才被
   * OutputPass 的 ACES 处理一次，所以贴地远景的地面与地平线处的天空同色（审查 P2-6）。
   */
  horizonColor: THREE.Color;
  sunColor: THREE.Color;
  /**
   * 0 = 纯太空（只有星），1 = 完整大气（贴地）。
   * 用 uniform 对象而不是裸数字：材质持有同一份引用，改这里就改材质（裸数字是构造时的快照）。
   */
  atmosphere: { value: number };
  /** 星空可见度（0–1，随大气浓度衰减）。 */
  stars: { value: number };
  /** 大气浓度：控制地平线雾霾与太阳光晕的厚度。 */
  haze: { value: number };
  /** 太阳圆盘 + 眩光的强度倍率（IBL 烘焙时置 0：那部分由主光负责，重复会过曝）。 */
  sunDisc: { value: number };
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 天空片元（单次散射近似）：
 * 1. 视线与太阳夹角 → Rayleigh（短波散射多 → 天顶深青蓝）与 Mie（白色前向散射 → 太阳周围光晕）。
 * 2. 「高出地平线的角度」= 视线与「指向地心」方向的夹角 − 掠射角 acos(R/D)；
 *    0° 是地平线雾霾，抬头 70° 到达天顶深青蓝。贴地机位（tilt 1.1）画面顶部约 80°。
 * 3. 太阳圆盘 + 光晕；星点按大气浓度与仰角衰减（天顶隐约可见，地平线不可见）。
 *
 * 颜色是「线性 HDR」常量（见 SKY_ZENITH_LINEAR 的说明），与 `3A画质.md` §1 的天空规定同一口径。
 */
const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 sunDirection;
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 planetCenter;
  uniform float planetRadius;
  uniform float atmosphere;
  uniform float stars;
  uniform float haze;
  uniform float sunDisc;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.59));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDirection);
    float sunDot = dot(d, sunDirection);
    // 高出地平线的角度：视线与「指向地心」方向的夹角超过掠射角才看得到天空。
    // 掠射角在相机处是 asin(R/D)（不是 acos(R/D)——那是地心处的张角；用错会把整个
    // 天空往上平移 50°+，贴地时看到的天顶就永远是纯蓝，地平线雾霾永远进不了画面）。
    vec3 toCenter = normalize(planetCenter - cameraPosition);
    float fromCenter = acos(clamp(dot(d, toCenter), -1.0, 1.0));
    float distanceToCenter = max(length(cameraPosition - planetCenter), planetRadius + 0.001);
    float grazing = asin(clamp(planetRadius / distanceToCenter, 0.0, 1.0));
    float aboveHorizon = max(fromCenter - grazing, 0.0);
    // 地平线雾霾白 → 抬头渐变为天顶深青蓝。用指数衰减（真实天空的雾霾也是贴着地平线
    // 压缩的）：贴地机位（tilt 1.1、高度 7.7、FOV 43°）可见的天空带只有地平线以上 0–6°，
    // 画面下缘是雾霾白、上缘仍是偏亮的天蓝；高度 60 的中空机位才看得到完整渐变到天顶。
    float t = exp(-aboveHorizon / 0.055);
    vec3 sky = mix(zenith, horizon, t);
    // 天空（全屏背景）是场景里唯一「不受雾影响」的物体：它本身就在雾的尽头，
    // 所以贴地时地平线附近的雾色必须与天空同一取色，否则地面边缘会有一道色差。


    // Mie 前向散射：太阳周围的暖白雾霾（内散射）；只在太阳一侧，强度克制。
    float mie = pow(max(sunDot, 0.0), 6.0) * 0.30 + pow(max(sunDot, 0.0), 48.0) * 0.35;
    sky += sunColor * mie * haze * 0.55;

    // 太阳圆盘（角半径约 0.6°）+ 两层光晕。
    float disc = smoothstep(0.99975, 0.99992, sunDot);
    float glow = pow(max(sunDot, 0.0), 900.0) * 1.6 + pow(max(sunDot, 0.0), 120.0) * 0.35;
    sky += sunColor * (disc * 26.0 + glow) * atmosphere * sunDisc;

    // 星空：大气越薄越亮；天顶隐约可见，靠近地平线被雾霾洗掉。
    float starMask = smoothstep(0.25, 1.0, aboveHorizon);
    float starField = hash(floor(d * 420.0));
    float star = step(0.9993, starField) * (0.35 + 0.65 * hash(floor(d * 420.0) + 7.0));
    sky += vec3(star) * star * stars * atmosphere * starMask;

    // 大气完全关闭（高度 ≥ 60）：太空底色 + 星点，与旧的太空背景同一观感。
    vec3 space = vec3(0.002, 0.005, 0.012) + vec3(star) * star * stars * 0.9;
    gl_FragColor = vec4(mix(space, sky, atmosphere), 1.0);
  }
`;

/**
 * 天空色是「线性 HDR」常量：天空穹顶走整条后处理链（Bloom 前的 HalfFloat → OutputPass 的 ACES
 * → 调色），若直接写 sRGB 目标值会被 ACES 再压一次、发灰发白。这里的取值由 ACES 反解得到
 * （`docs/guide/3A画质.md` 的目标色 #2f6fa8 / #b9d3e6，曝光 .92），反解脚本见报告。
 */
export const SKY_ZENITH_LINEAR = [0.0488, 0.1575, 0.3627] as const;
export const SKY_HORIZON_LINEAR = [0.3906, 0.7212, 1.2695] as const;

export function createSkyUniforms(quality: PlanetRenderQuality): SkyUniforms {
  void quality;
  return {
    sunDirection: new THREE.Vector3(-0.36, 0.5, 0.82).normalize(),
    zenith: new THREE.Color().setRGB(...SKY_ZENITH_LINEAR, THREE.LinearSRGBColorSpace),
    horizon: new THREE.Color().setRGB(...SKY_HORIZON_LINEAR, THREE.LinearSRGBColorSpace),
    // 目标显示色 #b9d3e6（与 3A画质.md 的地平线雾霾同口径）的 ACES 反解线性值。
    horizonColor: new THREE.Color().setRGB(...FOG_HORIZON_LINEAR, THREE.LinearSRGBColorSpace),
    sunColor: new THREE.Color('#ffe2bd'),
    atmosphere: { value: 1 },
    stars: { value: 0.5 },
    haze: { value: 1 },
    sunDisc: { value: 1 },
  };
}

/** 贴地天空穹顶（挂 scene，不随世界旋转：太阳相对相机固定，天空也相对相机固定）。 */
export class SkyDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly uniforms: SkyUniforms;
  /** 星球球心 / 半径：地平线（掠射角）按它算。 */
  private readonly planetCenter = new THREE.Vector3();
  private planetRadius = 100;

  constructor(quality: PlanetRenderQuality) {
    this.uniforms = createSkyUniforms(quality);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: this.uniforms.sunDirection },
        zenith: { value: this.uniforms.zenith },
        horizon: { value: this.uniforms.horizon },
        sunColor: { value: this.uniforms.sunColor },
        planetCenter: { value: this.planetCenter },
        planetRadius: { value: this.planetRadius },
        atmosphere: this.uniforms.atmosphere,
        stars: this.uniforms.stars,
        haze: this.uniforms.haze,
        sunDisc: this.uniforms.sunDisc,
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 32), material);
    this.mesh.name = 'atmosphere-sky';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  setSunDirection(direction: THREE.Vector3) {
    this.uniforms.sunDirection.copy(direction).normalize();
  }

  /**
   * 穹顶跟随相机（方向 = 视线方向）：地平线角度在片元里按「相机到地心」算，
   * 这里只需要把穹顶中心搬到相机位置。
   */
  followCamera(camera: THREE.PerspectiveCamera) {
    this.mesh.position.copy(camera.position);
  }

  /** 星球球心与半径（默认原点 / 100）。 */
  setPlanet(center: THREE.Vector3, radius: number) {
    this.planetCenter.copy(center);
    this.planetRadius = radius;
  }

  /**
   * 按相机高度在天空与太空之间过渡：altitude ≤ 25 全天空，≥ 60 纯太空。
   * 贴地机位（默认聚焦高度 7.7）总是 1；中空 60 的机位正好 0。
   */
  setAltitude(altitude: number) {
    const t = 1 - THREE.MathUtils.smoothstep(altitude, 25, 60);
    this.uniforms.atmosphere.value = t;
    // 星点：天空里被大气洗淡，太空中恢复。
    this.uniforms.stars.value = THREE.MathUtils.lerp(0.22, 0.55, 1 - t);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * 散射壳（全球 / 中空视角）：边缘增亮、日面瑞利蓝、明暗交界偏橙、夜面暗而不黑。
 *
 * 两层：
 * - `rim`（BackSide，半径 1.025R）：星球轮廓外的一圈大气边缘光；
 * - `veil`（FrontSide，同半径）：盖在星球圆盘上的薄大气（日面才加），越靠轮廓越厚——
 *   全球视角读成「向阳面亮、背阳面暗 + 边缘发亮」，中空视角读成远处地表的轻微空气透视。
 *
 * **太阳方向是星球局部空间**：两层都挂在 `world` 下（随星球旋转），shader 用物体空间法线
 * 与局部空间太阳方向做点积；`setSunDirection(sceneSun, worldQuaternion)` 负责把场景主光
 * 方向换算到局部空间。以前直接拿场景空间方向与（被 world 旋转过的）法线比，明暗交界会
 * 相对真实光照整体转一个角度。
 */
export class AtmosphereShell {
  /** 两层壳的父节点（场景只开关整组可见性）。 */
  readonly mesh: THREE.Group;
  private readonly rim: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly veil: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** 局部空间的太阳方向（uniform 的持有者）。 */
  private readonly sunDirection = new THREE.Vector3(-0.36, 0.5, 0.82).normalize();

  constructor(radius: number, sunDirection: THREE.Vector3) {
    this.setSunDirection(sunDirection);
    const shared = {
      sunDirection: { value: this.sunDirection },
      dayColor: { value: new THREE.Color('#93c4f2') },
      dayWhite: { value: new THREE.Color('#e8f3ff') },
      horizonColor: { value: new THREE.Color('#ff9a5c') },
      nightColor: { value: new THREE.Color('#0b1622') },
      veilCool: { value: new THREE.Color('#4f86bd') },
      veilWarm: { value: new THREE.Color('#cfe4f7') },
      /** 薄大气整体强度：全球视角 1，中空视角减弱（免得把已探索地表刷成蓝色）。 */
      veilStrength: { value: 1 },
    };
    const vertexShader = /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vObjectNormal;
      varying vec3 vViewPosition;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        // 物体空间法线：与局部空间太阳方向同空间，world 怎么转都对得上。
        vObjectNormal = normalize(normal);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `;
    const rimMaterial = new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDirection;
        uniform vec3 dayColor;
        uniform vec3 dayWhite;
        uniform vec3 horizonColor;
        uniform vec3 nightColor;
        varying vec3 vNormal;
        varying vec3 vObjectNormal;
        varying vec3 vViewPosition;
        void main() {
          // BackSide 渲染的是球壳远端：外法线背对相机，这里翻过来，让 |dot| 在轮廓处为 0。
          vec3 normal = -normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          // 边缘（视线掠过的球壳厚度）：pow 让边缘只有一圈亮带，不糊住整个球面。
          float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
          float sun = dot(normalize(vObjectNormal), sunDirection);
          float day = smoothstep(-0.22, 0.5, sun);
          // 明暗交界：窄带偏橙（瑞利散射被拉长），只在日面一侧出现。
          float terminator = smoothstep(0.5, 0.0, abs(sun + 0.04)) * smoothstep(-0.4, 0.15, sun);
          vec3 color = mix(nightColor, dayColor, day);
          // 向阳一侧（太阳在左上前方）：边缘是蓝白，最亮。
          color = mix(color, dayWhite, smoothstep(0.25, 0.95, sun) * 0.6);
          color = mix(color, horizonColor, terminator * 0.65);
          // 夜面保持一点冷色轮廓，不纯黑。
          color += nightColor * rim * 0.5;
          float alpha = rim * (0.10 + 0.85 * day);
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    const veilMaterial = new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDirection;
        uniform vec3 veilCool;
        uniform vec3 veilWarm;
        uniform float veilStrength;
        varying vec3 vNormal;
        varying vec3 vObjectNormal;
        varying vec3 vViewPosition;
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          // 视线穿过大气的厚度：圆盘中心最薄、靠近轮廓最厚（远处地表 = 空气透视）。
          float facing = max(dot(normal, viewDir), 0.0);
          float thickness = pow(1.0 - facing, 1.7);
          float sun = dot(normalize(vObjectNormal), sunDirection);
          float day = smoothstep(-0.18, 0.5, sun);
          vec3 color = mix(veilCool, veilWarm, smoothstep(0.15, 0.9, sun));
          color = mix(color, color * 0.55, 1.0 - day);
          // 日面才有大气：夜面不加（夜面靠 rim 的冷色轮廓）。向阳面（正对太阳）最亮，
          // 这样圆盘本身就能看出「向阳面亮、背阳面暗」，而不是整盘一样暗。
          float sunward = smoothstep(-0.1, 0.95, sun);
          // 背阳面留一点极薄的冷色（夜面暗而不黑），向阳面明显更亮。
          float alpha = (0.02 + day * (0.03 + 0.30 * thickness + 0.14 * sunward)) * veilStrength;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.5));
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    const geometry = new THREE.SphereGeometry(radius * 1.025, 128, 96);
    this.rim = new THREE.Mesh(geometry, rimMaterial);
    this.rim.name = 'atmosphere-shell-rim';
    this.rim.renderOrder = 10;
    // 薄大气层：不写深度、但参与深度测试——星球本体（半径 100 < 102.5）挡不住它，
    // 于是日面圆盘整体被轻微提亮（以前只有轮廓一圈，圆盘本身没有大气贡献）。
    this.veil = new THREE.Mesh(geometry, veilMaterial);
    this.veil.name = 'atmosphere-shell-veil';
    this.veil.renderOrder = 9;
    this.mesh = new THREE.Group();
    this.mesh.name = 'atmosphere-shell';
    this.mesh.add(this.rim, this.veil);
  }

  /**
   * 设置太阳方向。`worldQuaternion` 是星球（`world`）当前的旋转：给了就先把场景空间的
   * 主光方向换算到星球局部空间，保证 shader 里「物体空间法线 · 太阳方向」与场景主光一致。
   */
  setSunDirection(direction: THREE.Vector3, worldQuaternion?: THREE.Quaternion) {
    this.sunDirection.copy(direction);
    if (worldQuaternion) this.sunDirection.applyQuaternion(worldQuaternion.clone().invert());
    this.sunDirection.normalize();
  }

  /** 当前 shader 使用的太阳方向（星球局部空间）。 */
  get sunDirectionLocal() { return this.sunDirection; }

  /** 薄大气强度（全球视角 1；中空视角按高度减弱）。 */
  setVeilStrength(strength: number) {
    (this.veil.material.uniforms.veilStrength.value as number) = strength;
  }

  dispose() {
    this.rim.geometry.dispose();
    this.rim.material.dispose();
    this.veil.material.dispose();
  }
}

/**
 * 只含天空的 IBL：`PMREMGenerator.fromScene` 直接从天空穹顶烘出环境贴图。
 * 调用方负责 dispose 返回值；只在换星球 / 换档位时调用（不逐帧）。
 *
 * 白平衡（3A 第二轮 §13）：天光直接烘进 IBL 会把陶瓷白染成冰蓝（贴地机位实测受光面
 * R−B ≈ −17，阴影偏青绿）。这里只烘「去饱和的天光」——把天空色按 `SKY_IBL_DESATURATION`
 * 向中性灰靠拢，太阳圆盘/眩光不烘（那部分由 DirectionalLight 负责，重复会过曝），
 * 再乘 `SKY_IBL_INTENSITY`。天空穹顶本身的颜色不变（画面里的天空仍是目标色）。
 */
export const SKY_IBL_DESATURATION = 0.78;
export const SKY_IBL_INTENSITY = 0.48;
/**
 * 环境光的色相微调（3A 第二轮 §13 复测，第三轮随 IBL 烘焙点修正重调）：
 * 天空色 G 与 B 很接近（地平线雾霾 #b9d3e6），暗部只吃天光时 G ≈ B 且 R 被压低 →
 * 阴影读成青绿（贴地实测 G−avg(R,B) ≈ +20）。烘 IBL 时把 G 压到 0.64（R 不动，
 * 亮度约降 4%），色相从青蓝挪到蓝紫：阴影 G−avg 回到 ≈ −0.3…−3（不再发青），
 * 受光陶瓷面 R−B 从 −30 回到 +9（中性偏暖）。只作用于 IBL，天空穹顶仍是目标色。
 */
export const SKY_IBL_RED = 1.0;
export const SKY_IBL_GREEN = 0.64;

/**
 * 天空 shader 的「高出地平线角度 → 地平线雾霾权重」解析式（与 SKY_FRAGMENT 同一口径）：
 * `t = exp(-aboveHorizon / 0.055)`，1 = 地平线雾霾、0 = 天顶深青蓝。
 *
 * 抽出来是为了能单测审查 P1-5 的根因：烘焙相机放在球心时，`aboveHorizon` 处处是 90°，
 * 整个 IBL 只有天顶色、地平线白丢失。`cameraPos` / `planetCenter` / `radius` 与 shader 同名同义。
 */
export function skyHorizonFactor(
  direction: THREE.Vector3,
  cameraPos: THREE.Vector3,
  planetCenter: THREE.Vector3,
  radius: number,
): number {
  const d = direction.clone().normalize();
  // 相机与球心重合时 shader 里的 normalize(0) 是 NaN；这里按「在球心 = 处处 90°」处理
  // （与 GLSL 里 `cameraPosition - planetCenter` 退化后的实际观感一致：只有天顶色）。
  if (cameraPos.distanceToSquared(planetCenter) < 1e-8) return 0;
  const toCenter = planetCenter.clone().sub(cameraPos).normalize();
  const fromCenter = Math.acos(THREE.MathUtils.clamp(d.dot(toCenter), -1, 1));
  const distanceToCenter = Math.max(cameraPos.distanceTo(planetCenter), radius + 0.001);
  const grazing = Math.asin(THREE.MathUtils.clamp(radius / distanceToCenter, 0, 1));
  const aboveHorizon = Math.max(fromCenter - grazing, 0);
  return Math.exp(-aboveHorizon / 0.055);
}

/**
 * IBL 的烘焙观察点：相机沿 +Z 悬在地表上方 `altitude` 处（场景的 `updateCamera` 同一口径）。
 *
 * 不能放在球心（审查 P1-5）：`fromScene` 的 cube 相机在原点时，天空 shader 的地平线判据
 * 处处是 90°，地平线白完全丢失 → IBL 只剩天顶深蓝 → 陶瓷白偏冷。
 */
export function skyIblObserver(radius: number, altitude: number): THREE.Vector3 {
  return new THREE.Vector3(0, 0, radius + Math.max(altitude, 3.5));
}

export function createSkyEnvironment(
  renderer: THREE.WebGLRenderer,
  sunDirection: THREE.Vector3,
  envSize: number,
  /** 烘焙位置（世界坐标）：应在星球表面（相机高度附近），不能是球心（见 `skyIblObserver`）。 */
  observer = skyIblObserver(100, 3.5),
  planetRadius = 100,
): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const dome = new SkyDome('high');
  dome.setSunDirection(sunDirection);
  dome.setPlanet(new THREE.Vector3(0, 0, 0), planetRadius);
  // 烘焙相机放在地表上方：天空 shader 的地平线判据用 `cameraPosition`，放在球心时
  // 「高于地平线」恒为 90°，地平线雾霾（白）完全丢失，IBL 只剩天顶深蓝 → 陶瓷白偏冷
  // （审查 P1-5，也是第二轮 §13 的根因）。
  dome.mesh.position.copy(observer);
  // 环境贴图要的是「全天空」的亮度：贴地机位的高度过渡在这里不适用。
  dome.uniforms.atmosphere.value = 1;
  dome.uniforms.stars.value = 0.3;
  // 去饱和 + 降强度：IBL 只作环境补光，不把材质染蓝（见上面白平衡说明）。
  const desaturate = (color: THREE.Color) => {
    const luma = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    color.lerp(new THREE.Color(luma, luma, luma), SKY_IBL_DESATURATION);
    color.multiplyScalar(SKY_IBL_INTENSITY);
  };
  desaturate(dome.uniforms.zenith);
  desaturate(dome.uniforms.horizon);
  for (const color of [dome.uniforms.zenith, dome.uniforms.horizon]) {
    color.r *= SKY_IBL_RED;
    color.g *= SKY_IBL_GREEN;
  }
  // 环境贴图里不要太阳圆盘（会与 DirectionalLight 叠加过曝）。
  dome.uniforms.sunDisc.value = 0;
  scene.add(dome.mesh);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 4000, { size: envSize, position: observer.clone() });
  dome.dispose();
  pmrem.dispose();
  return target;
}
