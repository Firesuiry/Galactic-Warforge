import { describe, expect, it } from 'vitest';

import type { PlanetRenderView, ViewportTileBounds } from '@/features/planet-map/model';
import {
  commandableUnitIds,
  isDarkFogUnit,
  orderEligibleUnitIds,
  ownUnitsInTileRect,
  pruneControlGroup,
  resolveContextCommand,
  sameTypeOwnUnitsInView,
  summarizeUnitSelection,
} from '@/features/planet-map/rts-commands';

function makeUnit(id: string, type: string, ownerId: string, x: number, y: number, mecha = false) {
  return {
    id,
    type,
    owner_id: ownerId,
    position: { x, y, z: 0 },
    hp: 100,
    max_hp: 100,
    attack: 5,
    defense: 2,
    attack_range: 1,
    move_range: 4,
    vision_range: 5,
    ...(mecha ? { mecha: { energy: 50, max_energy: 100 } } : {}),
  } as never;
}

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: [],
    buildings: {},
    units: {
      'u-1': makeUnit('u-1', 'executor', 'p1', 1, 1, true),
      'u-2': makeUnit('u-2', 'soldier', 'p1', 2, 2),
      'u-3': makeUnit('u-3', 'soldier', 'p1', 4, 4),
      'u-4': makeUnit('u-4', 'worker', 'p1', 5, 5),
      'u-9': makeUnit('u-9', 'soldier', 'p2', 3, 3),
      'df-1': makeUnit('df-1', 'dark_fog', 'dark_fog', 6, 6),
    },
    resources: [],
  } as PlanetRenderView;
}

describe('rts-commands 选择器推导', () => {
  it('commandableUnitIds：过滤非己方与已阵亡单位', () => {
    const planet = makePlanet();
    expect(commandableUnitIds(planet, ['u-1', 'u-9', 'gone'], 'p1')).toEqual(['u-1']);
    expect(commandableUnitIds(planet, ['u-2', 'u-3'], 'p1')).toEqual(['u-2', 'u-3']);
  });

  it('orderEligibleUnitIds：执行体（mecha）不受理 unit_order', () => {
    const planet = makePlanet();
    expect(orderEligibleUnitIds(planet, ['u-1', 'u-2', 'u-3'], 'p1')).toEqual(['u-2', 'u-3']);
  });

  it('isDarkFogUnit：owner 或 type 命中 dark_fog 均判定为黑雾', () => {
    expect(isDarkFogUnit({ owner_id: 'dark_fog', type: 'worker' })).toBe(true);
    expect(isDarkFogUnit({ owner_id: 'p1', type: 'dark_fog' as never })).toBe(true);
    expect(isDarkFogUnit({ owner_id: 'p2', type: 'soldier' })).toBe(false);
  });
});

describe('rts-commands 框选与双击同类', () => {
  it('ownUnitsInTileRect：矩形内只选己方单位', () => {
    const planet = makePlanet();
    expect(ownUnitsInTileRect(planet, 'p1', { minX: 0, minY: 0, maxX: 3, maxY: 3 })).toEqual(['u-1', 'u-2']);
    expect(ownUnitsInTileRect(planet, 'p1', { minX: 0, minY: 0, maxX: 24, maxY: 16 })).toEqual(['u-1', 'u-2', 'u-3', 'u-4']);
    expect(ownUnitsInTileRect(planet, 'p1', { minX: 10, minY: 10, maxX: 12, maxY: 12 })).toEqual([]);
  });

  it('sameTypeOwnUnitsInView：视口内同类己方单位', () => {
    const planet = makePlanet();
    const bounds: ViewportTileBounds = { minX: 0, minY: 0, maxX: 3, maxY: 3, centerX: 1, centerY: 1 };
    expect(sameTypeOwnUnitsInView(planet, 'p1', 'u-2', bounds)).toEqual(['u-2']);
    expect(sameTypeOwnUnitsInView(planet, 'p1', 'u-2', null)).toEqual(['u-2', 'u-3']);
    // 敌方单位不锚定
    expect(sameTypeOwnUnitsInView(planet, 'p1', 'u-9', null)).toEqual([]);
  });
});

describe('rts-commands 右键情境指令', () => {
  it('点敌=攻击（敌军势力优先于非己方单位）', () => {
    const planet = makePlanet();
    const runtime = {
      enemy_forces: [{ id: 'ef-1', type: 'dark_fog_nest', position: { x: 3, y: 3, z: 0 } }],
    } as never;
    expect(resolveContextCommand(planet, runtime, 'p1', { x: 3, y: 3 })).toEqual({
      type: 'attack',
      targetId: 'ef-1',
      targetLabel: 'dark_fog_nest',
    });
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 3, y: 3 })).toEqual({
      type: 'attack',
      targetId: 'u-9',
      targetLabel: 'soldier',
    });
    // 黑雾单位同样是可攻击目标
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 6, y: 6 })).toEqual({
      type: 'attack',
      targetId: 'df-1',
      targetLabel: 'dark_fog',
    });
  });

  it('点地=移动；点己方单位=移动（不攻击自己人）', () => {
    const planet = makePlanet();
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 8, y: 8 })).toEqual({
      type: 'move',
      position: { x: 8, y: 8, z: 0 },
    });
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 2, y: 2 })).toEqual({
      type: 'move',
      position: { x: 2, y: 2, z: 0 },
    });
  });

  it('右键敌方建筑=攻击（含 2x2 占地的非原点格）；己方建筑仍是移动', () => {
    const planet = makePlanet();
    planet.buildings = {
      'b-enemy': {
        id: 'b-enemy',
        type: 'barracks',
        owner_id: 'p2',
        position: { x: 10, y: 10, z: 0 },
        hp: 200,
        max_hp: 200,
        runtime: { params: { footprint: { width: 2, height: 2 } } },
      } as never,
      'b-own': {
        id: 'b-own',
        type: 'barracks',
        owner_id: 'p1',
        position: { x: 14, y: 14, z: 0 },
        hp: 200,
        max_hp: 200,
      } as never,
    };
    // 敌方建筑：按占地包含判定，非原点格也算命中
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 10, y: 10 })).toEqual({
      type: 'attack',
      targetId: 'b-enemy',
      targetLabel: 'barracks',
    });
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 11, y: 11 })).toMatchObject({
      type: 'attack',
      targetId: 'b-enemy',
    });
    // 己方建筑：仍是移动（不攻击自己人）
    expect(resolveContextCommand(planet, undefined, 'p1', { x: 14, y: 14 })).toMatchObject({ type: 'move' });
  });
});

describe('rts-commands 多选构成与编队', () => {
  it('summarizeUnitSelection：按类型聚合计数，忽略已阵亡', () => {
    const planet = makePlanet();
    expect(summarizeUnitSelection(planet, ['u-1', 'u-2', 'u-3', 'gone'])).toEqual([
      { type: 'soldier', count: 2 },
      { type: 'executor', count: 1 },
    ]);
  });

  it('pruneControlGroup：读取编队时过滤阵亡/非己方成员', () => {
    const planet = makePlanet();
    expect(pruneControlGroup(planet, 'p1', ['u-1', 'u-9', 'gone', 'u-2'])).toEqual(['u-1', 'u-2']);
  });
});

describe('黑雾阵营判定', () => {
  it('黑雾按 dark_fog.hostile 区分中立/敌对，其余按属主', async () => {
    const { unitFaction, FACTION_LABEL, FACTION_COLOR } = await import('@/features/planet-map/rts-commands');
    expect(unitFaction({ owner_id: 'dark_fog', type: 'soldier' }, 'p1', false)).toBe('fog_neutral');
    expect(unitFaction({ owner_id: 'x', type: 'dark_fog' }, 'p1', true)).toBe('fog_hostile');
    expect(unitFaction({ owner_id: 'p1', type: 'soldier' }, 'p1', true)).toBe('own');
    expect(unitFaction({ owner_id: 'p2', type: 'soldier' }, 'p1', true)).toBe('enemy');
    expect(FACTION_LABEL.fog_neutral).toBe('黑雾（中立）');
    expect(FACTION_COLOR.fog_hostile).not.toBe(FACTION_COLOR.fog_neutral);
  });
});
