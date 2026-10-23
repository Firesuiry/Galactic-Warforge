import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { tileFrame } from './projection';
import {
  CONSTRUCTION_BAR_FG,
  ConstructionProgressOverlay,
  DetectionOverlay,
  RangeCircleOverlay,
  CONSTRUCTION_BAR_HEIGHT_TILES,
  CONSTRUCTION_BAR_WIDTH_TILES,
  DETECTION_PULSE_SECONDS,
  RANGE_CIRCLE_OPACITY,
  RANGE_CIRCLE_WIDTH_TILES,
  circleQuaternion,
  constructionBarProgress,
  detectionPhase,
  footprintCenterTile,
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

  it('footprintCenterTile：1×1 落回本格，3×3 取占地中心（跨面也不跑偏）', () => {
    expect(footprintCenterTile({ x: 5, y: 7 }, { width: 1, height: 1 }, FACE_SIZE)).toEqual({ x: 5, y: 7 });
    // 3×3 从 (5,7) 起：中心就是 (6,8)。
    expect(footprintCenterTile({ x: 5, y: 7 }, { width: 3, height: 3 }, FACE_SIZE)).toEqual({ x: 6, y: 8 });
    // 面边界：从最后一行/列起算，中心仍在面上（法线平均落回合法 tile）。
    const center = footprintCenterTile({ x: 14, y: 15 }, { width: 3, height: 3 }, FACE_SIZE);
    // 展开图坐标：跨面时落在相邻面（x ∈ [0, 3×faceSize)）。
    expect(center.x).toBeGreaterThanOrEqual(0);
    expect(center.x).toBeLessThan(3 * FACE_SIZE);
    expect(center.y).toBeGreaterThanOrEqual(0);
    expect(center.y).toBeLessThan(2 * FACE_SIZE);
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

  it('DetectionOverlay：按格去重建环、空列表清空、dispose 后组里不留对象', () => {
    const overlay = new DetectionOverlay(RADIUS);
    overlay.sync([{ x: 5, y: 9 }, { x: 5, y: 9 }, { x: 6, y: 9 }], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(2);
    overlay.sync([{ x: 6, y: 9 }], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(1);
    overlay.sync([], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(0);
    overlay.dispose();
    expect(overlay.group.children).toHaveLength(0);
  });

  it('RangeCircleOverlay：ghost 移动只改朝向（同 key 不重建 mesh），换半径重建、空列表清空', () => {
    const overlay = new RangeCircleOverlay(RADIUS);
    overlay.sync([{ key: 'ghost:combat', center: { x: 5, y: 5 }, spec: { kind: 'combat', radiusTiles: 5 } }], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(1);
    const holder = overlay.group.children[0];
    const before = holder.quaternion.clone();
    overlay.sync([{ key: 'ghost:combat', center: { x: 7, y: 6 }, spec: { kind: 'combat', radiusTiles: 5 } }], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(1);
    expect(overlay.group.children[0]).toBe(holder);
    expect(holder.quaternion.equals(before)).toBe(false);
    // 半径变化：同一个 key 也要换几何。
    overlay.sync([{ key: 'ghost:combat', center: { x: 7, y: 6 }, spec: { kind: 'combat', radiusTiles: 8 } }], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(1);
    expect(overlay.group.children[0]).not.toBe(holder);
    // 攻击 + 供电两圈共存。
    overlay.sync([
      { key: 'ghost:combat', center: { x: 7, y: 6 }, spec: { kind: 'combat', radiusTiles: 5 } },
      { key: 'ghost:power', center: { x: 7, y: 6 }, spec: { kind: 'power', radiusTiles: 12 } },
    ], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(2);
    overlay.sync([], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(0);
    overlay.dispose();
  });

  it('ConstructionProgressOverlay：进度可算才出条，完成后移除', () => {
    const overlay = new ConstructionProgressOverlay(RADIUS);
    overlay.sync([
      { id: 'c-1', tile: { x: 3, y: 4 }, progress: .25 },
      { id: 'c-2', tile: { x: 5, y: 6 }, progress: null },
    ], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(1);
    overlay.sync([{ id: 'c-1', tile: { x: 3, y: 4 }, progress: 1 }], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(1);
    overlay.sync([], FACE_SIZE);
    expect(overlay.group.children).toHaveLength(0);
    overlay.dispose();
  });

  it('样式常量对齐契约：线宽 ≤ .06 格、线不透明度 .55（R20-B）、进度色 #7df7b0、脉冲 1.6s、进度条 .8×.08 格', () => {
    // 3A 画质起射程圈与补给光环共用细虚线画法：线宽 ≤ .06 格（硬约束），填充改为径向渐变
    // （中心 0 → 边缘 .05）；不透明度保持 R20-B 定下的 .55，不随画法改动（审查 L5）。
    expect(RANGE_CIRCLE_WIDTH_TILES).toBeLessThanOrEqual(.06);
    expect(RANGE_CIRCLE_OPACITY).toBe(.55);
    expect(CONSTRUCTION_BAR_FG).toBe('#7df7b0');
    expect(DETECTION_PULSE_SECONDS).toBe(1.6);
    expect(CONSTRUCTION_BAR_WIDTH_TILES).toBe(.8);
    expect(CONSTRUCTION_BAR_HEIGHT_TILES).toBe(.08);
  });
});
