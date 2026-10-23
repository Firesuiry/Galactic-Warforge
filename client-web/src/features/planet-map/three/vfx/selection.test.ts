import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { BRACKET_SNAP_SECONDS, BRACKET_SPAN, SelectionOverlay, bracketGeometry, type BracketFootprint } from './selection';
import { surfaceCoordinate, surfaceFace, surfaceOffset } from '@shared/surface';
import { footprintCenterTile } from '../tactical-overlays';

const FACE = 16;
const RADIUS = 100;

/** 括号几何所有顶点 → 展开图坐标（与 `tileQuad` 同一套球面映射）。 */
function vertices(geometry: THREE.BufferGeometry): { x: number; y: number }[] {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < attribute.count; i++) {
    const vector = new THREE.Vector3(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    points.push(surfaceCoordinate(vector, FACE));
  }
  return points;
}

function centroid(points: { x: number; y: number }[]) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

/** 占地中心（与场景/测试接口 `entityScreenPos` 同一口径）。 */
function centerOf(origin: { x: number; y: number }, footprint: BracketFootprint) {
  return footprintCenterTile(origin, footprint, FACE);
}

describe('选中四角括号（步骤 13：中心 = 占地中心）', () => {
  const cases: [number, number][] = [[1, 1], [3, 3], [5, 5], [3, 5]];

  for (const [width, height] of cases) {
    it(`${width}×${height}：括号质心落在占地中心格，跨度 ≈ 占地 × ${BRACKET_SPAN}`, () => {
      const origin = { x: 5, y: 5 };
      const footprint = { width, height };
      const center = centerOf(origin, footprint);
      const points = vertices(bracketGeometry(center, FACE, RADIUS, 0.02, 0, footprint));
      const middle = centroid(points);
      expect(middle.x).toBeCloseTo(center.x, 2);
      expect(middle.y).toBeCloseTo(center.y, 2);
      // 括号在四角，8 条臂两两对称：包围盒尺寸 = 占地 × BRACKET_SPAN（再加臂宽 ~.1 格）。
      const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(width * BRACKET_SPAN, 0);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(height * BRACKET_SPAN, 0);
    });
  }

  it('3×3 的括号不再偏到占地原点（旧实现按原点画 1×1 括号，中心偏 −1 格）', () => {
    const origin = { x: 5, y: 5 };
    const footprint = { width: 3, height: 3 };
    const center = centerOf(origin, footprint);
    const middle = centroid(vertices(bracketGeometry(center, FACE, RADIUS, 0.02, 0, footprint)));
    // 占地中心比原点大 1 格（3×3），括号质心必须跟着过去。
    expect(middle.x - origin.x).toBeCloseTo(1, 2);
    expect(middle.y - origin.y).toBeCloseTo(1, 2);
  });

  it('跨面建筑：占地越过面边界时中心与括号仍一致', () => {
    // 面 0 的右边界是 x = 15；从 (14,5) 起 3×3 会跨到相邻面。
    const origin = { x: 14, y: 5 };
    const footprint = { width: 3, height: 3 };
    const cells = Array.from({ length: 9 }, (_, index) => surfaceOffset(origin, index % 3, Math.floor(index / 3), FACE));
    // 确实跨面：展开图坐标不再连续（面号不同）。
    const faces = new Set(cells.map((cell) => surfaceFace(cell, FACE)));
    expect(faces.size).toBeGreaterThan(1);
    const center = centerOf(origin, footprint);
    const middle = centroid(vertices(bracketGeometry(center, FACE, RADIUS, 0.02, 0, footprint)));
    // 跨面时质心按球面展开，仍落在中心格的附近（< .25 格）。
    const dx = Math.abs(middle.x - center.x), dy = Math.abs(middle.y - center.y);
    expect(Math.min(dx, FACE * 3 - dx)).toBeLessThan(0.25);
    expect(Math.min(dy, FACE * 2 - dy)).toBeLessThan(0.25);
  });

  it('收拢：inset=1 时臂长缩到最小（括号只剩四角点）', () => {
    const footprint = { width: 3, height: 3 };
    const open = vertices(bracketGeometry({ x: 6, y: 6 }, FACE, RADIUS, 0.02, 0, footprint));
    const closed = vertices(bracketGeometry({ x: 6, y: 6 }, FACE, RADIUS, 0.02, 1, footprint));
    // 外框尺寸不变（括号仍在四角），臂长收缩：每个顶点到最近角点的距离总和变小。
    const xs = open.map((point) => point.x), ys = open.map((point) => point.y);
    const corners = [
      { x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.min(...ys) },
      { x: Math.max(...xs), y: Math.max(...ys) }, { x: Math.min(...xs), y: Math.max(...ys) },
    ];
    const toCorners = (points: { x: number; y: number }[]) => points.reduce((sum, point) => (
      sum + Math.min(...corners.map((corner) => Math.hypot(point.x - corner.x, point.y - corner.y)))
    ), 0);
    expect(toCorners(closed)).toBeLessThan(toCorners(open) * 0.5);
  });
});

describe('括号收拢动画（步骤 19：与 VFX 时钟同一时间基）', () => {
  const FACE_SIZE = 16;

  it('非冻结：sync(now) 后随时间透明度上升（不再恒为最暗）', () => {
    const overlay = new SelectionOverlay(new THREE.Group(), RADIUS, () => 0.4);
    overlay.sync([{
      key: 'selected:b', tile: { x: 6, y: 6 }, color: '#ffd166', kind: 'building', opacity: 0.95,
      footprint: Array.from({ length: 9 }, (_, i) => ({ x: 5 + (i % 3), y: 5 + Math.floor(i / 3) })),
      footprintSize: { width: 3, height: 3 },
    }], FACE_SIZE, 0);
    const mesh = overlay.group.children[0] as THREE.Mesh;
    const opacity = () => (mesh.material as THREE.MeshBasicMaterial).opacity;
    overlay.animate(0, false);
    const atZero = opacity();
    overlay.animate(BRACKET_SNAP_SECONDS * 0.5, false);
    const atHalf = opacity();
    overlay.animate(BRACKET_SNAP_SECONDS, false);
    const done = opacity();
    expect(atHalf).toBeGreaterThan(atZero);
    expect(done).toBeGreaterThan(atHalf);
    // 起点就是最暗的 0.95 × 0.55，终点是 0.95（全亮）。
    expect(atZero).toBeCloseTo(0.95 * 0.55, 6);
    expect(done).toBeCloseTo(0.95, 6);
    overlay.dispose();
  });

  it('冻结：直接收拢完成（夹具截图固定）', () => {
    const overlay = new SelectionOverlay(new THREE.Group(), RADIUS, () => 0.4);
    overlay.sync([{
      key: 'selected:b', tile: { x: 6, y: 6 }, color: '#ffd166', kind: 'building', opacity: 0.95,
      footprintSize: { width: 1, height: 1 },
    }], FACE_SIZE, 12);
    overlay.animate(12, true);
    const mesh = overlay.group.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.95, 6);
    overlay.dispose();
  });

  it('时钟倒退（两套时基）时 clamp 到 0，不会出现负透明度', () => {
    const overlay = new SelectionOverlay(new THREE.Group(), RADIUS, () => 0.4);
    overlay.sync([{
      key: 'selected:b', tile: { x: 6, y: 6 }, color: '#ffd166', kind: 'building', opacity: 0.95,
      footprintSize: { width: 1, height: 1 },
    }], FACE_SIZE, 30);
    overlay.animate(1, false);
    const mesh = overlay.group.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.95 * 0.55, 6);
    overlay.dispose();
  });
});
