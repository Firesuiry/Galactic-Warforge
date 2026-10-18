import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { tileFrame } from './projection';
import {
  CONSTRUCTION_BAR_FG,
  CONSTRUCTION_BAR_HEIGHT_TILES,
  CONSTRUCTION_BAR_WIDTH_TILES,
  DETECTION_PULSE_SECONDS,
  RANGE_CIRCLE_OPACITY,
  RANGE_CIRCLE_WIDTH_TILES,
  circleQuaternion,
  constructionBarProgress,
  detectionPhase,
  rangeCircleAngle,
} from './tactical-overlays';

const RADIUS = 100;
const FACE_SIZE = 16;

describe('3D 战术叠加层纯函数（R20-B）', () => {
  it('rangeCircleAngle：世界长度 = 半径格数 × 格宽，弧度 = 世界长度 / 球半径', () => {
    // 100 半径、16 格面：格宽 ≈ 6.938；5 格射程的弧长应正好 5 格。
    const angle = rangeCircleAngle(5, FACE_SIZE, RADIUS);
    expect(angle * RADIUS).toBeCloseTo(5 * (RADIUS * Math.PI / (2 * FACE_SIZE) / Math.SQRT2), 6);
    expect(rangeCircleAngle(1, FACE_SIZE, RADIUS) * RADIUS).toBeCloseTo(RADIUS * Math.PI / 32 / Math.SQRT2, 6);
  });

  it('rangeCircleAngle：零/负/缺参数一律 0（不画圈）', () => {
    expect(rangeCircleAngle(0, FACE_SIZE, RADIUS)).toBe(0);
    expect(rangeCircleAngle(-3, FACE_SIZE, RADIUS)).toBe(0);
    expect(rangeCircleAngle(5, 0, RADIUS)).toBe(0);
    expect(rangeCircleAngle(5, FACE_SIZE, 0)).toBe(0);
  });

  it('circleQuaternion：局部 +Z→格法线、+X→东、−Y→南（规范系 = 圆心 +Z/东 +X/南 −Y）', () => {
    for (const tile of [{ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 15, y: 7 }, { x: 31, y: 20 }]) {
      const q = circleQuaternion(tile, FACE_SIZE);
      const { normal, east, south } = tileFrame(tile, FACE_SIZE);
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).distanceTo(normal)).toBeCloseTo(0, 6);
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(q).distanceTo(east)).toBeCloseTo(0, 6);
      expect(new THREE.Vector3(0, -1, 0).applyQuaternion(q).distanceTo(south)).toBeCloseTo(0, 6);
      // 纯旋转：不缩放、不镜像。
      expect(q.length()).toBeCloseTo(1, 9);
    }
  });

  it('circleQuaternion：圆环上任一点到圆心的角距离 = rangeCircleAngle（半径不因朝向而变）', () => {
    const tile = { x: 7, y: 9 };
    const q = circleQuaternion(tile, FACE_SIZE);
    const angle = rangeCircleAngle(4, FACE_SIZE, RADIUS);
    const center = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (let i = 0; i < 8; i += 1) {
      const a = i * Math.PI / 4;
      const point = new THREE.Vector3(Math.sin(angle) * Math.cos(a), -Math.sin(angle) * Math.sin(a), Math.cos(angle)).applyQuaternion(q);
      expect(center.angleTo(point)).toBeCloseTo(angle, 6);
    }
  });

  it('constructionBarProgress：remaining/total 可算时返回比例，缺数据返回 null', () => {
    expect(constructionBarProgress({ state: 'completed' })).toBe(1);
    expect(constructionBarProgress({ state: 'in_progress', remaining_ticks: 30, total_ticks: 100 })).toBeCloseTo(.7, 6);
    expect(constructionBarProgress({ state: 'in_progress', remaining_ticks: 0, total_ticks: 100 })).toBe(1);
    expect(constructionBarProgress({ state: 'in_progress', remaining_ticks: 120, total_ticks: 100 })).toBe(0);
    expect(constructionBarProgress({ state: 'pending' })).toBeNull();
    expect(constructionBarProgress({ state: 'in_progress' })).toBeNull();
    expect(constructionBarProgress({ state: 'in_progress', remaining_ticks: 5, total_ticks: 0 })).toBeNull();
  });

  it('detectionPhase：确定性、落在 [0,1)、不同格可错相', () => {
    expect(detectionPhase({ x: 5, y: 9 })).toBe(detectionPhase({ x: 5, y: 9 }));
    for (const tile of [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 15, y: 7 }, { x: 31, y: 20 }]) {
      const phase = detectionPhase(tile);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
    expect(detectionPhase({ x: 5, y: 9 })).not.toBe(detectionPhase({ x: 9, y: 5 }));
  });

  it('样式常量对齐契约：线宽 .06 格、线不透明度 .55、进度色 #7df7b0、脉冲 1.6s、进度条 .8×.08 格', () => {
    expect(RANGE_CIRCLE_WIDTH_TILES).toBe(.06);
    expect(RANGE_CIRCLE_OPACITY).toBe(.55);
    expect(CONSTRUCTION_BAR_FG).toBe('#7df7b0');
    expect(DETECTION_PULSE_SECONDS).toBe(1.6);
    expect(CONSTRUCTION_BAR_WIDTH_TILES).toBe(.8);
    expect(CONSTRUCTION_BAR_HEIGHT_TILES).toBe(.08);
  });
});
