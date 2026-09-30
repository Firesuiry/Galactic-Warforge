import { describe, expect, it } from 'vitest';

import type { Building, CombatSquad, Unit } from '@shared/types';

import { resolveWarGuide, type WarGuideInput } from '@/features/onboarding/war-guide';

const b = (type: string, extra: Partial<Building> = {}) =>
  ({ id: type, type, owner_id: 'p1', hp: 10, ...extra }) as Building;
const u = (type: string, extra: Partial<Unit> = {}) =>
  ({ id: type, type, owner_id: 'p1', hp: 10, ...extra }) as Unit;

const base: WarGuideInput = { playerId: 'p1', buildings: [], units: [], legions: [] };
const idOf = (input: WarGuideInput) => resolveWarGuide(input).current?.id;

describe('resolveWarGuide', () => {
  it('从采矿开始，按 采矿→产线→弹药→出兵→补给→进攻 逐步推进', () => {
    expect(idOf(base)).toBe('mine');
    const mine = [b('mining_machine')];
    expect(idOf({ ...base, buildings: mine })).toBe('line');
    const line = [...mine, b('assembling_machine_mk1', { production: { recipe_id: 'gear' } })];
    expect(idOf({ ...base, buildings: line })).toBe('ammo');
    const ammo = [...mine, b('assembling_machine_mk1', { production: { recipe_id: 'ammo_bullet' } })];
    expect(idOf({ ...base, buildings: ammo })).toBe('army');
    const army = [u('soldier')];
    expect(idOf({ ...base, buildings: ammo, units: army })).toBe('supply');
    const supply = [...ammo, b('supply_station')];
    expect(idOf({ ...base, buildings: supply, units: army })).toBe('attack');
    const attack = { order: 'attack', owner_id: 'p1', state: 'idle' } as CombatSquad;
    const done = resolveWarGuide({ ...base, buildings: supply, units: army, legions: [attack] });
    expect(done.complete).toBe(true);
    expect(done.currentIndex).toBe(-1);
  });

  it('玩家库存里有弹药也算弹药步骤完成；补给车算补给；他人建筑不计', () => {
    const buildings = [b('mining_machine'), b('arc_smelter'), b('supply_station', { owner_id: 'p2' })];
    const state = resolveWarGuide({ ...base, buildings, playerInventory: { titanium_ammo: 3 }, units: [u('soldier'), u('supply_truck')] });
    expect(state.steps.map((s) => s.done)).toEqual([true, true, true, true, true, false]);
    expect(state.current?.id).toBe('attack');
  });

  it('机甲/工程兵不算出兵', () => {
    const state = resolveWarGuide({ ...base, units: [u('worker'), u('executor'), u('soldier', { mecha: {} as never })] });
    expect(state.steps.find((s) => s.id === 'army')?.done).toBe(false);
  });
});
