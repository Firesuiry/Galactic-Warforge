import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import type { BattleEvent } from '@/engine/battle-events';
import {
  CombatEffects,
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
    expect(float.kind === 'damage_float' && float.text).toBe('-12');
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

  it('护盾吸收但目标是单位 → 不追加护盾波纹', () => {
    const specs = specsFromCombatEvent(
      makeEvent('damage_applied', { attacker_id: 'df-1', target_id: 's-1', damage: 3, shield_absorbed: 4 }),
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
});
