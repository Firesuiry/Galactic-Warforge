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

  it('采样点是浮点格坐标：不取整、相邻点不共点（无台阶）', () => {
    // 记录投影收到的格坐标：必须是浮点（取整会让 48 点吸到格心，画面变阶梯）。
    const seen: { x: number; y: number }[] = [];
    const ring = projectTheaterZoneRing(
      (tile) => {
        seen.push({ ...tile });
        return { x: tile.x * 10, y: tile.y * 10, visible: true };
      },
      { x: 10, y: 10 },
      4,
    );
    expect(ring).not.toBeNull();
    // 48 个圆周采样点 + 最后一次圆心投影。
    expect(seen).toHaveLength(49);
    seen.pop();
    // 至少有大量非整数坐标（48 个采样点里 0°/90°/180°/270° 四个正好落在整数格）。
    const fractional = seen.filter((tile) => !Number.isInteger(tile.x) || !Number.isInteger(tile.y));
    expect(fractional.length).toBeGreaterThan(40);
    // 相邻采样点的格坐标互不重合（取整后相邻点会大量共点）。
    for (let index = 0; index < seen.length; index += 1) {
      const current = seen[index];
      const next = seen[(index + 1) % seen.length];
      expect(Math.hypot(current.x - next.x, current.y - next.y)).toBeGreaterThan(0.1);
    }
    // 投影后的屏幕点同样不共点（无台阶）。
    const screen = ring!.path.slice(1, -1).trim().split(/ L /).map((pair) => pair.split(' ').map(Number));
    expect(screen).toHaveLength(48);
    for (let index = 0; index < screen.length; index += 1) {
      const [x, y] = screen[index];
      const [nx, ny] = screen[(index + 1) % screen.length];
      expect(Math.hypot(x - nx, y - ny)).toBeGreaterThan(0.5);
    }
  });

  it('整数格坐标即格心：中心 (10,10) 的投影与 10.5 偏移口径一致（tileNormal 的 +.5）', () => {
    // 固定口径：scene.project(tile) 的整数 tile 投到格心（shared-client surface.ts
    // 的 surfaceNormal 用 (x + .5)），所以战区中心直接传整数格 = 服务端「中心格」。
    // 这里用一个按格心算屏幕坐标的假投影，断言 ring.center 取的就是整数格心的投影。
    const project = (tile: { x: number; y: number }) => ({
      x: (tile.x + 0.5) * 8,
      y: (tile.y + 0.5) * 8,
      visible: true,
    });
    const ring = projectTheaterZoneRing(project, { x: 10, y: 10 }, 4);
    expect(ring!.center).toEqual({ x: 84, y: 84, visible: true });
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
