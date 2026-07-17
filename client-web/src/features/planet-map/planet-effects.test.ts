import { describe, expect, it } from 'vitest';

import type { BattleEvent } from '@/engine/battle-events';
import {
  FIRE_FLASH_MS,
  HIT_FLASH_MS,
  PLANET_DAMAGE_FLOAT_MS,
  PlanetEffectPool,
  specsFromPlanetBattleEvent,
  type PlanetEffectContext,
  type PlanetEffectPoint,
} from '@/features/planet-map/planet-effects';

function battleEvent(type: string, payload: Record<string, unknown>): BattleEvent {
  return { seq: 1, at: 0, type, payload, eventId: 'evt-1', tick: 321 };
}

const POINTS: Record<string, PlanetEffectPoint> = {
  'unit-1': { x: 18, y: 30, owner: 'own', kind: 'unit' },
  'unit-2': { x: 60, y: 66, owner: 'own', kind: 'unit' },
  'turret-1': { x: 42, y: 42, owner: 'own', kind: 'building' },
  'enemy-1': { x: 90, y: 90, owner: 'enemy', kind: 'unit' },
};

const context: PlanetEffectContext = {
  resolve(entityId) {
    return entityId ? POINTS[entityId] ?? null : null;
  },
};

describe('PlanetEffectPool 生命周期', () => {
  it('spawn 分配自增 id 与默认时长，advance 推进进度并按时完成', () => {
    const pool = new PlanetEffectPool();
    const effect = pool.spawn({
      kind: 'fire_flash',
      fromX: 0,
      fromY: 0,
      toX: 10,
      toY: 0,
      tone: 'unit',
    });
    expect(effect.id).toBe(1);
    expect(effect.durationMs).toBe(FIRE_FLASH_MS);
    expect(pool.active()).toHaveLength(1);

    let completed = pool.advance(FIRE_FLASH_MS / 2);
    expect(completed).toHaveLength(0);
    expect(effect.progress).toBeCloseTo(0.5, 6);
    expect(effect.done).toBe(false);

    completed = pool.advance(FIRE_FLASH_MS / 2);
    expect(completed).toEqual([effect]);
    expect(effect.progress).toBe(1);
    expect(effect.done).toBe(true);
    expect(pool.active()).toHaveLength(0);
  });

  it('完成的槽位被后续 spawn 复用（id 不复用）；clear 清空存活特效', () => {
    const pool = new PlanetEffectPool();
    const first = pool.spawn({ kind: 'hit_flash', targetId: 'unit-1' });
    expect(first.durationMs).toBe(HIT_FLASH_MS);
    pool.advance(HIT_FLASH_MS);
    expect(pool.active()).toHaveLength(0);

    const second = pool.spawn({ kind: 'hit_flash', targetId: 'unit-2' });
    expect(second).toBe(first);
    expect(second.id).not.toBe(1);
    expect(second.progress).toBe(0);
    expect(second.spec).toEqual({ kind: 'hit_flash', targetId: 'unit-2' });

    const float = pool.spawn({ kind: 'damage_float', x: 0, y: 0, text: '-3', tone: 'enemy_hit' });
    expect(float.durationMs).toBe(PLANET_DAMAGE_FLOAT_MS);
    pool.clear();
    expect(pool.active()).toHaveLength(0);
  });
});

describe('specsFromPlanetBattleEvent（damage_applied → 行星特效）', () => {
  it('非 damage_applied 事件不映射', () => {
    expect(specsFromPlanetBattleEvent(
      battleEvent('entity_destroyed', { target_id: 'unit-1' }),
      context,
    )).toEqual([]);
  });

  it('目标解析不到（不在场景实体树）时丢弃不演出', () => {
    expect(specsFromPlanetBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'unit-1', target_id: 'ghost-9', damage: 5 }),
      context,
    )).toEqual([]);
  });

  it('普通单位攻击敌方：青白开火闪光 + 红色飘字 + 受击闪白', () => {
    const specs = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', {
        attacker_id: 'unit-1',
        target_id: 'enemy-1',
        damage: 7,
        target_hp: 13,
      }),
      context,
    );
    expect(specs).toEqual([
      {
        kind: 'fire_flash',
        fromX: POINTS['unit-1']!.x,
        fromY: POINTS['unit-1']!.y,
        toX: POINTS['enemy-1']!.x,
        toY: POINTS['enemy-1']!.y,
        tone: 'unit',
      },
      {
        kind: 'damage_float',
        x: POINTS['enemy-1']!.x,
        y: POINTS['enemy-1']!.y - 10,
        text: '-7',
        tone: 'enemy_hit',
      },
      { kind: 'hit_flash', targetId: 'enemy-1' },
    ]);
  });

  it('己方受击：飘字走橙色系', () => {
    const specs = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'enemy-1', target_id: 'unit-2', damage: 3 }),
      context,
    );
    const float = specs.find((spec) => spec.kind === 'damage_float');
    expect(float).toMatchObject({ text: '-3', tone: 'own_hit' });
  });

  it('防御塔攻击（建筑节点 attacker）：黄白岔开配色', () => {
    const specs = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'turret-1', target_id: 'enemy-1', damage: 4 }),
      context,
    );
    const fire = specs.find((spec) => spec.kind === 'fire_flash');
    expect(fire).toMatchObject({ tone: 'defense' });
  });

  it('显式 attacker_type=turret 时即便解析为单位节点也用防御塔配色', () => {
    const specs = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', {
        attacker_id: 'unit-1',
        attacker_type: 'turret',
        target_id: 'enemy-1',
        damage: 4,
      }),
      context,
    );
    const fire = specs.find((spec) => spec.kind === 'fire_flash');
    expect(fire).toMatchObject({ tone: 'defense' });
  });

  it('attacker 解析不到时省略开火闪光，其余演出不受影响', () => {
    const specs = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'ghost-1', target_id: 'unit-1', damage: 2 }),
      context,
    );
    expect(specs.map((spec) => spec.kind)).toEqual(['damage_float', 'hit_flash']);
  });

  it('damage 缺失或 <=0 时省略飘字', () => {
    const noDamage = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'unit-1', target_id: 'enemy-1' }),
      context,
    );
    expect(noDamage.map((spec) => spec.kind)).toEqual(['fire_flash', 'hit_flash']);

    const zeroDamage = specsFromPlanetBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'unit-1', target_id: 'enemy-1', damage: 0 }),
      context,
    );
    expect(zeroDamage.find((spec) => spec.kind === 'damage_float')).toBeUndefined();
  });
});
