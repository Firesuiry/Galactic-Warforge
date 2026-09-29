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
    ...overrides,
  };
}

describe('unit-card-model', () => {
  it('运行时单位卡片：数值全部来自 Unit 字段', () => {
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
    const card = unitCardFromRuntimeUnit(unit, '士兵');
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
    expect(card.weaponClass).toBeUndefined();
    expect(card.armorClass).toBeUndefined();
    expect(card.countersText).toContain('系数表待服务端');
  });

  it('小队卡片：武器类别来自 weapon.type，护盾/在编数入卡', () => {
    const squad = {
      id: 'sq-1',
      owner_id: 'p1',
      planet_id: 'planet-1',
      blueprint_id: 'bp-razor',
      count: 3,
      hp: 240,
      max_hp: 300,
      shield: { level: 40, max_level: 60, recharge_rate: 1, recharge_delay: 10 },
      weapon: { type: 'cannon', damage: 22, fire_rate: 14, range: 9, ammo_cost: 1 },
      sustainment: {},
      state: 'idle',
      position: { x: 5, y: 6, z: 0 },
      move_speed: 0.2,
    } as unknown as CombatSquad;
    const card = unitCardFromSquad(squad, '剃刀突击机甲', 'ground');
    expect(card.title).toBe('剃刀突击机甲');
    expect(card.subtitle).toBe('sq-1 · 在编 3');
    expect(card.weaponClass).toBe('cannon');
    expect(card.stats).toContainEqual({ key: 'hp', label: 'HP', value: '240/300' });
    expect(card.stats).toContainEqual({ key: 'shield', label: '护盾', value: '40/60' });
    expect(card.stats).toContainEqual({ key: 'cooldown', label: '冷却', value: '14 tick' });
  });

  it('蓝图卡片：目录不暴露战斗数值 → statsSource none + 科技门槛判定', () => {
    const locked = unitCardFromPublicBlueprint(publicBlueprint(), catalog, new Set());
    expect(locked.statsSource).toBe('none');
    expect(locked.stats).toEqual([]);
    expect(locked.techGate).toEqual({
      techId: 'mil-ground-1',
      techName: '地面军事 I',
      unlocked: false,
    });

    const unlocked = unitCardFromPublicBlueprint(
      publicBlueprint(),
      catalog,
      new Set(['mil-ground-1']),
    );
    expect(unlocked.techGate?.unlocked).toBe(true);
  });

  it('玩家蓝图：科技门槛从公共蓝图按 id/父蓝图回溯', () => {
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
  });

  it('世界单位卡片：无可见科技时不出门槛行', () => {
    const entry: WorldUnitCatalogEntry = {
      id: 'soldier',
      name: 'Soldier',
      domain: 'ground',
      runtime_class: 'world_unit',
      public: true,
      production_mode: 'world_produce',
    };
    const card = unitCardFromWorldUnit(entry, catalog, new Set());
    expect(card.title).toBe('Soldier');
    expect(card.techGate).toBeUndefined();
    expect(card.statsSource).toBe('none');
  });

  it('域标签与克制文案', () => {
    expect(unitCardDomainLabel('ground')).toBe('地面');
    expect(unitCardDomainLabel('space')).toBe('太空');
    expect(unitCardDomainLabel('weird')).toBe('weird');
    expect(unitCardDomainLabel(undefined)).toBe('未知域');
    expect(unitCardCountersText('air')).toContain('空中');
    expect(unitCardCountersText(undefined)).toContain('服务端');
  });
});
