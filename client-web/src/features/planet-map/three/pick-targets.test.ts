import { describe, expect, it } from 'vitest';

import type { Building } from '@shared/types';

import type { TilePoint } from '../model';
import { buildingCoveringTile } from './pick-targets';

const FACE_SIZE = 16;

/** 最小建筑：position 是占地原点（左上角），footprint 决定覆盖格。 */
function building(id: string, x: number, y: number, width: number, height: number): Building {
  return {
    id, type: 'supply_station', owner_id: 'p1', position: { x, y, z: 0 }, hp: 1, max_hp: 1, level: 1, vision_range: 1,
    runtime: { params: { footprint: { width, height } } },
  } as unknown as Building;
}

describe('buildingCoveringTile：多格建筑按占地回 id（试玩 1019 C）', () => {
  const buildings = {
    'b-1': building('b-1', 5, 5, 3, 3),   // 3×3：占 (5,5)–(7,7)
    'b-2': building('b-2', 9, 5, 1, 1),   // 1×1
  };

  it('占地内任意一格（含四角）都返回同一栋', () => {
    for (const tile of [{ x: 5, y: 5 }, { x: 7, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 6 }]) {
      expect(buildingCoveringTile(buildings, tile, FACE_SIZE)).toBe('b-1');
    }
  });

  it('占地外返回 undefined（点空地不误选邻近建筑）', () => {
    expect(buildingCoveringTile(buildings, { x: 8, y: 5 }, FACE_SIZE)).toBeUndefined();
    expect(buildingCoveringTile(buildings, { x: 4, y: 4 }, FACE_SIZE)).toBeUndefined();
    expect(buildingCoveringTile(buildings, { x: 9, y: 5 }, FACE_SIZE)).toBe('b-2');
  });

  it('多栋占地重叠：取离该格最近的一栋（原点曼哈顿距离）', () => {
    const overlapping = {
      far: building('far', 0, 0, 5, 5),
      near: building('near', 2, 2, 1, 1),
    };
    expect(buildingCoveringTile(overlapping, { x: 2, y: 2 }, FACE_SIZE)).toBe('near');
    expect(buildingCoveringTile(overlapping, { x: 0, y: 0 }, FACE_SIZE)).toBe('far');
  });

  it('空表/undefined 不抛', () => {
    expect(buildingCoveringTile(undefined, { x: 1, y: 1 }, FACE_SIZE)).toBeUndefined();
    expect(buildingCoveringTile({}, { x: 1, y: 1 }, FACE_SIZE)).toBeUndefined();
  });
});
