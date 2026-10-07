import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { circleLoop, discGeometry, ribbonGeometry } from './surface-ribbon';

describe('贴地色带', () => {
  it('色带顶点都在指定半径球面上，宽度约为 2×halfWidth', () => {
    const center = new THREE.Vector3(0, 0, 1);
    const loop = circleLoop(center, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 0.1, 32);
    const geometry = ribbonGeometry(loop, 100, 0.5);
    const position = geometry.getAttribute('position');
    expect(position.count).toBe(64);
    const inner = new THREE.Vector3().fromBufferAttribute(position, 0);
    const outer = new THREE.Vector3().fromBufferAttribute(position, 1);
    expect(inner.length()).toBeCloseTo(100);
    expect(outer.length()).toBeCloseTo(100);
    expect(inner.distanceTo(outer)).toBeCloseTo(1, 1);
    expect(geometry.getIndex()!.count).toBe(32 * 6);
  });

  it('矩形四角斜接：拐角处宽度不收窄', () => {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * 0.01, y * 0.01, 1).normalize());
    const geometry = ribbonGeometry(corners, 100, 0.1);
    const position = geometry.getAttribute('position');
    const inner = new THREE.Vector3().fromBufferAttribute(position, 0);
    const outer = new THREE.Vector3().fromBufferAttribute(position, 1);
    expect(inner.distanceTo(outer)).toBeCloseTo(0.2 * Math.SQRT2, 2);
  });

  it('圆盘：中心 + 每个环点一个三角形', () => {
    const loop = circleLoop(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 0.1, 16);
    const geometry = discGeometry(loop, new THREE.Vector3(0, 0, 1), 50);
    expect(geometry.getAttribute('position').count).toBe(17);
    expect(geometry.getIndex()!.count).toBe(48);
  });
});
