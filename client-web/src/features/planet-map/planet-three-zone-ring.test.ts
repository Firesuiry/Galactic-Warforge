import { describe, expect, it } from 'vitest';

import {
  projectTheaterZoneRing,
  theaterZoneContainsTile,
  theaterZoneRingTiles,
  type ScreenPoint,
} from './planet-three-zone-ring';

/** 假投影：把格坐标线性映射到屏幕（(x+1)*10, (y+1)*10），可选按格判定不可见。 */
function linearProject(hidden: (tile: { x: number; y: number }) => boolean = () => false) {
  return (tile: { x: number; y: number }): ScreenPoint => ({
    x: (tile.x + 1) * 10,
    y: (tile.y + 1) * 10,
    visible: !hidden(tile),
  });
}

describe('theaterZoneRingTiles', () => {
  it('沿圆周采样 48 个格坐标，半径保底 2 格', () => {
    const points = theaterZoneRingTiles({ x: 0, y: 0 }, 3);
    expect(points).toHaveLength(48);
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(3, 6);
    }
    const tiny = theaterZoneRingTiles({ x: 5, y: 5 }, 0);
    for (const point of tiny) {
      expect(Math.hypot(point.x - 5, point.y - 5)).toBeCloseTo(2, 6);
    }
  });
});

describe('projectTheaterZoneRing', () => {
  it('把地面圆投影成闭合 SVG 多边形，并给出半径标签与圆心', () => {
    const ring = projectTheaterZoneRing(linearProject(), { x: 4, y: 6 }, 3);
    expect(ring).not.toBeNull();
    expect(ring!.path.startsWith('M ')).toBe(true);
    expect(ring!.path.endsWith(' Z')).toBe(true);
    expect(ring!.visiblePoints).toBe(48);
    expect(ring!.label).toBe('半径 3 格');
    expect(ring!.center).toEqual({ x: 50, y: 70, visible: true });
  });

  it('跳过不可见采样点；可见点少于 3 个时返回 null（球背面不画）', () => {
    // 前 10 个采样点不可见 → 仍剩 38 个，是开口折线（不闭合）。
    const partial = projectTheaterZoneRing(linearProject(tile => tile.y < -2), { x: 0, y: 0 }, 3);
    expect(partial).not.toBeNull();
    expect(partial!.visiblePoints).toBeLessThan(48);
    expect(partial!.path.endsWith('Z')).toBe(false);

    // 只有 2 个可见点 → 画不出形状。
    const blocked = projectTheaterZoneRing(
      tile => ({ x: tile.x, y: tile.y, visible: tile.x > 2.99 }),
      { x: 0, y: 0 },
      3,
    );
    expect(blocked).toBeNull();
  });

  it('投影整体失败（scene 未就绪）时返回 null，不抛错', () => {
    expect(projectTheaterZoneRing(() => null, { x: 1, y: 1 }, 3)).toBeNull();
  });
});

describe('theaterZoneContainsTile', () => {
  it('按格心距离判定悬停是否落在战区圆内', () => {
    expect(theaterZoneContainsTile({ x: 10, y: 10 }, 3, { x: 12, y: 12 })).toBe(true);
    expect(theaterZoneContainsTile({ x: 10, y: 10 }, 3, { x: 14, y: 14 })).toBe(false);
  });
});
