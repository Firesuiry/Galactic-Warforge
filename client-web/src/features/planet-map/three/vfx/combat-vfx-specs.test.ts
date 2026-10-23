import { describe, expect, it } from 'vitest';

import type { BattleEvent } from '@/engine/battle-events';
import { combatVfxFromEvent, type CombatPointLike } from './combat-vfx-specs';
import { COMBAT_VFX_LIMITS, TRACER_WIDTH_TILES } from './combat-vfx';

const own: CombatPointLike = { x: 0, y: 0, z: 100, owner: 'own', kind: 'unit' };
const enemyUnit: CombatPointLike = { x: 1, y: 0, z: 100, owner: 'enemy', kind: 'unit' };
const enemyBuilding: CombatPointLike = { x: 1, y: 1, z: 100, owner: 'enemy', kind: 'building' };
const resolve = (map: Record<string, CombatPointLike>) => (id: string | undefined | null) => (id ? map[id] ?? null : null);

function event(type: string, payload: Record<string, unknown>, seq = 1): BattleEvent {
  return { seq, at: 0, type, payload, eventId: `e-${seq}`, tick: 1 };
}

const destroy = (target: string, seq = 1) => event('entity_destroyed', { entity_id: target }, seq);
const hit = (attacker: string, target: string, seq = 1) => event('damage_applied', { attacker_id: attacker, target_id: target, damage: 5 }, seq);

describe('爆炸演出规格（步骤 14–15）', () => {
  it('冲击波半径按规模：小爆炸 1.5 格、大爆炸 3 格，寿命 0.35s', () => {
    const small = combatVfxFromEvent(destroy('u'), resolve({ u: enemyUnit }));
    const big = combatVfxFromEvent(destroy('b'), resolve({ b: enemyBuilding }));
    expect(small.shockwaves).toHaveLength(1);
    expect(small.shockwaves[0].size).toBe(1.5);
    expect(small.shockwaves[0].life).toBeCloseTo(0.35, 6);
    expect(big.shockwaves[0].size).toBe(3);
    expect(big.shockwaves[0].life).toBeCloseTo(0.35, 6);
  });

  it('碎片 6–12 片，暗色（走碎块池而不是发光粒子）', () => {
    for (const target of [enemyUnit, enemyBuilding]) {
      const specs = combatVfxFromEvent(destroy('t'), resolve({ t: target }));
      expect(specs.debris).toHaveLength(1);
      expect(specs.debris[0].count).toBeGreaterThanOrEqual(6);
      expect(specs.debris[0].count).toBeLessThanOrEqual(12);
      // 碎片不再混在发光粒子批里（旧版用 `debris` 粒子样式 + additive）。
      expect(specs.bursts.some((burst) => burst.style.kind === 'spark' && burst.style.blend === 'additive' && burst.count > 10)).toBe(false);
    }
  });

  it('烟接在火球之后（delay > 0），且色调是深灰不是发光色', () => {
    const specs = combatVfxFromEvent(destroy('u'), resolve({ u: enemyUnit }));
    const smoke = specs.bursts.filter((burst) => burst.style.kind === 'smoke');
    expect(smoke.length).toBeGreaterThanOrEqual(2);
    for (const burst of smoke) {
      expect(burst.delay ?? 0).toBeGreaterThan(0);
      // 深灰：#3a3530 量级（线性 RGB 分量都在 0.2 以下）。
      expect(Math.max(...burst.tint)).toBeLessThan(0.25);
      expect(burst.style.blend).toBe('alpha');
    }
    // 寿命覆盖 1.5–2.5s。
    expect(Math.min(...smoke.map((burst) => burst.life))).toBeGreaterThanOrEqual(1.5);
    expect(Math.max(...smoke.map((burst) => burst.life))).toBeLessThanOrEqual(2.5);
  });

  it('焦痕 8s 淡出', () => {
    const specs = combatVfxFromEvent(destroy('u'), resolve({ u: enemyUnit }));
    expect(specs.decals[0].life).toBeCloseTo(8, 6);
  });
});

describe('曳光宽度（步骤 16）', () => {
  it('曳光宽度 = 0.2 格，上限常量与池上限不变', () => {
    const specs = combatVfxFromEvent(hit('a', 'b'), resolve({ a: own, b: enemyUnit }));
    expect(specs.tracers[0].width).toBe(TRACER_WIDTH_TILES);
    expect(TRACER_WIDTH_TILES).toBe(0.2);
    expect(COMBAT_VFX_LIMITS.debris).toBeGreaterThanOrEqual(12);
  });

  it('同一帧大量爆炸：每条事件的碎片数有界（池上限 96 顶掉最旧）', () => {
    let debris = 0;
    for (let i = 0; i < 200; i++) {
      const specs = combatVfxFromEvent(destroy('t', i), resolve({ t: enemyBuilding }));
      debris += specs.debris[0].count;
    }
    expect(debris).toBeLessThanOrEqual(200 * 12);
    expect(COMBAT_VFX_LIMITS.debris).toBeLessThan(debris);
  });
});
