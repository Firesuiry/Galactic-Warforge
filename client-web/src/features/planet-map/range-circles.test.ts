import { describe, expect, it } from 'vitest';

import type { Building, BuildingFunctionModules, CatalogView } from '@shared/types';

import {
  RANGE_CIRCLE_COLORS,
  resolveGhostRangeCircles,
  resolveSelectedCombatRange,
} from '@/features/planet-map/range-circles';

// 射程判定从 2D planet-scene 抽出（第 20 轮 R20-B）：2D 与 3D 共用同一套纯函数。
describe('范围圈纯函数', () => {
  const catalog = {
    buildings: [
      { id: 'gauss_turret', combat_range: 5 },
      { id: 'tesla_tower', power_range: 4 },
      { id: 'jammer_tower', combat_range: 8 },
      { id: 'wind_turbine' },
    ],
  } as unknown as CatalogView;

  const makeBuilding = (functions?: BuildingFunctionModules): Building => ({
    id: 'b-1',
    type: 'gauss_turret',
    owner_id: 'p-1',
    position: { x: 3, y: 3, z: 0 },
    hp: 100,
    max_hp: 100,
    level: 1,
    vision_range: 6,
    runtime: {
      params: {
        energy_consume: 3,
        energy_generate: 0,
        capacity: 0,
        footprint: { width: 1, height: 1 },
      },
      functions,
      state: 'running',
    },
  });

  it('resolveGhostRangeCircles：combat_range/power_range 各出一圈，无范围字段不画', () => {
    expect(resolveGhostRangeCircles(catalog, 'gauss_turret')).toEqual([{ kind: 'combat', radiusTiles: 5 }]);
    expect(resolveGhostRangeCircles(catalog, 'tesla_tower')).toEqual([{ kind: 'power', radiusTiles: 4 }]);
    expect(resolveGhostRangeCircles(catalog, 'wind_turbine')).toEqual([]);
    expect(resolveGhostRangeCircles(catalog, 'unknown_type')).toEqual([]);
    expect(resolveGhostRangeCircles(catalog, undefined)).toEqual([]);
    expect(resolveGhostRangeCircles(undefined, 'gauss_turret')).toEqual([]);
  });

  it('resolveGhostRangeCircles：同一建筑同时带两种范围时两圈都出（攻击 + 供电）', () => {
    const both = {
      buildings: [{ id: 'hybrid', combat_range: 6, power_range: 3 }],
    } as unknown as CatalogView;
    expect(resolveGhostRangeCircles(both, 'hybrid')).toEqual([
      { kind: 'combat', radiusTiles: 6 },
      { kind: 'power', radiusTiles: 3 },
    ]);
  });

  it('resolveGhostRangeCircles：零/负半径防御性忽略', () => {
    const zeroCatalog = {
      buildings: [{ id: 'broken', combat_range: 0, power_range: -1 }],
    } as unknown as CatalogView;
    expect(resolveGhostRangeCircles(zeroCatalog, 'broken')).toEqual([]);
  });

  it('resolveSelectedCombatRange：已放置防御建筑读 runtime.functions.combat.range', () => {
    expect(resolveSelectedCombatRange(makeBuilding({ combat: { attack: 15, range: 5 } }))).toBe(5);
    expect(resolveSelectedCombatRange(makeBuilding({ power_grid: { wireless_range: 4 } }))).toBeUndefined();
    expect(resolveSelectedCombatRange(makeBuilding(undefined))).toBeUndefined();
    expect(resolveSelectedCombatRange(makeBuilding({ combat: { attack: 0, range: 0 } }))).toBeUndefined();
    expect(resolveSelectedCombatRange(null)).toBeUndefined();
    expect(resolveSelectedCombatRange(undefined)).toBeUndefined();
  });

  it('选中非防御建筑（只有采集/生产功能）不出圈', () => {
    const miner = makeBuilding({ collect: { resource_kind: 'iron_ore', speed: 1 } } as unknown as BuildingFunctionModules);
    expect(resolveSelectedCombatRange(miner)).toBeUndefined();
    const smelter = makeBuilding({ produce: { recipes: ['iron_ingot'] } } as unknown as BuildingFunctionModules);
    expect(resolveSelectedCombatRange(smelter)).toBeUndefined();
  });

  it('配色：攻击射程暖红、供电覆盖青色（2D/3D 同口径）', () => {
    expect(RANGE_CIRCLE_COLORS.combat).toBe('#ff7a59');
    expect(RANGE_CIRCLE_COLORS.power).toBe('#5fd4e8');
  });
});
