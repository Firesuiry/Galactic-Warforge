import { describe, expect, it } from 'vitest';

import {
  BUILDING_SPRITE_TILE_PX,
  FURNACE_GLOW_FRACTION,
  ROTOR_HUB_FRACTION,
  buildingSpriteCacheKey,
  buildingSpriteLayout,
  hasGlowWindow,
  hasRotorBlades,
  resolveBuildingAccent,
  resolveBuildingArchetype,
  resolveBuildingVisualState,
  resolveConveyorBeltDirection,
  windBladesCacheKey,
} from '@/features/planet-map/planet-building-sprites';

describe('原型映射 resolveBuildingArchetype', () => {
  it('电力塔/防御塔/采集立架 → tower', () => {
    for (const type of ['wind_turbine', 'tesla_tower', 'wireless_power_tower', 'laser_turret', 'signal_tower', 'mining_machine', 'vertical_launching_silo']) {
      expect(resolveBuildingArchetype(type)).toBe('tower');
    }
  });

  it('科研/分析 → dome', () => {
    expect(resolveBuildingArchetype('matrix_lab')).toBe('dome');
    expect(resolveBuildingArchetype('battlefield_analysis_base')).toBe('dome');
    expect(resolveBuildingArchetype('ray_receiver')).toBe('dome');
  });

  it('冶炼/组装/化工 → furnace', () => {
    for (const type of ['arc_smelter', 'assembling_machine_mk1', 'recomposing_assembler', 'chemical_plant', 'thermal_power_plant']) {
      expect(resolveBuildingArchetype(type)).toBe('furnace');
    }
  });

  it('仓储/物流站 → depot', () => {
    for (const type of ['depot_mk1', 'planetary_logistics_station', 'interstellar_logistics_station', 'accumulator']) {
      expect(resolveBuildingArchetype(type)).toBe('depot');
    }
  });

  it('传送带/分拣 → belt', () => {
    expect(resolveBuildingArchetype('conveyor_belt_mk1')).toBe('belt');
    expect(resolveBuildingArchetype('sorter_mk2')).toBe('belt');
  });

  it('未列名类型按关键词兜底，完全不认识走 special', () => {
    expect(resolveBuildingArchetype('some_new_lab_x')).toBe('dome');
    expect(resolveBuildingArchetype('ultra_smelter_x')).toBe('furnace');
    expect(resolveBuildingArchetype('solar_panel')).toBe('special');
    expect(resolveBuildingArchetype('')).toBe('special');
  });
});

describe('烘焙参数与缓存键', () => {
  it('缓存键格式 bldg:<archetype>:<w>x<h>:<state>，state 参与键', () => {
    expect(buildingSpriteCacheKey('tower', 1, 1, 'normal')).toBe('bldg:tower:1x1:normal');
    expect(buildingSpriteCacheKey('tower', 1, 1, 'distressed')).toBe('bldg:tower:1x1:distressed');
    expect(buildingSpriteCacheKey('furnace', 2, 3, 'normal')).toBe('bldg:furnace:2x3:normal');
    expect(windBladesCacheKey(1, 1)).toBe('bldg-blades:1x1');
  });

  it('belt 方向纹变体键：方向追加为末段，缺省不带方向段（非 belt 键不变）', () => {
    expect(buildingSpriteCacheKey('belt', 1, 1, 'normal', 'east')).toBe('bldg:belt:1x1:normal:east');
    expect(buildingSpriteCacheKey('belt', 1, 1, 'normal', 'north')).toBe('bldg:belt:1x1:normal:north');
    expect(buildingSpriteCacheKey('belt', 1, 1, 'distressed', 'south')).toBe('bldg:belt:1x1:distressed:south');
    // 四方向键互不相同（烘焙 4 向变体）
    const keys = (['north', 'east', 'south', 'west'] as const).map(
      (direction) => buildingSpriteCacheKey('belt', 1, 1, 'normal', direction),
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('resolveConveyorBeltDirection：取 conveyor.output 实方向，auto/空/缺失回退 east', () => {
    expect(resolveConveyorBeltDirection({ conveyor: { output: 'north' } })).toBe('north');
    expect(resolveConveyorBeltDirection({ conveyor: { output: 'south' } })).toBe('south');
    expect(resolveConveyorBeltDirection({ conveyor: { output: 'west' } })).toBe('west');
    expect(resolveConveyorBeltDirection({ conveyor: { output: 'east' } })).toBe('east');
    expect(resolveConveyorBeltDirection({ conveyor: { output: 'auto' } })).toBe('east');
    expect(resolveConveyorBeltDirection({ conveyor: { output: '' } })).toBe('east');
    expect(resolveConveyorBeltDirection({ conveyor: {} })).toBe('east');
    expect(resolveConveyorBeltDirection({})).toBe('east');
  });

  it('布局：32px/tile 超采样，溢出随 footprint 自适应', () => {
    const one = buildingSpriteLayout(1, 1);
    expect(one.footprintWidth).toBe(BUILDING_SPRITE_TILE_PX);
    expect(one.footprintHeight).toBe(BUILDING_SPRITE_TILE_PX);
    // 水平溢出约 8%+2px，上方结构高度 55%，下方投影余量
    expect(one.padX).toBe(Math.round(32 * 0.08) + 2);
    expect(one.topExtra).toBe(Math.round(32 * 0.55));
    expect(one.canvasWidth).toBe(one.footprintWidth + one.padX * 2);
    expect(one.canvasHeight).toBe(one.footprintHeight + one.topExtra + Math.round(32 * 0.12) + 2);

    const wide = buildingSpriteLayout(3, 2);
    expect(wide.footprintWidth).toBe(3 * BUILDING_SPRITE_TILE_PX);
    expect(wide.padX).toBe(Math.round(96 * 0.08) + 2);
    expect(wide.topExtra).toBe(Math.round(64 * 0.55));
  });

  it('轮毂/发光窗比例锚点在 footprint 内', () => {
    expect(ROTOR_HUB_FRACTION.x).toBeGreaterThan(0);
    expect(ROTOR_HUB_FRACTION.x).toBeLessThan(1);
    expect(ROTOR_HUB_FRACTION.y).toBeGreaterThan(0);
    expect(ROTOR_HUB_FRACTION.y).toBeLessThan(1);
    expect(FURNACE_GLOW_FRACTION.x).toBeGreaterThan(0);
    expect(FURNACE_GLOW_FRACTION.y).toBeLessThan(1);
  });
});

describe('状态与点缀色', () => {
  it('resolveBuildingVisualState：满血正常运行 → normal', () => {
    expect(resolveBuildingVisualState({ hp: 100, max_hp: 100, runtime: { state: 'running' } })).toBe('normal');
  });

  it('resolveBuildingVisualState：受损（hp 未满）或故障（error/no_power）→ distressed', () => {
    expect(resolveBuildingVisualState({ hp: 40, max_hp: 100, runtime: { state: 'running' } })).toBe('distressed');
    expect(resolveBuildingVisualState({ hp: 100, max_hp: 100, runtime: { state: 'error' } })).toBe('distressed');
    expect(resolveBuildingVisualState({ hp: 100, max_hp: 100, runtime: { state: 'no_power' } })).toBe('distressed');
    // paused 是合法停工，不算故障
    expect(resolveBuildingVisualState({ hp: 100, max_hp: 100, runtime: { state: 'paused' } })).toBe('normal');
  });

  it('resolveBuildingAccent：类型级点缀色覆盖原型默认色', () => {
    expect(resolveBuildingAccent('tesla_tower')).toBe(0xffd43b);
    expect(resolveBuildingAccent('wind_turbine')).toBe(0xe8f4ff);
    // 未列名类型回退到原型默认 accent
    expect(resolveBuildingAccent('solar_panel')).toBe(resolveBuildingAccent('unknown_xyz'));
  });

  it('动效挂载判定：只有 wind_turbine 有叶片，只有 furnace 有发光窗', () => {
    expect(hasRotorBlades('wind_turbine')).toBe(true);
    expect(hasRotorBlades('tesla_tower')).toBe(false);
    expect(hasGlowWindow('furnace')).toBe(true);
    expect(hasGlowWindow('tower')).toBe(false);
  });
});
