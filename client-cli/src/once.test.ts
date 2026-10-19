import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApiClient } from '@gw/shared/api';
import type { CommandResponse, ExecutionOutcome } from '@gw/shared/types';

import { createOnceRunner, onceConfigFromEnv, type OnceConfig } from './once.js';

const baseConfig: OnceConfig = {
  serverUrl: 'http://test.local',
  playerId: 'p1',
  playerKey: 'key_player_1',
  wait: true,
  waitTimeoutMs: 8000,
};

function auditEntry(index: number, status: string, code: string, message: string) {
  return {
    timestamp: '2026-10-19T00:00:00Z',
    tick: 10,
    player_id: 'p1',
    role: 'admin',
    issuer_type: 'player',
    issuer_id: 'p1',
    request_id: 'rid-1',
    action: 'command',
    permission: 'build',
    permission_granted: true,
    permissions: [],
    details: { command_index: index, stage: 'execute', status, code, message },
  };
}

/** 假服务端：/commands 回 ACCEPTED，/audit 回给定的 execute 记录。 */
function mockApi(executions: Array<{ index: number; status: string; code: string; message: string }>) {
  const calls: string[] = [];
  const api = createApiClient({
    serverUrl: 'http://test.local',
    auth: { playerId: 'p1', playerKey: 'key' },
    fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/commands') {
        const body = JSON.parse(String(init?.body)) as { request_id: string; commands: unknown[] };
        const response: CommandResponse = {
          request_id: body.request_id,
          accepted: true,
          enqueue_tick: 9,
          results: body.commands.map((_, index) => ({
            command_index: index,
            status: 'accepted',
            code: 'OK',
            message: '已受理，下一 tick 执行',
          })),
        };
        return new Response(JSON.stringify(response), { status: 202 });
      }
      if (url.pathname === '/audit') {
        return new Response(JSON.stringify({
          count: executions.length,
          entries: executions.map(e => auditEntry(e.index, e.status, e.code, e.message)),
        }), { status: 200 });
      }
      if (url.pathname === '/state/summary') {
        return new Response(JSON.stringify({ tick: 10 }), { status: 200 });
      }
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', tick: 10 }), { status: 200 });
      }
      throw new Error(`unexpected ${url.pathname}`);
    }) as typeof fetch,
  });
  return { api, calls };
}

function runner(api: ReturnType<typeof mockApi>['api'], config: Partial<OnceConfig> = {}) {
  const output: string[] = [];
  const once = createOnceRunner({
    config: { ...baseConfig, ...config },
    api,
    awaitOptions: { pollIntervalMs: 10 },
    stdout: (text) => output.push(text),
  });
  return { once, output, text: () => output.join('\n') };
}

describe('scripts/sw non-interactive runner', () => {
  it('appends execution success after ACCEPTED', async () => {
    const { api } = mockApi([{ index: 0, status: 'executed', code: 'OK', message: '施工任务已排队（位置 60,140）' }]);
    const { once, text } = runner(api);
    assert.equal(await once.run('build 60 140 wind_turbine'), true);
    assert.match(text(), /ACCEPTED/);
    assert.match(text(), /\[0\] ✓ OK: 施工任务已排队（位置 60,140）/);
  });

  it('reports execution failure and exits non-zero', async () => {
    const { api } = mockApi([{ index: 0, status: 'failed', code: 'INSUFFICIENT_RESOURCE', message: '背包缺：铁块 3、齿轮 2' }]);
    const { once, text } = runner(api);
    assert.equal(await once.run('build 60 140 wind_turbine'), false);
    assert.match(text(), /\[0\] ✗ INSUFFICIENT_RESOURCE: 背包缺：铁块 3、齿轮 2/);
  });

  it('prints a timeout line when execution never appears', async () => {
    const { api } = mockApi([]);
    const { once, text } = runner(api, { waitTimeoutMs: 500 });
    assert.equal(await once.run('build 60 140 wind_turbine'), false);
    assert.match(text(), /\[0\] … 未在 0\.5s 内执行（tick 是否在走？）/);
  });

  it('does not poll audit with SW_WAIT=0', async () => {
    const { api, calls } = mockApi([]);
    const { once } = runner(api, { wait: false });
    assert.equal(await once.run('build 60 140 wind_turbine'), true);
    assert.deepEqual(calls, ['POST /commands']);
  });

  it('skips blank lines and comments, keeps going after failures, and summarises', async () => {
    const { api } = mockApi([{ index: 0, status: 'failed', code: 'INSUFFICIENT_RESOURCE', message: '缺料' }]);
    const { once, text } = runner(api);
    const ok = await once.runLines([
      '# 注释',
      '',
      'build 60 140 wind_turbine',
      'help build',
    ]);
    assert.equal(ok, false);
    assert.match(text(), /^> build 60 140 wind_turbine/m);
    assert.match(text(), /^> help build/m);
    assert.doesNotMatch(text(), /^> #/m);
    assert.match(text(), /2 条：成功 1，失败 1/);
  });

  it('treats unknown commands and session-only commands as failures', async () => {
    const { api } = mockApi([]);
    const { once, text } = runner(api);
    assert.equal(await once.run('no_such_command'), false);
    assert.match(text(), /Unknown command: "no_such_command"/);
    assert.equal(await once.run('quit'), false);
    assert.match(text(), /非交互模式不支持 quit/);
  });

  it('reads env defaults and rejects an invalid SW_ISSUER', () => {
    const config = onceConfigFromEnv({});
    assert.deepEqual(config, {
      serverUrl: 'http://127.0.0.1:18080',
      playerId: 'p1',
      playerKey: 'key_player_1',
      issuerId: undefined,
      wait: true,
      waitTimeoutMs: 8000,
    });
    assert.equal(onceConfigFromEnv({ SW_ISSUER: 'builder' }).issuerId, 'builder');
    assert.throws(() => onceConfigFromEnv({ SW_ISSUER: 'bad name' }), /SW_ISSUER 非法/);
    assert.throws(() => onceConfigFromEnv({ SW_WAIT_TIMEOUT: 'abc' }), /SW_WAIT_TIMEOUT 非法/);
  });

  it('treats wait success as ok and wait timeout as failure', async () => {
    const { api } = mockApi([]);
    const { once, text } = runner(api);
    // wait job：summary 里没有 players.mechas → 未绑定机甲（本地错误）。
    assert.equal(await once.run('wait job'), false);
    assert.match(text(), /未绑定机甲/);
    // wait ticks 在 tick 不前进、--timeout 0 时立即超时。
    assert.equal(await once.run('wait ticks 5 --timeout 0'), false);
    assert.match(text(), /✗ 超时（0s，tick 前进 0）/);
  });

  it('counts each index independently when several commands share a request', async () => {
    const outcomes: ExecutionOutcome[] = [
      { command_index: 0, status: 'executed', code: 'OK', message: 'ok' },
      { command_index: 1, status: 'failed', code: 'POSITION_OCCUPIED', message: '占用' },
    ];
    const { api } = mockApi(outcomes.map(o => ({ index: o.command_index, status: o.status, code: o.code, message: o.message })));
    const { once, text } = runner(api);
    // raw 一次发两条，走同一 request_id
    assert.equal(await once.run('raw {"request_id":"rid-1","issuer_type":"player","issuer_id":"p1","commands":[{},{}]}'), false);
    assert.match(text(), /\[0\] ✓ OK: ok/);
    assert.match(text(), /\[1\] ✗ POSITION_OCCUPIED: 占用/);
  });
});
