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
  it('按 风机→电塔→采矿→熔炼→弹药→出兵→补给→进攻 逐步推进', () => {
    expect(idOf(base)).toBe('power');
    let buildings = [b('wind_turbine')];
    expect(idOf({ ...base, buildings })).toBe('grid');
    buildings = [...buildings, b('tesla_tower')];
    expect(idOf({ ...base, buildings })).toBe('mine');
    buildings = [...buildings, b('mining_machine')];
    expect(idOf({ ...base, buildings })).toBe('smelt');
    buildings = [...buildings, b('arc_smelter')];
    expect(idOf({ ...base, buildings })).toBe('ammo');
    buildings = [...buildings, b('assembling_machine_mk1', { production: { recipe_id: 'ammo_bullet' } } as Partial<Building>)];
    expect(idOf({ ...base, buildings })).toBe('army');
    const units = [u('soldier')];
    expect(idOf({ ...base, buildings, units })).toBe('supply');
    buildings = [...buildings, b('supply_station')];
    expect(idOf({ ...base, buildings, units })).toBe('attack');
    const attack = { order: 'attack', owner_id: 'p1', state: 'idle' } as CombatSquad;
    const done = resolveWarGuide({ ...base, buildings, units, legions: [attack] });
    expect(done.complete).toBe(true);
    expect(done.currentIndex).toBe(-1);
  });

  it('库存弹药算弹药完成；补给车算补给；他人建筑不计；机甲/工程兵不算出兵', () => {
    const buildings = [b('wind_turbine'), b('tesla_tower'), b('mining_machine'), b('arc_smelter'), b('supply_station', { owner_id: 'p2' })];
    const state = resolveWarGuide({ ...base, buildings, playerInventory: { titanium_ammo: 3 }, units: [u('worker'), u('executor'), u('soldier', { mecha: {} as never })] });
    expect(state.current?.id).toBe('army');
    expect(resolveWarGuide({ ...base, buildings, playerInventory: { titanium_ammo: 3 }, units: [u('soldier'), u('supply_truck')] }).current?.id).toBe('attack');
  });

  it('黑雾说明：开局不提示，见到黑雾或到出兵阶段说明中立，被激怒时转为防守警示', () => {
    expect(resolveWarGuide(base).notice).toBeNull();
    const fog = u('dark_fog', { owner_id: 'dark_fog' });
    expect(resolveWarGuide({ ...base, units: [fog] }).notice).toMatchObject({ tone: 'info', text: expect.stringContaining('攻击它会激怒它') });
    expect(resolveWarGuide({ ...base, darkFogHostile: true }).notice).toMatchObject({ tone: 'danger' });
  });
});
