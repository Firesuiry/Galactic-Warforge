import { describe, expect, it } from 'vitest';

import { describeHover } from '@/features/planet-map/hover-info';
import type { PlanetRenderView } from '@/features/planet-map/model';

function unit(id: string, type: string, owner: string, x: number, y: number, hp = 60, maxHp = 100) {
  return { id, type, owner_id: owner, position: { x, y, z: 0 }, hp, max_hp: maxHp, attack: 1, defense: 1, attack_range: 1, move_range: 1, vision_range: 1 };
}

const planet = {
  planet_id: 'p', map_width: 30, map_height: 20, surface: { topology: 'cube_sphere', face_size: 10 },
  units: {
    a: unit('a', 'soldier', 'p1', 1, 1),
    b: unit('b', 'soldier', 'p2', 2, 2, 100),
    c: unit('c', 'dark_fog', 'dark_fog', 3, 3, 40, 80),
  },
  buildings: {
    h: { id: 'h', type: 'wind_turbine', owner_id: 'p1', position: { x: 5, y: 5, z: 0 }, hp: 300, max_hp: 300 },
  },
  resources: [
    { id: 'r', planet_id: 'p', kind: 'iron_ore', behavior: 'finite', position: { x: 7, y: 7, z: 0 }, remaining: 1200, max_amount: 2000 },
  ],
} as unknown as PlanetRenderView;

const context = (darkFogHostile: boolean) => ({ planet, playerId: 'p1', darkFogHostile });

describe('悬停提示文案', () => {
  it('单位：中文名 + 归属 + 血量', () => {
    expect(describeHover(context(false), { x: 1, y: 1 })).toEqual({ title: '士兵', faction: 'own', ownerLabel: '己方', detail: '血量 60/100' });
    expect(describeHover(context(false), { x: 2, y: 2 })?.ownerLabel).toBe('敌方');
  });

  it('黑雾按敌对状态区分中立/敌对', () => {
    expect(describeHover(context(false), { x: 3, y: 3 })).toMatchObject({ title: '黑雾单位', ownerLabel: '黑雾（中立）', detail: '血量 40/80' });
    expect(describeHover(context(true), { x: 3, y: 3 })).toMatchObject({ faction: 'fog_hostile', ownerLabel: '黑雾（敌对）' });
  });

  it('建筑显示血量，资源显示剩余量，空地为 null', () => {
    expect(describeHover(context(false), { x: 5, y: 5 })).toMatchObject({ ownerLabel: '己方', detail: '血量 300/300' });
    expect(describeHover(context(false), { x: 7, y: 7 })).toEqual({ title: '铁矿', detail: '剩余 1200/2000' });
    expect(describeHover(context(false), { x: 9, y: 9 })).toBeNull();
  });
});

describe('悬停提示：高架带（第 19 轮 §3.5）', () => {
  it('同格有地面建筑与高架带时优先显示高架带，并写高度层', () => {
    const layered = {
      ...planet,
      buildings: {
        ...(planet.buildings as Record<string, unknown>),
        ground: { id: 'ground', type: 'sorter_mk1', owner_id: 'p1', position: { x: 6, y: 6, z: 0 }, hp: 100, max_hp: 100, sorter: {} },
        high: { id: 'high', type: 'conveyor_belt_mk2', owner_id: 'p1', position: { x: 6, y: 6, z: 0 }, hp: 100, max_hp: 100, conveyor: { input: 'west', output: 'east', elevation: 3 } },
      },
    } as unknown as PlanetRenderView;
    const info = describeHover({ planet: layered, playerId: 'p1', darkFogHostile: false }, { x: 6, y: 6 });
    expect(info?.title).toContain('传送带');
    expect(info?.detail).toContain('高度 3 层');
    // 地面层带子不写高度后缀
    const groundOnly = {
      ...planet,
      buildings: {
        belt: { id: 'belt', type: 'conveyor_belt_mk1', owner_id: 'p1', position: { x: 6, y: 6, z: 0 }, hp: 100, max_hp: 100, conveyor: { input: 'west', output: 'east' } },
      },
    } as unknown as PlanetRenderView;
    expect(describeHover({ planet: groundOnly, playerId: 'p1', darkFogHostile: false }, { x: 6, y: 6 })?.detail).toBe('血量 100/100');
  });
});
