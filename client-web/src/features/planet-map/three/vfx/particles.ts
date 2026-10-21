/**
 * GPU 粒子系统（3A 画质 · vfx 分支）。
 *
 * 设计要点（docs/guide/3A画质.md §2）：
 * - **运动在顶点着色器里按 (t − 发射时刻) 解析计算**：CPU 只在发射时写一次粒子属性，
 *   之后不再逐帧更新缓冲；绘制调用按混合模式固定 2 个（additive / alpha）。
 * - 环形缓冲 + 上限：池满时最旧的槽位被新发射覆盖（不抛错、不增长内存）。
 * - 冻结确定性：时间由场景传入（`?freeze=1` 时传固定相位），随机数全部来自
 *   `common.ts` 的哈希（同 seed 同发射序列），画面是时间的纯函数。
 * - 不做深度软粒子、不往 composer 加 pass。
 */

import * as THREE from 'three';

import { ATLAS_FRAMES, atlasTexture, onAtlasReady, type AtlasKind } from './atlas';
import { clamp01, rand, randSigned, smoothstep, type VfxQualitySettings } from './common';

/** 一种粒子外观（决定贴图行、混合模式、尺寸/颜色随寿命的曲线）。 */
export interface ParticleStyle {
  kind: AtlasKind;
  /** 混合模式：additive 用于火/光/火花，alpha 用于烟/尘。 */
  blend: 'additive' | 'alpha';
  /** 初始尺寸（格）。 */
  size: number;
  /** 末尺寸 / 初尺寸。 */
  growth: number;
  /** 初始颜色（线性 RGB，0..1）。 */
  colorFrom: [number, number, number];
  /** 末颜色（线性 RGB，0..1）。 */
  colorTo: [number, number, number];
  /** 初始不透明度。 */
  opacity: number;
  /** 重力（格/秒²，沿局部 +Y；负值下落）。 */
  gravity: number;
  /** 空气阻力（1/秒，速度按 e^{-drag·t} 衰减）。 */
  drag: number;
  /** 速度随机扰动（格/秒，各轴 ±）。 */
  spread: number;
  /** 是否沿表面法线抬升（真 = 相对球面法线，假 = 世界 Y）。 */
  surface: boolean;
}

/** 一次发射：位置、法线、基准速度与数量。 */
export interface ParticleBurst {
  /** 发射点（world 组局部坐标，球面半径附近）。 */
  position: THREE.Vector3;
  /** 表面法线（单位向量）。 */
  normal: THREE.Vector3;
  /** 平均速度（格/秒，沿 normal 与切向）。 */
  velocity: THREE.Vector3;
  /** 速度抖动倍率（叠加 style.spread）。 */
  spread?: number;
  /** 发射数量（会乘档位 emissionScale）。 */
  count: number;
  /** 寿命（秒）。 */
  life: number;
  /** 尺寸倍率。 */
  scale?: number;
  /** 随机种子（同一发射点重复触发时用不同种子）。 */
  seed: number;
  /** 色调倍率（RGB，默认 1）。 */
  tint?: [number, number, number];
}

const MAX_BURSTS_PER_FRAME = 512;

/** 单批（一个混合模式）的 GPU 缓冲与材质。 */
class ParticleBatch {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly capacity: number;
  /** 环形缓冲写指针：池满时从最旧槽位继续覆盖。 */
  private cursor = 0;
  private time = 0;
  private live = 0;

  constructor(
    capacity: number,
    blend: 'additive' | 'alpha',
    private readonly getTexture: () => THREE.Texture | null,
  ) {
    this.capacity = capacity;
    this.geometry = new THREE.BufferGeometry();
    const emitTime = new Float32Array(capacity).fill(-1e6);
    const birth = new Float32Array(capacity * 3);
    const velocity = new Float32Array(capacity * 3);
    const params = new Float32Array(capacity * 4); // life, size, growth, opacity
    const colorFrom = new Float32Array(capacity * 3);
    const colorTo = new Float32Array(capacity * 3);
    const style = new Float32Array(capacity * 4); // gravity, drag, frameStart, frameCount
    const frames = new Float32Array(capacity); // 该粒子的帧数（随机取 1..count）
    const seed = new Float32Array(capacity);
    for (const [name, array, size] of [
      ['emitTime', emitTime, 1], ['birth', birth, 3], ['velocity', velocity, 3], ['params', params, 4],
      ['colorFrom', colorFrom, 3], ['colorTo', colorTo, 3], ['style', style, 4], ['frames', frames, 1], ['seed', seed, 1],
    ] as const) {
      this.geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uTexture: { value: getTexture() },
        uHasTexture: { value: getTexture() ? 1 : 0 },
        uFadeNear: { value: 2.2 },
        uFadeFar: { value: 90 },
        uGrid: { value: 4 },
        // 占位：ParticleSystem.setWorldScale 按「格宽 × 屏幕高度」更新。
        uPixelScale: { value: 650 },
      },
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blend === 'additive' ? 16 : 15;
    this.points.name = `vfx-particles-${blend}`;
  }

  /**
   * 写一批粒子（覆盖最旧的槽位）。count 由调用方按档位缩过。
   * 整批一次性写入，属性各标记一次 needsUpdate（一次上传，不逐粒子）。
   */
  emit(burst: ParticleBurst, style: ParticleStyle, count: number): number {
    if (count <= 0) return 0;
    const scale = burst.scale ?? 1;
    const spread = (burst.spread ?? 1) * style.spread;
    const emitTime = this.geometry.getAttribute('emitTime') as THREE.BufferAttribute;
    const birth = this.geometry.getAttribute('birth') as THREE.BufferAttribute;
    const velocity = this.geometry.getAttribute('velocity') as THREE.BufferAttribute;
    const params = this.geometry.getAttribute('params') as THREE.BufferAttribute;
    const colorFromAttr = this.geometry.getAttribute('colorFrom') as THREE.BufferAttribute;
    const colorToAttr = this.geometry.getAttribute('colorTo') as THREE.BufferAttribute;
    const styleAttr = this.geometry.getAttribute('style') as THREE.BufferAttribute;
    const frames = this.geometry.getAttribute('frames') as THREE.BufferAttribute;
    const seeds = this.geometry.getAttribute('seed') as THREE.BufferAttribute;
    const tint = burst.tint ?? [1, 1, 1];
    const frame = ATLAS_FRAMES[style.kind];
    for (let i = 0; i < count; i++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const seed = (burst.seed + i * 977) | 0;
      const jitter = Math.sqrt(rand(seed, 1)) * spread;
      const angle = rand(seed, 2) * Math.PI * 2;
      const lift = randSigned(seed, 3) * spread * 0.35;
      const nx = burst.normal.x, ny = burst.normal.y, nz = burst.normal.z;
      // 切向基：任取一条与法线不平行的轴叉乘。
      const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = Math.abs(nx) < 0.9 ? 0 : 1;
      const tx = ny * 0 - nz * ay, ty = nz * ax - nx * 0, tz = nx * ay - ny * ax;
      const tlen = Math.hypot(tx, ty, tz) || 1;
      const ux = tx / tlen, uy = ty / tlen, uz = tz / tlen;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const cx = Math.cos(angle) * jitter, cy = Math.sin(angle) * jitter;
      birth.setXYZ(index,
        burst.position.x + (ux * cx + vx * cy) * 0.5,
        burst.position.y + (uy * cx + vy * cy) * 0.5,
        burst.position.z + (uz * cx + vz * cy) * 0.5);
      velocity.setXYZ(index,
        burst.velocity.x + (ux * cx + vx * cy) + nx * lift,
        burst.velocity.y + (uy * cx + vy * cy) + ny * lift,
        burst.velocity.z + (uz * cx + vz * cy) + nz * lift);
      emitTime.setX(index, this.time);
      const life = burst.life * (0.75 + rand(seed, 4) * 0.5);
      params.setXYZW(index, life, style.size * scale * (0.75 + rand(seed, 5) * 0.5), style.growth, style.opacity);
      colorFromAttr.setXYZ(index, style.colorFrom[0] * tint[0], style.colorFrom[1] * tint[1], style.colorFrom[2] * tint[2]);
      colorToAttr.setXYZ(index, style.colorTo[0] * tint[0], style.colorTo[1] * tint[1], style.colorTo[2] * tint[2]);
      styleAttr.setXYZW(index, style.gravity, style.drag, frame.start, style.surface ? 1 : 0);
      frames.setX(index, Math.max(1, Math.min(frame.count, Math.round(frame.count * (0.6 + rand(seed, 6) * 0.4)))));
      seeds.setX(index, rand(seed, 7) * 6.283);
    }
    emitTime.needsUpdate = true;
    birth.needsUpdate = true;
    velocity.needsUpdate = true;
    params.needsUpdate = true;
    colorFromAttr.needsUpdate = true;
    colorToAttr.needsUpdate = true;
    styleAttr.needsUpdate = true;
    frames.needsUpdate = true;
    seeds.needsUpdate = true;
    this.live = Math.min(this.capacity, this.live + count);
    return count;
  }

  /** 推进时间（秒）：只更新 uniform，不动缓冲。 */
  setTime(seconds: number): void {
    this.time = seconds;
    this.material.uniforms.uTime.value = seconds;
  }

  setPixelScale(scale: number): void {
    this.material.uniforms.uPixelScale.value = scale;
  }

  setTexture(texture: THREE.Texture | null): void {
    this.material.uniforms.uTexture.value = texture;
    this.material.uniforms.uHasTexture.value = texture ? 1 : 0;
  }

  /** 相机距离淡出（按相机高度）：近处不糊屏、远处不闪烁。 */
  setFade(near: number, far: number): void {
    this.material.uniforms.uFadeNear.value = near;
    this.material.uniforms.uFadeFar.value = far;
  }

  /** 已写入的槽位数（上限 = 容量；池满后不再增长）。 */
  aliveCount(): number {
    return this.live;
  }

  get capacitySize(): number { return this.capacity; }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

const VERTEX_SHADER = /* glsl */ `
  attribute float emitTime;
  attribute vec3 birth;
  attribute vec3 velocity;
  attribute vec4 params;   // life, size, growth, opacity
  attribute vec3 colorFrom;
  attribute vec3 colorTo;
  attribute vec4 style;    // gravity, drag, frameStart, surface
  attribute float frames;  // 帧数
  attribute float seed;

  uniform float uTime;
  uniform float uFadeNear;
  uniform float uFadeFar;
  uniform float uGrid;
  uniform float uPixelScale;

  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vFrame;   // 帧序号与每行帧数（图集网格）

  void main() {
    float age = uTime - emitTime;
    float life = max(params.x, 0.0001);
    float t = age / life;
    if (t < 0.0 || t > 1.0) {
      // 死粒子：推到裁剪外（GPU 侧剔除，不写缓冲）。
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      vColor = vec3(0.0);
      vFrame = vec2(0.0, uGrid);
      return;
    }
    // 解析运动：v(t) = v0·e^{-drag·t}；位移积分后叠加重力。
    float drag = style.y;
    float k = drag > 0.0001 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 pos = birth + velocity * k;
    // 重力沿「局部 +Y」近似为世界 +Y（球面局部法线由发射时 velocity 的 normal 分量承担）。
    pos.y += 0.5 * style.x * age * age;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 0.001);
    float fade = smoothstep(uFadeNear, uFadeNear + 1.0, dist) * (1.0 - smoothstep(uFadeFar * 0.6, uFadeFar, dist));
    float sizeT = mix(1.0, params.z, t);
    // 尺寸按世界单位投影：particleSize 的单位是「格」，先换算成世界长度再按视距缩放
    // （旧工业光点写死的 650 只对 RADIUS=100 / 16 格面成立，这里由 uniform 统一）。
    gl_PointSize = clamp(params.y * sizeT * uPixelScale / dist, 1.0, 220.0);

    vColor = mix(colorFrom, colorTo, t);
    // 淡入淡出：前 12% 快速淡入，后 45% 淡出。
    float fadeIn = smoothstep(0.0, 0.12, t);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, t);
    vAlpha = params.w * fadeIn * fadeOut * fade;
    // 序列帧：按寿命取帧（每粒子帧数 frames），帧序号 = frameStart + floor(t·frames)。
    vFrame = vec2(style.z + floor(min(t * frames, frames - 0.001)), uGrid);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uHasTexture;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vFrame;   // 帧序号与每行帧数（图集网格）

  void main() {
    if (vAlpha <= 0.001) discard;
    vec4 texel;
    if (uHasTexture > 0.5) {
      float cols = vFrame.y;
      float col = mod(vFrame.x, cols);
      float row = floor(vFrame.x / cols);
      // gl_PointCoord：左上原点、Y 向下；图集同样按行优先排布，直接拼即可。
      vec2 uv = (gl_PointCoord + vec2(col, row)) / cols;
      texel = texture2D(uTexture, uv);
    } else {
      // 无图集：柔和的径向衰减圆点。
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c) * 2.0;
      if (r > 1.0) discard;
      float a = pow(1.0 - r, 2.0);
      texel = vec4(1.0, 1.0, 1.0, a);
    }
    gl_FragColor = vec4(vColor * texel.rgb, texel.a * vAlpha);
    if (gl_FragColor.a <= 0.002) discard;
  }
`;

/**
 * 粒子系统：两批（additive / alpha）+ 全局环形缓冲。
 *
 * 用法：`emit(style, burst)` 写入；每帧 `setTime(t)`；相机高度变化时 `setCamera(height)`。
 * 冻结时调用方传固定时间（如 0.6s），画面静止且确定。
 */
export class ParticleSystem {
  readonly group = new THREE.Group();
  private readonly additive: ParticleBatch;
  private readonly alpha: ParticleBatch;
  private readonly settings: VfxQualitySettings;
  private readonly unsubscribeAtlas: () => void;
  private time = 0;
  private pending = 0;

  constructor(parent: THREE.Object3D, settings: VfxQualitySettings) {
    this.settings = settings;
    this.group.name = 'vfx-particles';
    // 环形缓冲：按 55/45 分配给两种混合模式（火焰/火花多，烟/尘次之）。
    const additiveCapacity = Math.max(64, Math.round(settings.particleLimit * 0.55));
    const alphaCapacity = Math.max(64, settings.particleLimit - additiveCapacity);
    this.additive = new ParticleBatch(additiveCapacity, 'additive', atlasTexture);
    this.alpha = new ParticleBatch(alphaCapacity, 'alpha', atlasTexture);
    this.group.add(this.additive.points, this.alpha.points);
    parent.add(this.group);
    this.unsubscribeAtlas = onAtlasReady((texture) => {
      this.additive.setTexture(texture);
      this.alpha.setTexture(texture);
    });
  }

  get quality(): VfxQualitySettings { return this.settings; }

  /**
   * 发射一批粒子；返回实际写入数（数量按档位 emissionScale 缩放）。
   * 每帧发射预算（`MAX_BURSTS_PER_FRAME`）只限制**批次数**，防同一帧上千条战斗事件
   * 把 CPU 时间全花在写缓冲上；超出部分直接丢弃（下一帧继续）。
   */
  emit(style: ParticleStyle, burst: ParticleBurst): number {
    if (this.pending >= MAX_BURSTS_PER_FRAME) return 0;
    this.pending += 1;
    const batch = style.blend === 'additive' ? this.additive : this.alpha;
    return batch.emit(burst, style, Math.round(burst.count * this.settings.emissionScale));
  }

  /** 每帧调用：推进 uniform 时间并清空单帧发射预算。 */
  setTime(seconds: number): void {
    this.time = seconds;
    this.additive.setTime(seconds);
    this.alpha.setTime(seconds);
    this.pending = 0;
  }

  /**
   * 世界尺度：粒子尺寸单位是「格」，投影到屏幕像素需要 `tileSize × 屏幕高度 / 2tan(fov/2)`。
   * 场景在 resize/聚焦后调用；默认 650 与旧工业光点口径一致（RADIUS=100、16 格面、1000px 高）。
   */
  setWorldScale(pixelScale: number): void {
    const scale = Math.max(1, pixelScale);
    for (const batch of [this.additive, this.alpha]) batch.setPixelScale(scale);
  }

  /** 相机高度（世界单位）：近处/远处淡出。 */
  setCamera(height: number): void {
    this.additive.setFade(Math.max(0.4, height * 0.02), Math.max(40, height * 2.6));
    this.alpha.setFade(Math.max(0.4, height * 0.02), Math.max(40, height * 2.6));
  }

  /** 存活粒子数（测试/诊断）。 */
  counts(): { additive: number; alpha: number; total: number } {
    const a = this.additive.aliveCount(), b = this.alpha.aliveCount();
    return { additive: a, alpha: b, total: a + b };
  }

  /** 当前时间（秒，冻结下由调用方固定）。 */
  get currentTime(): number { return this.time; }

  dispose(): void {
    this.unsubscribeAtlas();
    this.additive.dispose();
    this.alpha.dispose();
    this.group.removeFromParent();
  }
}

/** 常用样式（线性 RGB；与 3A 画质配色一致：暖白火、冷青己方发光）。 */
export const PARTICLE_STYLES = {
  /** 火焰：白热 → 橙红，上飘、轻微上浮。 */
  fire: {
    kind: 'fire', blend: 'additive', size: 0.55, growth: 1.9, colorFrom: [1, 0.92, 0.72], colorTo: [0.85, 0.24, 0.06],
    opacity: 0.9, gravity: 1.4, drag: 2.2, spread: 0.5, surface: true,
  } satisfies ParticleStyle,
  /** 烟：深灰 → 浅灰，缓慢上升并扩散（alpha 混合）。 */
  smoke: {
    kind: 'smoke', blend: 'alpha', size: 0.5, growth: 3.4, colorFrom: [0.2, 0.21, 0.23], colorTo: [0.52, 0.55, 0.58],
    opacity: 0.42, gravity: 0.85, drag: 1.1, spread: 0.35, surface: true,
  } satisfies ParticleStyle,
  /** 白色蒸汽：比烟更亮、更快消散。 */
  steam: {
    kind: 'smoke', blend: 'alpha', size: 0.36, growth: 2.8, colorFrom: [0.72, 0.78, 0.82], colorTo: [0.9, 0.93, 0.95],
    opacity: 0.3, gravity: 1.1, drag: 1.4, spread: 0.3, surface: true,
  } satisfies ParticleStyle,
  /** 火花：细长条，弹跳感（重力下坠 + 高阻力）。 */
  spark: {
    kind: 'spark', blend: 'additive', size: 0.34, growth: 0.6, colorFrom: [1, 0.82, 0.42], colorTo: [0.95, 0.32, 0.08],
    opacity: 0.95, gravity: -3.2, drag: 0.6, spread: 1.1, surface: true,
  } satisfies ParticleStyle,
  /** 焊花：冷白偏青（装配台焊接）。 */
  weld: {
    kind: 'spark', blend: 'additive', size: 0.3, growth: 0.5, colorFrom: [0.92, 0.98, 1], colorTo: [0.42, 0.86, 1],
    opacity: 0.9, gravity: -2.4, drag: 1.2, spread: 0.8, surface: true,
  } satisfies ParticleStyle,
  /** 尘土：采矿机扬尘（alpha）。 */
  dust: {
    kind: 'smoke', blend: 'alpha', size: 0.32, growth: 2.4, colorFrom: [0.44, 0.4, 0.33], colorTo: [0.62, 0.58, 0.5],
    opacity: 0.34, gravity: 0.5, drag: 1.6, spread: 0.55, surface: true,
  } satisfies ParticleStyle,
  /** 碎屑：小而硬的颗粒，抛物线飞出（additive 让它在暗部也看得见）。 */
  debris: {
    kind: 'spark', blend: 'additive', size: 0.16, growth: 0.9, colorFrom: [0.78, 0.74, 0.66], colorTo: [0.36, 0.33, 0.3],
    opacity: 0.8, gravity: -5.5, drag: 0.35, spread: 1.6, surface: true,
  } satisfies ParticleStyle,
  /** 全息光粒：缓慢上升的青色光点（研究站）。 */
  holo: {
    kind: 'glow', blend: 'additive', size: 0.2, growth: 0.7, colorFrom: [0.32, 0.9, 1], colorTo: [0.16, 0.52, 0.95],
    opacity: 0.75, gravity: 0.55, drag: 1.6, spread: 0.16, surface: true,
  } satisfies ParticleStyle,
  /** 冲击波环（作为 billboard 的扁平闪光，配合网格环用）。 */
  flash: {
    kind: 'glow', blend: 'additive', size: 1.2, growth: 2.2, colorFrom: [1, 0.94, 0.8], colorTo: [1, 0.5, 0.18],
    opacity: 0.85, gravity: 0, drag: 3.5, spread: 0.1, surface: true,
  } satisfies ParticleStyle,
} as const;

/** 归一化年龄（测试/调试：粒子在 t 时刻是否还活着）。 */
export function particleAlive(age: number, life: number): boolean {
  return age >= 0 && age < life;
}

/** 供测试使用：把 age 映射到不透明度（与 shader 同一条曲线）。 */
export function particleOpacity(t: number): number {
  return clamp01(smoothstep(0, 0.12, t) * (1 - smoothstep(0.55, 1, t)));
}
