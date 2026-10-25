import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { ApiClient } from '../api.js';
import type { CatalogView } from '../types.js';

import { cmdDrain, cmdFeed } from './item-transfer.js';

/** 假时钟：sleep 只推进时间，不真的等。 */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    elapsed: () => now,
  };
}

interface FakeBuilding {
  id: string;
  type: string;
  inventory: Record<string, number>;
  outputBuffer: Record<string, number>;
  /** 装入窗口容量（当前占用 = inventory 总量），undefined = 不限。 */
  inputWindow?: number;
  /** 每次装入前先消耗多少该物品（模拟建筑消耗原料）。 */
  consumePerCall?: number;
  /** 前 N 次装入返回 STORAGE_FULL（模拟窗口已满、等消耗）。 */
  fullForCalls?: number;
  /** 每次装入最多收多少。 */
  acceptPerTransfer?: number;
  /** 致命拒收（类型/槽位/研究模式等）。 */
  reject?: { code: string; message: string };
  /** 按物品拒收（多物品里只有一种装不进去）。 */
  rejectItems?: Record<string, { code: string; message: string }>;
  /** 每次取货最多给多少；0 = 背包已满。 */
  givePerTransfer?: number;
  /** 取货致命错误（执行体不可用、终局等）。 */
  takeError?: { code: string; message: string };
}

interface FakeState {
  backpack: Record<string, number>;
  buildings: Record<string, FakeBuilding>;
  slotsUsed: number;
  slotsTotal: number;
  /** 每个目标建筑累计收下的数量（验证「目标确实收够了」）。 */
  acceptedTotals: Record<string, Record<string, number>>;
}

interface FakeOptions {
  backpack: Record<string, number>;
  buildings: FakeBuilding[];
  /** 每次 to_player 成功取货后触发（测试里可拆建筑/补库存）。 */
  onTake?: (state: FakeState, itemId: string, taken: number) => void;
}

const CATALOG = {
  items: [
    { id: 'magnetic_coil', name: '磁线圈' },
    { id: 'circuit_board', name: '电路板' },
    { id: 'iron_ingot', name: '铁块' },
    { id: 'iron_ore', name: '铁矿' },
    { id: 'electromagnetic_matrix', name: '电磁矩阵' },
  ],
  buildings: [
    { id: 'assembling_machine_mk1', name: '矩阵制造台 Mk.I' },
    { id: 'arc_smelter', name: '电弧熔炉' },
    { id: 'matrix_lab', name: '矩阵研究站' },
    { id: 'depot_mk1', name: '小型储物仓' },
  ],
} as unknown as CatalogView;

function createFakeApi(options: FakeOptions) {
  const state: FakeState = {
    backpack: { ...options.backpack },
    buildings: Object.fromEntries(
      options.buildings.map((building) => [building.id, { ...building, inventory: { ...building.inventory }, outputBuffer: { ...building.outputBuffer } }]),
    ),
    slotsUsed: 0,
    slotsTotal: 40,
    acceptedTotals: {},
  };
  const transferCalls: Array<{ buildingId: string; itemId: string; quantity: number; direction: string }> = [];
  const pending = new Map<string, { status: string; code: string; message: string }>();
  let sequence = 0;

  function simulate(buildingId: string, itemId: string, quantity: number, direction: string) {
    const building = state.buildings[buildingId];
    if (!building) {
      return { status: 'failed', code: 'ENTITY_NOT_FOUND', message: '未找到建筑（可能已被拆除）' };
    }
    if (direction === 'to_player') {
      const stored = (building.inventory[itemId] ?? 0) + (building.outputBuffer[itemId] ?? 0);
      if (stored <= 0) {
        return {
          status: 'failed',
          code: 'INSUFFICIENT_RESOURCE',
          message: `${building.type}里没有可取出的「${itemId}」`,
        };
      }
      if (building.takeError) {
        return { status: 'failed', ...building.takeError };
      }
      const free = building.givePerTransfer ?? quantity;
      if (free <= 0) {
        return {
          status: 'failed',
          code: 'INSUFFICIENT_RESOURCE',
          message: `背包已满（已用 ${state.slotsUsed}/${state.slotsTotal} 格），装不下取出的「${itemId}」：先腾出空位或改送到别的建筑`,
        };
      }
      const taken = Math.min(quantity, stored, free);
      let left = taken;
      for (const bucket of [building.outputBuffer, building.inventory]) {
        const have = bucket[itemId] ?? 0;
        const remove = Math.min(have, left);
        bucket[itemId] = have - remove;
        left -= remove;
      }
      state.backpack[itemId] = (state.backpack[itemId] ?? 0) + taken;
      options.onTake?.(state, itemId, taken);
      return { status: 'executed', code: 'OK', message: `已取出 ${taken} 个「${itemId}」` };
    }

    const have = state.backpack[itemId] ?? 0;
    if (have < quantity) {
      return {
        status: 'failed',
        code: 'INSUFFICIENT_RESOURCE',
        message: `机甲背包需有 ${quantity} 个「${itemId}」，当前 ${have} 个`,
      };
    }
    if (building.reject) {
      return { status: 'failed', ...building.reject };
    }
    const rejectedItem = building.rejectItems?.[itemId];
    if (rejectedItem) {
      return { status: 'failed', ...rejectedItem };
    }
    if (building.consumePerCall) {
      building.inventory[itemId] = Math.max(0, (building.inventory[itemId] ?? 0) - building.consumePerCall);
    }
    let room: number;
    if (building.fullForCalls && building.fullForCalls > 0) {
      building.fullForCalls -= 1;
      room = 0;
    } else if (building.acceptPerTransfer !== undefined) {
      room = building.acceptPerTransfer;
    } else if (building.inputWindow !== undefined) {
      // 每种原料各自的输入窗口（服务端是共享缓冲，测试按单项窗口模拟足够）。
      room = Math.max(0, building.inputWindow - (building.inventory[itemId] ?? 0));
    } else {
      room = quantity;
    }
    const accepted = Math.min(quantity, have, room);
    if (accepted <= 0) {
      return {
        status: 'failed',
        code: 'STORAGE_FULL',
        message: '无法接收「' + itemId + '」：输入缓冲已满，等建筑消耗后再装入',
      };
    }
    building.inventory[itemId] = (building.inventory[itemId] ?? 0) + accepted;
    state.backpack[itemId] = have - accepted;
    const totals = (state.acceptedTotals[buildingId] ??= {});
    totals[itemId] = (totals[itemId] ?? 0) + accepted;
    return { status: 'executed', code: 'OK', message: `已传输 ${accepted} 个「${itemId}」至建筑` };
  }

  const api = {
    getAuth: () => ({ playerId: 'p1', issuerId: 'builder-a' }),
    fetchSummary: async () => ({
      tick: 1,
      active_planet_id: 'planet-1-1',
      surface: { topology: 'cube_sphere', face_size: 8 },
      map_width: 24,
      map_height: 16,
      players: {
        p1: {
          player_id: 'p1',
          is_alive: true,
          mechas: [
            {
              unit_id: 'u-1',
              planet_id: 'planet-1-1',
              operator: 'builder-a',
              alive: true,
              respawn_at_tick: 0,
              inventory: { ...state.backpack },
              inventory_slots_used: state.slotsUsed,
              inventory_slots_total: state.slotsTotal,
              operate_range: 18,
              concurrent_tasks: 2,
              construction_active: 0,
              construction_pending: 0,
            },
          ],
        },
      },
    }),
    fetchCatalog: async () => CATALOG,
    fetchPlanetInspect: async (planetId: string, params: { entityId: string }) => {
      const building = state.buildings[params.entityId];
      if (!building) {
        throw new Error('HTTP 404: not found');
      }
      return {
        planet_id: planetId,
        discovered: true,
        building: {
          id: building.id,
          type: building.type,
          owner_id: 'p1',
          position: { x: 0, y: 0 },
          hp: 1,
          max_hp: 1,
          level: 1,
          vision_range: 1,
          runtime: { state: 'running' },
          storage: { inventory: building.inventory, output_buffer: building.outputBuffer },
        },
      };
    },
    cmdTransferItem: async (buildingId: string, itemId: string, quantity: number, _planetId: string, direction: string) => {
      transferCalls.push({ buildingId, itemId, quantity, direction });
      const outcome = simulate(buildingId, itemId, quantity, direction);
      sequence += 1;
      const requestId = `req-${sequence}`;
      pending.set(requestId, outcome);
      return {
        request_id: requestId,
        accepted: true,
        enqueue_tick: 1,
        results: [{ command_index: 0, status: 'accepted', code: 'OK', message: 'accepted' }],
      };
    },
    awaitExecution: async (requestId: string) => {
      const outcome = pending.get(requestId) ?? { status: 'failed', code: 'EXECUTION_TIMEOUT', message: 'missing' };
      return { status: 'executed', outcomes: [{ command_index: 0, ...outcome }] };
    },
  } as unknown as ApiClient;
  return { api, state, transferCalls };
}

function context(api: ApiClient, clock: ReturnType<typeof fakeClock>) {
  return { api, issuerId: 'builder-a', waitOptions: { now: clock.now, sleep: clock.sleep, pollIntervalMs: 1000 } };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function building(overrides: Partial<FakeBuilding> & { id: string }): FakeBuilding {
  return { type: 'assembling_machine_mk1', inventory: {}, outputBuffer: {}, ...overrides };
}

describe('feed 累计装入', () => {
  it('多轮装载：窗口 8、每轮消耗 4，两个物品各 20 一次命令装满', async () => {
    const clock = fakeClock();
    const { api, state, transferCalls } = createFakeApi({
      backpack: { magnetic_coil: 20, circuit_board: 20 },
      buildings: [building({ id: 'b-1', inputWindow: 8, consumePerCall: 4 })],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil:20,circuit_board:20', '--wait'], context(api, clock)));
    assert.match(out, /✓ 已装入 矩阵制造台 Mk\.I：磁线圈 20\/20、电路板 20\/20（共 \d+ 次搬运，用 \d+ 秒）/);
    assert.ok(transferCalls.length > 4, `应当多轮搬运，实际 ${transferCalls.length} 次`);
    assert.equal(state.backpack.magnetic_coil, 0);
    assert.equal(state.backpack.circuit_board, 0);
  });

  it('无 --wait：装到窗口满就失败，报告已装/目标与差额', async () => {
    const clock = fakeClock();
    const { api, transferCalls } = createFakeApi({
      backpack: { magnetic_coil: 20 },
      buildings: [building({ id: 'b-1', inputWindow: 8 })],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil:20'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /磁线圈 8\/20/);
    assert.match(out, /还差磁线圈 12/);
    assert.equal(transferCalls.length, 1);
  });

  it('背包不足：要求 20 只有 5，不无限循环，报告还差多少', async () => {
    const clock = fakeClock();
    const { api: apiWait } = createFakeApi({
      backpack: { magnetic_coil: 5 },
      buildings: [building({ id: 'b-1', inputWindow: 8 })],
    });
    const waitOut = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil:20', '--wait'], context(apiWait, clock)));
    assert.match(waitOut, /^✗ /);
    assert.match(waitOut, /磁线圈 5\/20/);
    assert.match(waitOut, /背包里没有「磁线圈」/);

    const { api } = createFakeApi({
      backpack: { magnetic_coil: 5 },
      buildings: [building({ id: 'b-1', inputWindow: 8 })],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil:20'], context(api, fakeClock())));
    assert.match(out, /还差磁线圈 15/);
  });

  it('STORAGE_FULL：无 --wait 立即失败并提示加 --wait；--wait 等到消耗后成功', async () => {
    const clock = fakeClock();
    const { api: apiNoWait } = createFakeApi({
      backpack: { iron_ore: 10 },
      buildings: [building({ id: 'b-1', fullForCalls: 2, acceptPerTransfer: 8 })],
    });
    const noWait = stripAnsi(await cmdFeed(['b-1', 'iron_ore:10'], context(apiNoWait, clock)));
    assert.match(noWait, /^✗ /);
    assert.match(noWait, /无法接收/);
    assert.match(noWait, /加 --wait 等消耗/);

    const clockWait = fakeClock();
    const { api: apiWait, state } = createFakeApi({
      backpack: { iron_ore: 10 },
      buildings: [building({ id: 'b-1', fullForCalls: 2, acceptPerTransfer: 8 })],
    });
    const waitOut = stripAnsi(await cmdFeed(['b-1', 'iron_ore:10', '--wait'], context(apiWait, clockWait)));
    assert.match(waitOut, /^✓ /);
    assert.match(waitOut, /铁矿 10\/10/);
    assert.equal(state.backpack.iron_ore, 0);
    assert.ok(clockWait.elapsed() >= 2000, `应当等到建筑消耗（实际 ${clockWait.elapsed()}ms）`);
  });

  it('致命错误（研究站拒收非矩阵）立即失败，不等待不重试', async () => {
    const clock = fakeClock();
    const { api, transferCalls } = createFakeApi({
      backpack: { iron_ingot: 10 },
      buildings: [
        building({
          id: 'b-lab',
          type: 'matrix_lab',
          reject: { code: 'VALIDATION_FAILED', message: '矩阵研究站处于研究模式，只接受矩阵（研究耗材）' },
        }),
      ],
    });
    const out = stripAnsi(await cmdFeed(['b-lab', 'iron_ingot:10', '--wait'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /矩阵研究站处于研究模式/);
    assert.equal(transferCalls.length, 1);
    assert.equal(clock.elapsed(), 0);
  });

  it('目标建筑被拆（ENTITY_NOT_FOUND）→ ✗ 原文', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({ backpack: { iron_ore: 10 }, buildings: [] });
    const out = stripAnsi(await cmdFeed(['b-gone', 'iron_ore:10'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /未找到建筑/);
  });

  it('--fill：一次装到当前窗口上限即成功（即使只收 8）', async () => {
    const clock = fakeClock();
    const { api, state, transferCalls } = createFakeApi({
      backpack: { magnetic_coil: 30 },
      buildings: [building({ id: 'b-1', acceptPerTransfer: 8 })],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil', '--fill'], context(api, clock)));
    assert.match(out, /^✓ /);
    assert.match(out, /磁线圈 8 个/);
    assert.equal(transferCalls.length, 1);
    assert.equal(state.backpack.magnetic_coil, 22);
  });

  it('回执只数成功搬运：被 STORAGE_FULL 挡回的尝试不计入', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: { iron_ore: 10 },
      buildings: [building({ id: 'b-1', fullForCalls: 1, acceptPerTransfer: 8 })],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'iron_ore:10', '--wait'], context(api, clock)));
    assert.match(out, /^✓ /);
    assert.match(out, /铁矿 10\/10/);
    assert.match(out, /共 2 次搬运/);
  });

  it('--wait 超时：报告每项已装/目标与原因', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: { magnetic_coil: 10 },
      buildings: [building({ id: 'b-1', fullForCalls: 100 })],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil:10', '--wait', '--timeout', '3'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /超时 3s/);
    assert.match(out, /磁线圈 0\/10/);
  });

  it('参数错误：重复物品 / count=0 / --fill+count / --wait 缺 count', async () => {
    const clock = fakeClock();
    const cases = [
      ['b-1', 'magnetic_coil:20,magnetic_coil:10'],
      ['b-1', 'magnetic_coil:0'],
      ['b-1', 'magnetic_coil:20', '--fill'],
      ['b-1', 'magnetic_coil', '--wait'],
    ];
    for (const args of cases) {
      const { api, transferCalls } = createFakeApi({
        backpack: { magnetic_coil: 30 },
        buildings: [building({ id: 'b-1' })],
      });
      const out = stripAnsi(await cmdFeed(args, context(api, clock)));
      assert.match(out, /^Error: /, `${args.join(' ')} 应当是参数错误：${out}`);
      assert.equal(transferCalls.length, 0);
    }
  });

  it('多物品中一种被拒收：不阻塞另一种，最终按失败汇总', async () => {
    const clock = fakeClock();
    const { api, state, transferCalls } = createFakeApi({
      backpack: { magnetic_coil: 20, circuit_board: 20 },
      buildings: [
        building({
          id: 'b-1',
          acceptPerTransfer: 8,
          rejectItems: { circuit_board: { code: 'VALIDATION_FAILED', message: '建筑只接受 3 种物品，槽位已满' } },
        }),
      ],
    });
    const out = stripAnsi(await cmdFeed(['b-1', 'magnetic_coil:20,circuit_board:20'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /磁线圈 8\/20/);
    assert.match(out, /电路板：建筑只接受 3 种物品/);
    assert.ok(transferCalls.some((call) => call.itemId === 'magnetic_coil'));
    assert.equal(state.backpack.magnetic_coil, 12);
  });
});

describe('drain 取货 / 转运', () => {
  it('源里没有该物品 → ✗ 服务端原文', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-smelter', type: 'arc_smelter' })],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /没有可取出的「iron_ingot」/);
  });

  it('未指定物品且源全空 → ✗ 建筑里没有可取出的物品', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-smelter', type: 'arc_smelter' })],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /建筑里没有可取出的物品/);
  });

  it('背包满且无 --to → ✗ 报告已取出/源剩余', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-smelter', type: 'arc_smelter', inventory: {}, outputBuffer: { iron_ingot: 8 }, givePerTransfer: 0 })],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /背包已满/);
    assert.match(out, /源里还剩 8 个/);
  });

  it('--to 目标不存在 → 立即 ✗，不发搬运命令', async () => {
    const clock = fakeClock();
    const { api, transferCalls } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 8 } })],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot', '--to', 'b-ghost'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /目标建筑 b-ghost 不存在/);
    assert.equal(transferCalls.length, 0);
  });

  it('--to 目标不收该物品 → 立即 ✗ 并报告背包里还剩多少', async () => {
    const clock = fakeClock();
    const { api, transferCalls } = createFakeApi({
      backpack: {},
      buildings: [
        building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 5 }, givePerTransfer: 5 }),
        building({
          id: 'b-lab',
          type: 'matrix_lab',
          reject: { code: 'VALIDATION_FAILED', message: '矩阵研究站处于研究模式，只接受矩阵（研究耗材）' },
        }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot', '--to', 'b-lab'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /只接受矩阵/);
    assert.match(out, /背包残留 5/);
    assert.ok(transferCalls.length <= 3, `不能无限重试（实际 ${transferCalls.length} 次）`);
  });

  it('--to 目标满（STORAGE_FULL）→ 等目标消耗后继续并成功', async () => {
    const clock = fakeClock();
    const { api, state } = createFakeApi({
      backpack: {},
      buildings: [
        building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 18 }, givePerTransfer: 18 }),
        building({ id: 'b-depot', type: 'depot_mk1', fullForCalls: 2, acceptPerTransfer: 100 }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot', '--to', 'b-depot'], context(api, clock)));
    assert.match(out, /^✓ 已转运 电弧熔炉 → 小型储物仓：铁块 18 个/);
    assert.equal(state.buildings['b-depot'].inventory.iron_ingot, 18);
    assert.ok(clock.elapsed() >= 2000);
  });

  it('--to 目标一直满 → 超时 ✗，报告背包里还剩多少', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: {},
      buildings: [
        building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 18 }, givePerTransfer: 18 }),
        building({ id: 'b-depot', type: 'depot_mk1', fullForCalls: 100 }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot', '--to', 'b-depot', '--timeout', '3'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /超时 3s/);
    assert.match(out, /背包残留 18/);
  });

  it('源被拆中途 → ✗ 带已取出数', async () => {
    const clock = fakeClock();
    let removed = false;
    const { api } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-depot', type: 'depot_mk1', inventory: { iron_ingot: 10 }, givePerTransfer: 5 })],
      onTake: (state) => {
        if (!removed) {
          removed = true;
          delete state.buildings['b-depot'];
        }
      },
    });
    const out = stripAnsi(await cmdDrain(['b-depot', 'iron_ingot'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /源建筑已不存在/);
    assert.match(out, /铁块 5 个/);
  });

  it('count 大于源库存 → 取到空即成功并注明源已空', async () => {
    const clock = fakeClock();
    const { api, state } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-depot', type: 'depot_mk1', outputBuffer: { iron_ingot: 8 }, givePerTransfer: 8 })],
    });
    const out = stripAnsi(await cmdDrain(['b-depot', 'iron_ingot:100'], context(api, clock)));
    assert.match(out, /^✓ /);
    assert.match(out, /铁块 8\/100/);
    assert.match(out, /源已空/);
    assert.equal(state.backpack.iron_ingot, 8);
  });

  it('熔炉 8 个成品：一条命令取走 8 个（≤2 次搬运）', async () => {
    const clock = fakeClock();
    const { api, state, transferCalls } = createFakeApi({
      backpack: {},
      buildings: [building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 8 } })],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot'], context(api, clock)));
    assert.match(out, /^✓ 已取出 电弧熔炉：铁块 8 个/);
    assert.equal(state.backpack.iron_ingot, 8);
    assert.ok(transferCalls.length >= 1 && transferCalls.length <= 2, `搬运次数 ${transferCalls.length}`);
  });

  it('EXECUTOR_UNAVAILABLE → ✗ 原文', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: {},
      buildings: [
        building({
          id: 'b-depot',
          type: 'depot_mk1',
          inventory: { iron_ingot: 3 },
          takeError: { code: 'EXECUTOR_UNAVAILABLE', message: '机甲不可用' },
        }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-depot', 'iron_ingot'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /机甲不可用/);
  });

  it('多物品中一种目标不收 → 其它照常，最后汇总失败原因', async () => {
    const clock = fakeClock();
    const { api } = createFakeApi({
      backpack: {},
      buildings: [
        building({
          id: 'b-depot',
          type: 'depot_mk1',
          inventory: { iron_ingot: 5, magnetic_coil: 5 },
          givePerTransfer: 5,
        }),
        building({
          id: 'b-target',
          type: 'matrix_lab',
          acceptPerTransfer: 100,
          rejectItems: { magnetic_coil: { code: 'VALIDATION_FAILED', message: '建筑只接受 3 种物品，槽位已满' } },
        }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-depot', 'iron_ingot,magnetic_coil', '--to', 'b-target'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /铁块 5 个/);
    assert.match(out, /磁线圈/);
    assert.match(out, /建筑只接受 3 种物品/);
  });

  it('P1：目标只收一部分时继续送到收完，不能误报成功（目标会消耗）', async () => {
    const clock = fakeClock();
    const { api, state, transferCalls } = createFakeApi({
      backpack: {},
      buildings: [
        building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 8 }, givePerTransfer: 8 }),
        // 目标每轮只收 3 个、并且每次调用前消耗掉 3 个（模拟目标在消耗）。
        building({ id: 'b-target', type: 'depot_mk1', inputWindow: 3, consumePerCall: 3 }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot', '--to', 'b-target'], context(api, clock)));
    assert.match(out, /^✓ 已转运 电弧熔炉 → 小型储物仓：铁块 8 个/);
    assert.equal(state.acceptedTotals['b-target'].iron_ingot, 8, '目标必须累计收下 8 个');
    assert.equal(state.backpack.iron_ingot ?? 0, 0, '背包不能有残留');
    // 8 个分 3 次装入（3+3+2），不能停在第一次。
    assert.ok(transferCalls.filter((call) => call.direction === 'to_building').length >= 3);
  });

  it('P1：目标一直收不下 → ✗ 且写清源剩/背包残留/目标已收', async () => {
    const clock = fakeClock();
    const { api, state } = createFakeApi({
      backpack: {},
      buildings: [
        building({ id: 'b-smelter', type: 'arc_smelter', outputBuffer: { iron_ingot: 8 }, givePerTransfer: 8 }),
        building({ id: 'b-target', type: 'depot_mk1', acceptPerTransfer: 0 }),
      ],
    });
    const out = stripAnsi(await cmdDrain(['b-smelter', 'iron_ingot', '--to', 'b-target', '--timeout', '2'], context(api, clock)));
    assert.match(out, /^✗ /);
    assert.match(out, /源剩 0/);
    assert.match(out, /背包残留 8/);
    assert.match(out, /目标已收 0/);
    assert.match(out, /超时 2s/);
    assert.equal(state.backpack.iron_ingot, 8);
  });
});
