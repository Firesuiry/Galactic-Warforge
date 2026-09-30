import { surfaceNormal, surfaceStep, type SurfaceDirection, type SurfacePoint } from '@shared/surface';

export interface BeltPlacement { tile: SurfacePoint; direction: SurfaceDirection }

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
