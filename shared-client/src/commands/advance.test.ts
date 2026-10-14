import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createApiClient } from '../api.js';
import { advanceStopOnFromArgs, cmdAdvance, cmdAdvanceCancel } from './debug.js';

function recordingApi() {
  const requests: Array<{ url: string; method?: string; body: unknown }> = [];
  const api = createApiClient({
    serverUrl: 'http://test.local',
    auth: { playerId: 'p1', playerKey: 'key' },
    fetchFn: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (String(input).endsWith('/cancel')) {
        return { ok: true, json: async () => ({ cancelled: true }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          start_tick: 100,
          end_tick: 600,
          stopped_reason: 'under_attack',
          detail: '我方目标 u-1 在 tick 512 受到伤害',
          elapsed_ms: 820,
          ticks_per_sec: 610.5,
        }),
      } as Response;
    },
  });
  return { api, requests };
}

describe('advance command', () => {
  it('shows help', async () => {
    const { api } = recordingApi();
    const out = await cmdAdvance(['--help'], { api });
    assert.match(out, /advance <ticks> \[options\]/);
    assert.match(out, /--no-stop-attack/);
  });

  it('defaults every stop condition to on', () => {
    assert.deepEqual(advanceStopOnFromArgs({ positionals: [], options: {} }), {
      game_over: true,
      under_attack: true,
      critical_alert: true,
    });
  });

  it('turns a single stop condition off with --no-stop-<x>', () => {
    assert.deepEqual(
      advanceStopOnFromArgs({ positionals: [], options: { 'no-stop-alert': true } }),
      { game_over: true, under_attack: true, critical_alert: false },
    );
  });

  it('sends ticks with the default stop_on payload', async () => {
    const { api, requests } = recordingApi();
    const out = await cmdAdvance(['500'], { api });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://test.local/admin/advance');
    assert.equal(requests[0].method, 'POST');
    assert.deepEqual(requests[0].body, {
      ticks: 500,
      stop_on: { game_over: true, under_attack: true, critical_alert: true },
    });
    assert.match(out, /tick 100 → 600/);
    assert.match(out, /under_attack/);
    assert.match(out, /611 tick\/s/);
  });

  it('sends to_tick and disabled stop conditions', async () => {
    const { api, requests } = recordingApi();
    await cmdAdvance(['--to', '900', '--no-stop-attack', '--no-stop-gameover'], { api });
    assert.deepEqual(requests[0].body, {
      to_tick: 900,
      stop_on: { game_over: false, under_attack: false, critical_alert: true },
    });
  });

  it('rejects a missing or invalid target', async () => {
    const { api, requests } = recordingApi();
    assert.match(await cmdAdvance([], { api }), /需要 <ticks> 或 --to <tick>/);
    assert.match(await cmdAdvance(['0'], { api }), /正整数/);
    assert.match(await cmdAdvance(['5', '--to', '9'], { api }), /只能给一个/);
    assert.equal(requests.length, 0);
  });

  it('cancels a running fast-forward', async () => {
    const { api, requests } = recordingApi();
    const out = await cmdAdvanceCancel([], { api });
    assert.equal(requests[0].url, 'http://test.local/admin/advance/cancel');
    assert.match(out, /cancelled/);
  });
});
