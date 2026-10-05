import { describe, expect, it } from 'vitest';

import type {
  CatalogView,
  CombatSquad,
  Unit,
  WarBlueprintDetailView,
  WarPublicBlueprintCatalogEntry,
  WorldUnitCatalogEntry,
} from '@shared/types';

import {
  unitCardCountersText,
  unitCardDomainLabel,
  unitCardFromBlueprintDetail,
  unitCardFromPublicBlueprint,
  unitCardFromRuntimeUnit,
  unitCardFromSquad,
  unitCardFromWorldUnit,
} from '@/features/war/unit-card-model';

const damageCoefficients = {
  gun: { light: 1.25, heavy: 0.75, structure: 0.5, air: 1, ship: 0.75 },
  cannon: { light: 0.75, heavy: 1.25, structure: 1.5, air: 0.5, ship: 1 },
  missile: { light: 1, heavy: 0.75, structure: 1.25, air: 1.5, ship: 1.25 },
  laser: { light: 1, heavy: 0.9, structure: 1, air: 1.1, ship: 1.1 },
};

const catalog: CatalogView = {
  techs: [
    {
      id: 'mil-ground-1',
      name: '地面军事 I',
      category: 'military',
      type: 'unlock',
      level: 1,
      icon_key: 'lab',
      color: '#fff',
    },
  ],
  damage_coefficients: damageCoefficients,
  world_units: [
    {
      id: 'soldier',
      name: 'Soldier',
      domain: 'ground',
      runtime_class: 'world_unit',
      public: true,
      production_mode: 'world_produce',
      armor_class: 'light',
      weapon_class: 'gun',
      attack: 15,
      attack_range: 2,
      attack_cooldown_tick: 10,
      move_speed: 0.25,
      max_hp: 100,
    },
  ],
};

function publicBlueprint(overrides: Partial<WarPublicBlueprintCatalogEntry> = {}): WarPublicBlueprintCatalogEntry {
  return {
    id: 'bp-razor',
    name: '剃刀突击机甲',
    domain: 'ground',
    source: 'public',
    runtime_class: 'combat_squad',
    production_mode: 'factory_recipe',
    visible_tech_id: 'mil-ground-1',
    deploy_command: 'deploy_squad',
    armor_class: 'heavy',
    weapon_class: 'cannon',
    attack: 22,
    range: 9,
    max_hp: 80,
    ...overrides,
  };
}

describe('unit-card-model', () => {
  it('运行时单位卡片：数值来自 Unit，缺类别时按 type 补目录', () => {
    const unit = {
      id: 'u-1',
      type: 'soldier',
      owner_id: 'p1',
      position: { x: 1, y: 2, z: 0 },
      hp: 60,
      max_hp: 100,
      attack: 12,
      defense: 4,
      attack_range: 6,
      move_range: 8,
      vision_range: 10,
      move_speed: 0.4,
      attack_cooldown_ticks: 12,
    } as Unit;
    const card = unitCardFromRuntimeUnit(unit, '士兵', catalog);
    expect(card.title).toBe('士兵');
    expect(card.statsSource).toBe('runtime');
    expect(card.stats).toEqual([
      { key: 'hp', label: 'HP', value: '60/100' },
      { key: 'attack', label: '攻击', value: '12' },
      { key: 'defense', label: '防御', value: '4' },
      { key: 'range', label: '射程', value: '6' },
      { key: 'cooldown', label: '冷却', value: '12 tick' },
      { key: 'speed', label: '速度', value: '0.4 tile/tick' },
    ]);
    expect(card.weaponClass).toBe('gun');
    expect(card.armorClass).toBe('light');
    expect(card.countersText).toBe('机枪克制轻甲；被重甲、建筑、舰船克制');

    const typed = unitCardFromRuntimeUnit(
      { ...unit, armor_class: 'heavy', weapon_class: 'cannon' },
      '士兵',
      catalog,
    );
    expect(typed.armorClass).toBe('heavy');
    expect(typed.weaponClass).toBe('cannon');
    expect(typed.countersText).toBe('加农克制重甲、建筑；被轻甲、空中克制');
  });

  it('军团卡片：HP 汇总自成员单位，类别取成员', () => {
    const squad: CombatSquad = {
      id: 'sq-1',
      owner_id: 'p1',
      planet_id: 'planet-1',
      name: '剃刀突击机甲',
      member_ids: ['u-1', 'u-2', 'u-3'],
      order: 'idle',
      state: 'idle',
      position: { x: 5, y: 6, z: 0 },
      last_order_tick: 0,
    };
    const member = (id: string, hp: number) =>
      ({ id, type: 'mecha', hp, max_hp: 100, weapon_class: 'cannon', armor_class: 'heavy' }) as unknown as Unit;
    const card = unitCardFromSquad(squad, [member('u-1', 80), member('u-2', 100)], catalog);
    expect(card.title).toBe('剃刀突击机甲');
    expect(card.subtitle).toBe('sq-1 · 在编 3');
    expect(card.weaponClass).toBe('cannon');
    expect(card.armorClass).toBe('heavy');
    expect(card.stats).toEqual([{ key: 'hp', label: 'HP', value: '180/200' }]);
    expect(card.countersText).toContain('加农克制重甲');
  });

  it('蓝图卡片：目录有数值时 statsSource=catalog，并判定科技门槛', () => {
    const locked = unitCardFromPublicBlueprint(publicBlueprint(), catalog, new Set());
    expect(locked.statsSource).toBe('catalog');
    expect(locked.armorClass).toBe('heavy');
    expect(locked.weaponClass).toBe('cannon');
    expect(locked.stats).toEqual([
      { key: 'hp', label: 'HP', value: '80' },
      { key: 'attack', label: '攻击', value: '22' },
      { key: 'range', label: '射程', value: '9' },
    ]);
    expect(locked.techGate).toEqual({
      techId: 'mil-ground-1',
      techName: '地面军事 I',
      unlocked: false,
    });
    expect(locked.countersText).toBe('加农克制重甲、建筑；被轻甲、空中克制');

    const unlocked = unitCardFromPublicBlueprint(
      publicBlueprint(),
      catalog,
      new Set(['mil-ground-1']),
    );
    expect(unlocked.techGate?.unlocked).toBe(true);

    const bare = unitCardFromPublicBlueprint(
      publicBlueprint({
        armor_class: undefined,
        weapon_class: undefined,
        attack: undefined,
        range: undefined,
        max_hp: undefined,
      }),
      catalog,
      new Set(),
    );
    expect(bare.statsSource).toBe('none');
    expect(bare.stats).toEqual([]);
    expect(bare.countersText).toBe('武器类别未知');
  });

  it('玩家蓝图：科技门槛与战斗字段从公共蓝图按 id/父蓝图回溯', () => {
    const detail = {
      id: 'bp-razor-mk2',
      name: '剃刀 MK2',
      source: 'variant',
      state: 'adopted',
      domain: 'ground',
      parent_blueprint_id: 'bp-razor',
      validation: { valid: true },
    } as WarBlueprintDetailView;
    const catalogWithPublic: CatalogView = {
      ...catalog,
      warfare: { public_blueprints: [publicBlueprint()] },
    };
    const card = unitCardFromBlueprintDetail(detail, catalogWithPublic, new Set(['mil-ground-1']));
    expect(card.techGate?.techId).toBe('mil-ground-1');
    expect(card.techGate?.unlocked).toBe(true);
    expect(card.runtimeClass).toBe('combat_squad');
    expect(card.armorClass).toBe('heavy');
    expect(card.weaponClass).toBe('cannon');
    expect(card.statsSource).toBe('catalog');
    expect(card.stats).toContainEqual({ key: 'attack', label: '攻击', value: '22' });
  });

  it('世界单位卡片：读取目录战斗数值', () => {
    const entry: WorldUnitCatalogEntry = {
      id: 'soldier',
      name: 'Soldier',
      domain: 'ground',
      runtime_class: 'world_unit',
      public: true,
      production_mode: 'world_produce',
      armor_class: 'light',
      weapon_class: 'gun',
      attack: 15,
      attack_range: 2,
      attack_cooldown_tick: 10,
      move_speed: 0.25,
      max_hp: 100,
    };
    const card = unitCardFromWorldUnit(entry, catalog, new Set());
    expect(card.title).toBe('Soldier');
    expect(card.techGate).toBeUndefined();
    expect(card.statsSource).toBe('catalog');
    expect(card.armorClass).toBe('light');
    expect(card.weaponClass).toBe('gun');
    expect(card.stats).toEqual([
      { key: 'hp', label: 'HP', value: '100' },
      { key: 'attack', label: '攻击', value: '15' },
      { key: 'range', label: '射程', value: '2' },
      { key: 'cooldown', label: '冷却', value: '10 tick' },
      { key: 'speed', label: '速度', value: '0.25 tile/tick' },
    ]);
    expect(card.countersText).toBe('机枪克制轻甲；被重甲、建筑、舰船克制');
  });

  it('域标签与克制文案', () => {
    expect(unitCardDomainLabel('ground')).toBe('地面');
    expect(unitCardDomainLabel('space')).toBe('太空');
    expect(unitCardDomainLabel('weird')).toBe('weird');
    expect(unitCardDomainLabel(undefined)).toBe('未知域');
    expect(unitCardCountersText('gun', damageCoefficients)).toBe('机枪克制轻甲；被重甲、建筑、舰船克制');
    expect(unitCardCountersText('laser', damageCoefficients)).toBe('激光克制空中、舰船；被重甲克制');
    expect(unitCardCountersText('missile', undefined)).toBe('克制系数未加载');
    expect(unitCardCountersText(undefined, damageCoefficients)).toBe('武器类别未知');
  });
});
