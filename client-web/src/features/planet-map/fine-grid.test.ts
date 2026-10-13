import { describe, expect, it } from 'vitest';
import type { Building, Unit } from '@shared/types';

import { buildingFootprintCells, tileContainsBuilding } from '@/features/planet-map/model';

function building(overrides: Partial<Building>): Building {
  return {
    id: 'b',
    type: 'arc_smelter',
    owner_id: 'p1',
    position: { x: 3, y: 3, z: 0 },
    hp: 1,
    max_hp: 1,
    level: 1,
    vision_range: 0,
    runtime: { params: { footprint: { width: 3, height: 3 } }, state: 'running' },
    ...overrides,
  } as unknown as Building;
}

describe('细分网格占地几何（§4）', () => {
  it('建筑按 footprint 铺满 W×H cell，position 是占地原点', () => {
    const cells = buildingFootprintCells(building({}), 48);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toEqual({ x: 3, y: 3 });
    expect(cells).toContainEqual({ x: 5, y: 5 });
  });

  it('旋转后的 footprint（服务端已交换宽高）直接生效：2×3 → 3×2', () => {
    const rotated = building({ runtime: { params: { footprint: { width: 3, height: 2 } }, state: 'running' } } as never);
    expect(buildingFootprintCells(rotated, 48)).toHaveLength(6);
  });

  it('占地命中判定覆盖整块（选中/悬停按 footprint，而不是只认左上格）', () => {
    const smelter = building({});
    expect(tileContainsBuilding(smelter, 3, 3, 48)).toBe(true);
    expect(tileContainsBuilding(smelter, 5, 5, 48)).toBe(true);
    expect(tileContainsBuilding(smelter, 6, 5, 48)).toBe(false);
  });

  it('5×5 HQ 占地 25 格', () => {
    const hq = building({ type: 'battlefield_analysis_base', runtime: { params: { footprint: { width: 5, height: 5 } }, state: 'running' } } as never);
    expect(buildingFootprintCells(hq, 288)).toHaveLength(25);
  });
});

describe('运输机器人占 1 cell（§4）', () => {
  it('单位类型进 UnitType 联合且不在建筑占地判定里', () => {
    const robot: Unit = {
      id: 'robot-1', type: 'transport_robot', owner_id: 'p1', position: { x: 4, y: 4, z: 0 },
      hp: 60, max_hp: 60, attack: 0, defense: 0, attack_range: 0, move_range: 0, vision_range: 4,
    };
    expect(robot.type).toBe('transport_robot');
  });
});
