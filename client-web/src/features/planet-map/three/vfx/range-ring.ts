/**
 * 范围圈重画（3A 画质 vfx 分支）：补给光环 / 射程圈统一为
 * 「≤ .06 格宽虚线环（沿圆周缓慢流动，freeze 定格）+ 内部极淡径向渐变（中心 0 → 边缘 .05）」。
 *
 * 旧补给光环是一条很粗的实心薄荷绿环（半宽 ≈ .32 格、不透明 .85 × 呼吸），抢画面；
 * 这里改成细虚线 + 极淡填充，运行/停机颜色语义不变（运行薄荷绿、停机暗红）。
 *
 * 建造 ghost 的供电范围圈同一画法（`RANGE_CIRCLE_*` 口径不变，只换虚线）。
 */

import * as THREE from 'three';

import { ribbonGeometry } from '../surface-ribbon';

/** 虚线环参数（格）。 */
export const DASH_RING = {
  width: 0.055,
  dash: 0.42,
  gap: 0.26,
  opacity: 0.62,
  /** 填充不透明度：中心 0 → 边缘 0.05。 */
  fillEdge: 0.05,
  /** 虚线流动速度（圈/秒），freeze 下为 0。 */
  flow: 0.08,
} as const;

/**
 * 虚线环几何：在单位法线环上按弧长切段。
 *
 * `loop`：闭合环上的单位法线（首尾不重复）；`radiusTiles`：环半径（格），
 * 用于把 dash/gap（格）换算成段数比例。
 */
export function dashedRingGeometry(loop: THREE.Vector3[], radius: number, halfWidth: number, dash: number, gap: number): THREE.BufferGeometry {
  const count = loop.length;
  const period = Math.max(1, Math.round((count * (dash + gap)) / Math.max(dash + gap, 1e-6) / 8));
  const dashCount = Math.max(1, Math.round(period * (dash / (dash + gap))));
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  // 沿环按 period 个点为一组，前 dashCount 个点连成一段（不闭合）。
  for (let start = 0; start < count; start += period) {
    const end = Math.min(count, start + dashCount);
    if (end - start < 2) continue;
    const segment = loop.slice(start, end);
    const ribbon = ribbonGeometry(segment, radius, halfWidth);
    const array = ribbon.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < array.count; i++) positions.push(array.getX(i), array.getY(i), array.getZ(i));
    // ribbonGeometry 的索引按 (count) 个点循环，这里段是开放的：重建索引（每对相邻点一个四边形）。
    const points = segment.length;
    for (let i = 0; i < points - 1; i++) {
      const a = base + i * 2, b = base + (i + 1) * 2;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    base += points * 2;
    ribbon.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * 径向渐变盘（中心 0 → 边缘 alpha）。
 * `loop`：闭合环；`center`：圆心法线；顶点色 alpha 从 0 到 `edgeAlpha`。
 */
export function radialDiscGeometry(loop: THREE.Vector3[], center: THREE.Vector3, radius: number, edgeAlpha: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  positions.push(...center.clone().setLength(radius).toArray());
  colors.push(1, 1, 1, 0);
  loop.forEach((normal) => {
    positions.push(...normal.clone().setLength(radius).toArray());
    colors.push(1, 1, 1, edgeAlpha);
  });
  const indices: number[] = [];
  for (let i = 0; i < loop.length; i++) indices.push(0, i + 1, ((i + 1) % loop.length) + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * 虚线环材质：流动相位用 `uFlow` uniform（沿环方向偏移段索引，画面平滑）。
 * 简化实现：相位写进顶点属性（每次重建几何代价高），这里改用「整圈缓慢自转」——
 * 视觉上是虚线沿圆周流动，且不重建几何。
 */
export function createDashRingMaterial(color: string, opacity = DASH_RING.opacity): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
}

export function createRadialFillMaterial(color: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 1, depthWrite: false,
    side: THREE.DoubleSide, vertexColors: true, toneMapped: false,
  });
}

/** 补给光环配色（运行 / 停机 / 补给车）。 */
export const SUPPLY_AURA_COLORS = {
  running: '#5ff0b0',
  stopped: '#e0727f',
  truck: '#7dc5f4',
} as const;
