/**
 * 镜头震动（3A 画质 vfx 分支）。
 *
 * 契约（plan.md 步骤 5）：
 * - 接口 `add(strength 0..1, durationMs)` + `apply(camera) → restore()`；
 * - 在 `animate` 里 `composer.render()` 前后各一行接入；
 * - 爆炸按距画面中心的距离与规模触发；
 * - freeze / reduced-motion 下无效（`add` 直接返回，`apply` 是空操作）。
 *
 * 相机本体归光照分支：这里只在渲染前平移/微转相机，渲染后立刻还原，
 * 不写相机状态（`camera.position/quaternion` 由场景维护，下一帧照常计算）。
 */

import * as THREE from 'three';

/** 同时生效的震动源上限（爆炸密集时只保留最强的几条）。 */
export const SHAKE_SOURCES = 6;

interface ShakeSource {
  strength: number;
  duration: number;
  elapsed: number;
  /** 相位种子：确定性抖动（不随机），冻结下也不动。 */
  seed: number;
}

/** 最大位移（世界单位）：远景相机高度约 16 格时，0.06 世界单位约等于 0.06 格。 */
export const SHAKE_TRANSLATION = 0.09;
/** 最大旋转（弧度）。 */
export const SHAKE_ROTATION = 0.0035;

/**
 * 镜头震动。`enabled()` 由场景提供（freeze / reduced-motion 时为 false）。
 */
export class CameraShake {
  private readonly sources: ShakeSource[] = [];
  private seed = 1;
  private readonly offset = new THREE.Vector3();
  private readonly rotation = new THREE.Euler();
  private savedPosition = new THREE.Vector3();
  private savedQuaternion = new THREE.Quaternion();
  private saved = false;

  constructor(private readonly enabled: () => boolean = () => true) {}

  /** 叠加一次震动（strength 0..1，durationMs 毫秒）。不满足门控时直接忽略。 */
  add(strength: number, durationMs: number): void {
    if (!this.enabled()) return;
    if (!(strength > 0) || !(durationMs > 0)) return;
    const clamped = Math.min(1, strength);
    if (this.sources.length >= SHAKE_SOURCES) {
      // 顶掉最弱的（同等时最旧的）。
      let weakest = 0;
      for (let i = 1; i < this.sources.length; i++) if (this.sources[i].strength < this.sources[weakest].strength) weakest = i;
      if (this.sources[weakest].strength >= clamped) return;
      this.sources.splice(weakest, 1);
    }
    this.sources.push({ strength: clamped, duration: durationMs / 1000, elapsed: 0, seed: this.seed++ * 1.618 });
  }

  /** 推进一帧（秒）。 */
  update(dt: number): void {
    if (this.sources.length === 0) return;
    const step = Math.max(0, dt);
    for (let i = this.sources.length - 1; i >= 0; i--) {
      this.sources[i].elapsed += step;
      if (this.sources[i].elapsed >= this.sources[i].duration) this.sources.splice(i, 1);
    }
  }

  /** 当前合成强度（0..1，测试用）。 */
  get intensity(): number {
    let total = 0;
    for (const source of this.sources) {
      const t = Math.min(source.elapsed / source.duration, 1);
      total += source.strength * (1 - t) * (1 - t);
    }
    return Math.min(1, total);
  }

  /**
   * 渲染前把震动叠到相机上；返回 `restore`，渲染后调用即可还原。
   * 没有震动源时两者都是空操作（不写相机）。
   */
  apply(camera: THREE.Camera): () => void {
    if (this.sources.length === 0 || !this.enabled()) return () => {};
    this.savedPosition.copy(camera.position);
    this.savedQuaternion.copy(camera.quaternion);
    this.saved = true;
    const strength = this.intensity;
    // 确定性抖动：由各源的 seed 与进度合成，不用随机数（冻结下也不会漂）。
    let x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0;
    for (const source of this.sources) {
      const t = Math.min(source.elapsed / source.duration, 1);
      const envelope = (1 - t) * (1 - t) * source.strength;
      const phase = source.elapsed * 46 + source.seed;
      x += Math.sin(phase * 1.7) * envelope;
      y += Math.cos(phase * 2.3) * envelope;
      z += Math.sin(phase * 0.9 + 1.3) * envelope;
      rx += Math.sin(phase * 1.1 + 0.4) * envelope;
      ry += Math.cos(phase * 1.5 + 2.1) * envelope;
      rz += Math.sin(phase * 2.7 + 3.3) * envelope;
    }
    this.offset.set(x, y, z).multiplyScalar(SHAKE_TRANSLATION * strength);
    this.rotation.set(rx * SHAKE_ROTATION * strength, ry * SHAKE_ROTATION * strength, rz * SHAKE_ROTATION * strength);
    camera.position.add(this.offset);
    camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(this.rotation));
    camera.updateMatrixWorld();
    return () => this.restore(camera);
  }

  /** 还原相机（`apply` 的返回值也调它；重复调用安全）。 */
  restore(camera?: THREE.Camera): void {
    if (!this.saved || !camera) return;
    camera.position.copy(this.savedPosition);
    camera.quaternion.copy(this.savedQuaternion);
    camera.updateMatrixWorld();
    this.saved = false;
  }

  /** 清空（场景 destroy / 切档）。 */
  clear(): void {
    this.sources.length = 0;
    this.saved = false;
  }
}

/**
 * 爆炸 → 震动强度：规模越大、离画面中心越近越强（屏幕外/背后的爆炸不震）。
 * `distance` 与 `radius` 为世界单位；`falloff` 内满强度、之外线性衰减到 0。
 */
export function shakeFromExplosion(scale: number, distance: number, radius = 18): number {
  if (!(scale > 0) || !(radius > 0)) return 0;
  if (distance >= radius) return 0;
  const proximity = 1 - distance / radius;
  return Math.min(1, Math.max(0, 0.25 + scale * 0.35) * proximity * proximity);
}
