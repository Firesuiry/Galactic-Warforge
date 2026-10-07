import { describe, expect, it } from 'vitest';

import type { BattleEvent } from '@/engine/battle-events';
import {
  FIRE_FLASH_MS,
  HIT_FLASH_MS,
  PLANET_DAMAGE_FLOAT_MS,
  PLANET_DAMAGE_MERGE_MS,
  PLANET_EFFECT_LIMITS,
  PlanetEffectPool,
  damageFloatText,
  type PlanetDamageFloatEffectSpec,
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
    })!.effect;
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
    const first = pool.spawn({ kind: 'hit_flash', targetId: 'unit-1' })!.effect;
    expect(first.durationMs).toBe(HIT_FLASH_MS);
    pool.advance(HIT_FLASH_MS);
    expect(pool.active()).toHaveLength(0);

    const second = pool.spawn({ kind: 'hit_flash', targetId: 'unit-2' })!.effect;
    expect(second).toBe(first);
    expect(second.id).not.toBe(1);
    expect(second.progress).toBe(0);
    expect(second.spec).toEqual({ kind: 'hit_flash', targetId: 'unit-2' });

    const float = pool.spawn({ kind: 'damage_float', targetId: 'unit-1', x: 0, y: 0, amount: 3, tone: 'enemy_hit' })!.effect;
    expect(float.durationMs).toBe(PLANET_DAMAGE_FLOAT_MS);
    pool.clear();
    expect(pool.active()).toHaveLength(0);
  });
});

function floatSpec(targetId: string, amount: number, tone: 'enemy_hit' | 'own_hit' = 'enemy_hit'): PlanetDamageFloatEffectSpec {
  return { kind: 'damage_float', targetId, x: 0, y: 0, amount, tone };
}

describe('PlanetEffectPool 上限与飘字合并', () => {
  it('fire_flash / hit_flash 超上限丢弃新的（返回 null）', () => {
    const pool = new PlanetEffectPool();
    for (let i = 0; i < PLANET_EFFECT_LIMITS.fire_flash; i += 1) {
      expect(pool.spawn({ kind: 'fire_flash', fromX: 0, fromY: 0, toX: 1, toY: 1, tone: 'unit' })).not.toBeNull();
    }
    expect(pool.spawn({ kind: 'fire_flash', fromX: 0, fromY: 0, toX: 1, toY: 1, tone: 'unit' })).toBeNull();
    expect(PLANET_EFFECT_LIMITS.fire_flash).toBe(64);

    for (let i = 0; i < PLANET_EFFECT_LIMITS.hit_flash; i += 1) {
      expect(pool.spawn({ kind: 'hit_flash', targetId: `u-${i}` })).not.toBeNull();
    }
    expect(pool.spawn({ kind: 'hit_flash', targetId: 'u-x' })).toBeNull();
    expect(PLANET_EFFECT_LIMITS.hit_flash).toBe(32);
    // 各类上限独立计数。
    expect(pool.active()).toHaveLength(64 + 32);
  });

  it('damage_float 超上限顶掉最旧（evicted 返回给场景回收）', () => {
    const pool = new PlanetEffectPool();
    const firsts = [];
    for (let i = 0; i < PLANET_EFFECT_LIMITS.damage_float; i += 1) {
      const result = pool.spawn(floatSpec(`t-${i}`, 1))!;
      expect(result.evicted).toBeUndefined();
      firsts.push({ id: result.effect.id, effect: result.effect });
    }
    expect(PLANET_EFFECT_LIMITS.damage_float).toBe(24);
    const oldestId = firsts[0]!.id;
    const result = pool.spawn(floatSpec('t-new', 5))!;
    expect(result.merged).toBe(false);
    expect(result.evicted?.id).toBe(oldestId);
    expect(result.evicted?.done).toBe(true);
    const floats = pool.active().filter((effect) => effect.spec.kind === 'damage_float');
    expect(floats).toHaveLength(24);
    expect(floats.some((effect) => effect.id === oldestId)).toBe(false);
    expect(floats.at(-1)).toBe(result.effect);
  });

  it('同目标同色调窗口内合并：数值累加、计时归零、不新建', () => {
    const pool = new PlanetEffectPool();
    const first = pool.spawn(floatSpec('enemy-1', 7))!;
    pool.advance(PLANET_DAMAGE_MERGE_MS - 50);
    const second = pool.spawn(floatSpec('enemy-1', 5))!;
    expect(second.merged).toBe(true);
    expect(second.effect).toBe(first.effect);
    expect(second.effect.elapsedMs).toBe(0);
    expect(second.effect.progress).toBe(0);
    expect(damageFloatText(second.effect.spec as PlanetDamageFloatEffectSpec)).toBe('-12');
    expect(pool.active()).toHaveLength(1);
  });

  it('窗口外、不同目标或不同色调不合并', () => {
    const pool = new PlanetEffectPool();
    pool.spawn(floatSpec('enemy-1', 7));
    expect(pool.spawn(floatSpec('enemy-2', 1))!.merged).toBe(false);
    expect(pool.spawn(floatSpec('enemy-1', 1, 'own_hit'))!.merged).toBe(false);
    expect(pool.active()).toHaveLength(3);

    const late = new PlanetEffectPool();
    late.spawn(floatSpec('enemy-1', 7));
    late.advance(PLANET_DAMAGE_MERGE_MS);
    const result = late.spawn(floatSpec('enemy-1', 3))!;
    expect(result.merged).toBe(false);
    expect(late.active()).toHaveLength(2);
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
        targetId: 'enemy-1',
        x: POINTS['enemy-1']!.x,
        y: POINTS['enemy-1']!.y - 10,
        amount: 7,
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
    expect(float).toMatchObject({ targetId: 'unit-2', amount: 3, tone: 'own_hit' });
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
