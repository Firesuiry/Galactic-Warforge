import { surfaceNormal, surfaceStep, type SurfaceDirection, type SurfacePoint } from '@shared/surface';

import { clampBeltElevation } from './logistics-tier';

export interface BeltPlacement { tile: SurfacePoint; direction: SurfaceDirection }

/** 拖拽铺带的一格：方向 + 该格落成后的高度（第 19 轮 §3.5）。 */
export interface BeltElevationPlacement extends BeltPlacement { elevation: number }

/** 上游带子判定需要的最小建筑字段（避免把 model 的类型拖进纯函数）。 */
export interface ExistingBeltLike {
  position: { x: number; y: number };
  type: string;
  conveyor?: { output?: string; elevation?: number };
}

/** Interpolate pointer samples; gameplay placement validation stays on the server. */
export function traceBeltStroke(from: SurfacePoint, to: SurfacePoint, size: number): BeltPlacement[] {
  if (from.x === to.x && from.y === to.y) return [];
  const goal = surfaceNormal(to, size);
  const directions: SurfaceDirection[] = ['north', 'east', 'south', 'west'];
  const seen = new Set<string>();
  const result: BeltPlacement[] = [];
  let current = from;
  for (let step = 0; step < 64; step++) {
    seen.add(current.x + ':' + current.y);
    const candidates = directions.map(direction => {
      const next = surfaceStep(current, direction, size);
      const n = surfaceNormal(next.tile, size);
      return { direction, next, distance: (n.x-goal.x)**2+(n.y-goal.y)**2+(n.z-goal.z)**2 };
    }).filter(c => !seen.has(c.next.tile.x + ':' + c.next.tile.y)).sort((a,b) => a.distance-b.distance);
    const best = candidates[0];
    if (!best) return [];
    result.push({ tile: current, direction: best.direction });
    current = best.next.tile;
    if (current.x === to.x && current.y === to.y) {
      result.push({ tile: current, direction: best.next.direction });
      return result;
    }
  }
  return [];
}

function isCardinal(direction: string | undefined): direction is SurfaceDirection {
  return direction === 'north' || direction === 'east' || direction === 'south' || direction === 'west';
}

/**
 * 拖拽铺带第一格的高度（§3.5）：
 * 相邻若有一条现成带子正对着这一格输出（它的 output 方向步进一格 = 本格），
 * 取那条带子的高度（多条取最高，保证接着往上叠而不是往下钻）；否则取目标高度。
 */
export function resolveBeltStartElevation(
  tile: SurfacePoint,
  targetElevation: number,
  belts: readonly ExistingBeltLike[],
  size: number,
): number {
  let upstream: number | undefined;
  for (const belt of belts) {
    if (!belt.type.startsWith('conveyor_belt_')) continue;
    if (!isCardinal(belt.conveyor?.output)) continue;
    const origin = { x: Math.round(belt.position.x), y: Math.round(belt.position.y) };
    const next = surfaceStep(origin, belt.conveyor.output, size).tile;
    if (next.x !== tile.x || next.y !== tile.y) continue;
    const elevation = clampBeltElevation(belt.conveyor?.elevation ?? 0);
    upstream = upstream === undefined ? elevation : Math.max(upstream, elevation);
  }
  return clampBeltElevation(upstream ?? targetElevation);
}

/**
 * 下一格高度（§3.5）：
 * - 与上一格同方向（直行）→ 向目标高度走 1 步（每格最多 ±1）；
 * - 转弯 → 保持上一格高度（坡道上不许转弯，服务端坡道也只认直行延续）。
 */
export function stepBeltElevation(
  previous: Pick<BeltElevationPlacement, 'direction' | 'elevation'>,
  next: Pick<BeltPlacement, 'direction'>,
  targetElevation: number,
): number {
  const current = clampBeltElevation(previous.elevation);
  if (previous.direction !== next.direction) return current;
  const target = clampBeltElevation(targetElevation);
  if (target === current) return current;
  return clampBeltElevation(current + Math.sign(target - current));
}

/** 整条拖拽路径逐格定高（纯函数，拖拽预览与单测共用）。 */
export function assignBeltElevations(
  stroke: readonly BeltPlacement[],
  startElevation: number,
  targetElevation: number,
): BeltElevationPlacement[] {
  const result: BeltElevationPlacement[] = [];
  for (let index = 0; index < stroke.length; index++) {
    const elevation = index === 0
      ? clampBeltElevation(startElevation)
      : stepBeltElevation(result[index - 1], stroke[index], targetElevation);
    result.push({ ...stroke[index], elevation });
  }
  return result;
}
