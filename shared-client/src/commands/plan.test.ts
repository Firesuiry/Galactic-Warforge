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
  fmtHandcraftHint,
  occupiedByTasks,
  parsePlanItems,
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
  ],
  buildings: [
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

  it('未知命令与缺参数报错', () => {
    assert.throws(() => parsePlanItems('move u-1 3 4'), /只支持 build \/ upgrade/);
    assert.throws(() => parsePlanItems('build 1 wind_turbine'), /需要 <x> <y> <type>/);
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

  it('upgrade 造价按等级线性放大（向上取整）', () => {
    assert.deepEqual(upgradeCost([{ item_id: 'iron_ingot', quantity: 3 }], 2), [{ item_id: 'iron_ingot', quantity: 6 }]);
    assert.deepEqual(upgradeCost([{ item_id: 'glass', quantity: 1 }], 3), [{ item_id: 'glass', quantity: 3 }]);
  });
});

describe('plan 可手搓提示', () => {
  it('可手搓物品给出配方与原料换算', () => {
    const hint = fmtHandcraftHint(catalog, 'glass', 4, new Set());
    assert.match(hint, /可手搓：glass/);
    assert.match(hint, /石矿×2 → 玻璃×1/);
    assert.match(hint, /需 4 批 = 石矿×8/);
  });

  it('不可手搓物品明说需要生产建筑', () => {
    assert.match(fmtHandcraftHint(catalog, 'iron_ingot', 2, new Set()), /没有可手搓配方/);
  });

  it('未解锁科技会写出来', () => {
    assert.match(fmtHandcraftHint(catalog, 'glass', 1, new Set()), /未解锁科技 glass/);
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
