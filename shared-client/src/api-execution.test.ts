import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createApiClient } from './api.js';
import type { CommandResponse } from './types.js';

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

const accepted: CommandResponse = {
  request_id: 'rid-1',
  accepted: true,
  enqueue_tick: 9,
  results: [
    { command_index: 0, status: 'accepted', code: 'OK', message: '已受理，下一 tick 执行' },
    { command_index: 1, status: 'rejected', code: 'VALIDATION_FAILED', message: '结构错误' },
  ],
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

describe('awaitExecution', () => {
  it('polls audit until every accepted index has an execute record', async () => {
    const auditCalls: URL[] = [];
    let polls = 0;
    const api = createApiClient({
      serverUrl: 'http://test.local',
      auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        auditCalls.push(url);
        polls += 1;
        const entries = polls < 2 ? [] : [
          auditEntry(1, 'executed', 'OK', '第二条'),
          // precheck 记录不算执行结果
          { ...auditEntry(0, 'rejected', 'VALIDATION_FAILED', '结构错误'), details: { command_index: 0, stage: 'precheck' } },
          auditEntry(0, 'failed', 'INSUFFICIENT_RESOURCE', '背包缺：铁块 3'),
        ];
        return jsonResponse({ count: entries.length, entries });
      }) as typeof fetch,
    });

    const result = await api.awaitExecution('rid-1', 2, { timeoutMs: 1000, pollIntervalMs: 0 });
    assert.equal(result.status, 'executed');
    assert.deepEqual(result.outcomes, [
      { command_index: 0, status: 'failed', code: 'INSUFFICIENT_RESOURCE', message: '背包缺：铁块 3' },
      { command_index: 1, status: 'executed', code: 'OK', message: '第二条' },
    ]);
    assert.equal(auditCalls.length, 2);
    assert.equal(auditCalls[0].pathname, '/audit');
    assert.equal(auditCalls[0].searchParams.get('request_id'), 'rid-1');
    assert.equal(auditCalls[0].searchParams.get('player_id'), 'p1');
  });

  it('returns timeout with whatever executed before the deadline', async () => {
    const api = createApiClient({
      serverUrl: 'http://test.local',
      auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: (async () => jsonResponse({
        count: 1,
        entries: [auditEntry(0, 'executed', 'OK', 'ok')],
      })) as typeof fetch,
    });
    let clock = 0;
    const result = await api.awaitExecution('rid-1', 2, {
      timeoutMs: 100,
      pollIntervalMs: 0,
      now: () => clock,
      sleep: async () => { clock += 50; },
    });
    assert.equal(result.status, 'timeout');
    assert.deepEqual(result.outcomes.map(o => o.command_index), [0]);
  });

  it('fires onCommandResponse for every POST /commands', async () => {
    const seen: CommandResponse[] = [];
    const api = createApiClient({
      serverUrl: 'http://test.local',
      auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: (async () => jsonResponse(accepted)) as typeof fetch,
      onCommandResponse: (response) => seen.push(response),
    });
    await api.sendCommands([{ type: 'build' }]);
    assert.deepEqual(seen.map(r => r.request_id), ['rid-1']);
    // 运行时可替换回调（非交互入口用）
    const replaced: CommandResponse[] = [];
    api.setCommandResponseHandler((response) => replaced.push(response));
    await api.sendCommands([{ type: 'build' }]);
    assert.equal(seen.length, 1);
    assert.equal(replaced.length, 1);
  });
});
