import * as THREE from 'three';

/**
 * 贴球面的闭合色带（WebGL 线宽恒为 1px，远看几乎不可见；地表标记一律用色带网格）。
 * loop：闭合环上的单位法线（首尾不重复）；radius：贴地半径；halfWidth：半宽（世界单位）。
 * 拐角按斜接（miter）展开，矩形描边四角宽度一致。
 */
export function ribbonGeometry(loop: THREE.Vector3[], radius: number, halfWidth: number): THREE.BufferGeometry {
  const count = loop.length;
  const positions = new Float32Array(count * 2 * 3);
  const side = (from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3) => (
    new THREE.Vector3().subVectors(to, from).cross(normal).normalize()
  );
  for (let i = 0; i < count; i++) {
    const normal = loop[i];
    const previous = side(loop[(i - 1 + count) % count], normal, normal);
    const next = side(normal, loop[(i + 1) % count], normal);
    const miter = previous.clone().add(next);
    if (miter.lengthSq() < 1e-12) miter.copy(next);
    miter.normalize();
    const length = halfWidth / Math.max(miter.dot(next), 0.25);
    const center = normal.clone().multiplyScalar(radius);
    const inner = center.clone().addScaledVector(miter, -length).setLength(radius);
    const outer = center.clone().addScaledVector(miter, length).setLength(radius);
    inner.toArray(positions, i * 6);
    outer.toArray(positions, i * 6 + 3);
  }
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2, b = ((i + 1) % count) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** 球面小圆：以 center 为中心、角半径 angle 的圆（segments 个点，首尾不重复）。 */
export function circleLoop(center: THREE.Vector3, east: THREE.Vector3, south: THREE.Vector3, angle: number, segments = 64): THREE.Vector3[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = i * Math.PI * 2 / segments;
    return center.clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(east, Math.sin(angle) * Math.cos(a))
      .addScaledVector(south, Math.sin(angle) * Math.sin(a))
      .normalize();
  });
}

/** 球面圆盘（扇形三角），用于范围的淡色填充。 */
export function discGeometry(loop: THREE.Vector3[], center: THREE.Vector3, radius: number): THREE.BufferGeometry {
  const positions = new Float32Array((loop.length + 1) * 3);
  center.clone().setLength(radius).toArray(positions, 0);
  loop.forEach((normal, i) => normal.clone().setLength(radius).toArray(positions, (i + 1) * 3));
  const indices: number[] = [];
  for (let i = 0; i < loop.length; i++) indices.push(0, i + 1, ((i + 1) % loop.length) + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}
