import { describe, expect, it } from 'vitest';

import type { CombatSquad, Unit } from '@shared/types';

import {
  formableUnitIds,
  legionAliveMemberIds,
  legionArrow,
  legionCenter,
  legionOutOfAmmoCount,
  ownLegions,
} from '@/features/planet-map/legion-model';

function unit(id: string, overrides: Partial<Unit> = {}): Unit {
  return { id, type: 'soldier', owner_id: 'p1', position: { x: 0, y: 0, z: 0 }, hp: 10, max_hp: 10, ...overrides } as Unit;
}
function legion(overrides: Partial<CombatSquad> = {}): CombatSquad {
  return {
    id: 'sq-1', owner_id: 'p1', planet_id: 'pl', name: '一团', member_ids: ['a', 'b'],
    state: 'idle', order: 'idle', position: { x: 1, y: 1, z: 0 }, ...overrides,
  } as CombatSquad;
}

describe('legion-model', () => {
  const units = {
    a: unit('a', { position: { x: 2, y: 2, z: 0 }, combat_state: 'no_ammunition' }),
    b: unit('b', { position: { x: 4, y: 6, z: 0 } }),
    c: unit('c', { hp: 0 }),
  };

  it('ownLegions 只保留己方存活且有成员的军团', () => {
    const list = ownLegions([
      legion(), legion({ id: 'x', owner_id: 'p2' }), legion({ id: 'y', state: 'destroyed' }),
      legion({ id: 'empty', member_ids: null }),
    ], 'p1');
    expect(list.map((l) => l.id)).toEqual(['sq-1']);
  });

  it('质心与存活成员；成员全灭回退军团 position', () => {
    expect(legionAliveMemberIds(legion({ member_ids: ['a', 'b', 'c'] }), units)).toEqual(['a', 'b']);
    expect(legionCenter(legion(), units)).toMatchObject({ x: 3, y: 4 });
    expect(legionCenter(legion({ member_ids: ['c'] }), units)).toMatchObject({ x: 1, y: 1 });
  });

  it('指令箭头：attack/defend/retreat 且有 target 才有', () => {
    const target = { x: 9, y: 9, z: 0 };
    expect(legionArrow(legion({ order: 'attack', target }), units)).toMatchObject({ order: 'attack', to: target, from: { x: 3, y: 4 } });
    expect(legionArrow(legion({ order: 'resupply', target }), units)).toBeNull();
    expect(legionArrow(legion({ order: 'attack' }), units)).toBeNull();
  });

  it('缺弹计数与编队候选过滤', () => {
    expect(legionOutOfAmmoCount(legion(), units)).toBe(1);
    const pool = {
      s1: unit('s1'), s2: unit('s2', { squad_id: 'sq-1' }), m: unit('m', { mecha: {} as never }),
      w: unit('w', { type: 'worker' }), e: unit('e', { owner_id: 'p2' }), d: unit('d', { hp: 0 }),
    };
    expect(formableUnitIds(pool, Object.keys(pool), 'p1')).toEqual(['s1']);
  });
});
