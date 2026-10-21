/**
 * 范围圈重画（3A 画质 vfx 分支）：补给光环 / 射程圈统一为
 * 「≤ .06 格宽虚线环（沿圆周缓慢流动，freeze 定格）+ 内部极淡径向渐变（中心 0 → 边缘 .05）」。
 *
 * 旧补给光环是一条很粗的实心薄荷绿环（半宽 ≈ .32 格、不透明 .85 × 呼吸），抢画面；
 * 这里改成细虚线 + 极淡填充，运行/停机颜色语义不变（运行薄荷绿、停机暗红）。
 *
 * 虚线「流动」不重建几何：`setFlow(phase)` 把环整体绕自身轴旋转一个小于一个 dash 周期的
 * 角度——视觉上虚线沿圆周缓慢滑动，冻结时相位固定。
 */

import * as THREE from 'three';

import { ribbonGeometry } from '../surface-ribbon';
import { tileFrame } from '../projection';

/** 虚线环参数（格）。 */
export const DASH_RING = {
  /** 线宽（格）：硬约束 ≤ .06。 */
  width: 0.055,
  /** 一段虚线的弧长（格）。 */
  dash: 0.42,
  /** 段间距（格）。 */
  gap: 0.26,
  opacity: 0.62,
  /** 填充不透明度：中心 0 → 边缘 0.05。 */
  fillEdge: 0.05,
  /** 虚线流动速度（圈/秒），freeze 下为 0。 */
  flow: 0.06,
} as const;

/**
 * 虚线环几何：把单位法线环按「弧长 ≈ 格数 × 每格段数」切成若干段，每段单独一条细带。
 * `loop` 为闭合环（首尾不重复），`tileSize` 用于把格换算成弧长。
 */
export function dashedRingGeometry(loop: THREE.Vector3[], radius: number, halfWidth: number, tileSize: number, radiusTiles: number): THREE.BufferGeometry {
  const count = loop.length;
  const circumference = Math.max(0.001, 2 * Math.PI * radiusTiles);
  const periodTiles = DASH_RING.dash + DASH_RING.gap;
  const periods = Math.max(3, Math.round(circumference / periodTiles));
  const pointsPerPeriod = count / periods;
  const dashPoints = Math.max(2, Math.round(pointsPerPeriod * (DASH_RING.dash / periodTiles)));
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (let start = 0; start < count; start += pointsPerPeriod) {
    const from = Math.round(start);
    const to = Math.min(count - 1, from + dashPoints);
    if (to - from < 1) continue;
    const segment = loop.slice(from, to + 1);
    const ribbon = ribbonGeometry(segment, radius, halfWidth);
    const array = ribbon.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < array.count; i++) positions.push(array.getX(i), array.getY(i), array.getZ(i));
    // 开放段：每对相邻点一个四边形（ribbonGeometry 的索引按闭合环写，这里重建）。
    for (let i = 0; i < segment.length - 1; i++) {
      const a = base + i * 2, b = base + (i + 1) * 2;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    base += segment.length * 2;
    ribbon.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  void tileSize;
  return geometry;
}

/** 径向渐变盘：中心 alpha 0 → 边缘 `edgeAlpha`（顶点色）。 */
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

export function createDashRingMaterial(color: string, opacity: number = DASH_RING.opacity): THREE.MeshBasicMaterial {
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

/** 补给光环配色（运行 / 停机 / 补给车）——语义与旧版一致。 */
export const SUPPLY_AURA_COLORS = {
  running: '#5ff0b0',
  stopped: '#e0727f',
  truck: '#7dc5f4',
} as const;

/** 虚线流动相位（0..1，冻结时由调用方给固定值）。 */
export function dashFlowPhase(seconds: number, frozen: boolean): number {
  return frozen ? 0.25 : (seconds * DASH_RING.flow) % 1;
}

/**
 * 贴球面虚线环的「流动」：绕环心轴旋转一个小于一个 dash 周期的角度。
 * 返回可直接 `quaternion.premultiply` 的旋转（轴 = 该格法线）。
 */
export function flowRotation(tile: { x: number; y: number }, faceSize: number, phase: number): THREE.Quaternion {
  const { normal } = tileFrame(tile, faceSize);
  return new THREE.Quaternion().setFromAxisAngle(normal, phase * (DASH_RING.dash + DASH_RING.gap) * 0.9 * Math.PI * 2 / 6);
}
