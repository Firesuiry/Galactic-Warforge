import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { cmdAgentThread } from './agent.js';

describe('agent thread command', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('prints last turn status, failure code, and executed action count', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'thread-agent-lisi',
      agentId: 'agent-lisi',
      messages: [{ role: 'assistant', content: '创建失败。' }],
      toolCalls: [],
      executionLogs: [],
      lastTurn: {
        status: 'failed',
        errorCode: 'provider_incomplete_execution',
        errorMessage: '这轮只有规划，没有执行所需动作。',
        executedActionCount: 0,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const output = await cmdAgentThread(['agent-lisi']);

    assert.match(output, /Last turn: failed/);
    assert.match(output, /Error code: provider_incomplete_execution/);
    assert.match(output, /Executed actions: 0/);
  });
});
