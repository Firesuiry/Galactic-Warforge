import { describe, expect, it } from 'vitest';
import type { Building, PlanetSceneView } from '@shared/types';

import { assessBuildTiles, describeBuildBlock } from '@/features/planet-map/build-workflow';

/**
 * §4 建造幽灵：细分网格后幽灵按**整个 footprint**（1×1/2×2/3×3/5×5 cell）显示，
 * 并对每格做本地合法性提示；旋转 90/270 时宽高交换。
 */

function planet(): PlanetSceneView {
  const width = 24;
  const height = 16;
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: width,
    map_height: height,
    surface: { topology: 'cube_sphere', face_size: 8 },
    tick: 1,
    bounds: { x: 0, y: 0, width, height },
    terrain: Array.from({ length: height }, () => Array.from({ length: width }, () => 'buildable')),
    buildings: {},
    units: {},
    resources: [],
  } as unknown as PlanetSceneView;
}

function buildingAt(id: string, type: string, x: number, y: number, w = 1, h = 1): Building {
  return {
    id, type, owner_id: 'p1', position: { x, y, z: 0 }, hp: 1, max_hp: 1, level: 1, vision_range: 0,
    runtime: { params: { footprint: { width: w, height: h } }, state: 'running' },
  } as unknown as Building;
}

const catalog = {
  buildings: [
    { id: 'arc_smelter', name: '电弧熔炉', buildable: true, footprint: { width: 3, height: 3 } },
    { id: 'wind_turbine', name: '风机', buildable: true, footprint: { width: 2, height: 2 } },
    { id: 'conveyor_belt_mk1', name: '传送带', buildable: true, footprint: { width: 1, height: 1 } },
  ],
} as never;

describe('建造幽灵占地评估（§4）', () => {
  it('3×3 熔炉的幽灵覆盖 9 格（全绿）', () => {
    const assessment = assessBuildTiles(catalog, 'arc_smelter', planet() as never, { x: 4, y: 4, z: 0 })!;
    expect(assessment.footprint).toEqual({ width: 3, height: 3 });
    expect(assessment.buildable).toBe(true);
    expect(assessment.blockedTiles).toEqual([]);
  });

  it('每格单独判定：幽灵里有一格被建筑占用 → 只标那一格红、整体不可建', () => {
    const scene = planet();
    scene.buildings = { 'b-1': buildingAt('b-1', 'wind_turbine', 5, 5, 1, 1) } as never;
    const assessment = assessBuildTiles(catalog, 'arc_smelter', scene as never, { x: 4, y: 4, z: 0 }, 'p1')!;
    expect(assessment.buildable).toBe(false);
    expect(assessment.blockedTiles.map((tile) => `${tile.x},${tile.y}`)).toEqual(['5,5']);
    expect(describeBuildBlock(assessment, () => '', () => '风力涡轮机')).toBe('该格已有你的建筑：风力涡轮机');
  });

  it('旋转 90/270 时宽高交换（2×2 风机在 90° 下仍是 2×2，1×3 会变 3×1）', () => {
    const wide = {
      buildings: [{ id: 'x', name: '长条', buildable: true, footprint: { width: 1, height: 3 } }],
    } as never;
    const upright = assessBuildTiles(wide, 'x', planet() as never, { x: 4, y: 4, z: 0 }, 'p1', 0)!;
    expect(upright.footprint).toEqual({ width: 1, height: 3 });
    const rotated = assessBuildTiles(wide, 'x', planet() as never, { x: 4, y: 4, z: 0 }, 'p1', 90)!;
    expect(rotated.footprint).toEqual({ width: 3, height: 1 });
  });

  it('1×1 传送带的幽灵只有 1 格（细分网格后小件仍按 1 cell 评估）', () => {
    const assessment = assessBuildTiles(catalog, 'conveyor_belt_mk1', planet() as never, { x: 7, y: 7, z: 0 })!;
    expect(assessment.footprint).toEqual({ width: 1, height: 1 });
    expect(assessment.buildable).toBe(true);
  });
});
