import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  createAgentProfile,
  fetchAgentThread,
  listAgentProfiles,
  sendAgentMessage,
  updateAgentProfile,
} from './agent-api.js';

describe('agent gateway api helpers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls agent-gateway list/create/update/message/thread endpoints', async () => {
    const seen: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      seen.push({ url, method, body });

      if (url.endsWith('/agents') && method === 'GET') {
        return new Response(JSON.stringify([{ id: 'agent-lisi', name: '李斯' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'agent-lisi', name: '李斯' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents/agent-lisi') && method === 'PATCH') {
        return new Response(JSON.stringify({ id: 'agent-lisi', name: '李斯', policy: { canCreateAgents: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents/agent-lisi/messages') && method === 'POST') {
        return new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/agents/agent-lisi/thread') && method === 'GET') {
        return new Response(JSON.stringify({
          id: 'thread-agent-lisi',
          agentId: 'agent-lisi',
          messages: [{ role: 'assistant', content: '胡景已创建。' }],
          toolCalls: [],
          executionLogs: [],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    const agents = await listAgentProfiles();
    const created = await createAgentProfile({
      name: '李斯',
      providerId: 'provider-case1',
      serverUrl: 'http://127.0.0.1:18080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    const updated = await updateAgentProfile('agent-lisi', {
      policy: { canCreateAgents: true },
    });
    const accepted = await sendAgentMessage('agent-lisi', '创建胡景，并赋予其建筑权限');
    const thread = await fetchAgentThread('agent-lisi');

    assert.equal(agents[0]?.id, 'agent-lisi');
    assert.equal(created.id, 'agent-lisi');
    assert.equal(updated.policy?.canCreateAgents, true);
    assert.equal(accepted.accepted, true);
    assert.equal(thread.id, 'thread-agent-lisi');
    assert.equal(seen.length, 5);
  });
});
