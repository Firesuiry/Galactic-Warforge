/**
 * 战斗视觉层：把 `combat-vfx-specs` 的指令落成 Three 对象。
 *
 * 组成：
 * - 粒子：交给共享的 `ParticleSystem`（火焰/烟/火花/闪光/碎屑）；
 * - 曳光：细长拉伸 billboard（面向相机的四边形），短命；
 * - 焦痕：贴地深色圆盘，随时间淡出；
 * - 冲击波：贴地扩散的细环；
 * - 点光源：池化（上限由档位决定，low 档 0 个），只做极短促的照明。
 *
 * 所有对象池化、几何共享；池满时顶掉最旧（不抛错、不增长内存）。
 */

import * as THREE from 'three';

import { clamp01 } from './common';
import { ParticleSystem, type ParticleStyle } from './particles';
import type { CombatVfxSpecs, VfxBurst, VfxDecal, VfxLight, VfxShockwave, VfxTracer } from './combat-vfx-specs';

export const COMBAT_VFX_LIMITS = {
  tracers: 48,
  decals: 32,
  shockwaves: 16,
  lights: 4,
} as const;

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
interface TracerFx extends Timed { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; width: number }
interface DecalFx extends Timed { mesh: THREE.Mesh; size: number }
interface ShockwaveFx extends Timed { mesh: THREE.Mesh; size: number }
interface LightFx extends Timed { light: THREE.PointLight; base: number; active: boolean }

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
  private readonly tracerGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly decalGeometry = new THREE.CircleGeometry(1, 28);
  private readonly shockGeometry = new THREE.RingGeometry(0.86, 1, 56);
  private readonly decalTexture: THREE.CanvasTexture;
  private readonly decalMaterial: THREE.MeshBasicMaterial;
  private readonly shockMaterial: THREE.MeshBasicMaterial;
  private readonly tracerMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly maxLights: number;

  constructor(parent: THREE.Object3D, particles: ParticleSystem, maxLights: number = COMBAT_VFX_LIMITS.lights) {
    this.particles = particles;
    this.maxLights = maxLights;
    this.group.name = 'combat-vfx';
    parent.add(this.group);
    this.decalTexture = makeDecalTexture();
    this.decalMaterial = new THREE.MeshBasicMaterial({
      map: this.decalTexture, color: 0x10100e, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.shockMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc78a, transparent: true, opacity: 0.9, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    });
  }

  /** 应用一条事件的全部视觉指令。 */
  spawn(specs: CombatVfxSpecs): void {
    for (const burst of specs.bursts) this.emitBurst(burst);
    for (const tracer of specs.tracers) this.spawnTracer(tracer);
    for (const decal of specs.decals) this.spawnDecal(decal);
    for (const wave of specs.shockwaves) this.spawnShockwave(wave);
    for (const light of specs.lights) this.flashLight(light);
  }

  /** 直接发射一批粒子（工业氛围等其它来源共用粒子系统）。 */
  emit(style: ParticleStyle, burst: Parameters<ParticleSystem['emit']>[1]): void {
    this.particles.emit(style, burst);
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
      from: new THREE.Vector3(), to: new THREE.Vector3(), width: 1, elapsed: 0, duration: spec.life,
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

  /** 曳光：放在两点中点，沿方向拉伸，法线朝向相机（billboard 绕轴旋转）。 */
  private poseTracer(fx: TracerFx, t: number): void {
    const direction = new THREE.Vector3().subVectors(fx.to, fx.from);
    const length = direction.length() || 0.0001;
    fx.mesh.position.copy(fx.from).addScaledVector(direction, 0.5);
    fx.mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
    // 面向相机：在拉伸平面内绕自身长轴旋转到最朝向相机（简单近似：保持世界对齐即可，
    // 细长条在近景/远景都可读，不做逐帧重定向以免增加每帧开销）。
    fx.mesh.rotateY(0);
    const width = fx.width * (1 - t * 0.35);
    fx.mesh.scale.set(width, length, 1);
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
    void Z_AXIS;
  }

  private releaseTracer(fx: TracerFx): void {
    fx.mesh.removeFromParent();
    this.freeTracers.push(fx);
  }

  private spawnDecal(spec: VfxDecal): void {
    if (this.decals.length >= COMBAT_VFX_LIMITS.decals) this.releaseDecal(this.decals.shift()!);
    const fx = this.freeDecals.pop() ?? {
      mesh: new THREE.Mesh(this.decalGeometry, this.decalMaterial),
      size: 1, elapsed: 0, duration: spec.life,
    };
    const normal = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    fx.mesh.position.set(spec.at.x, spec.at.y, spec.at.z);
    fx.mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
    fx.mesh.renderOrder = 9;
    fx.size = spec.size;
    fx.elapsed = 0;
    fx.duration = spec.life;
    fx.mesh.scale.setScalar(spec.size);
    this.group.add(fx.mesh);
    this.decals.push(fx);
  }

  private releaseDecal(fx: DecalFx): void {
    fx.mesh.removeFromParent();
    this.freeDecals.push(fx);
  }

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
    fx.size = spec.size;
    fx.elapsed = 0;
    fx.duration = spec.life;
    fx.mesh.scale.setScalar(spec.size * 0.25);
    this.group.add(fx.mesh);
    this.shockwaves.push(fx);
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
  update(dt: number, time: number, cameraHeight: number): void {
    this.particles.setTime(time);
    this.particles.setCamera(cameraHeight);
    const step = Math.max(0, dt);
    this.advance(this.tracers, step, (fx) => this.releaseTracer(fx), (fx, t) => this.poseTracer(fx, t));
    this.advance(this.decals, step, (fx) => this.releaseDecal(fx), (fx, t) => {
      fx.mesh.scale.setScalar(fx.size * (1 + t * 0.12));
      const material = fx.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.55 * (1 - t) ** 1.4;
    });
    this.advance(this.shockwaves, step, (fx) => { fx.mesh.removeFromParent(); this.freeShockwaves.push(fx); }, (fx, t) => {
      fx.mesh.scale.setScalar(fx.size * (0.25 + t * 1.15));
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t) ** 1.6;
    });
    for (const fx of this.lights) {
      if (!fx.active) continue;
      fx.elapsed += step;
      const t = clamp01(fx.elapsed / fx.duration);
      fx.light.intensity = fx.base * (1 - t) ** 2;
      if (t >= 1) { fx.active = false; fx.light.intensity = 0; }
    }
  }

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
      particles: this.particles.counts(),
    };
  }

  get particleSystem(): ParticleSystem { return this.particles; }

  dispose(): void {
    for (const fx of this.tracers) fx.mesh.removeFromParent();
    for (const fx of this.decals) fx.mesh.removeFromParent();
    for (const fx of this.shockwaves) { fx.mesh.removeFromParent(); (fx.mesh.material as THREE.Material).dispose(); }
    for (const fx of this.lights) fx.light.removeFromParent();
    this.tracers.length = 0; this.decals.length = 0; this.shockwaves.length = 0; this.lights.length = 0;
    this.tracerGeometry.dispose();
    this.decalGeometry.dispose();
    this.shockGeometry.dispose();
    this.decalTexture.dispose();
    this.decalMaterial.dispose();
    this.shockMaterial.dispose();
    this.tracerMaterials.forEach((material) => material.dispose());
    this.tracerMaterials.clear();
    this.group.removeFromParent();
  }
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
