import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { BattleEvent } from '@/engine/battle-events';
import {
  COMBAT_FX_LIMITS,
  CombatEffects,
  DAMAGE_MERGE_MS,
  specsFromCombatEvent,
  type CombatPoint,
} from '@/features/planet-map/three/combat-effects';

function makeEvent(type: string, payload: Record<string, unknown>, seq = 1): BattleEvent {
  return { seq, at: 0, type, payload, eventId: `e-${seq}`, tick: 1 };
}

function resolveMap(entries: Record<string, CombatPoint>) {
  return (id: string | undefined | null) => (id ? entries[id] ?? null : null);
}

const turret: CombatPoint = { x: 0, y: 0, z: 100, owner: 'own', kind: 'building' };
const soldier: CombatPoint = { x: 1, y: 0, z: 100, owner: 'own', kind: 'unit' };
const fogUnit: CombatPoint = { x: 0, y: 1, z: 100, owner: 'darkfog', kind: 'unit' };
const enemyMecha: CombatPoint = { x: 1, y: 1, z: 100, owner: 'enemy', kind: 'unit' };

describe('combat-effects 事件 → 特效指令（C2）', () => {
  it('damage_applied：弹道 + 枪口 + 命中闪光 + 伤害飘字；建筑攻击者=防御塔配色', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 't-1', target_id: 'e-1', damage: 12, target_hp: 60 }),
      resolveMap({ 't-1': turret, 'e-1': enemyMecha }),
    );
    const kinds = specs.map((spec) => spec.kind);
    expect(kinds).toEqual(['projectile', 'muzzle', 'hit_flash', 'damage_float']);
    const projectile = specs[0];
    expect(projectile.kind === 'projectile' && projectile.tone).toBe('defense');
    const float = specs[3];
    expect(float.kind === 'damage_float' && float.amount).toBe(12);
    expect(float.kind === 'damage_float' && float.targetId).toBe('e-1');
    expect(float.kind === 'damage_float' && float.tone).toBe('enemy_hit');
  });

  it('黑雾攻击者=暗红配色；己方受击飘字=橙色系', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 's-1', damage: 5, target_hp: 30 }),
      resolveMap({ 'df-1': fogUnit, 's-1': soldier }),
    );
    expect(specs[0].kind === 'projectile' && specs[0].tone).toBe('darkfog');
    const float = specs[3];
    expect(float.kind === 'damage_float' && float.tone).toBe('own_hit');
  });

  it('护盾吸收 > 0 且目标是建筑 → 追加护盾波纹', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', {
        attacker_id: 'df-1',
        target_id: 't-1',
        damage: 3,
        shield_absorbed: 9,
        shield_remaining: 40,
      }),
      resolveMap({ 'df-1': fogUnit, 't-1': turret }),
    );
    expect(specs.some((spec) => spec.kind === 'shield_ripple')).toBe(true);
  });

  it('护盾吸收且目标是机甲单位 → 追加护盾波纹（服务端只有机甲带护盾）', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 's-1', damage: 3, shield_absorbed: 4 }),
      resolveMap({ 'df-1': fogUnit, 's-1': soldier }),
    );
    expect(specs.some((spec) => spec.kind === 'shield_ripple')).toBe(true);
  });

  it('无护盾吸收 → 不追加护盾波纹', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 's-1', damage: 3 }),
      resolveMap({ 'df-1': fogUnit, 's-1': soldier }),
    );
    expect(specs.some((spec) => spec.kind === 'shield_ripple')).toBe(false);
  });

  it('目标解析不到（不在渲染集合）→ 不演出', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 'ghost', damage: 3 }),
      resolveMap({ 'df-1': fogUnit }),
    );
    expect(specs).toEqual([]);
  });

  it('entity_destroyed → 爆炸 + 残骸（建筑更大规模）', () => {
    const unitSpecs = specsFromCombatEvent(
      makeEvent('entity_destroyed', { entity_id: 'e-1', entity_type: 'unit', killed_by: 's-1' }),
      resolveMap({ 'e-1': enemyMecha }),
    );
    expect(unitSpecs.map((spec) => spec.kind)).toEqual(['explosion', 'wreck']);

    const buildingSpecs = specsFromCombatEvent(
      makeEvent('entity_destroyed', { entity_id: 't-1', entity_type: 'building' }),
      resolveMap({ 't-1': turret }),
    );
    const explosion = buildingSpecs[0];
    expect(explosion.kind === 'explosion' && explosion.scale).toBeGreaterThan(1);
  });
});

describe('CombatEffects 特效池', () => {
  it('spawn → 场上出现特效对象；update 推进后到期回收', () => {
    const parent = new THREE.Group();
    const effects = new CombatEffects(parent, () => 1);
    effects.spawnSpecs(specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 't-1', target_id: 'e-1', damage: 12 }),
      resolveMap({ 't-1': turret, 'e-1': enemyMecha }),
    ));
    expect(effects.activeCount).toBe(4);
    expect(parent.children.length).toBe(4);

    effects.update(120);
    // 枪口 130ms / 命中 170ms / 弹道 240ms / 飘字 850ms：120ms 后全部存活
    expect(effects.activeCount).toBe(4);
    effects.update(200);
    // 320ms：枪口/命中/弹道已回收，飘字存活
    expect(effects.activeCount).toBe(1);
    effects.update(600);
    expect(effects.activeCount).toBe(0);
    effects.dispose();
  });

  it('entity_destroyed 残骸留存数秒后移除', () => {
    const parent = new THREE.Group();
    const effects = new CombatEffects(parent, () => 1);
    effects.spawnSpecs(specsFromCombatEvent(
      makeEvent('entity_destroyed', { entity_id: 'e-1', entity_type: 'unit' }),
      resolveMap({ 'e-1': enemyMecha }),
    ));
    expect(effects.activeCount).toBe(2);
    effects.update(1000);
    // 爆炸 520ms 结束，残骸 4200ms 留存
    expect(effects.activeCount).toBe(1);
    effects.update(4000);
    expect(effects.activeCount).toBe(0);
    effects.dispose();
  });

  it('同一目标短时间内的伤害合并为一个飘字（数字累加），窗口外另起一个', () => {
    const parent = new THREE.Group();
    const effects = new CombatEffects(parent, () => 1);
    const resolve = resolveMap({ 't-1': turret, 'e-1': enemyMecha, 'e-2': fogUnit });
    const hit = (target: string, damage: number, seq: number) => effects.spawnSpecs(specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 't-1', target_id: target, damage }, seq), resolve,
    ));
    hit('e-1', 5, 1);
    effects.update(100);
    hit('e-1', 7, 2);
    hit('e-2', 3, 3);
    expect(effects.damageFloats().map((fx) => [fx.targetId, fx.amount])).toEqual([['e-1', 12], ['e-2', 3]]);
    effects.update(DAMAGE_MERGE_MS + 10);
    hit('e-1', 4, 4);
    expect(effects.damageFloats().filter((fx) => fx.targetId === 'e-1').map((fx) => fx.amount)).toEqual([12, 4]);
    effects.dispose();
  });

  it('全局上限：飘字 ≤24（顶掉最旧）、弹道 ≤64；到期后对象回收复用不再新建', () => {
    const parent = new THREE.Group();
    const effects = new CombatEffects(parent, () => 1);
    const points: Record<string, CombatPoint> = { 't-1': turret };
    for (let i = 0; i < 100; i += 1) points[`e-${i}`] = { ...enemyMecha, x: i };
    const resolve = resolveMap(points);
    for (let i = 0; i < 100; i += 1) {
      effects.spawnSpecs(specsFromCombatEvent(makeEvent('damage_applied', { attacker_id: 't-1', target_id: `e-${i}`, damage: 1 }, i + 1), resolve));
    }
    const counts = effects.counts();
    expect(counts.damageFloats).toBe(COMBAT_FX_LIMITS.damageFloats);
    expect(counts.projectiles).toBe(COMBAT_FX_LIMITS.projectiles);
    expect(counts.flashes).toBe(COMBAT_FX_LIMITS.flashes);
    expect(effects.damageFloats()[effects.damageFloats().length - 1].targetId).toBe('e-99');
    expect(effects.damageFloats()[0].targetId).toBe(`e-${100 - COMBAT_FX_LIMITS.damageFloats}`);

    const sprites = new Set<THREE.Object3D>();
    parent.children.forEach((child) => sprites.add(child));
    effects.update(5000);
    expect(effects.activeCount).toBe(0);
    expect(parent.children.length).toBe(0);
    // 第二轮：所有对象来自自由表（与第一轮同一批实例）
    for (let i = 0; i < 100; i += 1) {
      effects.spawnSpecs(specsFromCombatEvent(makeEvent('damage_applied', { attacker_id: 't-1', target_id: `e-${i}`, damage: 1 }, 200 + i), resolve));
    }
    expect(parent.children.every((child) => sprites.has(child))).toBe(true);
    effects.dispose();
    expect(parent.children.length).toBe(0);
  });
});
