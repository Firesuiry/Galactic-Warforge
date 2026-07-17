import { describe, expect, it } from 'vitest';

import type { BattleEvent } from '@/engine/battle-events';
import {
  BattleEffectPool,
  DAMAGE_FLOAT_MS,
  EXPLOSION_BIG_MS,
  EXPLOSION_MS,
  INTERCEPT_FLASH_MS,
  MISSILE_FLIGHT_MS,
  specsFromBattleEvent,
  type BattleEffectContext,
} from '@/features/war/battlefield/battlefield-effects';

function battleEvent(type: string, payload: Record<string, unknown>): BattleEvent {
  return { seq: 1, at: 0, type, payload, eventId: 'evt-1', tick: 321 };
}

const context: BattleEffectContext = {
  resolve(entityId) {
    const table: Record<string, { x: number; y: number }> = {
      'fleet-1': { x: 100, y: 100 },
      'enemy-fleet-3': { x: 300, y: 200 },
    };
    return entityId ? table[entityId] ?? null : null;
  },
  nearestHostile: () => ({ x: 320, y: 220 }),
};

describe('BattleEffectPool 生命周期', () => {
  it('spawn 分配自增 id 与默认时长，advance 推进进度并按时完成', () => {
    const pool = new BattleEffectPool();
    const effect = pool.spawn({ kind: 'missile', fromX: 0, fromY: 0, toX: 10, toY: 0 });
    expect(effect.id).toBe(1);
    expect(effect.durationMs).toBe(MISSILE_FLIGHT_MS);
    expect(pool.active()).toHaveLength(1);

    let completed = pool.advance(MISSILE_FLIGHT_MS / 2);
    expect(completed).toHaveLength(0);
    expect(effect.progress).toBeCloseTo(0.5, 6);
    expect(effect.done).toBe(false);
    expect(pool.active()).toHaveLength(1);

    completed = pool.advance(MISSILE_FLIGHT_MS / 2);
    expect(completed).toEqual([effect]);
    expect(effect.progress).toBe(1);
    expect(effect.done).toBe(true);
    expect(pool.active()).toHaveLength(0);
  });

  it('完成的槽位被后续 spawn 复用（id 不复用）', () => {
    const pool = new BattleEffectPool();
    const first = pool.spawn({ kind: 'intercept_flash', x: 0, y: 0 });
    pool.advance(INTERCEPT_FLASH_MS);
    expect(pool.active()).toHaveLength(0);

    const second = pool.spawn({ kind: 'intercept_flash', x: 1, y: 1 });
    expect(second).toBe(first); // 槽位对象复用
    expect(second.id).not.toBe(1);
    expect(second.progress).toBe(0);
    expect(second.done).toBe(false);
    expect(second.spec).toEqual({ kind: 'intercept_flash', x: 1, y: 1 });
  });

  it('不同特效默认时长分档：大爆炸最久，拦截闪光最短', () => {
    const pool = new BattleEffectPool();
    const flash = pool.spawn({ kind: 'intercept_flash', x: 0, y: 0 });
    const boom = pool.spawn({ kind: 'explosion', x: 0, y: 0 });
    const bigBoom = pool.spawn({ kind: 'explosion', x: 0, y: 0, big: true });
    const text = pool.spawn({ kind: 'damage_float', x: 0, y: 0, text: '-3' });
    expect(flash.durationMs).toBe(INTERCEPT_FLASH_MS);
    expect(boom.durationMs).toBe(EXPLOSION_MS);
    expect(bigBoom.durationMs).toBe(EXPLOSION_BIG_MS);
    expect(text.durationMs).toBe(DAMAGE_FLOAT_MS);
    expect(EXPLOSION_BIG_MS).toBeGreaterThan(EXPLOSION_MS);

    // clear 后无存活特效
    pool.clear();
    expect(pool.active()).toHaveLength(0);
  });
});

describe('specsFromBattleEvent 事件映射', () => {
  it('missile_salvo_fired（己方齐射）：舰队 → 目标一道导弹', () => {
    const specs = specsFromBattleEvent(
      battleEvent('missile_salvo_fired', { fleet_id: 'fleet-1', target_id: 'enemy-fleet-3', launched: 4 }),
      context,
    );
    expect(specs).toEqual([
      { kind: 'missile', fromX: 100, fromY: 100, toX: 300, toY: 200 },
    ]);
  });

  it('missile_salvo_fired（敌方齐射）：从最近敌点射向被打舰队', () => {
    const specs = specsFromBattleEvent(
      battleEvent('missile_salvo_fired', {
        fleet_id: 'fleet-1',
        target_id: 'fleet-1',
        source: 'enemy_force',
        launched: 2,
      }),
      context,
    );
    expect(specs).toEqual([
      { kind: 'missile', fromX: 320, fromY: 220, toX: 100, toY: 100 },
    ]);
  });

  it('missile_salvo_fired：标记不在图上时不演出', () => {
    expect(specsFromBattleEvent(
      battleEvent('missile_salvo_fired', { fleet_id: 'ghost', target_id: 'enemy-fleet-3' }),
      context,
    )).toEqual([]);
    expect(specsFromBattleEvent(
      battleEvent('missile_salvo_fired', { fleet_id: 'fleet-1', target_id: 'ghost' }),
      context,
    )).toEqual([]);
  });

  it('point_defense_intercept：拦截闪光落在被保护目标处，fleet_id 兜底', () => {
    expect(specsFromBattleEvent(
      battleEvent('point_defense_intercept', { fleet_id: 'fleet-1', target_id: 'enemy-fleet-3', intercepted: 2 }),
      context,
    )).toEqual([{ kind: 'intercept_flash', x: 300, y: 200 }]);

    expect(specsFromBattleEvent(
      battleEvent('point_defense_intercept', { fleet_id: 'fleet-1', target_id: 'ghost', intercepted: 1 }),
      context,
    )).toEqual([{ kind: 'intercept_flash', x: 100, y: 100 }]);
  });

  it('battle_report_generated：爆炸 + 伤害飘字；target_destroyed 升级为大爆炸', () => {
    const specs = specsFromBattleEvent(
      battleEvent('battle_report_generated', {
        battle_id: 'battle-1',
        fleet_id: 'fleet-1',
        report: { target_id: 'enemy-fleet-3', target_strength_loss: 9, target_destroyed: false },
      }),
      context,
    );
    expect(specs).toEqual([
      { kind: 'explosion', x: 300, y: 200, big: false },
      { kind: 'damage_float', x: 300, y: 188, text: '-9' },
    ]);

    const destroyed = specsFromBattleEvent(
      battleEvent('battle_report_generated', {
        battle_id: 'battle-2',
        fleet_id: 'fleet-1',
        report: { target_id: 'enemy-fleet-3', target_strength_loss: 12, target_destroyed: true },
      }),
      context,
    );
    expect(destroyed[0]).toEqual({ kind: 'explosion', x: 300, y: 200, big: true });
  });

  it('battle_report_generated：无 report 或目标不在图上时不演出', () => {
    expect(specsFromBattleEvent(battleEvent('battle_report_generated', { battle_id: 'b' }), context)).toEqual([]);
    expect(specsFromBattleEvent(
      battleEvent('battle_report_generated', { report: { target_id: 'ghost', target_strength_loss: 3 } }),
      context,
    )).toEqual([]);
  });

  it('damage_applied / entity_destroyed 不映射视觉特效（避免与战报演出重复）', () => {
    expect(specsFromBattleEvent(
      battleEvent('damage_applied', { attacker_id: 'fleet-1', target_id: 'enemy-fleet-3', damage: 2 }),
      context,
    )).toEqual([]);
    expect(specsFromBattleEvent(
      battleEvent('entity_destroyed', { entity_id: 'enemy-fleet-3', killed_by: 'fleet-1' }),
      context,
    )).toEqual([]);
  });
});
