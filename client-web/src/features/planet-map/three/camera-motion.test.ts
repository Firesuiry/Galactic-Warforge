import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { CameraMotion, EASING, MOTION, type MotionOutput } from './camera-motion';

/** 用固定步长把补间跑完，返回每帧的采样（3A §9：测试钩子立即生效，只有 UI 路径走这里）。 */
function run(motion: CameraMotion, out: MotionOutput, from: number, to: number, stepMs: number) {
  const frames: MotionOutput[] = [];
  for (let now = from; now <= to; now += stepMs) {
    const frame: MotionOutput = {};
    motion.sample(now, stepMs / 1000, frame);
    frames.push({ ...frame });
  }
  void out;
  return frames;
}

describe('镜头手感（3A §9）', () => {
  it('滚轮缩放：180ms 内从起点缓动到终点，结束即停', () => {
    const motion = new CameraMotion();
    motion.tweenAltitude(10, 20, 0);
    const frames = run(motion, {}, 0, 260, 16);
    const values = frames.map(f => f.altitude).filter((v): v is number => v !== undefined);
    // 单调递增、首帧不到终点、180ms 后落位。
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(values[0]).toBeLessThan(20);
    expect(values.at(-1)).toBeCloseTo(20, 5);
    expect(motion.active).toBe(false);
  });

  it('缓动曲线单调且两端为 0/1', () => {
    for (const ease of [EASING.outCubic, EASING.inOutCubic]) {
      expect(ease(0)).toBeCloseTo(0, 6);
      expect(ease(1)).toBeCloseTo(1, 6);
      let previous = 0;
      for (let i = 1; i <= 10; i++) {
        const value = ease(i / 10);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('视角切换：600ms 内高度/俯仰/朝向一起插值，groundView 在补间期间固定', () => {
    const motion = new CameraMotion();
    const from = { altitude: 10, tilt: 0, groundView: false, quaternion: new THREE.Quaternion() };
    const to = { altitude: 300, tilt: 1.1, groundView: true, quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) };
    motion.tweenView(from, to, 0);
    const frames = run(motion, {}, 0, 700, 16);
    const mid = frames[10];
    expect(mid.altitude).toBeGreaterThan(10);
    expect(mid.altitude).toBeLessThan(300);
    expect(mid.groundView).toBe(true);
    const lastAltitude = frames.map(f => f.altitude).filter((v): v is number => v !== undefined).at(-1);
    const lastTilt = frames.map(f => f.tilt).filter((v): v is number => v !== undefined).at(-1);
    expect(lastAltitude).toBeCloseTo(300, 5);
    expect(lastTilt).toBeCloseTo(1.1, 5);
    expect(motion.active).toBe(false);
  });

  it('拖拽惯性：约 300ms 后停止，且总转角有界', () => {
    const motion = new CameraMotion();
    motion.startInertia(2, 1, 0);
    let total = 0;
    const identity = new THREE.Quaternion();
    for (let now = 0; now <= 400; now += 16) {
      const out: MotionOutput = {};
      motion.sample(now, 0.016, out);
      // 惯性是增量（审查 P0-1）：绝不能写绝对姿态 quaternion。
      expect(out.quaternion).toBeUndefined();
      if (out.quaternionDelta) total += identity.angleTo(out.quaternionDelta);
    }
    expect(total).toBeGreaterThan(0);
    // 角速度 2 rad/s、τ=0.1s：积分上界约 0.3 rad，留余量。
    expect(total).toBeLessThan(0.5);
    expect(motion.active).toBe(false);
  });

  it('惯性每帧转角等于解析值 v·τ·(e^{-t/τ}−e^{-(t+dt)/τ})（审查 P0-2：不得被自乘）', () => {
    const motion = new CameraMotion();
    const vx = 2;
    motion.startInertia(vx, 0, 0);
    const identity = new THREE.Quaternion();
    const decay = (t: number) => Math.exp(-t / MOTION.inertiaTau);
    for (let i = 0; i < 5; i++) {
      const now = i * 16;
      const out: MotionOutput = {};
      motion.sample(now, 0.016, out);
      const expected = vx * MOTION.inertiaTau * (decay(now / 1000) - decay((now + 16) / 1000));
      expect(identity.angleTo(out.quaternionDelta!)).toBeCloseTo(expected, 5);
    }
  });

  it('拖拽松手后第一帧只转动增量，不重置已有姿态（审查 P0-1）', () => {
    const motion = new CameraMotion();
    const world = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);
    const before = world.clone();
    motion.startInertia(2, 1, 0);
    const out: MotionOutput = {};
    motion.sample(0, 0.016, out);
    // 场景的写法：绝对姿态 copy，增量 premultiply（planet-three-scene.applyMotion）。
    if (out.quaternion) world.copy(out.quaternion);
    if (out.quaternionDelta) world.premultiply(out.quaternionDelta);
    // 与松手前连续：角差远小于 0.01 rad（期望 ≈ 0.026 rad）。
    expect(before.angleTo(world)).toBeLessThan(0.05);
    expect(before.angleTo(world)).toBeGreaterThan(0);
  });

  it('多帧惯性每帧转角等于解析增量，姿态单调累积（审查 P0-1/P0-2 的逐帧断言）', () => {
    const motion = new CameraMotion();
    const world = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 1.2, -0.3));
    motion.startInertia(1.5, 0.7, 0);
    const decay = (t: number) => Math.exp(-t / MOTION.inertiaTau);
    const expected: number[] = [];
    let previous = world.clone();
    for (let i = 0; i < 8; i++) {
      const now = i * 16;
      const out: MotionOutput = {};
      motion.sample(now, 0.016, out);
      expect(out.quaternion).toBeUndefined();
      world.premultiply(out.quaternionDelta!);
      // 每帧转角 == v·τ·(e^{-t/τ} − e^{-(t+dt)/τ})（两轴合成后的模长与四元数角一致）。
      const step = previous.angleTo(world);
      const expectedStep = Math.hypot(1.5, 0.7) * MOTION.inertiaTau * (decay(now / 1000) - decay((now + 16) / 1000));
      expect(step).toBeCloseTo(expectedStep, 4);
      expect(step).toBeLessThan(0.05);
      expected.push(step);
      previous = world.clone();
    }
    // 指数衰减：后一帧永远小于前一帧。
    for (let i = 1; i < expected.length; i++) expect(expected[i]).toBeLessThan(expected[i - 1]);
  });

  it('取消后不再驱动任何字段', () => {
    const motion = new CameraMotion();
    motion.tweenAltitude(10, 300, 0);
    motion.startInertia(3, 3, 0);
    motion.cancel();
    const out: MotionOutput = {};
    expect(motion.sample(100, 0.016, out)).toBe(false);
    expect(out).toEqual({});
    expect(motion.active).toBe(false);
    expect(MOTION.view).toBe(600);
  });
});
