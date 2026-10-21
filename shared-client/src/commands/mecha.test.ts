import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { ApiClient } from '../api.js';
import type { CommandResponse, StateSummary } from '../types.js';

import { cmdMecha } from './mecha.js';

const mechaView = {
  unit_id: 'u-7', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
  inventory: {}, inventory_slots_used: 0, inventory_slots_total: 40, operate_range: 18,
  concurrent_tasks: 2, construction_active: 0, construction_pending: 0,
};

const summary = {
  tick: 1,
  active_planet_id: 'planet-1-1',
  surface: { topology: 'cube_sphere', face_size: 8 },
  map_width: 24,
  map_height: 16,
  players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 0 }, mechas: [mechaView] } },
} as unknown as StateSummary;

const catalog = {
  items: [{ id: 'iron_ingot', name: '铁块' }, { id: 'gear', name: '齿轮' }],
  world_units: [{ id: 'executor', cost: [{ item_id: 'iron_ingot', quantity: 16 }, { item_id: 'gear', quantity: 8 }] }],
};

function fakeApi(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  return {
    getAuth: () => ({ playerId: 'p1', issuerId: 'p1', issuerType: 'player' }),
    fetchSummary: async () => summary,
    fetchCatalog: async () => catalog,
    cmdAssignMecha: async () => ({ accepted: true, request_id: 'r', enqueue_tick: 1, results: [{ command_index: 0, status: 'executed', code: 'OK', message: 'ok' }] }),
    cmdDispatchMecha: async () => ({ accepted: true, request_id: 'r', enqueue_tick: 1, results: [{ command_index: 0, status: 'executed', code: 'OK', message: 'ok' }] }),
    ...overrides,
  } as unknown as ApiClient;
}

function response(accepted: boolean, status: string, message: string): CommandResponse {
  return { accepted, request_id: 'r', enqueue_tick: 1, results: [{ command_index: 0, status, code: accepted ? 'OK' : 'NOT_OWNER', message }] };
}

describe('mecha assign 参数解析（审查 #2）', () => {
  it('多余的位置参数直接报错，不下发', async () => {
    let called = false;
    const api = fakeApi({ cmdAssignMecha: async () => { called = true; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['assign', 'u-7', 'p1', 'extra'], { api });
    assert.match(out, /参数过多/);
    assert.equal(called, false);
  });

  it('未知 -- 选项直接报错', async () => {
    let called = false;
    const api = fakeApi({ cmdAssignMecha: async () => { called = true; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['assign', 'u-7', '--foo', 'bar'], { api });
    assert.match(out, /未知选项/);
    assert.equal(called, false);
  });

  it('--release 与 operator 同时给时报错', async () => {
    let called = false;
    const api = fakeApi({ cmdAssignMecha: async () => { called = true; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['assign', 'u-7', '--release', 'p1'], { api });
    assert.match(out, /--release 不接受 operator/);
    assert.equal(called, false);
  });

  it('--release 解绑：operator 传空串', async () => {
    let args: unknown[] = [];
    const api = fakeApi({ cmdAssignMecha: async (...rest: unknown[]) => { args = rest; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['assign', 'u-7', '--release'], { api });
    assert.deepEqual(args, ['u-7', '']);
    assert.match(out, /已解绑/);
  });
});

describe('mecha assign 以服务端回执为准（审查 #3）', () => {
  it('被拒绝时不打印「已绑给」，显示拒绝原因', async () => {
    const api = fakeApi({ cmdAssignMecha: async () => response(false, 'rejected', '机甲不属于你') });
    const out = await cmdMecha(['assign', 'u-7', 'builder-a'], { api });
    assert.doesNotMatch(out, /已绑给/);
    assert.match(out, /绑定未生效/);
    assert.match(out, /机甲不属于你/);
  });

  it('accepted 但执行失败（failed）同样不算成功', async () => {
    const api = fakeApi({ cmdAssignMecha: async () => response(true, 'failed', '执行失败') });
    const out = await cmdMecha(['assign', 'u-7', 'builder-a'], { api });
    assert.doesNotMatch(out, /已绑给/);
    assert.match(out, /绑定未生效/);
  });

  it('执行成功才打印「已绑给」', async () => {
    const api = fakeApi();
    const out = await cmdMecha(['assign', 'u-7', 'builder-a'], { api });
    assert.match(out, /u-7 已绑给 builder-a/);
  });
});

describe('mecha list（审查 #1 / #4）', () => {
  it('彩色列按可见宽度对齐（ANSI 不计入列宽）', async () => {
    const many = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 0 }, mechas: [
      mechaView,
      { ...mechaView, unit_id: 'u-8', operator: '', alive: false, respawn_at_tick: 50, inventory_slots_used: 3 },
    ] } } } as unknown as StateSummary;
    const api = fakeApi({ fetchSummary: async () => many });
    const out = await cmdMecha(['list'], { api });
    // 表格 = 表头 + 分隔线 + 2 行数据（最后一行是「我的机甲」提示，不参与对齐断言）。
    const lines = out.split('\n').slice(0, 4);
    // 去掉 ANSI 后，Alive 列在所有行同一列开始。
    // 只比数据行（表头/分隔线没有 Alive 值）。
    const visible = lines.slice(2).map((line) => line.replace(/\u001b\[[0-9;]*m/g, ''));
    const aliveIndex = visible.map((line) => line.indexOf('yes') >= 0 ? line.indexOf('yes') : line.indexOf('no (respawn'));
    assert.ok(aliveIndex.every((index) => index === aliveIndex[0]), `Alive 列错位：${visible.join('\n')}`);
    assert.match(out, /u-8/);
  });

  it('空表造价从 /catalog 的 executor 条目读（不写死数字）', async () => {
    const empty = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 0 }, mechas: [] } } } as unknown as StateSummary;
    const api = fakeApi({ fetchSummary: async () => empty });
    const out = await cmdMecha(['list'], { api });
    assert.match(out, /铁块 16、齿轮 8/);
  });

  it('目录不可达时不给可能过期的成本数字', async () => {
    const empty = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 0 }, mechas: [] } } } as unknown as StateSummary;
    const api = fakeApi({ fetchSummary: async () => empty, fetchCatalog: async () => { throw new Error('offline'); } });
    const out = await cmdMecha(['list'], { api });
    assert.match(out, /成本见 catalog/);
    assert.doesNotMatch(out, /铁块16|铁块 16/);
  });
});

describe('mecha list 作业与施工列', () => {
  it('作业列显示 craft/min 目标与批次，Construction 说明 pending 才有意义', async () => {
    const busy = {
      ...mechaView, unit_id: 'u-8', operator: 'builder-a', construction_active: 0, construction_pending: 4,
      job: { kind: 'craft', recipe_id: 'craft_circuit_board', remaining_batches: 3, state: 'running' },
    };
    const mining = {
      ...mechaView, unit_id: 'u-9', operator: 'builder-b',
      job: { kind: 'mine', resource_id: 'iron_ore_node', remaining_batches: 5, state: 'running', paused: true },
    };
    const api = fakeApi({
      fetchSummary: async () => ({
        ...summary,
        players: { p1: { ...summary.players.p1, mechas: [busy, mining, mechaView] } },
      }),
    });
    const out = await cmdMecha(['list'], { api, issuerId: 'builder-a' });
    assert.match(out, /craft craft_circuit_board ×3/);
    assert.match(out, /mine iron_ore_node ×5（paused）/);
    assert.match(out, /pending 才是排队\/缺料/);
    assert.match(out, /0\/4/);
  });
});

describe('mecha dispatch（第 22 轮 §2）', () => {
  it('把目标行星和点名机甲一起下发', async () => {
    let args: unknown[] = [];
    const api = fakeApi({ cmdDispatchMecha: async (...rest: unknown[]) => { args = rest; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['dispatch', 'planet-1-2', 'u-7'], { api });
    assert.deepEqual(args, ['planet-1-2', 'u-7']);
    assert.match(out, /ok/);
  });

  it('只给行星时 mecha_id 传 undefined（服务端自动选一台）', async () => {
    let args: unknown[] = [];
    const api = fakeApi({ cmdDispatchMecha: async (...rest: unknown[]) => { args = rest; return response(true, 'executed', 'ok'); } });
    await cmdMecha(['dispatch', 'planet-1-2'], { api });
    assert.deepEqual(args, ['planet-1-2', undefined]);
  });

  it('缺少行星参数时不下发', async () => {
    let called = false;
    const api = fakeApi({ cmdDispatchMecha: async () => { called = true; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['dispatch'], { api });
    assert.match(out, /Usage: dispatch_mecha <planet_id> \[mecha_id\]/);
    assert.equal(called, false);
  });

  it('多余参数直接报错', async () => {
    let called = false;
    const api = fakeApi({ cmdDispatchMecha: async () => { called = true; return response(true, 'executed', 'ok'); } });
    const out = await cmdMecha(['dispatch', 'planet-1-2', 'u-7', 'extra'], { api });
    assert.match(out, /Usage: dispatch_mecha/);
    assert.equal(called, false);
  });
});
