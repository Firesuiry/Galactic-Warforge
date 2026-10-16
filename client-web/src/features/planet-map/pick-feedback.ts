/**
 * 3D 点选反馈：点选落空时不能静默丢弃（试玩 1016 B4）。
 *
 * 两类落空都要给出可见提示：
 * - `offscreen`：程序化点选的目标格投影不在视野内（`project().visible === false`），
 *   例如驱动脚本 / 迷你地图按格下令时镜头还没转过去。场景会先把镜头聚焦到该格，
 *   再派发点击，并让界面提示「已移动镜头」——否则玩家（和自动化）以为点了就生效了。
 * - `miss`：点击处根本不在星球表面（射线没打中球面，例如点到星空/行星圆盘外），
 *   在建造/移动等「点格子下令」的模式下同样要给一句可执行的提示。
 */

import type { TilePoint } from './model';

export type PickNotice =
  | { kind: 'offscreen'; tile: TilePoint }
  | { kind: 'miss' };

/** 目标格不在视野内（镜头已聚焦过去）。 */
export function offscreenPickNotice(tile: TilePoint): PickNotice {
  return { kind: 'offscreen', tile: { x: Math.round(tile.x), y: Math.round(tile.y) } };
}

/** 点击处不在星球表面。 */
export const PICK_MISS_NOTICE: PickNotice = { kind: 'miss' };

/** 提示文案（`role="status"` 胶囊，2.4s 后自动消失）。 */
export function describePickNotice(notice: PickNotice): string {
  return notice.kind === 'offscreen'
    ? `目标格 (${notice.tile.x}, ${notice.tile.y}) 不在视野内，已移动镜头`
    : '点击处不在星球表面：滚轮缩放或拖动旋转后，点星球上的格子';
}
