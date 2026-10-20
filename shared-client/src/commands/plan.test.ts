import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { ApiClient } from '../api.js';
import type {
  Building,
  CatalogView,
  ConstructionTaskView,
  MechaView,
  PlanetRuntimeView,
  StateSummary,
} from '../types.js';

import {
  cmdPlan,
  computePlanCost,
  findBuildingSources,
  fmtHandcraftHint,
  occupiedByTasks,
  parsePlanItems,
  recipeInputs,
  upgradeCost,
} from './plan.js';

const catalog = {
  items: [
    { id: 'circuit_board', name: '电路板' },
    { id: 'glass', name: '玻璃' },
    { id: 'stone_ore', name: '石矿' },
    { id: 'iron_ingot', name: '铁块' },
    { id: 'gear', name: '齿轮' },
    { id: 'magnetic_coil', name: '磁线圈' },
    { id: 'copper_ingot', name: '铜块' },
    { id: 'copper_ore', name: '铜矿' },
    { id: 'magnet', name: '磁铁' },
    { id: 'iron_ore', name: '铁矿' },
  ],
  buildings: [
    { id: 'supply_station', name: '补给站', buildable: true, build_cost: { items: [{ item_id: 'iron_ingot', quantity: 6 }] } },
    { id: 'arc_smelter', name: '电弧熔炉', buildable: true, build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }] } },
    { id: 'matrix_lab', buildable: true, build_cost: { items: [{ item_id: 'circuit_board', quantity: 8 }, { item_id: 'glass', quantity: 4 }] } },
    { id: 'wind_turbine', buildable: true, build_cost: { items: [{ item_id: 'iron_ingot', quantity: 2 }, { item_id: 'magnetic_coil', quantity: 1 }] } },
    { id: 'arc_smelter', buildable: true, build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }, { item_id: 'iron_ingot', quantity: 3 }] } },
    { id: 'foundation', buildable: false, build_cost: { items: [] } },
  ],
  recipes: [
    {
      id: 'glass', name: '玻璃', handcraft_allowed: true, duration: 2, tech_unlock: ['glass'],
      inputs: [{ item_id: 'stone_ore', quantity: 2 }],
      outputs: [{ item_id: 'glass', quantity: 1 }],
    },
    {
      id: 'smelt_iron', name: '铁块', handcraft_allowed: false, duration: 2,
      inputs: [{ item_id: 'iron_ore', quantity: 1 }],
      outputs: [{ item_id: 'iron_ingot', quantity: 1 }],
    },
    {
      id: 'circuit_board', name: '电路板', handcraft_allowed: true, duration: 30,
      inputs: [{ item_id: 'iron_ingot', quantity: 1 }, { item_id: 'copper_ingot', quantity: 1 }],
      outputs: [{ item_id: 'circuit_board', quantity: 1 }],
    },
    {
      id: 'smelt_copper', name: '铜块', handcraft_allowed: true, duration: 60,
      inputs: [{ item_id: 'copper_ore', quantity: 1 }],
      outputs: [{ item_id: 'copper_ingot', quantity: 1 }],
    },
    {
      id: 'smelt_magnet', name: '磁铁', handcraft_allowed: true, duration: 60,
      inputs: [{ item_id: 'iron_ore', quantity: 1 }],
      outputs: [{ item_id: 'magnet', quantity: 1 }],
    },
    {
      id: 'loop_a', name: '环A', handcraft_allowed: true, duration: 1,
      inputs: [{ item_id: 'loop_b', quantity: 1 }],
      outputs: [{ item_id: 'loop_a', quantity: 1 }],
    },
    {
      id: 'loop_b', name: '环B', handcraft_allowed: true, duration: 1,
      inputs: [{ item_id: 'loop_a', quantity: 1 }],
      outputs: [{ item_id: 'loop_b', quantity: 1 }],
    },
  ],
} as unknown as CatalogView;

function mecha(inventory: Record<string, number>): MechaView {
  return {
    unit_id: 'u-7', planet_id: 'planet-1-1', operator: 'builder-a', alive: true, respawn_at_tick: 0,
    position: { x: 3, y: 3, z: 0 },
    inventory, inventory_slots_used: Object.keys(inventory).length, inventory_slots_total: 40,
    operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0,
  } as MechaView;
}

function summary(view: MechaView | undefined): StateSummary {
  return {
    tick: 1,
    active_planet_id: 'planet-1-1',
    surface: { topology: 'cube_sphere', face_size: 8 },
    map_width: 8,
    map_height: 8,
    players: {
      p1: {
        player_id: 'p1',
        is_alive: true,
        resources: { energy: 0 },
        mechas: view ? [view] : [],
        tech: { player_id: 'p1', completed_techs: { glass: 1 } },
      },
    },
  } as unknown as StateSummary;
}

function building(id: string, type: string, storage: Record<string, number>): Building {
  return {
    id, type, owner_id: 'p1', position: { x: 1, y: 1, z: 0 }, hp: 10, max_hp: 10, level: 1, vision_range: 1,
    runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 3, height: 3 } }, state: 'running' },
    storage: { inventory: storage },
  } as Building;
}

function supplyStation(id: string, storage: Record<string, number>): Building {
  return building(id, 'supply_station', storage);
}

function arcSmelter(id: string, storage: Record<string, number>): Building {
  return building(id, 'arc_smelter', storage);
}

function task(overrides: Partial<ConstructionTaskView> = {}): ConstructionTaskView {
  return {
    id: 'c-1',
    player_id: 'p1',
    mecha_id: 'u-7',
    building_type: 'wind_turbine',
    position: { x: 0, y: 0, z: 0 },
    state: 'pending',
    enqueue_tick: 1,
    cost: { items: [{ item_id: 'gear', quantity: 2 }] },
    ...overrides,
  };
}

function fakeApi(options: {
  inventory?: Record<string, number>;
  tasks?: ConstructionTaskView[];
  buildings?: Record<string, Building>;
  /** 场景里的本方建筑（缺口提示的取料来源）。 */
  sceneBuildings?: Record<string, Building>;
  mecha?: MechaView;
} = {}) {
  const view = 'mecha' in options ? options.mecha : mecha(options.inventory ?? {});
  const runtime = {
    planet_id: 'planet-1-1',
    discovered: true,
    available: true,
    tick: 1,
    threat_level: 0,
    construction_tasks: options.tasks ?? [],
  } as PlanetRuntimeView;
  const api = {
    getAuth: () => ({ playerId: 'p1', issuerId: 'builder-a', issuerType: 'agent' }),
    fetchSummary: async () => summary(view),
    fetchCatalog: async () => catalog,
    fetchPlanetRuntime: async () => runtime,
    fetchPlanetScene: async () => ({
      planet_id: 'planet-1-1',
      discovered: true,
      map_width: 8,
      map_height: 8,
      tick: 1,
      bounds: { x: 0, y: 0, width: 8, height: 8 },
      buildings: options.sceneBuildings ?? {},
    }),
    fetchPlanetInspect: async (_planetId: string, params: { entityId?: string }) => ({
      planet_id: 'planet-1-1',
      discovered: true,
      entity_kind: 'building',
      entity_id: params.entityId,
      building: options.buildings?.[params.entityId ?? ''],
    }),
  } as unknown as ApiClient;
  return api;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('plan 参数解析', () => {
  it('分号分隔多条 build', () => {
    const items = parsePlanItems('build 62 146 matrix_lab; build 65 146 wind_turbine');
    assert.equal(items.length, 2);
    assert.deepEqual(items[0].position, { x: 62, y: 146 });
    assert.equal(items[1].buildingType, 'wind_turbine');
  });

  it('换行分隔、upgrade 只带建筑 id', () => {
    const items = parsePlanItems('build 1 2 wind_turbine\nupgrade b-5\n');
    assert.deepEqual(items.map((item) => item.kind), ['build', 'upgrade']);
    assert.equal(items[1].buildingId, 'b-5');
  });

  it('跳过空行与 # 注释', () => {
    const items = parsePlanItems('# 计划\nbuild 1 2 wind_turbine\n\n# 后面这条也算\nupgrade b-5\n');
    assert.equal(items.length, 2);
  });

  it('未知命令与缺参数报错', () => {
    assert.throws(() => parsePlanItems('move u-1 3 4'), /只支持 build \/ upgrade \/ craft_item/);
    assert.throws(() => parsePlanItems('build 1 wind_turbine'), /需要 <x> <y> <type>/);
  });

  it('craft_item 与 build / upgrade 混在一行', () => {
    const items = parsePlanItems('build 1 2 wind_turbine; craft_item gear 5\nupgrade b-5');
    assert.deepEqual(items.map((item) => item.kind), ['build', 'craft', 'upgrade']);
    assert.equal(items[1].recipeId, 'gear');
    assert.equal(items[1].batches, 5);
    assert.match(items[1].label, /craft gear×5/);
  });

  it('同一行里相邻计划动词自动切开', () => {
    const items = parsePlanItems('build 98 146 matrix_lab craft_item circuit_board 4 upgrade b-5');
    assert.deepEqual(items.map((item) => item.kind), ['build', 'craft', 'upgrade']);
    assert.equal(items[1].recipeId, 'circuit_board');
    assert.equal(items[1].batches, 4);
  });

  it('build 的带值选项不会被当成下一个计划动词', () => {
    const items = parsePlanItems('build 1 2 wind_turbine --rotation 90 craft_item gear 2');
    assert.equal(items.length, 2);
    assert.equal(items[0].buildingType, 'wind_turbine');
    assert.equal(items[1].batches, 2);
  });

  it('craft_item 缺批数或批数非正数报错', () => {
    assert.throws(() => parsePlanItems('craft_item gear'), /需要 <配方> <批数>/);
    assert.throws(() => parsePlanItems('craft_item gear 0'), /正整数/);
    assert.throws(() => parsePlanItems('craft_item gear -2'), /正整数/);
    assert.throws(() => parsePlanItems('craft_item gear x'), /正整数/);
  });
});

describe('plan 用料计算', () => {
  it('累计多项造价', () => {
    const { need } = computePlanCost(
      [
        [{ item_id: 'circuit_board', quantity: 8 }, { item_id: 'glass', quantity: 4 }],
        [{ item_id: 'iron_ingot', quantity: 2 }, { item_id: 'magnetic_coil', quantity: 1 }],
        [{ item_id: 'circuit_board', quantity: 4 }, { item_id: 'iron_ingot', quantity: 3 }],
      ],
      { circuit_board: 15 },
      new Map(),
    );
    assert.equal(need.get('circuit_board'), 12);
    assert.equal(need.get('iron_ingot'), 5);
    assert.equal(need.get('glass'), 4);
  });

  it('背包够时没有缺口；不够时缺口 = 需要 − 背包', () => {
    const enough = computePlanCost([[{ item_id: 'circuit_board', quantity: 12 }]], { circuit_board: 15 }, new Map());
    assert.equal(enough.gaps.size, 0);
    const short = computePlanCost([[{ item_id: 'glass', quantity: 4 }]], { glass: 0 }, new Map());
    assert.equal(short.gaps.get('glass'), 4);
  });

  it('施工任务占用抵扣背包', () => {
    const occupied = occupiedByTasks([
      task({ id: 'c-1', cost: { items: [{ item_id: 'iron_ingot', quantity: 2 }] } }),
      task({ id: 'c-2', state: 'in_progress', cost: { items: [{ item_id: 'iron_ingot', quantity: 3 }] } }),
      task({ id: 'c-3', state: 'paused', cost: { items: [{ item_id: 'gear', quantity: 1 }] } }),
      // 已扣料、别人的机甲、已结束的任务都不占。
      task({ id: 'c-4', materials_deducted: true, cost: { items: [{ item_id: 'iron_ingot', quantity: 9 }] } }),
      task({ id: 'c-5', mecha_id: 'u-99', cost: { items: [{ item_id: 'iron_ingot', quantity: 9 }] } }),
      task({ id: 'c-6', state: 'completed', cost: { items: [{ item_id: 'iron_ingot', quantity: 9 }] } }),
      task({ id: 'c-7', state: 'cancelled', cost: { items: [{ item_id: 'iron_ingot', quantity: 9 }] } }),
    ], 'u-7');
    assert.equal(occupied.get('iron_ingot'), 5);
    assert.equal(occupied.get('gear'), 1);

    const result = computePlanCost(
      [[{ item_id: 'iron_ingot', quantity: 4 }]],
      { iron_ingot: 8 },
      occupied,
    );
    // 8 − 5 = 3 可用，需要 4 → 缺 1。
    assert.equal(result.gaps.get('iron_ingot'), 1);
  });

  it('craft_item 的原料按批数计入需要，但不计入施工占用', async () => {
    const api = fakeApi({ inventory: { iron_ingot: 3 } });
    const out = stripAnsi(await cmdPlan(['craft_item', 'circuit_board', '5'], { api, issuerId: 'builder-a' }));
    // 电路板×5 = 铁块 5 + 铜块 5；背包铁块 3 → 缺铁块 2、铜块 5。
    assert.match(out, /计划 1 项（craft circuit_board×5）/);
    // 产物本身不在用料表里，只有配方输入。
    assert.doesNotMatch(out, /^电路板\s/m);
    assert.match(out, /铁块\s+5\s+3\s+-\s+2/);
    assert.match(out, /铜块\s+5\s+0\s+-\s+5/);
    assert.match(out, /✗ 结论：缺 铁块 2、铜块 5/);
  });

  it('craft_item 与 build 混排时合并同种原料', async () => {
    const api = fakeApi({ inventory: {} });
    const out = stripAnsi(await cmdPlan(
      ['craft_item', 'circuit_board', '2', ';', 'build', '1', '1', 'wind_turbine'],
      { api, issuerId: 'builder-a' },
    ));
    // 电路板 2 批 = 铁块 2 + 铜块 2，再加风机铁块 2、磁线圈 1。
    assert.match(out, /铁块\s+4\s+0/);
    assert.match(out, /磁线圈\s+1\s+0/);
  });

  it('craft_item 未知配方 / 不可手搓配方直接报错', async () => {
    const api = fakeApi();
    assert.match(
      stripAnsi(await cmdPlan(['craft_item', 'no_such_recipe', '1'], { api })),
      /未知配方：no_such_recipe/,
    );
    assert.match(
      stripAnsi(await cmdPlan(['craft_item', 'smelt_iron', '1'], { api })),
      /该配方不可手搓：smelt_iron/,
    );
  });

  it('recipeInputs 按批数放大', () => {
    const recipe = { inputs: [{ item_id: 'iron_ingot', quantity: 1 }, { item_id: 'copper_ingot', quantity: 2 }] };
    assert.deepEqual(recipeInputs(recipe as never, 3), [
      { item_id: 'iron_ingot', quantity: 3 },
      { item_id: 'copper_ingot', quantity: 6 },
    ]);
  });

  it('upgrade 造价按等级线性放大（向上取整）', () => {
    assert.deepEqual(upgradeCost([{ item_id: 'iron_ingot', quantity: 3 }], 2), [{ item_id: 'iron_ingot', quantity: 6 }]);
    assert.deepEqual(upgradeCost([{ item_id: 'glass', quantity: 1 }], 3), [{ item_id: 'glass', quantity: 3 }]);
  });
});

describe('plan 可手搓提示', () => {
  it('可手搓物品给出配方与原料换算', () => {
    const hint = fmtHandcraftHint(catalog, 'glass', 4, new Set()).join('\n');
    assert.match(hint, /可手搓：glass/);
    assert.match(hint, /石矿×2 → 玻璃×1/);
    assert.match(hint, /需 4 批 = 石矿×8/);
  });

  it('不可手搓物品明说需要生产建筑', () => {
    assert.match(fmtHandcraftHint(catalog, 'iron_ingot', 2, new Set()).join('\n'), /不可手搓，需要生产建筑/);
  });

  it('未解锁科技会写出来', () => {
    assert.match(fmtHandcraftHint(catalog, 'glass', 1, new Set()).join('\n'), /未解锁科技 glass/);
  });

  it('递归展开：缺电路板 → 铜块不可手搓时给出建筑来源，铁块继续展开', () => {
    const buildings = [
      supplyStation('b-97', { copper_ingot: 56 }),
      arcSmelter('b-55', { copper_ingot: 12 }),
      arcSmelter('b-67', { copper_ingot: 3 }),
    ];
    const hint = fmtHandcraftHint(catalog, 'circuit_board', 11, {
      completedTechs: new Set(),
      inventory: {},
      buildings,
    });
    const text = hint.join('\n');
    assert.match(hint[0], /电路板 11（可手搓：circuit_board，铁块×1\+铜块×1 → 电路板×1；需 11 批 = 铁块×11\+铜块×11）/);
    // 铜块可手搓（smelt_copper），但背包/建筑里已有 → 直接给来源，不再展开。
    assert.match(text, /↳ 铜块 11：.*b-97 补给站\(56\)/);
    assert.match(text, /b-97 补给站\(56\) \/ b-55 电弧熔炉\(12\)/);
    // 铁块不可手搓（测试目录里 smelt_iron 的 handcraft_allowed=false），给出「不可手搓」。
    assert.match(text, /↳ 铁块 11：不可手搓/);
    assert.doesNotMatch(text, /b-67/);
  });

  it('递归展开：建筑里没有的中间产物沿手搓链继续展开', () => {
    const hint = fmtHandcraftHint(catalog, 'circuit_board', 2, {
      completedTechs: new Set(),
      inventory: { copper_ingot: 2 },
      buildings: [],
    });
    const text = hint.join('\n');
    assert.match(text, /↳ 铜块 2：背包已有/);
    assert.match(text, /↳ 铁块 2：不可手搓/);
  });

  it('递归展开示例：电路板 11 → 铜块给补给站来源、铁块继续沿手搓链展开', () => {
    const hint = fmtHandcraftHint(catalog, 'circuit_board', 11, {
      completedTechs: new Set(),
      inventory: {},
      buildings: [supplyStation('b-97', { copper_ingot: 56 })],
    });
    assert.equal(hint[0], '电路板 11（可手搓：circuit_board，铁块×1+铜块×1 → 电路板×1；需 11 批 = 铁块×11+铜块×11）');
    // 子行按配方输入顺序：铁块在前、铜块在后。
    assert.match(hint[1], /^  ↳ 铁块 11：不可手搓/);
    assert.equal(hint[2], '  ↳ 铜块 11：b-97 补给站(56)');
  });

  it('递归最多 3 层且配方环不会死循环', () => {
    const hint = fmtHandcraftHint(catalog, 'loop_a', 1, { completedTechs: new Set() });
    assert.ok(hint.length <= 4, `层数应受限：${hint.join(' | ')}`);
    assert.match(hint.join('\n'), /配方环，停止展开/);
  });

  it('findBuildingSources 只列库存 > 0 的前 2 个，按数量降序', () => {
    const buildings = [
      arcSmelter('b-3', { copper_ingot: 5 }),
      arcSmelter('b-1', { copper_ingot: 9 }),
      arcSmelter('b-2', { copper_ingot: 1 }),
      arcSmelter('b-4', { iron_ingot: 100 }),
    ];
    assert.deepEqual(findBuildingSources(buildings, 'copper_ingot'), [
      { id: 'b-1', type: 'arc_smelter', quantity: 9 },
      { id: 'b-3', type: 'arc_smelter', quantity: 5 },
    ]);
    assert.deepEqual(findBuildingSources(buildings, 'gold'), []);
  });
});

describe('cmdPlan 命令', () => {
  it('料齐时输出累计表与「料齐了」', async () => {
    const api = fakeApi({ inventory: { circuit_board: 15, glass: 9, iron_ingot: 2, magnetic_coil: 1 } });
    const out = stripAnsi(await cmdPlan(['build', '62', '146', 'matrix_lab', ';', 'build', '65', '146', 'wind_turbine'], { api, issuerId: 'builder-a' }));
    assert.match(out, /计划 2 项（matrix_lab, wind_turbine）/);
    assert.match(out, /电路板\s+8\s+15/);
    assert.match(out, /结论：料齐了/);
    assert.doesNotMatch(out, /✗/);
  });

  it('有缺口时结论以 ✗ 开头并给手搓提示（scripts/sw 据此非 0）', async () => {
    const api = fakeApi({ inventory: { circuit_board: 15 } });
    const out = stripAnsi(await cmdPlan(['build', '62', '146', 'matrix_lab'], { api, issuerId: 'builder-a' }));
    assert.match(out, /✗ 结论：缺 玻璃 4/);
    assert.match(out, /可手搓：glass/);
  });

  it('施工占用计入缺口', async () => {
    const api = fakeApi({
      inventory: { circuit_board: 15, glass: 4, iron_ingot: 2, magnetic_coil: 1 },
      tasks: [task({ cost: { items: [{ item_id: 'iron_ingot', quantity: 2 }] } })],
    });
    const out = stripAnsi(await cmdPlan(['build', '65', '146', 'wind_turbine'], { api, issuerId: 'builder-a' }));
    // 需要铁块 2，背包 2，占用 2 → 缺 2。
    assert.match(out, /铁块\s+2\s+2\s+2\s+2/);
    assert.match(out, /✗ 结论：缺 铁块 2/);
  });

  it('未知建筑类型直接报错，不发请求', async () => {
    const api = fakeApi();
    const out = stripAnsi(await cmdPlan(['build', '1', '1', 'no_such_building'], { api }));
    assert.match(out, /未知建筑类型：no_such_building/);
  });

  it('upgrade 按建筑当前等级算造价', async () => {
    const api = fakeApi({
      inventory: {},
      buildings: {
        'b-5': {
          id: 'b-5', type: 'wind_turbine', owner_id: 'p1', position: { x: 1, y: 1, z: 0 },
          hp: 10, max_hp: 10, level: 2, vision_range: 1,
          runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 2, height: 2 } }, state: 'running' },
        } as Building,
      },
    });
    const out = stripAnsi(await cmdPlan(['upgrade', 'b-5'], { api, issuerId: 'builder-a' }));
    assert.match(out, /计划 1 项（b-5 wind_turbine→L3）/);
    // 基础铁块 2 × L2 = 4，磁线圈 1 × 2 = 2。
    assert.match(out, /铁块\s+4/);
    assert.match(out, /磁线圈\s+2/);
  });

  it('没有绑定机甲时报错', async () => {
    const api = fakeApi({ mecha: undefined });
    const out = stripAnsi(await cmdPlan(['build', '1', '1', 'wind_turbine'], { api }));
    assert.match(out, /没有绑定的机甲/);
  });
});
