import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { ApiClient } from '../api.js';
import type { StateSummary } from '../types.js';

import { cmdWait } from './wait.js';

/** 假时钟：sleep 推进时间，不真的等。 */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => { now += ms; },
    advance: (ms: number) => { now += ms; },
  };
}

const mechaView = {
  unit_id: 'u-7', planet_id: 'planet-1-1', operator: 'builder-a', alive: true, respawn_at_tick: 0,
  inventory: {}, inventory_slots_used: 0, inventory_slots_total: 40, operate_range: 18,
  concurrent_tasks: 2, construction_active: 0, construction_pending: 0,
};

function summary(mecha: Record<string, unknown> | undefined): StateSummary {
  return {
    tick: 1,
    active_planet_id: 'planet-1-1',
    surface: { topology: 'cube_sphere', face_size: 8 },
    map_width: 24,
    map_height: 16,
    players: {
      p1: {
        player_id: 'p1',
        is_alive: true,
        resources: { energy: 0 },
        mechas: mecha ? [mecha as typeof mechaView] : [],
      },
    },
  } as unknown as StateSummary;
}

interface FakeState {
  ticks: number[];
  summaries: StateSummary[];
  runtimes: Array<{ construction_tasks?: unknown[] }>;
  inspects: Array<{ building?: unknown }>;
}

/** 每次调用依次吐出序列里的下一项（耗尽后停在最后一项）。 */
function fakeApi(state: Partial<FakeState> = {}) {
  const ticks = [...(state.ticks ?? [100])];
  const summaries = [...(state.summaries ?? [summary(mechaView)])];
  const runtimes = [...(state.runtimes ?? [{ construction_tasks: [] }])];
  const inspects = [...(state.inspects ?? [{ building: { runtime: { state: 'running' } } }])];
  const next = <T>(list: T[]): T => (list.length > 1 ? list.shift() as T : list[0]);
  const calls: string[] = [];
  const api = {
    getAuth: () => ({ playerId: 'p1', issuerId: 'builder-a', issuerType: 'agent' }),
    fetchHealth: async () => { calls.push('health'); return { status: 'ok', tick: next(ticks) }; },
    fetchSummary: async () => { calls.push('summary'); return next(summaries); },
    fetchPlanetRuntime: async () => { calls.push('runtime'); return next(runtimes); },
    fetchPlanetInspect: async () => { calls.push('inspect'); return next(inspects); },
  } as unknown as ApiClient;
  return { api, calls };
}

function ctx(api: ApiClient, clock: ReturnType<typeof fakeClock>) {
  return {
    api,
    issuerId: 'builder-a',
    waitOptions: { now: clock.now, sleep: clock.sleep, pollIntervalMs: 1000 },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('wait ticks', () => {
  it('tick 前进到目标就返回成功行', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ ticks: [100, 110, 120] });
    const out = stripAnsi(await cmdWait(['ticks', '20'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：tick 前进 20（100 → 120）（用了 20 tick \/ 2 秒）/);
  });

  it('tick 不动时按超时返回失败行', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ ticks: [100] });
    const out = stripAnsi(await cmdWait(['ticks', '5', '--timeout', '3'], ctx(api, clock)));
    assert.match(out, /^✗ 超时（3s，tick 前进 0）：tick 只前进 0\/5/);
  });

  it('拒绝非整数 tick 数，不发请求', async () => {
    const clock = fakeClock();
    const { api, calls } = fakeApi();
    const out = stripAnsi(await cmdWait(['ticks', '1.5'], ctx(api, clock)));
    assert.match(out, /ticks 必须是非负整数/);
    assert.equal(calls.length, 0);
  });
});

describe('wait job', () => {
  it('作业结束后返回成功行，描述开工时的作业', async () => {
    const clock = fakeClock();
    const working = summary({ ...mechaView, job: { kind: 'craft', recipe_id: 'gear', remaining_batches: 3, state: 'running' } });
    const idle = summary(mechaView);
    const { api } = fakeApi({ summaries: [working, working, idle] });
    const out = stripAnsi(await cmdWait(['job'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：我的机甲 u-7 完成 craft gear ×3/);
  });

  it('没有作业立即返回「当前没有作业」，不轮询', async () => {
    const clock = fakeClock();
    const { api, calls } = fakeApi();
    const out = stripAnsi(await cmdWait(['job'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：当前没有作业（用了 0 tick \/ 0 秒）/);
    assert.deepEqual(calls, ['summary']);
  });

  it('作业一直不结束时超时', async () => {
    const clock = fakeClock();
    const working = summary({ ...mechaView, job: { kind: 'craft', recipe_id: 'gear', remaining_batches: 3, state: 'running' } });
    const { api } = fakeApi({ summaries: [working] });
    const out = stripAnsi(await cmdWait(['job', '--timeout', '2'], ctx(api, clock)));
    assert.match(out, /^✗ 超时（2s，tick 前进 0）：我的机甲 u-7 作业仍在：craft gear ×3/);
  });

  it('没有机甲时给出绑定提示', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ summaries: [summary(undefined)] });
    const out = stripAnsi(await cmdWait(['job'], ctx(api, clock)));
    assert.match(out, /未绑定机甲/);
  });
});

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ct-1', player_id: 'p1', building_type: 'assembling_machine_mk1', position: { x: 60, y: 140 },
    state: 'in_progress', enqueue_tick: 10, mecha_id: 'u-7', remaining_ticks: 2, ...overrides,
  };
}

describe('wait build', () => {
  it('队列清空后返回成功行', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ runtimes: [
      { construction_tasks: [task()] },
      { construction_tasks: [] },
    ] });
    const out = stripAnsi(await cmdWait(['build'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：我的机甲 u-7 施工队列已清空/);
  });

  it('剩下的任务全是 pending + insufficient_materials 时提前返回并列出任务', async () => {
    const clock = fakeClock();
    const stuck = task({ state: 'pending', wait_reason: 'insufficient_materials', remaining_ticks: undefined, building_name: '组装机' });
    const { api } = fakeApi({ runtimes: [{ construction_tasks: [stuck, { ...stuck, id: 'ct-2' }] }] });
    const out = stripAnsi(await cmdWait(['build'], ctx(api, clock)));
    assert.match(out, /^✗ 提前返回（缺料，tick 前进 0）：/);
    assert.match(out, /任务 ct-1 组装机 @\(60,140\)：pending，缺料/);
    assert.match(out, /任务 ct-2 组装机 @\(60,140\)：pending，缺料/);
  });

  it('只统计我自己机甲的任务（按 mecha_id 过滤）', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ runtimes: [{ construction_tasks: [
      task({ id: 'other', mecha_id: 'u-9', state: 'pending', wait_reason: 'insufficient_materials' }),
    ] }] });
    const out = stripAnsi(await cmdWait(['build'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：我的机甲 u-7 施工队列已清空/);
  });

  it('10 秒毫无进展时提前返回并列出任务', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ runtimes: [{ construction_tasks: [task({ remaining_ticks: 5 })] }] });
    const out = stripAnsi(await cmdWait(['build', '--timeout', '60'], ctx(api, clock)));
    assert.match(out, /^✗ 提前返回（施工无进展，tick 前进 0）：10s 内无进展；/);
    assert.match(out, /ct-1/);
  });

  it('一直有进展但没做完时超时', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ runtimes: [
      { construction_tasks: [task({ remaining_ticks: 5 })] },
      { construction_tasks: [task({ remaining_ticks: 4 })] },
      { construction_tasks: [task({ remaining_ticks: 3 })] },
      { construction_tasks: [task({ remaining_ticks: 2 })] },
    ] });
    const out = stripAnsi(await cmdWait(['build', '--timeout', '2'], ctx(api, clock)));
    assert.match(out, /^✗ 超时（2s，tick 前进 0）：还有 1 个施工任务/);
  });
});

describe('wait item', () => {
  it('背包数量达标后返回成功', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ summaries: [
      summary({ ...mechaView, inventory: { gear: 1 } }),
      summary({ ...mechaView, inventory: { gear: 3 } }),
    ] });
    const out = stripAnsi(await cmdWait(['item', 'gear', '3'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：我的机甲背包 gear ≥ 3（当前 3）/);
  });

  it('背包数量一直不够时超时', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ summaries: [summary({ ...mechaView, inventory: { gear: 1 } })] });
    const out = stripAnsi(await cmdWait(['item', 'gear', '3', '--timeout', '2'], ctx(api, clock)));
    assert.match(out, /^✗ 超时（2s，tick 前进 0）：背包 gear 1\/3/);
  });

  it('--in 把 inventory 与 output_buffer 相加', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ inspects: [
      { building: { storage: { inventory: { gear: 2 }, output_buffer: { gear: 1 } } } },
    ] });
    const out = stripAnsi(await cmdWait(['item', 'gear', '3', '--in', 'b-1'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：建筑 b-1 gear ≥ 3（当前 3）/);
  });

  it('--in 建筑不存在时提前返回', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ inspects: [{ building: undefined }] });
    const out = stripAnsi(await cmdWait(['item', 'gear', '3', '--in', 'b-404'], ctx(api, clock)));
    assert.match(out, /^✗ 提前返回（建筑不存在，tick 前进 0）：建筑 b-404 不在 planet-1-1/);
  });
});

describe('wait running', () => {
  it('建筑进入 running 后返回成功', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ inspects: [
      { building: { runtime: { state: 'no_power', state_reason: 'out_of_range' } } },
      { building: { runtime: { state: 'running' } } },
    ] });
    const out = stripAnsi(await cmdWait(['running', 'b-1'], ctx(api, clock)));
    assert.match(out, /✓ 等到了：建筑 b-1 进入 running/);
  });

  it('超时消息给出当前 state 与原因', async () => {
    const clock = fakeClock();
    const { api } = fakeApi({ inspects: [{ building: { runtime: { state: 'no_power', state_reason: 'out_of_range' } } }] });
    const out = stripAnsi(await cmdWait(['running', 'b-1', '--timeout', '2'], ctx(api, clock)));
    assert.match(out, /^✗ 超时（2s，tick 前进 0）：建筑 b-1 state=no_power，reason=out_of_range/);
  });
});

describe('wait 参数校验', () => {
  it('未知条件、未知选项、缺参数都本地报错', async () => {
    const clock = fakeClock();
    const { api, calls } = fakeApi();
    assert.match(stripAnsi(await cmdWait(['nope'], ctx(api, clock))), /未知等待条件：nope/);
    assert.match(stripAnsi(await cmdWait(['job', '--bogus'], ctx(api, clock))), /未知选项：--bogus/);
    assert.match(stripAnsi(await cmdWait(['item', 'gear'], ctx(api, clock))), /用法：wait item/);
    assert.match(stripAnsi(await cmdWait(['item', 'gear', '0'], ctx(api, clock))), /数量必须是正整数/);
    assert.match(stripAnsi(await cmdWait(['job', '--timeout', 'x'], ctx(api, clock))), /--timeout 非法/);
    assert.equal(calls.length, 0);
  });
});
