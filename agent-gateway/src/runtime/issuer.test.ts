import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runCommandLine } from '@gw/shared/command-runtime';

describe('agent issuer', () => {
  it('sends game.command as issuer_type=agent with the agent id', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/commands')) {
        requests.push(JSON.parse(String(init?.body ?? '{}')));
      }
      return {
        ok: true,
        json: async () => ({ accepted: true, request_id: 'r', enqueue_tick: 1, results: [] }),
      } as Response;
    }) as typeof fetch;
    try {
      await runCommandLine('scan_planet planet-1-1', {
        currentPlayer: 'p1',
        serverUrl: 'http://test.local',
        playerKey: 'key_player_1',
        issuerId: 'agent-builder',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(requests.length, 1);
    assert.equal(requests[0].issuer_type, 'agent');
    assert.equal(requests[0].issuer_id, 'agent-builder');
  });

  it('keeps player issuer when no agent id is given', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith('/commands')) {
        requests.push(JSON.parse(String(init?.body ?? '{}')));
      }
      return {
        ok: true,
        json: async () => ({ accepted: true, request_id: 'r', enqueue_tick: 1, results: [] }),
      } as Response;
    }) as typeof fetch;
    try {
      await runCommandLine('scan_planet planet-1-1', {
        currentPlayer: 'p1',
        serverUrl: 'http://test.local',
        playerKey: 'key_player_1',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(requests[0].issuer_type, 'player');
    assert.equal(requests[0].issuer_id, 'p1');
  });
});
