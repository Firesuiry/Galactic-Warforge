import { surfaceOffset } from '@shared/surface';

import type { Building } from '@shared/types';

import { getBuildingFootprint, type TilePoint } from '../model';

/**
 * 按格找建筑（3D 拾取，第 20 轮 R20-B / 试玩 1019 C）。
 *
 * 批量实例（InstancedMesh）命中只给「实例所属格」，多格建筑点边角时会落在相邻格上；
 * 这里按占地扫描，返回**占地包含该格**的建筑 id（多栋重叠时取离该格最近的一栋），
 * 调用侧据此选中整栋，而不是只给格坐标。
 */
export function buildingCoveringTile(
  buildings: Record<string, Building> | undefined,
  tile: TilePoint,
  faceSize: number,
): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const building of Object.values(buildings ?? {})) {
    const footprint = getBuildingFootprint(building);
    for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
      const cell = surfaceOffset(building.position, dx, dy, faceSize);
      if (cell.x !== tile.x || cell.y !== tile.y) continue;
      const distance = Math.abs(building.position.x - tile.x) + Math.abs(building.position.y - tile.y);
      if (!best || distance < best.distance) best = { id: building.id, distance };
    }
  }
  return best?.id;
}
