import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { directionVector, type CardinalDirection } from '../logistics-direction';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';
import {
  GHOST_ARROW_SHAPE,
  SORTER_GHOST_ARROW_SHAPE,
  ghostArrowGeometry,
  ghostArrowTransform,
  sorterGhostArrowGeometry,
} from './ghost-arrow';

const DIRECTIONS: CardinalDirection[] = ['north', 'east', 'south', 'west'];
const FACE_SIZE = 16;
const RADIUS = 100;
const TILES = [{ x: 4, y: 4 }, { x: 0, y: 0 }, { x: 15, y: 7 }, { x: 31, y: 20 }];

/** 几何的横向范围（局部 X = 箭头指向，局部 Z = 横向，局部 Y = 格法线）。 */
function spans(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return { along: box.max.x - box.min.x, across: box.max.z - box.min.z, height: box.max.y - box.min.y, minX: box.min.x, maxX: box.max.x };
}

describe('建造 ghost 贴地细箭头几何（DSP 口径：细杆 + 三角箭头）', () => {
  it('几何平铺在局部 XZ 平面：法线朝 +Y、没有任何顶点离开地面', () => {
    for (const geometry of [ghostArrowGeometry(1), sorterGhostArrowGeometry(1)]) {
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      expect(position.count).toBeGreaterThanOrEqual(9);
      for (let i = 0; i < position.count; i += 1) {
        expect(position.getY(i)).toBeCloseTo(0, 9);
        expect(normal.getY(i)).toBeCloseTo(1, 9);
      }
    }
  });

  it('细箭头：杆宽 ≤ .12 格（旧版 0.82 格粗 chevron 已删除）', () => {
    // 传送带箭头：0.82 * .5 = .41 格长，横向最宽处也远小于一格。
    const belt = spans(ghostArrowGeometry(1, .5));
    expect(belt.along).toBeCloseTo(GHOST_ARROW_SHAPE.length * .5, 6);
    expect(belt.across).toBeCloseTo(GHOST_ARROW_SHAPE.headHalfWidth * 2, 6);
    expect(GHOST_ARROW_SHAPE.shaftWidth).toBeLessThanOrEqual(.12);
    expect(belt.across).toBeLessThan(.3);

    // 分拣器箭头：贯穿一格，杆宽 ≤ .12 格。
    const sorter = spans(sorterGhostArrowGeometry(1));
    expect(sorter.along).toBeCloseTo(SORTER_GHOST_ARROW_SHAPE.tip - SORTER_GHOST_ARROW_SHAPE.tail, 6);
    expect(SORTER_GHOST_ARROW_SHAPE.shaftWidth).toBeLessThanOrEqual(.12);
    expect(sorter.across).toBeCloseTo(SORTER_GHOST_ARROW_SHAPE.headHalfWidth * 2, 6);
  });

  it('分拣器箭头从取货端（-0.5 格）贯穿到放货端（+0.5 格），尾在背后、尖在正面', () => {
    const size = 40;
    const sorter = spans(sorterGhostArrowGeometry(size));
    expect(sorter.minX).toBeCloseTo(-.5 * size, 6);
    expect(sorter.maxX).toBeCloseTo(.5 * size, 6);
    // 箭头头在 +X（指向放货端）：尖端一侧的顶点数少于尾端（三角收敛到一点）。
    const geometry = sorterGhostArrowGeometry(size);
    const position = geometry.getAttribute('position');
    let atTip = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getX(i) - size * .5) < 1e-6) atTip += 1;
    }
    expect(atTip).toBeGreaterThan(0);
  });

  it('四个朝向都平铺在格平面里、且局部 +X 转到该方向', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    for (const tile of TILES) {
      const normal = tileNormal(tile, FACE_SIZE);
      const { east, south } = tileFrame(tile, FACE_SIZE);
      for (const direction of DIRECTIONS) {
        const { quaternion } = ghostArrowTransform(tile, direction, FACE_SIZE, RADIUS, { size, lift: .1 });
        // 平铺：几何的局部 +Y（面法线）贴合格法线。
        const worldNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
        expect(worldNormal.dot(normal)).toBeCloseTo(1, 6);
        // 指向：局部 +X → 该方向的格内向量。
        const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
        const vector = directionVector(direction);
        const expected = east.clone().multiplyScalar(vector.x).addScaledVector(south, vector.y).normalize();
        expect(forward.dot(expected)).toBeCloseTo(1, 6);
      }
    }
  });

  it('lift 把箭头抬离地面（传送带 .1 / 分拣器 .08）', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    const tile = { x: 4, y: 4 };
    const normal = tileNormal(tile, FACE_SIZE);
    const belt = ghostArrowTransform(tile, 'north', FACE_SIZE, RADIUS, { size, lift: .1 }).position;
    expect(belt.distanceTo(normal.clone().multiplyScalar(RADIUS + size * .1))).toBeCloseTo(0, 6);
    const sorter = ghostArrowTransform(tile, 'north', FACE_SIZE, RADIUS, { size, lift: .08 }).position;
    expect(sorter.distanceTo(normal.clone().multiplyScalar(RADIUS + size * .08))).toBeCloseTo(0, 6);
  });

  it('传送带箭头缩小到 .5 倍：长度腰斩、杆宽不变（细线不能被缩到看不见），位置仍在格心', () => {
    const size = surfaceTileSize(RADIUS, FACE_SIZE);
    const full = spans(ghostArrowGeometry(size));
    const half = spans(ghostArrowGeometry(size, .5));
    expect(half.along / full.along).toBeCloseTo(.5, 6);
    // 宽度只随 `size` 缩放，不随 `scale`：.5 倍时箭头仍然有 .18 格的三角头。
    expect(half.across).toBeCloseTo(full.across, 6);
    // 位置/姿态不含 scale：缩放的只是几何。
    const { position, quaternion } = ghostArrowTransform({ x: 4, y: 4 }, 'east', FACE_SIZE, RADIUS, { size });
    const mesh = new THREE.Mesh(ghostArrowGeometry(size, .5));
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    expect(mesh.position.distanceTo(position)).toBeCloseTo(0, 9);
    expect(Math.abs(mesh.quaternion.dot(quaternion))).toBeCloseTo(1, 9);
  });
});
