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
  cmdPlanNeed,
  expandNeed,
  fmtNeedTree,
  fmtSourceList,
  fmtStockMarker,
  leafTotals,
  pickRecipe,
  summarizeNeed,
  occupiedByTasks,
  parsePlanItems,
  recipeInputs,
  summarizeSources,
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
    { id: 'electromagnetic_matrix', name: '电磁矩阵' },
  ],
  buildings: [
    { id: 'supply_station', name: '补给站', buildable: true, build_cost: { items: [{ item_id: 'iron_ingot', quantity: 6 }] } },
    { id: 'arc_smelter', name: '电弧熔炉', buildable: true, build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }] } },
    { id: 'matrix_lab', buildable: true, build_cost: { items: [{ item_id: 'circuit_board', quantity: 8 }, { item_id: 'glass', quantity: 4 }] } },
    { id: 'wind_turbine', buildable: true, build_cost: { items: [{ item_id: 'iron_ingot', quantity: 2 }, { item_id: 'magnetic_coil', quantity: 1 }] } },
    { id: 'arc_smelter', buildable: true, build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }, { item_id: 'iron_ingot', quantity: 3 }] } },
    { id: 'foundation', buildable: false, build_cost: { items: [] } },
    { id: 'assembling_machine_mk1', name: '制造台 Mk.I', buildable: true, build_cost: { items: [] } },
  ],
  techs: [
    { id: 'glass', name: '玻璃', unlocks: [{ type: 'recipe', id: 'glass' }] },
    { id: 'electromagnetism', name: '电磁学', unlocks: [{ type: 'recipe', id: 'electromagnetic_matrix' }] },
  ],
  recipes: [
    {
      id: 'glass', name: '玻璃', handcraft_allowed: true, duration: 2, tech_unlock: ['glass'],
      inputs: [{ item_id: 'stone_ore', quantity: 2 }],
      outputs: [{ item_id: 'glass', quantity: 1 }],
    },
    {
      id: 'magnetic_coil', name: '磁线圈', handcraft_allowed: true, duration: 30,
      inputs: [{ item_id: 'magnet', quantity: 2 }, { item_id: 'copper_ingot', quantity: 1 }],
      outputs: [{ item_id: 'magnetic_coil', quantity: 2 }],
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
      id: 'electromagnetic_matrix', name: '电磁矩阵', handcraft_allowed: false, duration: 60,
      building_types: ['assembling_machine_mk1'], tech_unlock: ['electromagnetism'],
      inputs: [{ item_id: 'magnetic_coil', quantity: 1 }, { item_id: 'circuit_board', quantity: 1 }],
      outputs: [{ item_id: 'electromagnetic_matrix', quantity: 1 }],
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

function summary(view: MechaView | undefined, completedTechs: Record<string, number> = { glass: 1 }): StateSummary {
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
        tech: { player_id: 'p1', completed_techs: completedTechs },
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
  /** 已完成的科技（plan need 选配方用）；缺省只有 glass。 */
  completedTechs?: Record<string, number>;
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
    fetchSummary: async () => summary(view, options.completedTechs),
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

  it('建筑 / 配方 id 恰好叫计划动词时按位置解析，不切错', () => {
    // 数据表里将来出现 id 为 upgrade 的建筑 / id 为 build 的配方时也不误切。
    const upgradeBuilding = parsePlanItems('build 1 1 upgrade');
    assert.equal(upgradeBuilding.length, 1);
    assert.equal(upgradeBuilding[0].kind, 'build');
    assert.equal(upgradeBuilding[0].buildingType, 'upgrade');

    const buildRecipe = parsePlanItems('craft_item build 2');
    assert.equal(buildRecipe.length, 1);
    assert.equal(buildRecipe[0].kind, 'craft');
    assert.equal(buildRecipe[0].recipeId, 'build');
    assert.equal(buildRecipe[0].batches, 2);

    const craftBuilding = parsePlanItems('build 1 1 craft_item');
    assert.equal(craftBuilding.length, 1);
    assert.equal(craftBuilding[0].buildingType, 'craft_item');
  });

  it('位置参数吃满后，同名的下一个 token 才当新计划项', () => {
    // build 吃满 3 个后，第二个 upgrade 才是下一项；建筑的 id 恰好叫 upgrade。
    const items = parsePlanItems('build 1 1 upgrade upgrade b-5');
    assert.deepEqual(items.map((item) => item.kind), ['build', 'upgrade']);
    assert.equal(items[0].buildingType, 'upgrade');
    assert.equal(items[1].buildingId, 'b-5');

    const two = parsePlanItems('build 1 1 wind_turbine upgrade b-5');
    assert.deepEqual(two.map((item) => item.kind), ['build', 'upgrade']);
    assert.equal(two[1].buildingId, 'b-5');
  });

  it('位置参数没吃满时，动词 token 当参数（缺参数由 parsePlanItems 报错）', () => {
    // build 只给了 1 个位置参数就遇到 upgrade：不当新项，留给 build 的 <type>，
    // 再由「需要 <x> <y> <type>」报出可读错误。
    assert.throws(() => parsePlanItems('build 1 upgrade'), /需要 <x> <y> <type>/);
    assert.throws(() => parsePlanItems('craft_item gear build'), /正整数/);
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
    assert.match(text, /b-97 补给站\(56\)、b-55 电弧熔炉\(12\) 等 3 处   \[够\]/);
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
    assert.equal(hint[2], '  ↳ 铜块 11：b-97 补给站(56)   [够]');
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

  it('--json 每项带 building_type / position / building_id / recipe_id / batches', async () => {
    const api = fakeApi({
      inventory: { circuit_board: 15, glass: 9, iron_ingot: 2, magnetic_coil: 1 },
      buildings: {
        'b-5': {
          id: 'b-5', type: 'wind_turbine', owner_id: 'p1', position: { x: 1, y: 1, z: 0 },
          hp: 10, max_hp: 10, level: 1, vision_range: 1,
          runtime: { params: { energy_consume: 0, energy_generate: 0, capacity: 0, footprint: { width: 2, height: 2 } }, state: 'running' },
        } as Building,
      },
    });
    const out = await cmdPlan(
      ['build', '62', '146', 'matrix_lab', 'craft_item', 'glass', '3', 'upgrade', 'b-5', '--json'],
      { api, issuerId: 'builder-a' },
    );
    const parsed = JSON.parse(out) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(parsed.items[0], {
      kind: 'build', label: 'matrix_lab', building_type: 'matrix_lab', position: { x: 62, y: 146 },
    });
    assert.deepEqual(parsed.items[1], {
      kind: 'craft', label: 'craft glass×3', recipe_id: 'glass', batches: 3,
    });
    assert.deepEqual(parsed.items[2], {
      kind: 'upgrade', label: 'b-5 wind_turbine→L2', building_id: 'b-5', building_type: 'wind_turbine',
    });
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

describe('plan need', () => {
  const completed = new Set(['glass', 'electromagnetism']);

  it('pickRecipe 取单批产出最多的可用配方，科技未满足的跳过', () => {
    const catalogWithAlt = {
      ...catalog,
      recipes: [
        ...(catalog.recipes ?? []),
        {
          id: 'matrix_alt', name: '电磁矩阵（慢）', handcraft_allowed: false, duration: 120,
          inputs: [{ item_id: 'magnetic_coil', quantity: 2 }],
          outputs: [{ item_id: 'electromagnetic_matrix', quantity: 1 }],
        },
        {
          id: 'matrix_bulk', name: '电磁矩阵（双）', handcraft_allowed: false, duration: 120,
          tech_unlock: ['electromagnetism'],
          inputs: [{ item_id: 'magnetic_coil', quantity: 2 }],
          outputs: [{ item_id: 'electromagnetic_matrix', quantity: 2 }],
        },
      ],
    } as unknown as CatalogView;
    // 单批产出 2 的优先。
    assert.equal(pickRecipe(catalogWithAlt, 'electromagnetic_matrix', { completedTechs: completed })?.id, 'matrix_bulk');
    // 科技没完成时 matrix_bulk（门槛 electromagnetism）被过滤，同物品的 matrix_alt 无门槛 → 选它。
    assert.equal(pickRecipe(catalogWithAlt, 'electromagnetic_matrix', { completedTechs: new Set() })?.id, 'matrix_alt');
    // 只剩有科技门槛的配方、科技又没完成时 → 没有可用配方。
    assert.equal(
      pickRecipe(catalog, 'electromagnetic_matrix', { completedTechs: new Set() }),
      undefined,
    );
    // 显式 --from 不看科技门槛。
    assert.equal(
      pickRecipe(catalogWithAlt, 'electromagnetic_matrix', { recipeId: 'electromagnetic_matrix', completedTechs: new Set() })?.id,
      'electromagnetic_matrix',
    );
    // 基础原料没有配方。
    assert.equal(pickRecipe(catalog, 'iron_ore', { completedTechs: completed }), undefined);
  });

  it('expandNeed 递归展开到基础原料，原料按每批产量取整', () => {
    const root = expandNeed(catalog, 'electromagnetic_matrix', 20, {
      completedTechs: completed,
      stockOf: () => 0,
    });
    // 电磁矩阵 20 → 磁线圈 20 + 电路板 20。
    assert.equal(root.children.length, 2);
    assert.equal(root.children[0].itemId, 'magnetic_coil');
    assert.equal(root.children[0].quantity, 20);
    // 磁线圈配方每批产 2：20 个 = 10 批 → 磁铁 20、铜块 10。
    assert.equal(root.children[0].children[0].itemId, 'magnet');
    assert.equal(root.children[0].children[0].quantity, 20);
    assert.equal(root.children[0].children[1].itemId, 'copper_ingot');
    assert.equal(root.children[0].children[1].quantity, 10);
    assert.equal(root.children[0].children[0].children[0].itemId, 'iron_ore');
    assert.equal(root.children[0].children[0].children[0].leafReason, 'base');
    // 电路板 → 铁块 + 铜块 → 铁矿 / 铜矿。
    const board = root.children[1];
    assert.equal(board.itemId, 'circuit_board');
    assert.deepEqual(board.children.map((child) => child.itemId), ['iron_ingot', 'copper_ingot']);
    // 铁矿 20（磁铁）+ 20（电路板铁块）= 40；铜矿 10（磁线圈铜块）+ 20（电路板铜块）= 30。
    assert.deepEqual(leafTotals(root), new Map([['iron_ore', 40], ['copper_ore', 30]]));
  });

  it('多级展开：每批产量 > 1 时按批数向上取整', () => {
    // 磁线圈 3 个：每批 2 个 → 2 批 → 磁铁 4、铜块 2。
    const root = expandNeed(catalog, 'magnetic_coil', 3, { completedTechs: completed, stockOf: () => 0 });
    assert.equal(root.children[0].quantity, 4);
    assert.equal(root.children[1].quantity, 2);
  });

  it('检测配方环：环上的物品停止展开', () => {
    const root = expandNeed(catalog, 'loop_a', 1, { completedTechs: completed, stockOf: () => 0 });
    const text = fmtNeedTree(catalog, root).join('\n');
    assert.match(text, /^loop_a 1 ← loop_a/m);
    assert.match(text, /loop_b 1 ← loop_b/);
    assert.match(text, /loop_a 1（配方环，停止展开）/);
    // 环上不再往下展开。
    assert.equal(text.split('\n').length, 3);
  });

  it('最多展开 6 层', () => {
    // 构造一条 8 层深的链：item_0 → item_1 → … → item_8。
    const recipes = Array.from({ length: 8 }, (_, i) => ({
      id: `chain_${i}`, name: `链${i}`, handcraft_allowed: false, duration: 1,
      inputs: [{ item_id: `item_${i + 1}`, quantity: 1 }],
      outputs: [{ item_id: `item_${i}`, quantity: 1 }],
    }));
    const chainCatalog = {
      items: Array.from({ length: 9 }, (_, i) => ({ id: `item_${i}`, name: `物品${i}` })),
      buildings: [],
      recipes,
    } as unknown as CatalogView;
    const root = expandNeed(chainCatalog, 'item_0', 1, { completedTechs: completed, stockOf: () => 0 });
    const text = fmtNeedTree(chainCatalog, root).join('\n');
    assert.match(text, /物品6 1（展开到 6 层上限，不再展开）/);
    assert.doesNotMatch(text, /物品7/);
  });

  it('缺口 = 需要 − 现有量；现有量来自背包 + 建筑库存', () => {
    const rows = summarizeNeed(catalog, expandNeed(catalog, 'electromagnetic_matrix', 20, {
      completedTechs: completed,
      stockOf: (id) => (id === 'iron_ore' ? 60 : 0),
    }));
    const iron = rows.find((row) => row.itemId === 'iron_ore');
    assert.deepEqual(iron, { itemId: 'iron_ore', need: 40, stock: 60, gap: 0 });
    const copper = rows.find((row) => row.itemId === 'copper_ore');
    assert.deepEqual(copper, { itemId: 'copper_ore', need: 30, stock: 0, gap: 30 });
  });

  it('--from 显式指定配方', async () => {
    const api = fakeApi({ inventory: {}, completedTechs: { glass: 1, electromagnetism: 1 } });
    const out = stripAnsi(await cmdPlanNeed(['need', 'electromagnetic_matrix', '2', '--from', 'electromagnetic_matrix'], { api, issuerId: 'builder-a' }));
    assert.match(out, /电磁矩阵 2 ← electromagnetic_matrix（制造台 Mk.I）/);
    assert.match(out, /磁线圈 2 ← magnetic_coil/);
  });

  it('未知物品 / 未知配方 / 配方不产该物品都报错', async () => {
    const api = fakeApi();
    assert.match(stripAnsi(await cmdPlanNeed(['need', 'no_such_item', '1'], { api, issuerId: 'builder-a' })), /未知物品：no_such_item/);
    assert.match(stripAnsi(await cmdPlanNeed(['need', 'electromagnetic_matrix', '1', '--from', 'nope'], { api, issuerId: 'builder-a' })), /未知配方：nope/);
    assert.match(stripAnsi(await cmdPlanNeed(['need', 'electromagnetic_matrix', '1', '--from', 'glass'], { api, issuerId: 'builder-a' })), /配方 glass 不产出「电磁矩阵」/);
    assert.match(stripAnsi(await cmdPlanNeed(['need', 'electromagnetic_matrix', 'x'], { api, issuerId: 'builder-a' })), /数量必须是正整数/);
  });

  it('cmdPlan 把 need 子命令转给 cmdPlanNeed', async () => {
    const api = fakeApi({ inventory: {}, completedTechs: { glass: 1, electromagnetism: 1 } });
    const out = stripAnsi(await cmdPlan(['need', 'electromagnetic_matrix', '2'], { api, issuerId: 'builder-a' }));
    assert.match(out, /^需要 电磁矩阵 2/);
    assert.match(out, /汇总/);
  });

  it('现有量够时结论「现有量够」，不够时 ✗ 结论', async () => {
    // 基础原料够 = 中间产物也都能现做，全部缺口归零。
    const enough = fakeApi({
      inventory: { iron_ore: 100, copper_ore: 100 },
      completedTechs: { glass: 1, electromagnetism: 1 },
    });
    const out = stripAnsi(await cmdPlanNeed(['need', 'electromagnetic_matrix', '20'], { api: enough, issuerId: 'builder-a' }));
    assert.match(out, /结论：现有量够/);
    assert.doesNotMatch(out, /✗/);
    // 中间产物行也按现有原料折算：磁线圈 20 ← magnetic_coil 仍在树里（要现做）。

    const short = fakeApi({ inventory: { iron_ore: 30, copper_ore: 100 }, completedTechs: { glass: 1, electromagnetism: 1 } });
    const out2 = stripAnsi(await cmdPlanNeed(['need', 'electromagnetic_matrix', '20'], { api: short, issuerId: 'builder-a' }));
    assert.match(out2, /✗ 结论：还缺 铁矿 10/);
  });

  it('--json 给树与汇总', async () => {
    const api = fakeApi({ inventory: {}, completedTechs: { glass: 1, electromagnetism: 1 } });
    const out = await cmdPlanNeed(['need', 'electromagnetic_matrix', '2', '--json'], { api, issuerId: 'builder-a' });
    const parsed = JSON.parse(out) as {
      tree: { item_id: string; recipe_id?: string; children: unknown[] };
      summary: Array<{ item_id: string; need: number; stock: number; gap: number }>;
      gap_total: number;
    };
    assert.equal(parsed.tree.item_id, 'electromagnetic_matrix');
    assert.equal(parsed.tree.recipe_id, 'electromagnetic_matrix');
    assert.equal(parsed.tree.children.length, 2);
    const iron = parsed.summary.find((row) => row.item_id === 'iron_ore');
    // 电磁矩阵 2 → 磁线圈 2（1 批，磁铁 2 + 铜块 1）+ 电路板 2（铁块 2 + 铜块 2）。
    assert.deepEqual(iron, { item_id: 'iron_ore', name: '铁矿', need: 4, stock: 0, gap: 4 });
    // 铜矿 1（磁线圈 1 批的铜块 1）+ 2（电路板 2 批的铜块 2）= 3；铁矿 4 → 合计 7。
    assert.equal(parsed.gap_total, 7);
  });
});

describe('plan 来源可取出数量与够不够标记', () => {
  it('summarizeSources 按 inventory + output_buffer 合计、只列 > 0、按数量降序', () => {
    const buildings = [
      { ...arcSmelter('b-55', { copper_ingot: 2 }), storage: { inventory: { copper_ingot: 1 }, output_buffer: { copper_ingot: 1 } } },
      arcSmelter('b-1', { copper_ingot: 9 }),
      arcSmelter('b-2', { copper_ingot: 0 }),
      arcSmelter('b-4', { iron_ingot: 100 }),
    ];
    const summary = summarizeSources(buildings, 'copper_ingot');
    assert.deepEqual(summary.listed, [
      { id: 'b-1', type: 'arc_smelter', quantity: 9 },
      { id: 'b-55', type: 'arc_smelter', quantity: 2 },
    ]);
    assert.equal(summary.total, 11);
    assert.equal(summary.count, 2);
    assert.deepEqual(summarizeSources(buildings, 'gold'), { listed: [], total: 0, count: 0 });
  });

  it('fmtStockMarker：够标 [够]，不够标还差多少', () => {
    assert.equal(fmtStockMarker(4, 4), '[够]');
    assert.equal(fmtStockMarker(10, 4), '[够]');
    assert.equal(fmtStockMarker(48, 60), '[不够，还差 12]');
    assert.equal(fmtStockMarker(0, 5), '[不够，还差 5]');
  });

  it('fmtSourceList 超过 limit 处时补「等 N 处」', () => {
    const summary = summarizeSources([
      supplyStation('b-97', { copper_ingot: 42 }),
      arcSmelter('b-55', { copper_ingot: 2 }),
      arcSmelter('b-67', { copper_ingot: 1 }),
    ], 'copper_ingot');
    assert.equal(fmtSourceList(catalog, summary), 'b-97 补给站(42)、b-55 电弧熔炉(2) 等 3 处');
    assert.equal(fmtSourceList(catalog, summarizeSources([supplyStation('b-97', { copper_ingot: 42 })], 'copper_ingot')), 'b-97 补给站(42)');
  });

  it('缺口提示的来源列带数量与 [够]', () => {
    const hint = fmtHandcraftHint(catalog, 'circuit_board', 2, {
      completedTechs: new Set(),
      inventory: {},
      buildings: [supplyStation('b-97', { copper_ingot: 42 }), arcSmelter('b-55', { copper_ingot: 2 })],
    }).join('\n');
    assert.match(hint, /↳ 铜块 2：b-97 补给站\(42\)、b-55 电弧熔炉\(2\)   \[够\]/);
  });

  it('来源合计不够时不再写来源，改为按缺口继续沿手搓链展开', () => {
    const hint = fmtHandcraftHint(catalog, 'circuit_board', 60, {
      completedTechs: new Set(),
      inventory: {},
      buildings: [supplyStation('b-97', { copper_ingot: 40 }), arcSmelter('b-55', { copper_ingot: 2 })],
    }).join('\n');
    // 铜块合计 42 < 60 → 缺口 18，铜块本身可手搓（smelt_copper），继续展开到铜矿。
    assert.match(hint, /↳ 铜块 18（可手搓：smelt_copper/);
    assert.match(hint, /↳ 铜矿 18：不可手搓，需要生产建筑/);
  });

  it('不可手搓物品的来源也带数量与标记', () => {
    const hint = fmtHandcraftHint(catalog, 'iron_ingot', 12, {
      completedTechs: new Set(),
      inventory: {},
      buildings: [arcSmelter('b-49', { iron_ingot: 48 })],
    }).join('\n');
    assert.match(hint, /铁块 12：不可手搓，从 b-49 电弧熔炉\(48\) 取   \[够\]/);
    const short = fmtHandcraftHint(catalog, 'iron_ingot', 60, {
      completedTechs: new Set(),
      inventory: {},
      buildings: [arcSmelter('b-49', { iron_ingot: 48 })],
    }).join('\n');
    assert.match(short, /铁块 60：不可手搓，从 b-49 电弧熔炉\(48\) 取   \[不够，还差 12\]/);
  });

  it('--json 的 sources 带 available / gap / enough', async () => {
    const api = fakeApi({
      inventory: {},
      sceneBuildings: { 'b-49': arcSmelter('b-49', { iron_ingot: 48 }) },
    });
    const out = await cmdPlan(['build', '62', '146', 'matrix_lab', '--json'], { api, issuerId: 'builder-a' });
    const parsed = JSON.parse(out) as {
      gaps: Record<string, number>;
      sources: Record<string, { buildings: unknown[]; available: number; gap: number; enough: boolean }>;
    };
    assert.equal(parsed.gaps.circuit_board, 8);
    assert.equal(parsed.sources.circuit_board.available, 0);
    assert.equal(parsed.sources.circuit_board.enough, false);
    assert.equal(parsed.sources.circuit_board.gap, 8);
  });
});
