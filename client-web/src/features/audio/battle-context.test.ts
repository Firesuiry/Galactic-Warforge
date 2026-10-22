import { beforeEach, describe, expect, it } from 'vitest';

import type { BattleEvent } from '@/engine/battle-events';
import {
  battleAttackerId,
  battleOwnInvolvement,
  battleTargetId,
  buildBattleEntityIndex,
  getBattleEntityIndex,
  resolveEntityTile,
  resolveEntityType,
  resetBattleEntityIndexForTests,
  setBattleEntityIndex,
  type BattleEntityRef,
} from '@/features/audio/battle-context';
import type { PlanetRenderView } from '@/features/planet-map/model';

function event(type: string, payload: Record<string, unknown> = {}, extra: Partial<BattleEvent> = {}): BattleEvent {
  return { seq: 1, at: 1000, type, payload, eventId: `e-${type}`, tick: 0, ...extra };
}

function planet(): PlanetRenderView {
  return {
    planet_id: 'p-1',
    buildings: {
      'b-own': { id: 'b-own', type: 'gauss_turret', owner_id: 'p1', hp: 100, position: { x: 12.4, y: 8.6, z: 0 }, runtime: { state: 'running' } },
      'b-enemy': { id: 'b-enemy', type: 'laser_turret', owner_id: 'p2', hp: 100, position: { x: 30, y: 30, z: 0 }, runtime: { state: 'running' } },
    },
    units: {
      'u-own': { id: 'u-own', type: 'soldier', owner_id: 'p1', hp: 100, position: { x: 5, y: 5, z: 0 } },
      'u-fog': { id: 'u-fog', type: 'dark_fog', owner_id: 'dark_fog', hp: 100, position: { x: 40, y: 40, z: 0 } },
    },
  } as unknown as PlanetRenderView;
}

beforeEach(() => {
  resetBattleEntityIndexForTests();
});

describe('buildBattleEntityIndex 实体索引', () => {
  it('建筑与单位都进索引，格坐标取整；没有行星数据时为空', () => {
    const index = buildBattleEntityIndex(planet());
    expect([...index.keys()].sort()).toEqual(['b-enemy', 'b-own', 'u-fog', 'u-own']);
    expect(index.get('b-own')).toEqual({ ownerId: 'p1', type: 'gauss_turret', tile: { x: 12, y: 9 } });
    expect(index.get('u-own')?.tile).toEqual({ x: 5, y: 5 });
    expect(buildBattleEntityIndex(undefined).size).toBe(0);
  });

  it('反查坐标 / 类型；查不到返回 null / undefined', () => {
    const index = buildBattleEntityIndex(planet());
    expect(resolveEntityTile('b-own', index)).toEqual({ x: 12, y: 9 });
    expect(resolveEntityTile('nope', index)).toBeNull();
    expect(resolveEntityTile(undefined, index)).toBeNull();
    expect(resolveEntityType('b-enemy', index)).toBe('laser_turret');
    expect(resolveEntityType('nope', index)).toBeUndefined();
  });

  it('id 提取：attacker_id / target_id / entity_destroyed 的 entity_id', () => {
    expect(battleAttackerId(event('damage_applied', { attacker_id: 'a1' }))).toBe('a1');
    expect(battleAttackerId(event('damage_applied', { attacker_id: 'a1' }, { attackerId: 'a2' }))).toBe('a2');
    expect(battleTargetId(event('damage_applied', { target_id: 't1' }))).toBe('t1');
    expect(battleTargetId(event('entity_destroyed', { entity_id: 'e1' }))).toBe('e1');
    expect(battleTargetId(event('damage_applied', { target_id: 42 }))).toBeUndefined();
  });
});

describe('battleOwnInvolvement 己方参与判定', () => {
  const index = buildBattleEntityIndex(planet());

  it('payload 直接带 owner（舰队战）', () => {
    expect(battleOwnInvolvement(event('damage_applied', { attacker_owner: 'p1', target_owner: 'p2' }), 'p1', index)).toBe(true);
    expect(battleOwnInvolvement(event('damage_applied', { attacker_owner: 'p2', target_owner: 'p3' }), 'p1', index)).toBe(false);
  });

  it('行星战斗事件无 owner 字段：按攻击方 / 目标实体归属反查', () => {
    expect(battleOwnInvolvement(event('damage_applied', { attacker_id: 'b-own', target_id: 'u-fog' }), 'p1', index)).toBe(true);
    expect(battleOwnInvolvement(event('damage_applied', { attacker_id: 'b-enemy', target_id: 'u-own' }), 'p1', index)).toBe(true);
    expect(battleOwnInvolvement(event('damage_applied', { attacker_id: 'b-enemy', target_id: 'u-fog' }), 'p1', index)).toBe(false);
  });

  it('都查不到时按事件类型语义：己方舰队齐射 / 战报算参与，敌方齐射不算', () => {
    expect(battleOwnInvolvement(event('missile_salvo_fired', { source: 'fleet' }), 'p1', index)).toBe(true);
    expect(battleOwnInvolvement(event('missile_salvo_fired', { source: 'enemy_force' }), 'p1', index)).toBe(false);
    expect(battleOwnInvolvement(event('battle_report_generated', {}), 'p1', index)).toBe(true);
    expect(battleOwnInvolvement(event('point_defense_intercept', {}), 'p1', index)).toBe(false);
  });

  it('没有玩家 id 时一律不算', () => {
    expect(battleOwnInvolvement(event('battle_report_generated', {}), '', index)).toBe(false);
  });
});

describe('当前行星索引（模块级单例）', () => {
  it('set 之后 get 返回同一份；null 清空', () => {
    const index = new Map<string, BattleEntityRef>([['x', { ownerId: 'p1', type: 't', tile: { x: 1, y: 2 } }]]);
    setBattleEntityIndex(index);
    expect(getBattleEntityIndex().get('x')?.tile).toEqual({ x: 1, y: 2 });
    setBattleEntityIndex(null);
    expect(getBattleEntityIndex().size).toBe(0);
  });
});
