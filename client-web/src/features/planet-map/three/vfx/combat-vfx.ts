/**
 * 战斗视觉层：把 `combat-vfx-specs` 的指令落成 Three 对象。
 *
 * 组成：
 * - 粒子：交给共享的 `ParticleSystem`（火焰/烟/火花/闪光/碎屑）；
 * - 曳光：细长拉伸 billboard（面向相机的四边形），短命；
 * - 焦痕：贴地深色圆盘，随时间淡出；
 * - 冲击波：贴地扩散的细环（半径按规模 1.5–3 格，环宽 ≤ .12 格，0.35s 淡出）；
 * - 碎片：暗色小块抛物线飞出、落地淡出（实例化共享几何）；
 * - 点光源：池化（上限由档位决定，low 档 0 个），只做极短促的照明。
 *
 * 所有对象池化、几何共享；池满时顶掉最旧（不抛错、不增长内存）。
 */

import * as THREE from 'three';

import { clamp01, rand, randSigned } from './common';
import { ParticleSystem } from './particles';
import {
  wreckSmoke,
  type CombatVfxSpecs, type VfxBurst, type VfxDebris, type VfxDecal, type VfxLight,
  type VfxShield, type VfxShockwave, type VfxTracer, type VfxWreck,
} from './combat-vfx-specs';

export const COMBAT_VFX_LIMITS = {
  tracers: 48,
  shockwaves: 16,
  lights: 4,
  debris: 96,
  shields: 12,
  wrecks: 10,
} as const;

/** 残骸冒烟的发射间隔（秒）：同一具残骸 0.45s 冒一次，共 4.2s。 */
export const WRECK_SMOKE_INTERVAL = 0.45;

/** 曳光宽度：远景（相机高度 > `TRACER_PIXEL_FLOOR_ALTITUDE`）不再加宽，按像素下限保持。 */
export const TRACER_WIDTH_TILES = 0.2;
export const TRACER_PIXEL_FLOOR_ALTITUDE = 20;
export const TRACER_MIN_PIXELS = 1.5;

/** 把 VfxBurst 的 at/normal/velocity 换算成粒子系统需要的 Vector3。 */
function burstFrom(spec: VfxBurst) {
  return {
    position: new THREE.Vector3(spec.at.x, spec.at.y, spec.at.z),
    normal: new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z),
    velocity: new THREE.Vector3(spec.velocity.x, spec.velocity.y, spec.velocity.z),
    count: spec.count,
    life: spec.life,
    scale: spec.scale,
    spread: spec.spread,
    seed: spec.seed,
    tint: spec.tint,
  };
}

interface Timed { elapsed: number; duration: number }
interface TracerFx extends Timed { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; width: number; direction: THREE.Vector3 }
interface DecalFx extends Timed { mesh: THREE.Mesh; size: number; opacity: number }
interface ShockwaveFx extends Timed { mesh: THREE.Mesh; size: number }
interface LightFx extends Timed { light: THREE.PointLight; base: number; active: boolean }
interface DebrisFx { mesh: THREE.Mesh; elapsed: number; duration: number; origin: THREE.Vector3; velocity: THREE.Vector3; normal: THREE.Vector3; spin: THREE.Vector3; size: number }
interface DelayedBurst { burst: VfxBurst; remaining: number }
interface ShieldFx extends Timed { mesh: THREE.Mesh; size: number }
interface WreckFx extends Timed { at: THREE.Vector3; normal: THREE.Vector3; seed: number; next: number }

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * 战斗视觉层：粒子 + 曳光 + 焦痕 + 冲击波 + 点光源。
 * 挂到 world 组（随星球旋转），`update(dt, time)` 每帧推进。
 */
export class CombatVfx {
  readonly group = new THREE.Group();
  private readonly particles: ParticleSystem;
  private readonly tracers: TracerFx[] = [];
  private readonly freeTracers: TracerFx[] = [];
  private readonly decals: DecalFx[] = [];
  private readonly freeDecals: DecalFx[] = [];
  private readonly shockwaves: ShockwaveFx[] = [];
  private readonly freeShockwaves: ShockwaveFx[] = [];
  private readonly lights: LightFx[] = [];
  private readonly debris: DebrisFx[] = [];
  private readonly freeDebris: DebrisFx[] = [];
  private readonly delayed: DelayedBurst[] = [];
  private readonly shields: ShieldFx[] = [];
  private readonly freeShields: ShieldFx[] = [];
  private readonly wrecks: WreckFx[] = [];
  private readonly tracerGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly decalGeometry = new THREE.CircleGeometry(1, 28);
  // 冲击波是**细环**（环宽 = 半径的 4%，配合 spec.size ≤ 3 格 → 环宽 ≤ .12 格）。
  private readonly shockGeometry = new THREE.RingGeometry(0.96, 1, 72);
  /** 碎块：一个共享的小八面体（暗色、不发光）。 */
  private readonly debrisGeometry = new THREE.OctahedronGeometry(1, 0);
  /** 护盾气泡：单位球，菲涅尔 shader（边缘亮、正面几乎透明）。 */
  private readonly shieldGeometry = new THREE.SphereGeometry(1, 24, 16);
  private readonly shieldMaterial = makeShieldMaterial();
  private readonly debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x2f2a24, roughness: 0.92, metalness: 0.08, flatShading: true });
  private readonly decalTexture: THREE.CanvasTexture;
  private readonly decalMaterial: THREE.MeshBasicMaterial;
  private readonly shockMaterial: THREE.MeshBasicMaterial;
  private readonly tracerMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly maxLights: number;
  /** 焦痕池容量（按档位：low 12 / balanced 24 / high 32）。 */
  private readonly maxDecals: number;

  constructor(
    parent: THREE.Object3D,
    particles: ParticleSystem,
    maxLights: number = COMBAT_VFX_LIMITS.lights,
    /** 一格的世界长度：贴花/冲击波/曳光尺寸以「格」给出，落成 mesh 时要换算。 */
    private readonly tileScale: () => number = () => 1,
    maxDecals = 32,
  ) {
    this.particles = particles;
    this.maxLights = maxLights;
    this.maxDecals = Math.max(0, maxDecals);
    this.group.name = 'combat-vfx';
    parent.add(this.group);
    this.decalTexture = makeDecalTexture();
    this.decalMaterial = new THREE.MeshBasicMaterial({
      map: this.decalTexture, color: 0x1a1712, transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
    });
    // 冲击波：**亮橙白**的 additive 细环，不写深度、不挡地面。
    // 旧色 0xffa860 是橙（R:G:B = 1 : .66 : .38），additive 叠在绿地上会读成土黄（审查步骤 23）；
    // 提到接近 #ffd8a8 的暖白、并把整体亮度抬过 bloom 的 luminanceThreshold(.45 线性) 才有辉光。
    this.shockMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd8a8, transparent: true, opacity: 1, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    });
  }

  /** 应用一条事件的全部视觉指令。 */
  spawn(specs: CombatVfxSpecs): void {
    for (const burst of specs.bursts) {
      // 延迟发射（爆炸的烟接在火球之后）：进队列，由 `update` 按时间放出。
      if (burst.delay && burst.delay > 0) this.delayed.push({ burst, remaining: burst.delay });
      else this.emitBurst(burst);
    }
    for (const tracer of specs.tracers) this.spawnTracer(tracer);
    for (const decal of specs.decals) this.spawnDecal(decal);
    for (const wave of specs.shockwaves) this.spawnShockwave(wave);
    for (const light of specs.lights) this.flashLight(light);
    for (const debris of specs.debris) this.spawnDebris(debris);
    for (const shield of specs.shields) this.spawnShield(shield);
    for (const wreck of specs.wrecks) this.spawnWreck(wreck);
  }

  /** 护盾命中：菲涅尔气泡（池化，上限 `shields`）。 */
  private spawnShield(spec: VfxShield): void {
    if (this.shields.length >= COMBAT_VFX_LIMITS.shields) {
      const oldest = this.shields.shift()!;
      oldest.mesh.removeFromParent();
      this.freeShields.push(oldest);
    }
    const fx = this.freeShields.pop() ?? {
      mesh: new THREE.Mesh(this.shieldGeometry, this.shieldMaterial),
      size: 1, elapsed: 0, duration: spec.life,
    };
    const normal = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    fx.mesh.position.set(spec.at.x, spec.at.y, spec.at.z);
    fx.mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
    fx.mesh.renderOrder = 13;
    fx.size = spec.size * this.tileScale();
    fx.mesh.scale.setScalar(fx.size);
    fx.elapsed = 0;
    fx.duration = spec.life;
    this.group.add(fx.mesh);
    this.shields.push(fx);
  }

  /** 残骸冒烟：登记一具残骸，`update` 里按间隔从 `wreckSmoke` 取烟。 */
  private spawnWreck(spec: VfxWreck): void {
    if (this.wrecks.length >= COMBAT_VFX_LIMITS.wrecks) this.wrecks.shift();
    this.wrecks.push({
      at: new THREE.Vector3(spec.at.x, spec.at.y, spec.at.z),
      normal: new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize(),
      seed: spec.seed, elapsed: 0, duration: spec.life, next: 0,
    });
  }

  private emitBurst(spec: VfxBurst): void {
    this.particles.emit(spec.style, burstFrom(spec));
  }

  private tracerMaterial(color: number): THREE.MeshBasicMaterial {
    let material = this.tracerMaterials.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.95, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      });
      this.tracerMaterials.set(color, material);
    }
    return material;
  }

  private spawnTracer(spec: VfxTracer): void {
    if (this.tracers.length >= COMBAT_VFX_LIMITS.tracers) {
      const oldest = this.tracers.shift()!;
      this.releaseTracer(oldest);
    }
    const fx = this.freeTracers.pop() ?? {
      mesh: new THREE.Mesh(this.tracerGeometry, this.tracerMaterial(spec.color)),
      from: new THREE.Vector3(), to: new THREE.Vector3(), width: 1, direction: new THREE.Vector3(), elapsed: 0, duration: spec.life,
    };
    fx.mesh.material = this.tracerMaterial(spec.color);
    fx.from.set(spec.from.x, spec.from.y, spec.from.z);
    fx.to.set(spec.to.x, spec.to.y, spec.to.z);
    fx.width = spec.width;
    fx.elapsed = 0;
    fx.duration = spec.life;
    this.group.add(fx.mesh);
    this.tracers.push(fx);
    this.poseTracer(fx, 0);
  }

  /** 相机（billboard 用）：由场景每帧传入，未传时退化为世界对齐。 */
  private camera?: THREE.Camera;
  setCamera(camera: THREE.Camera): void { this.camera = camera; }

  /** 曳光：放在两点中点，沿方向拉伸，法线朝向相机（billboard 绕轴旋转）。 */
  private poseTracer(fx: TracerFx, t: number): void {
    fx.direction.subVectors(fx.to, fx.from);
    const length = fx.direction.length() || 0.0001;
    fx.mesh.position.copy(fx.from).addScaledVector(fx.direction, 0.5);
    // Billboard 长条：局部 +Y 对齐弹道方向，平面法线尽量朝向相机（否则斜视角下是一条线）。
    fx.direction.normalize();
    this.tracerCamera.copy(this.camera ? this.camera.position : Y_AXIS);
    this.tracerCamera.sub(fx.mesh.position).normalize();
    this.tracerSide.crossVectors(fx.direction, this.tracerCamera);
    if (this.tracerSide.lengthSq() < 1e-6) this.tracerSide.set(1, 0, 0);
    this.tracerSide.normalize();
    this.tracerNormal.crossVectors(this.tracerSide, fx.direction).normalize();
    this.tracerBasis.makeBasis(this.tracerSide, fx.direction, this.tracerNormal);
    fx.mesh.quaternion.setFromRotationMatrix(this.tracerBasis);
    // 宽度（格 → 世界）。远景（相机高度 > 20）不再继续加宽，改按像素下限保持 ≥ 1.5px：
    // 曳光的像素宽 ≈ 世界宽 × uPixelScale / 视距，这里用场景给的 pixelScale 反推世界宽下限。
    const tile = this.tileScale();
    let width = fx.width * tile * (1 - t * 0.35);
    if (this.cameraHeight > TRACER_PIXEL_FLOOR_ALTITUDE && this.pixelScale > 0) {
      const distance = this.camera ? this.camera.position.distanceTo(fx.mesh.position) : this.cameraHeight;
      const minWorld = (TRACER_MIN_PIXELS * distance) / this.pixelScale;
      width = Math.max(width, minWorld);
    }
    fx.mesh.scale.set(width, length, 1);
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
  }

  private readonly tracerCamera = new THREE.Vector3();
  private readonly tracerSide = new THREE.Vector3();
  private readonly tracerNormal = new THREE.Vector3();
  private readonly tracerBasis = new THREE.Matrix4();
  /** 相机高度与粒子像素换算系数（由 `update` 传入，曳光的像素下限用）。 */
  private cameraHeight = 0;
  private pixelScale = 0;
  setPixelScale(scale: number): void { this.pixelScale = Math.max(0, scale); }

  private releaseTracer(fx: TracerFx): void {
    fx.mesh.removeFromParent();
    this.freeTracers.push(fx);
  }

  private spawnDecal(spec: VfxDecal): void {
    if (this.maxDecals <= 0) return;
    if (this.decals.length >= this.maxDecals) this.releaseDecal(this.decals.shift()!);
    const fx = this.freeDecals.pop() ?? {
      mesh: new THREE.Mesh(this.decalGeometry, this.decalMaterial.clone()),
      size: 1, elapsed: 0, duration: spec.life, opacity: 0.62,
    };
    const normal = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    fx.mesh.position.set(spec.at.x, spec.at.y, spec.at.z);
    fx.mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
    fx.mesh.renderOrder = 9;
    fx.size = spec.size * this.tileScale();
    fx.elapsed = 0;
    fx.duration = spec.life;
    fx.opacity = this.decalMaterial.opacity;
    fx.mesh.scale.setScalar(fx.size);
    this.group.add(fx.mesh);
    this.decals.push(fx);
  }

  private releaseDecal(fx: DecalFx): void {
    fx.mesh.removeFromParent();
    this.freeDecals.push(fx);
  }

  /**
   * 冲击波：`spec.size` 是**最终半径（格）**，环几何是半径 1 的细环，缩放即半径。
   * 0.35s 内从 .15 扩到 1、亮度淡到 0；不写深度、不挡地面。
   */
  private spawnShockwave(spec: VfxShockwave): void {
    if (this.shockwaves.length >= COMBAT_VFX_LIMITS.shockwaves) {
      const oldest = this.shockwaves.shift()!;
      oldest.mesh.removeFromParent();
      this.freeShockwaves.push(oldest);
    }
    const fx = this.freeShockwaves.pop() ?? {
      mesh: new THREE.Mesh(this.shockGeometry, this.shockMaterial.clone()),
      size: 1, elapsed: 0, duration: spec.life,
    };
    const normal = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    fx.mesh.position.set(spec.at.x, spec.at.y, spec.at.z);
    fx.mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
    fx.mesh.renderOrder = 12;
    fx.size = spec.size * this.tileScale();
    fx.elapsed = 0;
    fx.duration = spec.life;
    fx.mesh.scale.setScalar(fx.size * 0.15);
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0;
    this.group.add(fx.mesh);
    this.shockwaves.push(fx);
  }

  /**
   * 碎片：暗色小块沿抛物线飞出、落地后停住并淡出（池化，上限 `debris`）。
   * 只做刚体位移 + 自转，不参与光照计算以外的东西。
   */
  private spawnDebris(spec: VfxDebris): void {
    const normal = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    const tangentA = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
    if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0);
    tangentA.normalize();
    const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
    const tile = this.tileScale();
    for (let i = 0; i < spec.count; i++) {
      if (this.debris.length >= COMBAT_VFX_LIMITS.debris) {
        const oldest = this.debris.shift()!;
        oldest.mesh.removeFromParent();
        this.freeDebris.push(oldest);
      }
      const seed = spec.seed + i * 613;
      const angle = rand(seed, 1) * Math.PI * 2;
      const speed = (0.8 + rand(seed, 2) * 2.4) * tile;
      const fx = this.freeDebris.pop() ?? {
        mesh: new THREE.Mesh(this.debrisGeometry, this.debrisMaterial),
        elapsed: 0, duration: spec.life, origin: new THREE.Vector3(), velocity: new THREE.Vector3(),
        normal: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1,
      };
      fx.mesh.material = this.debrisMaterial;
      fx.origin.set(spec.at.x, spec.at.y, spec.at.z).addScaledVector(normal, tile * 0.05);
      fx.normal.copy(normal);
      // 初速：切向 + 沿法线的上抛（沿法线 = 远离地面，落回时由重力拉回）。
      fx.velocity.copy(tangentA).multiplyScalar(Math.cos(angle) * speed)
        .addScaledVector(tangentB, Math.sin(angle) * speed)
        .addScaledVector(normal, (0.7 + rand(seed, 3) * 1.2) * tile);
      fx.spin.set(randSigned(seed, 4) * 9, randSigned(seed, 5) * 9, randSigned(seed, 6) * 9);
      fx.size = spec.size * tile * (0.7 + rand(seed, 7) * 0.7);
      fx.mesh.scale.setScalar(fx.size);
      fx.mesh.position.copy(fx.origin);
      fx.mesh.renderOrder = 10;
      fx.elapsed = 0;
      fx.duration = spec.life;
      this.group.add(fx.mesh);
      this.debris.push(fx);
    }
  }

  /** 点光源池：超限时顶掉最旧的；low 档 maxLights=0 直接跳过（不进池）。 */
  private flashLight(spec: VfxLight): void {
    if (this.maxLights <= 0) return;
    let fx = this.lights.find((entry) => !entry.active);
    if (!fx) {
      if (this.lights.length >= this.maxLights) {
        fx = this.lights.shift()!;
      } else {
        const light = new THREE.PointLight(0xffffff, 0, 4, 2);
        this.group.add(light);
        fx = { light, base: 0, active: false, elapsed: 0, duration: 1 };
        this.lights.push(fx);
      }
    }
    fx.light.color.setHex(spec.color);
    fx.light.position.set(spec.at.x, spec.at.y, spec.at.z);
    fx.light.distance = spec.distance;
    fx.base = spec.intensity;
    fx.light.intensity = spec.intensity;
    fx.active = true;
    fx.elapsed = 0;
    fx.duration = spec.life;
    if (!this.lights.includes(fx)) this.lights.push(fx);
  }

  /**
   * 逐帧推进。`dt` 秒；`frozen` 时不推进（画面定格在固定相位）。
   * `time` 秒：交给粒子系统的统一时钟（冻结时由调用方给固定值）。
   */
  /** 夹具定格：只拨粒子时钟（曳光/焦痕按 dt 推进，夹具里 dt=0 即停在首帧）。 */
  setTime(seconds: number): void {
    this.particles.setTime(seconds);
  }

  update(dt: number, time: number, cameraHeight: number): void {
    this.particles.setTime(time);
    this.particles.setCamera(cameraHeight);
    this.cameraHeight = cameraHeight;
    const step = Math.max(0, dt);
    // 延迟发射的批次（爆炸烟接在火球之后）。
    if (this.delayed.length) {
      for (let i = this.delayed.length - 1; i >= 0; i--) {
        this.delayed[i].remaining -= step;
        if (this.delayed[i].remaining > 0) continue;
        this.emitBurst(this.delayed[i].burst);
        this.delayed.splice(i, 1);
      }
    }
    this.advance(this.tracers, step, (fx) => this.releaseTracer(fx), (fx, t) => this.poseTracer(fx, t));
    // 相机变化后重定向曳光（billboard）；只在有曳光时做，平时零开销。
    if (this.camera && this.tracers.length) for (const fx of this.tracers) this.poseTracer(fx, Math.min(fx.elapsed / fx.duration, 1));
    this.advance(this.decals, step, (fx) => this.releaseDecal(fx), (fx, t) => {
      fx.mesh.scale.setScalar(fx.size * (1 + t * 0.12));
      const material = fx.mesh.material as THREE.MeshBasicMaterial;
      // 焦痕 8s 淡出：前 70% 基本保留，最后 30% 收干净。
      material.opacity = fx.opacity * (1 - clamp01((t - 0.7) / 0.3)) ** 1.2;
    });
    this.advance(this.shockwaves, step, (fx) => { fx.mesh.removeFromParent(); this.freeShockwaves.push(fx); }, (fx, t) => {
      // 半径从 .15 扩到 1（spec.size 已是最终半径），亮度同步淡到 0。
      fx.mesh.scale.setScalar(fx.size * (0.15 + t * 0.85));
      // 亮度：前 35% 保持满亮（读得出「冲击」），之后淡到 0；additive 下 opacity 直接就是加色量。
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0 * (1 - t) ** 1.5;
    });
    this.advanceDebris(step);
    this.advance(this.shields, step, (fx) => { fx.mesh.removeFromParent(); this.freeShields.push(fx); }, (fx, t) => {
      // 气泡扩张 + 淡出：菲涅尔强度由 shader 按视线夹角给，这里只调整体透明度与半径。
      const material = fx.mesh.material as THREE.ShaderMaterial;
      material.uniforms.uOpacity.value = (1 - t) ** 1.4;
      fx.mesh.scale.setScalar(fx.size * (0.9 + t * 0.35));
    });
    this.advanceWrecks(step);
    for (const fx of this.lights) {
      if (!fx.active) continue;
      fx.elapsed += step;
      const t = clamp01(fx.elapsed / fx.duration);
      fx.light.intensity = fx.base * (1 - t) ** 2;
      if (t >= 1) { fx.active = false; fx.light.intensity = 0; }
    }
  }

  /** 碎片：解析抛物线（沿法线的上抛 + 表面重力），落地后贴地停住并淡出。 */
  private advanceDebris(dt: number): void {
    if (!this.debris.length) return;
    const tile = this.tileScale();
    const gravity = 9.5 * tile;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const fx = this.debris[i];
      fx.elapsed += dt;
      const t = fx.elapsed;
      const normalSpeed = fx.velocity.dot(fx.normal);
      // 切向速度：从初速里去掉法线分量（`tangent` 是速度向量，长度即切向速度）。
      this.debrisTangent.copy(fx.velocity).addScaledVector(fx.normal, -normalSpeed);
      const tangentialSpeed = this.debrisTangent.length();
      const landAt = normalSpeed > 0 ? (2 * normalSpeed) / gravity : 0;
      const flown = Math.min(t, landAt);
      const lift = Math.max(0, normalSpeed * flown - 0.5 * gravity * flown * flown);
      this.debrisPosition.copy(fx.origin)
        .addScaledVector(this.debrisTangent, tangentialSpeed > 1e-6 ? flown : 0)
        .addScaledVector(fx.normal, lift);
      fx.mesh.position.copy(this.debrisPosition);
      fx.mesh.rotation.set(fx.spin.x * flown, fx.spin.y * flown, fx.spin.z * flown);
      // 落地后 40% 寿命内缩掉（不留一地带子）。
      const fade = clamp01((fx.elapsed - fx.duration * 0.6) / (fx.duration * 0.4));
      fx.mesh.scale.setScalar(fx.size * (1 - fade * 0.7));
      if (fx.elapsed >= fx.duration) {
        fx.mesh.removeFromParent();
        this.debris.splice(i, 1);
        this.freeDebris.push(fx);
      }
    }
  }

  /** 残骸冒烟：按 `WRECK_SMOKE_INTERVAL` 从 `wreckSmoke` 取一批烟，寿命到了就停。 */
  private advanceWrecks(dt: number): void {
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const wreck = this.wrecks[i];
      wreck.elapsed += dt;
      if (wreck.elapsed >= wreck.duration) { this.wrecks.splice(i, 1); continue; }
      if (wreck.elapsed < wreck.next) continue;
      wreck.next = wreck.elapsed + WRECK_SMOKE_INTERVAL;
      const burst = wreckSmoke(wreck.at, wreck.normal, wreck.seed, wreck.elapsed);
      if (burst) this.emitBurst(burst);
    }
  }

  private readonly debrisTangent = new THREE.Vector3();
  private readonly debrisPosition = new THREE.Vector3();

  private advance<T extends Timed>(list: T[], dt: number, release: (fx: T) => void, step: (fx: T, t: number) => void): T[] {
    return list.filter((fx) => {
      fx.elapsed += dt;
      const t = Math.min(fx.elapsed / fx.duration, 1);
      if (t >= 1) { release(fx); return false; }
      step(fx, t);
      return true;
    });
  }

  /** 存活计数（测试/诊断）。 */
  counts() {
    return {
      tracers: this.tracers.length,
      decals: this.decals.length,
      shockwaves: this.shockwaves.length,
      lights: this.lights.filter((fx) => fx.active).length,
      debris: this.debris.length,
      shields: this.shields.length,
      wrecks: this.wrecks.length,
      delayed: this.delayed.length,
      particles: this.particles.counts(),
    };
  }

  get particleSystem(): ParticleSystem { return this.particles; }

  dispose(): void {
    for (const fx of this.tracers) fx.mesh.removeFromParent();
    // 焦痕材质是逐实例克隆（透明度独立淡出），必须逐个释放——**包括池里空闲的**（审查 L7）。
    for (const fx of [...this.decals, ...this.freeDecals]) { fx.mesh.removeFromParent(); (fx.mesh.material as THREE.Material).dispose(); }
    for (const fx of [...this.shockwaves, ...this.freeShockwaves]) { fx.mesh.removeFromParent(); (fx.mesh.material as THREE.Material).dispose(); }
    for (const fx of [...this.shields, ...this.freeShields]) fx.mesh.removeFromParent();
    this.wrecks.length = 0;
    this.shields.length = 0; this.freeShields.length = 0;
    for (const fx of this.lights) fx.light.removeFromParent();
    for (const fx of this.debris) fx.mesh.removeFromParent();
    this.tracers.length = 0; this.decals.length = 0; this.shockwaves.length = 0; this.lights.length = 0;
    this.debris.length = 0; this.freeDebris.length = 0; this.delayed.length = 0;
    this.debrisGeometry.dispose();
    this.debrisMaterial.dispose();
    this.tracerGeometry.dispose();
    this.decalGeometry.dispose();
    this.shockGeometry.dispose();
    this.shieldGeometry.dispose();
    this.shieldMaterial.dispose();
    this.decalTexture.dispose();
    this.decalMaterial.dispose();
    this.shockMaterial.dispose();
    this.tracerMaterials.forEach((material) => material.dispose());
    this.tracerMaterials.clear();
    this.group.removeFromParent();
  }
}

/** 护盾气泡材质：菲涅尔边缘光（视空间法线 · 视线），正面近乎透明。 */
function makeShieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color('#7fe9ff') }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
        // 边缘一圈亮环 + 极淡的整体填充：读起来是「能量罩」，不是一颗实心球。
        float alpha = (rim * 0.85 + 0.05) * uOpacity;
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(uColor * (0.7 + rim * 0.8), alpha);
      }
    `,
  });
}

/** 焦痕贴图：中心深、边缘碎（程序生成，无第三方素材）。 */
function makeDecalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context && typeof context.createRadialGradient === 'function') {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    // 边缘碎裂：确定性位置的小缺口（不做随机）。
    context.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 18; i++) {
      const angle = (i * 2.399963) % (Math.PI * 2);
      const radius = 22 + ((i * 7) % 9);
      context.beginPath();
      context.arc(32 + Math.cos(angle) * radius, 32 + Math.sin(angle) * radius, 3 + (i % 3), 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
