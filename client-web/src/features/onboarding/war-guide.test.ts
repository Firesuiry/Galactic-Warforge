import { describe, expect, it } from 'vitest';

import type { Building, CombatSquad, Unit } from '@shared/types';

import { resolveWarGuide, type WarGuideCatalog, type WarGuideInput } from '@/features/onboarding/war-guide';

const b = (type: string, extra: Partial<Building> = {}) =>
  ({ id: type, type, owner_id: 'p1', hp: 10, ...extra }) as Building;
const u = (type: string, extra: Partial<Unit> = {}) =>
  ({ id: type, type, owner_id: 'p1', hp: 10, ...extra }) as Unit;

const base: WarGuideInput = { playerId: 'p1', buildings: [], units: [], legions: [] };
const idOf = (input: WarGuideInput) => resolveWarGuide(input).current?.id;

/** 目录最小面：建筑造价 + 配方 + 物品中文名（与 server/data/*.yaml 同构）。 */
const catalog: WarGuideCatalog = {
  buildings: [
    { id: 'wind_turbine', name: '风力涡轮机', build_cost: { items: [{ item_id: 'iron_ingot', quantity: 6 }, { item_id: 'gear', quantity: 1 }, { item_id: 'magnetic_coil', quantity: 3 }] } },
    { id: 'tesla_tower', name: '电力感应塔', build_cost: { items: [{ item_id: 'iron_ingot', quantity: 2 }, { item_id: 'magnetic_coil', quantity: 1 }] } },
    { id: 'mining_machine', name: '采矿机', build_cost: { items: [{ item_id: 'circuit_board', quantity: 2 }, { item_id: 'gear', quantity: 2 }] } },
    { id: 'arc_smelter', name: '电弧熔炉', build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }, { item_id: 'stone_brick', quantity: 2 }] } },
    { id: 'assembling_machine_mk1', name: '制造台 Mk.I', build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }, { item_id: 'gear', quantity: 8 }] } },
    { id: 'barracks', name: '兵营', build_cost: { items: [{ item_id: 'iron_ingot', quantity: 8 }, { item_id: 'circuit_board', quantity: 4 }] } },
    { id: 'matrix_lab', name: '矩阵研究站', build_cost: { items: [{ item_id: 'glass', quantity: 4 }, { item_id: 'circuit_board', quantity: 4 }] } },
    { id: 'supply_station', name: '补给站', build_cost: { items: [{ item_id: 'iron_ingot', quantity: 6 }, { item_id: 'circuit_board', quantity: 2 }] } },
  ],
  items: [
    { id: 'iron_ingot', name: '铁块' },
    { id: 'copper_ingot', name: '铜块' },
    { id: 'stone_ore', name: '石矿' },
    { id: 'glass', name: '玻璃' },
    { id: 'circuit_board', name: '电路板' },
    { id: 'gear', name: '齿轮' },
    { id: 'magnetic_coil', name: '磁线圈' },
    { id: 'stone_brick', name: '石材' },
  ],
  recipes: [
    { id: 'glass', name: '玻璃', handcraft_allowed: true, inputs: [{ item_id: 'stone_ore', quantity: 2 }], outputs: [{ item_id: 'glass', quantity: 1 }], building_types: ['arc_smelter'] },
    { id: 'circuit_board', name: '电路板', handcraft_allowed: true, inputs: [{ item_id: 'iron_ingot', quantity: 1 }, { item_id: 'copper_ingot', quantity: 1 }], outputs: [{ item_id: 'circuit_board', quantity: 1 }], building_types: ['assembling_machine_mk1'] },
    { id: 'gear', name: '齿轮', handcraft_allowed: true, inputs: [{ item_id: 'iron_ingot', quantity: 1 }], outputs: [{ item_id: 'gear', quantity: 1 }], building_types: ['assembling_machine_mk1'] },
    { id: 'magnetic_coil', name: '磁线圈', handcraft_allowed: true, inputs: [{ item_id: 'copper_ingot', quantity: 1 }], outputs: [{ item_id: 'magnetic_coil', quantity: 2 }], building_types: ['assembling_machine_mk1'] },
    { id: 'smelt_stone', name: '石材', handcraft_allowed: true, inputs: [{ item_id: 'stone_ore', quantity: 1 }], outputs: [{ item_id: 'stone_brick', quantity: 1 }], building_types: ['arc_smelter'] },
  ],
};

describe('resolveWarGuide', () => {
  it('按 风机→电塔→采矿→熔炼→弹药→出兵→研究→补给→进攻 逐步推进', () => {
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
    expect(idOf({ ...base, buildings, units })).toBe('research');
    // 研究步骤：建研究站 + 有研究在进行即可推进（不必等电磁学完成）。
    buildings = [...buildings, b('matrix_lab')];
    const researching = { tech: { player_id: 'p1', current_research: { tech_id: 'electromagnetism', state: 'in_progress', progress: 1, total_cost: 20 } } };
    expect(idOf({ ...base, buildings, units, ...researching })).toBe('supply');
    buildings = [...buildings, b('supply_station')];
    expect(idOf({ ...base, buildings, units, ...researching })).toBe('attack');
    const attack = { order: 'attack', owner_id: 'p1', state: 'idle' } as CombatSquad;
    const done = resolveWarGuide({ ...base, buildings, units, legions: [attack], ...researching });
    expect(done.complete).toBe(true);
    expect(done.currentIndex).toBe(-1);
  });

  it('已完成电磁学即算研究完成（不要求研究站还在）', () => {
    const buildings = [b('wind_turbine'), b('tesla_tower'), b('mining_machine'), b('arc_smelter'), b('assembling_machine_mk1', { production: { recipe_id: 'ammo_bullet' } } as Partial<Building>)];
    const tech = { player_id: 'p1', completed_techs: ['dyson_sphere_program', 'electromagnetism'] };
    expect(idOf({ ...base, buildings, units: [u('soldier')], tech })).toBe('supply');
    // 只有研究站、没有进行中的研究：不算完成（研究站建好但没开始研究）。
    expect(idOf({ ...base, buildings: [...buildings, b('matrix_lab')], units: [u('soldier')] })).toBe('research');
  });

  it('库存弹药算弹药完成；补给车算补给；他人建筑不计；机甲/工程兵不算出兵', () => {
    const buildings = [b('wind_turbine'), b('tesla_tower'), b('mining_machine'), b('arc_smelter'), b('supply_station', { owner_id: 'p2' })];
    const state = resolveWarGuide({ ...base, buildings, playerInventory: { titanium_ammo: 3 }, units: [u('worker'), u('executor'), u('soldier', { mecha: {} as never })] });
    expect(state.current?.id).toBe('army');
    const researchDone = { tech: { player_id: 'p1', completed_techs: ['electromagnetism'] } };
    expect(resolveWarGuide({ ...base, buildings, playerInventory: { titanium_ammo: 3 }, units: [u('soldier'), u('supply_truck')], ...researchDone }).current?.id).toBe('attack');
    // 真实 summary 里 completed_techs 是服务端的 {tech_id: level} 映射。
    const serverShape = { tech: { player_id: 'p1', completed_techs: { dyson_sphere_program: 1, electromagnetism: 1 } as never } };
    expect(resolveWarGuide({ ...base, buildings, playerInventory: { titanium_ammo: 3 }, units: [u('soldier'), u('supply_truck')], ...serverShape }).current?.id).toBe('attack');
  });

  it('弹药步骤文案：开局可用配方，不再要求先研究武器系统', () => {
    const steps = resolveWarGuide(base).steps;
    const ammo = steps.find((step) => step.id === 'ammo')!;
    expect(ammo.hint).toContain('开局即可用');
    expect(ammo.hint).not.toContain('需先在科技页研究武器系统');
    const army = steps.find((step) => step.id === 'army')!;
    expect(army.hint).toContain('步兵');
  });

  it('黑雾说明：开局不提示，见到黑雾或到出兵阶段说明中立，被激怒时转为防守警示', () => {
    expect(resolveWarGuide(base).notice).toBeNull();
    const fog = u('dark_fog', { owner_id: 'dark_fog' });
    expect(resolveWarGuide({ ...base, units: [fog] }).notice).toMatchObject({ tone: 'info', text: expect.stringContaining('攻击它会激怒它') });
    expect(resolveWarGuide({ ...base, darkFogHostile: true }).notice).toMatchObject({ tone: 'danger' });
  });
});

describe('resolveWarGuide 缺料兜底（试玩 1011 G）', () => {
  it('当前步骤的关键建筑买不起时给出「还差」与逐项来源', () => {
    // 停在「风机」：背包什么都没有，风机要 铁块 6 / 齿轮 1 / 磁线圈 3。
    const state = resolveWarGuide({ ...base, catalog, playerInventory: {} });
    expect(state.shortage?.text).toBe('还差：铁块 ×6、齿轮 ×1、磁线圈 ×3');
    const glass = state.shortage?.sources.find((source) => source.itemId === 'gear');
    expect(glass?.source).toBe('制造台 Mk.I或机甲手搓：铁块 ×1');
  });

  it('研究步骤缺料给出玻璃/电路板的来源（从目录配方推导，不硬编码数字）', () => {
    const buildings = [b('wind_turbine'), b('tesla_tower'), b('mining_machine'), b('arc_smelter'), b('assembling_machine_mk1', { production: { recipe_id: 'ammo_bullet' } } as Partial<Building>)];
    const state = resolveWarGuide({ ...base, buildings, units: [u('soldier')], catalog, playerInventory: {} });
    expect(state.current?.id).toBe('research');
    expect(state.shortage?.text).toBe('还差：玻璃 ×4、电路板 ×4');
    expect(state.shortage?.sources.find((source) => source.itemId === 'glass')?.source).toBe('电弧熔炉或机甲手搓：石矿 ×2');
    expect(state.shortage?.sources.find((source) => source.itemId === 'circuit_board')?.source).toBe('制造台 Mk.I或机甲手搓：铁块 ×1 + 铜块 ×1');
  });

  it('背包够料时没有缺料行；缺料行只在当前步骤出现（已完成的步骤不报）', () => {
    const plenty = { iron_ingot: 99, gear: 99, magnetic_coil: 99, circuit_board: 99, glass: 99, stone_brick: 99 };
    expect(resolveWarGuide({ ...base, catalog, playerInventory: plenty }).shortage).toBeNull();
    // 停在电塔：只报电塔的缺口，不报已完成的风机。
    const state = resolveWarGuide({ ...base, buildings: [b('wind_turbine')], catalog, playerInventory: { iron_ingot: 1 } });
    expect(state.current?.id).toBe('grid');
    expect(state.shortage?.text).toBe('还差：铁块 ×1、磁线圈 ×1');
  });

  it('attack 步骤没有关键建筑（编军团不花建筑造价），目录缺失时也不报', () => {
    const buildings = [b('wind_turbine'), b('tesla_tower'), b('mining_machine'), b('arc_smelter'), b('assembling_machine_mk1', { production: { recipe_id: 'ammo_bullet' } } as Partial<Building>), b('supply_station')];
    const tech = { player_id: 'p1', completed_techs: ['electromagnetism'] };
    const state = resolveWarGuide({ ...base, buildings, units: [u('soldier')], catalog, playerInventory: {}, tech });
    expect(state.current?.id).toBe('attack');
    expect(state.shortage).toBeNull();
    // 无目录（纯逻辑调用方）时不报缺料，不影响既有推导。
    expect(resolveWarGuide({ ...base, playerInventory: {} }).shortage).toBeNull();
  });
});
