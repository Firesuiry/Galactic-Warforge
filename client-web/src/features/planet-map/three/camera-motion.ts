import * as THREE from 'three';

/**
 * 镜头手感（第 23 轮 3A §9）：**只服务用户输入路径**的阻尼与补间。
 *
 * 测试钩子（`focus/setTilt/zoom/setAltitude/orbit/rotateView`）与夹具/深链仍走立即生效的
 * 场景方法——截图与 e2e 依赖「调用后状态立刻是目标值」。这里的补间只由 UI 路径调用
 * （拖拽松手惯性、滚轮、缩放/回家/全球按钮），`?freeze=1` 与 reduced-motion 下由调用方
 * 直接落到目标值，不经过本模块。
 *
 * 本模块只做「数值/四元数随时间的插值」，不碰相机与场景：每帧场景取一次
 * `sample(now, dt, out)`，把 out 里出现的字段写回 altitude / tilt / world.quaternion。
 */

/** 缓动曲线（时长见 3A §9：拖拽 300ms、滚轮 180ms、视角切换 600ms）。 */
export const EASING = {
  /** 滚轮缩放：快出慢收。 */
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  /** 全球 ↔ 地面：两头慢、中间快。 */
  inOutCubic: (t: number) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

export const MOTION = {
  dragInertia: 300,
  wheel: 180,
  view: 600,
  /** 惯性的指数衰减时间常数（秒）：300ms 后残余 < 5%。 */
  inertiaTau: 0.1,
};

/** 本帧要写回的镜头字段（只含本帧被运动驱动的字段）。 */
export interface MotionOutput {
  altitude?: number;
  tilt?: number;
  groundView?: boolean;
  quaternion?: THREE.Quaternion;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: (t: number) => number;
}

export class CameraMotion {
  private altitude: Tween | null = null;
  private tilt: Tween | null = null;
  private rotation: { from: THREE.Quaternion; to: THREE.Quaternion; start: number; duration: number } | null = null;
  private inertia: { vx: number; vy: number; start: number } | null = null;
  /** 视角切换期间固定的 groundView（不按高度阈值逐帧重算，避免中途跳变）。 */
  private groundView: boolean | null = null;
  private readonly scratch = new THREE.Quaternion();
  private readonly scratchEuler = new THREE.Euler();

  /** 是否有未完成的运动。 */
  get active(): boolean {
    return Boolean(this.altitude || this.tilt || this.rotation || this.inertia);
  }

  /** 绝对高度的补间（滚轮 / 缩放按钮）。 */
  tweenAltitude(from: number, to: number, now: number, duration = MOTION.wheel, ease = EASING.outCubic): void {
    if (Math.abs(to - from) < 1e-6) {
      this.altitude = null;
      return;
    }
    this.altitude = { from, to, start: now, duration, ease };
  }

  /** 俯仰补间（缩放跨过地面/全球阈值时，视线抬起/放下与高度一起走）。 */
  tweenTilt(from: number, to: number, now: number, duration = MOTION.wheel, ease = EASING.outCubic): void {
    if (Math.abs(to - from) < 1e-6) {
      this.tilt = null;
      return;
    }
    this.tilt = { from, to, start: now, duration, ease };
  }

  /** 视角切换（全球 ↔ 地面）：高度 + 俯仰 + 朝向一起 600ms ease-in-out。 */
  tweenView(
    from: { altitude: number; tilt: number; groundView: boolean; quaternion: THREE.Quaternion },
    to: { altitude: number; tilt: number; groundView: boolean; quaternion: THREE.Quaternion },
    now: number,
  ): void {
    this.altitude = { from: from.altitude, to: to.altitude, start: now, duration: MOTION.view, ease: EASING.inOutCubic };
    this.tilt = { from: from.tilt, to: to.tilt, start: now, duration: MOTION.view, ease: EASING.inOutCubic };
    this.rotation = { from: from.quaternion.clone(), to: to.quaternion.clone(), start: now, duration: MOTION.view };
    this.groundView = to.groundView;
    this.inertia = null;
  }

  /** 拖拽松手：按松手时的角速度继续转，约 300ms 内指数衰减到静止。 */
  startInertia(vx: number, vy: number, now: number): void {
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || Math.hypot(vx, vy) < 1e-3) return;
    this.inertia = { vx, vy, start: now };
    this.altitude = null;
    this.tilt = null;
    this.rotation = null;
    this.groundView = null;
  }

  /** 用户开始新的操作：取消进行中的补间与惯性。 */
  cancel(): void {
    this.altitude = null;
    this.tilt = null;
    this.rotation = null;
    this.inertia = null;
    this.groundView = null;
  }

  /**
   * 取本帧的镜头状态，写进 `out`（只写本帧被驱动的字段），返回是否有变化。
   * 全部补间结束后自动清空，`active` 变 false。
   */
  sample(now: number, dt: number, out: MotionOutput): boolean {
    let changed = false;
    const progress = (tween: Tween) => {
      const raw = tween.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - tween.start) / tween.duration));
      return { value: tween.from + (tween.to - tween.from) * tween.ease(raw), done: raw >= 1 };
    };
    if (this.altitude) {
      const { value, done } = progress(this.altitude);
      out.altitude = value;
      changed = true;
      if (done) this.altitude = null;
    }
    if (this.tilt) {
      const { value, done } = progress(this.tilt);
      out.tilt = value;
      changed = true;
      if (done) this.tilt = null;
    }
    if (this.rotation) {
      const raw = Math.min(1, Math.max(0, (now - this.rotation.start) / this.rotation.duration));
      out.quaternion = (out.quaternion ?? this.scratch.identity()).copy(this.rotation.from).slerp(this.rotation.to, EASING.inOutCubic(raw));
      changed = true;
      if (raw >= 1) this.rotation = null;
    }
    if (this.groundView !== null) {
      out.groundView = this.groundView;
      changed = true;
      if (!this.altitude && !this.tilt && !this.rotation) this.groundView = null;
    }
    if (this.inertia) {
      const elapsed = (now - this.inertia.start) / 1000;
      const span = MOTION.dragInertia / 1000;
      if (elapsed >= span) {
        this.inertia = null;
      } else {
        // 指数衰减的解析积分：本帧转过的角度 = v·τ·(e^{-t/τ} − e^{-(t+dt)/τ})。
        const decay = (t: number) => Math.exp(-Math.min(t, span) / MOTION.inertiaTau);
        const scale = MOTION.inertiaTau * (decay(elapsed) - decay(elapsed + dt));
        this.scratchEuler.set(this.inertia.vy * scale, this.inertia.vx * scale, 0);
        out.quaternion = (out.quaternion ?? this.scratch.identity()).premultiply(this.scratch.setFromEuler(this.scratchEuler));
        changed = true;
      }
    }
    return changed;
  }
}
