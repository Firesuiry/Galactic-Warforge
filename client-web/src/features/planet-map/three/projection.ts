import { Vector3 } from 'three';
import { surfaceNormal, surfaceTile, surfaceFace } from '@shared/surface';
import type { TilePoint } from '../model';
export { surfaceTileSize } from '@shared/surface';
export function tileNormal(tile: TilePoint, faceSize: number, face?: number) {
  const n = surfaceNormal(tile, faceSize, face);
  return new Vector3(n.x, n.y, n.z);
}
export function normalTile(normal: Vector3, faceSize: number): TilePoint {
  return surfaceTile(normal, faceSize);
}
/**
 * 1 cell 的贴地四边形：四角取相邻 cell 中心方向（共用中心格所在面，跨面时不串面）。
 *
 * 选中框/悬停框/占地框都由它画：**一个 cell 就是一个 cell**，四角必须落在相邻
 * cell 中心方向上，不能外扩成外接四边形（那样近景下框比格子大一圈）。
 * 与 `tileFrame` 的 east/south 组合出来的理想格子边界一致，测试见 projection.test.ts。
 */
export function tileQuad(tile: TilePoint, faceSize: number): Vector3[] {
  const face = surfaceFace(tile, faceSize);
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]
    .map(([dx, dy]) => tileNormal({ x: tile.x + dx, y: tile.y + dy }, faceSize, face));
}

export function tileFrame(tile: TilePoint, faceSize: number) {
  const face = surfaceFace(tile, faceSize), normal = tileNormal(tile, faceSize, face);
  const east = tileNormal({x: tile.x + .001, y: tile.y}, faceSize, face).sub(normal);
  east.addScaledVector(normal, -east.dot(normal)).normalize();
  return {normal, east, south: new Vector3().crossVectors(east, normal).normalize()};
}
