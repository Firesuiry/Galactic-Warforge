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

describe('多层传送带本地预检（第 19 轮 §3.2）', () => {
  function belt(id: string, x: number, y: number, elevation: number): Building {
    return {
      ...buildingAt(id, 'conveyor_belt_mk1', x, y),
      conveyor: { input: 'west', output: 'east', elevation },
    } as unknown as Building;
  }
  function sorter(id: string, x: number, y: number): Building {
    return buildingAt(id, 'sorter_mk1', x, y);
  }

  it('高架带可以压在地面带/分拣器上（LowLogistics）', () => {
    const scene = planet();
    scene.buildings = {
      'b-ground': belt('b-ground', 6, 6, 0),
      'b-sorter': sorter('b-sorter', 7, 7),
    } as never;
    const overBelt = assessBuildTiles(catalog, 'conveyor_belt_mk1', scene as never, { x: 6, y: 6, z: 0 }, 'p1', 0, undefined, undefined, 2)!;
    expect(overBelt.buildable).toBe(true);
    expect(overBelt.blockedTiles).toEqual([]);
    const overSorter = assessBuildTiles(catalog, 'conveyor_belt_mk1', scene as never, { x: 7, y: 7, z: 0 }, 'p1', 0, undefined, undefined, 1)!;
    expect(overSorter.buildable).toBe(true);
  });

  it('同层同格已有带子不可放（同高度冲突；不同高度可放）', () => {
    const scene = planet();
    scene.buildings = { 'b-up': belt('b-up', 6, 6, 2) } as never;
    const same = assessBuildTiles(catalog, 'conveyor_belt_mk1', scene as never, { x: 6, y: 6, z: 0 }, 'p1', 0, undefined, undefined, 2)!;
    expect(same.buildable).toBe(false);
    expect(same.blockedTiles).toEqual([expect.objectContaining({ reason: 'building', buildingId: 'b-up' })]);
    const other = assessBuildTiles(catalog, 'conveyor_belt_mk1', scene as never, { x: 6, y: 6, z: 0 }, 'p1', 0, undefined, undefined, 3)!;
    expect(other.buildable).toBe(true);
  });

  it('非传送带 elevation>0 不可放（服务端 INVALID_ELEVATION 的本地同口径）', () => {
    const assessment = assessBuildTiles(catalog, 'wind_turbine', planet() as never, { x: 4, y: 4, z: 0 }, 'p1', 0, undefined, undefined, 2)!;
    expect(assessment.buildable).toBe(false);
    expect(describeBuildBlock(assessment, (id) => id, () => '风机')).toBe('只有传送带可以架高');
  });

  it('地面放非 LowLogistics 建筑时，该格有高架带则不可放（「上方有高架传送带」）', () => {
    const scene = planet();
    scene.buildings = { 'b-high': belt('b-high', 6, 6, 2) } as never;
    const blocked = assessBuildTiles(catalog, 'wind_turbine', scene as never, { x: 6, y: 6, z: 0 }, 'p1')!;
    expect(blocked.buildable).toBe(false);
    expect(blocked.blockedTiles).toEqual([expect.objectContaining({ reason: 'overhead_belt', buildingId: 'b-high' })]);
    expect(describeBuildBlock(blocked, (id) => id, () => '风机')).toBe('上方有高架传送带');
    // LowLogistics 仍可放回地面带/分拣器（不受高架影响）
    const sorterOk = assessBuildTiles(catalog, 'conveyor_belt_mk1', scene as never, { x: 6, y: 6, z: 0 }, 'p1')!;
    expect(sorterOk.buildable).toBe(true);
  });
});
