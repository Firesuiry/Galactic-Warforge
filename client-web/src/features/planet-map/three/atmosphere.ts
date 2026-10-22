import * as THREE from 'three';
import type { PlanetRenderQuality } from './render-quality';

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
   * 地平线雾霾的「显示空间」色（sRGB 分量，不经 ACES）：雾 chunk 在 tonemapping 之后执行，
   * 贴地远景的地面要与地平线处的天空同色，所以雾色取这一份，而不是 HDR 的 `horizon`。
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
    sky += sunColor * (disc * 26.0 + glow) * atmosphere;

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
    // 目标显示色 #b9d3e6（与 3A画质.md 的地平线雾霾同口径）；用 LinearSRGBColorSpace
    // 只是为了跳过 three 的 sRGB→线性转换，雾 shader 拿到的是显示空间分量。
    horizonColor: new THREE.Color().setRGB(0.7255, 0.8275, 0.902, THREE.LinearSRGBColorSpace),
    sunColor: new THREE.Color('#ffe2bd'),
    atmosphere: { value: 1 },
    stars: { value: 0.5 },
    haze: { value: 1 },
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

/** 散射壳（全球视角）：边缘增亮、日面瑞利蓝、明暗交界偏橙、夜面暗而不黑。 */
export class AtmosphereShell {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(radius: number, sunDirection: THREE.Vector3) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: sunDirection.clone().normalize() },
        dayColor: { value: new THREE.Color('#5aa6e8') },
        horizonColor: { value: new THREE.Color('#ff9a5c') },
        nightColor: { value: new THREE.Color('#0b1622') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewPosition = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDirection;
        uniform vec3 dayColor;
        uniform vec3 horizonColor;
        uniform vec3 nightColor;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          // BackSide 渲染的是球壳远端：外法线背对相机，这里翻过来，让 |dot| 在轮廓处为 0。
          vec3 normal = -normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          // 边缘（视线掠过的球壳厚度）：pow 让边缘只有一圈亮带，不糊住整个球面。
          float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.2);
          float sun = dot(normal, sunDirection);
          float day = smoothstep(-0.28, 0.55, sun);
          // 明暗交界：±0.25 的窄带偏橙（瑞利散射被拉长）。
          float terminator = smoothstep(0.45, 0.0, abs(sun + 0.02)) * smoothstep(-0.35, 0.1, sun);
          vec3 color = mix(nightColor, dayColor, day);
          color = mix(color, horizonColor, terminator * 0.75);
          // 夜面保持一点冷色轮廓，不纯黑。
          color += nightColor * rim * 0.6;
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
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.025, 128, 96), material);
    this.mesh.name = 'atmosphere-shell';
    this.mesh.renderOrder = 10;
  }

  setSunDirection(direction: THREE.Vector3) {
    (this.mesh.material.uniforms.sunDirection.value as THREE.Vector3).copy(direction).normalize();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * 只含天空的 IBL：`PMREMGenerator.fromScene` 直接从天空穹顶烘出环境贴图。
 * 调用方负责 dispose 返回值；只在换星球 / 换档位时调用（不逐帧）。
 */
export function createSkyEnvironment(renderer: THREE.WebGLRenderer, sunDirection: THREE.Vector3, envSize: number): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const dome = new SkyDome('high');
  dome.setSunDirection(sunDirection);
  // 环境贴图要的是「全天空」的亮度：贴地机位的高度过渡在这里不适用。
  dome.uniforms.atmosphere.value = 1;
  dome.uniforms.stars.value = 0.3;
  scene.add(dome.mesh);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 4000, { size: envSize });
  dome.dispose();
  pmrem.dispose();
  return target;
}
