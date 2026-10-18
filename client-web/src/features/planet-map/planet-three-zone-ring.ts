/**
 * 3D 战区「地面圆」投影（R20-A ⑥⑦）。
 *
 * 服务端战区的几何是**球面上的中心 + 半径**，不是屏幕矩形：2D 平面图上画一个屏幕圆
 * 还能糊弄过去，倾斜的球面上屏幕圆与地面圆完全对不上（试玩 1020 层 10/11：
 * 拖拽预览是屏幕正矩形、建好后 3D 里看不到）。这里的画法：
 * 沿圆周取约 48 个**格坐标**采样点 → 逐点投影成屏幕点 → 连成 SVG 多边形。
 * 拖拽预览与已建成的战区共用同一套采样/投影，保证「画出来的圈 = 建出来的战区」。
 *
 * 纯函数（输入是投影回调），jsdom 单测可直接喂假的 project。
 */

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export type ProjectTile = (tile: { x: number; y: number }) => ScreenPoint | null;

/** 圆周采样段数：48 段在贴地视角下已看不出折线。 */
export const THEATER_RING_SEGMENTS = 48;

/** 战区半径下限（tile），与 squad-commands 的 THEATER_ZONE_MIN_RADIUS 同口径。 */
export const THEATER_RING_MIN_RADIUS = 2;

export interface TheaterZoneRing {
  /** `半径 N 格` 标签文案。 */
  label: string;
  /** SVG path（地面圆投影；未闭合时是开口折线）。 */
  path: string;
  /** 圆心投影（不可见时为 null）。 */
  center: ScreenPoint | null;
  /** 实际连进 path 的可见点数。 */
  visiblePoints: number;
  /** 采样点总数。 */
  totalPoints: number;
}

/** 沿地面圆周采样格坐标（浮点格；含首点不重复闭合点）。 */
export function theaterZoneRingTiles(
  center: { x: number; y: number },
  radius: number,
  segments: number = THEATER_RING_SEGMENTS,
): { x: number; y: number }[] {
  const safeRadius = Math.max(THEATER_RING_MIN_RADIUS, radius);
  const count = Math.max(8, Math.floor(segments));
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push({
      x: center.x + Math.cos(angle) * safeRadius,
      y: center.y + Math.sin(angle) * safeRadius,
    });
  }
  return points;
}

/**
 * 地面圆 → 屏幕多边形。投影不可见的点跳过（球体背面的采样点不该被连进来），
 * 可见点少于 3 个时返回 null（画不出有面积的形状）。
 */
export function projectTheaterZoneRing(
  project: ProjectTile,
  center: { x: number; y: number },
  radius: number,
  segments: number = THEATER_RING_SEGMENTS,
): TheaterZoneRing | null {
  const tiles = theaterZoneRingTiles(center, radius, segments);
  const projected: ScreenPoint[] = [];
  for (const tile of tiles) {
    const point = project(tile);
    if (point?.visible) projected.push(point);
  }
  if (projected.length < 3) return null;
  const path = projected
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
    + (projected.length === tiles.length ? ' Z' : '');
  const centerPoint = project(center);
  return {
    label: `半径 ${Math.max(THEATER_RING_MIN_RADIUS, Math.round(radius))} 格`,
    path,
    center: centerPoint?.visible ? centerPoint : null,
    visiblePoints: projected.length,
    totalPoints: tiles.length,
  };
}

/** 格坐标是否落在战区圆内（用于悬停高亮；格心距离 ≤ 半径）。 */
export function theaterZoneContainsTile(
  center: { x: number; y: number },
  radius: number,
  tile: { x: number; y: number },
): boolean {
  const safeRadius = Math.max(THEATER_RING_MIN_RADIUS, radius);
  return Math.hypot(tile.x - center.x, tile.y - center.y) <= safeRadius;
}
