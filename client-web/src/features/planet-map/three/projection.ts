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
export function tileFrame(tile: TilePoint, faceSize: number) {
  const face = surfaceFace(tile, faceSize), normal = tileNormal(tile, faceSize, face);
  const east = tileNormal({x: tile.x + .001, y: tile.y}, faceSize, face).sub(normal);
  east.addScaledVector(normal, -east.dot(normal)).normalize();
  return {normal, east, south: new Vector3().crossVectors(east, normal).normalize()};
}
