import { MathUtils, Vector3 } from 'three';
import type { TilePoint } from '../model';

/** Equal-area cylindrical projection keeps polar colonies usable while preserving server tile IDs. */
export function tileNormal(tile: TilePoint, width: number, height: number) {
  const longitude = (tile.x + .5) / width * Math.PI * 2;
  const y = MathUtils.clamp(1 - 2 * (tile.y + .5) / height, -1, 1);
  const equatorial = Math.sqrt(Math.max(0, 1 - y * y));
  return new Vector3(-Math.cos(longitude) * equatorial, y, Math.sin(longitude) * equatorial);
}

export function normalTile(normal: Vector3, width: number, height: number): TilePoint {
  const u = ((Math.atan2(normal.z, -normal.x) / (2 * Math.PI)) + 1) % 1;
  return { x: Math.min(width - 1, Math.floor(u * width)), y: Math.min(height - 1, Math.max(0, Math.floor((1 - MathUtils.clamp(normal.y, -1, 1)) * .5 * height))) };
}
