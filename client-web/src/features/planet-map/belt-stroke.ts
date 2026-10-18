import { surfaceNormal, surfaceStep, type SurfaceDirection, type SurfacePoint } from '@shared/surface';

import { clampBeltElevation } from './logistics-tier';

export interface BeltPlacement { tile: SurfacePoint; direction: SurfaceDirection }

/** 拖拽铺带的一格：方向 + 该格落成后的高度（第 19 轮 §3.5）。 */
export interface BeltElevationPlacement extends BeltPlacement { elevation: number }

/** 上游带子判定需要的最小建筑字段（避免把 model 的类型拖进纯函数）。 */
export interface ExistingBeltLike {
  position: { x: number; y: number };
  type: string;
  owner_id?: string;
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

/**
 * 指针从 `from` 移到 `to` 后更新拖拽路径（逐格处理笔迹，第 19 轮 §3.5 / B3–B5）。
 *
 * 旧实现只看笔迹终点：回拖跨过路径里的已有格时会追加反向格，得到首尾不接的路径；
 * 截断处也不刷新方向，回拖后再转向会留下指向已截掉格子的断链。这里逐格处理：
 * - 该格已在路径里（下标 i）→ 截断到 i+1，并把新的末端格方向设成「从 path[i-1] 进入它」
 *   （即 path[i-1].direction；i=0 时保留原方向）——不会掉头成环；
 * - 否则追加：末端格方向改成 `dir(e→c)`，新格方向也是 `dir(e→c)`。
 *
 * 方向取笔迹的携带朝向（跨面时 surfaceStep 会翻转），保证每格输出方向都能步进到下一格。
 * 高度不在这里算：调用方用 `assignBeltElevations` 按目标高度重算整条路径。
 * 笔迹为空（指针没动/追踪失败）返回 null，调用方保持原路径。
 */
export function applyBeltStrokeStep(
  path: readonly BeltElevationPlacement[],
  from: SurfacePoint,
  to: SurfacePoint,
  size: number,
): BeltElevationPlacement[] | null {
  const segment = traceBeltStroke(from, to, size);
  if (segment.length === 0) return null;
  const next = path.map(part => ({ ...part }));
  // 第一格是拖拽起点（已在路径里），只处理笔迹后面的格。
  for (let index = 1; index < segment.length; index++) {
    const part = segment[index];
    // dir(e→c)：笔迹上一格记录的就是「从它走到本格」的携带朝向。
    const stepDirection = segment[index - 1].direction;
    const revisited = next.findIndex(entry => entry.tile.x === part.tile.x && entry.tile.y === part.tile.y);
    if (revisited >= 0) {
      next.length = revisited + 1;
      // 截断处的末端格要朝路径的前进方向（从 path[i-1] 进入它的方向），不能照抄反向笔迹，
      // 否则末端格会掉头指回上一格。i=0 时保留原方向（第一格的方向等第一次追加时回填）。
      if (revisited > 0) next[revisited] = { ...next[revisited], direction: next[revisited - 1].direction };
      continue;
    }
    const previous = next[next.length - 1];
    next[next.length - 1] = { ...previous, direction: stepDirection };
    next.push({ tile: part.tile, direction: stepDirection, elevation: previous.elevation });
  }
  return next;
}

function isCardinal(direction: string | undefined): direction is SurfaceDirection {
  return direction === 'north' || direction === 'east' || direction === 'south' || direction === 'west';
}

/**
 * 建造模式给的朝向是不是明确四向（`Direction` 里的 'auto' 不算）。
 * 拖拽铺带第一格与单格放置都要用它区分「玩家选了方向」与「交给建造模式兜底」。
 */
export function isCardinalDirection(direction: string | undefined): direction is SurfaceDirection {
  return isCardinal(direction);
}

/**
 * 拖拽铺带第一格的高度（§3.5）：
 * 相邻若有一条现成带子正对着这一格输出（它的 output 方向步进一格 = 本格），
 * 取那条带子的高度（多条取最高，保证接着往上叠而不是往下钻）；否则取目标高度。
 *
 * `playerId` 给了就只看**自己的**带子（别人的带子不决定起始高度：场景数据里含敌方/中立建筑，
 * 接着敌人的带子定高会算出一个自己铺不出来的坡）。缺省（undefined）保持旧行为，只按几何判定。
 */
export function resolveBeltStartElevation(
  tile: SurfacePoint,
  targetElevation: number,
  belts: readonly ExistingBeltLike[],
  size: number,
  playerId?: string,
): number {
  let upstream: number | undefined;
  for (const belt of belts) {
    if (!belt.type.startsWith('conveyor_belt_')) continue;
    if (playerId && belt.owner_id !== playerId) continue;
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
