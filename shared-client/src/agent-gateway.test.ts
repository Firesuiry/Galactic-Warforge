import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentGatewayClient } from './agent-gateway.js';

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
    ...init,
  });
}

/** client-web 经 vite 代理访问网关 */
const gateway = createAgentGatewayClient({ baseUrl: '/agent-api' });

describe('agent gateway client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches providers from the agent gateway', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      expect(String(input)).toBe('/agent-api/providers');
      return Promise.resolve(jsonResponse([
        {
          id: 'provider-builder',
          name: '建造 Provider',
          description: '负责建设',
          providerKind: 'codex_cli',
          defaultModel: 'gpt-5-codex',
          systemPrompt: '负责建设。',
          toolPolicy: {
            cliEnabled: true,
            maxSteps: 8,
            maxToolCallsPerTurn: 4,
            commandWhitelist: ['build'],
          },
          providerConfig: {
            command: 'codex',
            model: 'gpt-5-codex',
            workdir: '/tmp',
            argsTemplate: [],
            envOverrides: {},
          },
        },
      ]));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(gateway.fetchProviders()).resolves.toEqual([
      expect.objectContaining({
        id: 'provider-builder',
        name: '建造 Provider',
      }),
    ]);
  });

  it('posts provider, agent, member invite, provider binding, and owned schedule payloads', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/agent-api/providers' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: '建造 Provider',
          providerKind: 'codex_cli',
        });
        return Promise.resolve(jsonResponse({ id: 'provider-builder', name: '建造 Provider' }, { status: 201 }));
      }

      if (url === '/agent-api/agents' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: '建造官',
          providerId: 'provider-builder',
          playerId: 'p1',
          playerKey: 'key_player_1',
        });
        return Promise.resolve(jsonResponse({ id: 'agent-builder', name: '建造官', providerId: 'provider-builder' }, { status: 201 }));
      }

      if (url === '/agent-api/agents/agent-builder' && method === 'PATCH') {
        expect(JSON.parse(String(init?.body))).toEqual({
          providerId: 'provider-director',
        });
        return Promise.resolve(jsonResponse({ id: 'agent-builder', name: '建造官', providerId: 'provider-director' }));
      }

      if (url === '/agent-api/conversations/conv-a/members' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({
          actorType: 'player',
          actorId: 'p1',
          memberIds: ['agent:agent-builder'],
        });
        return Promise.resolve(jsonResponse({ conversationId: 'conv-a', memberIds: ['player:p1', 'agent:agent-builder'] }));
      }

      if (url === '/agent-api/schedules' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          ownerAgentId: 'agent-builder',
          targetType: 'conversation',
          targetId: 'conv-a',
        });
        return Promise.resolve(jsonResponse({
          id: 'schedule-a',
          ownerAgentId: 'agent-builder',
          targetType: 'conversation',
          targetId: 'conv-a',
          intervalSeconds: 300,
          messageTemplate: '@建造官 每五分钟汇报一次',
          enabled: true,
        }, { status: 201 }));
      }

      if (url === '/agent-api/schedules/schedule-a' && method === 'PATCH') {
        expect(JSON.parse(String(init?.body))).toEqual({
          enabled: false,
        });
        return Promise.resolve(jsonResponse({
          id: 'schedule-a',
          ownerAgentId: 'agent-builder',
          targetType: 'conversation',
          targetId: 'conv-a',
          intervalSeconds: 300,
          messageTemplate: '@建造官 每五分钟汇报一次',
          enabled: false,
        }));
      }

      return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    await gateway.createProvider({
      name: '建造 Provider',
      providerKind: 'codex_cli',
      description: '负责建设',
      defaultModel: 'gpt-5-codex',
      systemPrompt: '负责建设。',
      toolPolicy: {
        cliEnabled: true,
        maxSteps: 8,
        maxToolCallsPerTurn: 4,
        commandWhitelist: ['build'],
      },
      providerConfig: {
        command: 'codex',
        model: 'gpt-5-codex',
        workdir: '/tmp',
        argsTemplate: [],
        envOverrides: {},
      },
    });

    await gateway.createAgent({
      name: '建造官',
      providerId: 'provider-builder',
      serverUrl: 'http://localhost:8080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    await gateway.updateAgent('agent-builder', {
      providerId: 'provider-director',
    });

    await gateway.addConversationMembers('conv-a', {
      actorType: 'player',
      actorId: 'p1',
      memberIds: ['agent:agent-builder'],
    });

    await gateway.createSchedule({
      ownerAgentId: 'agent-builder',
      creatorType: 'player',
      creatorId: 'p1',
      targetType: 'conversation',
      targetId: 'conv-a',
      intervalSeconds: 300,
      messageTemplate: '@建造官 每五分钟汇报一次',
    });

    await gateway.updateSchedule('schedule-a', {
      enabled: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('fetches conversation turns and preserves authoritative send response payloads', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/agent-api/conversations/conv-a/turns' && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            id: 'turn-1',
            conversationId: 'conv-a',
            requestMessageId: 'msg-request',
            actorType: 'player',
            actorId: 'p1',
            targetAgentId: 'agent-builder',
            status: 'planning',
            assistantPreview: '先检查矿机。',
            actionSummaries: [],
            createdAt: '2026-04-03T00:00:00.000Z',
            updatedAt: '2026-04-03T00:00:01.000Z',
          },
        ]));
      }

      if (url === '/agent-api/conversations/conv-a/messages' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({
          senderType: 'player',
          senderId: 'p1',
          content: '@建造官 检查产线',
        });
        return Promise.resolve(jsonResponse({
          accepted: true,
          message: {
            id: 'msg-request',
            conversationId: 'conv-a',
            senderType: 'player',
            senderId: 'p1',
            kind: 'chat',
            content: '@建造官 检查产线',
            mentions: [{ type: 'agent', id: 'agent-builder' }],
            createdAt: '2026-04-03T00:00:00.000Z',
          },
          turns: [
            {
              id: 'turn-1',
              conversationId: 'conv-a',
              requestMessageId: 'msg-request',
              actorType: 'player',
              actorId: 'p1',
              targetAgentId: 'agent-builder',
              status: 'accepted',
              actionSummaries: [],
              createdAt: '2026-04-03T00:00:00.000Z',
              updatedAt: '2026-04-03T00:00:00.000Z',
            },
          ],
        }, { status: 202 }));
      }

      return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(gateway.fetchConversationTurns('conv-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'turn-1',
        assistantPreview: '先检查矿机。',
      }),
    ]);

    await expect(gateway.sendConversationMessage('conv-a', {
      senderType: 'player',
      senderId: 'p1',
      content: '@建造官 检查产线',
    })).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        message: expect.objectContaining({
          id: 'msg-request',
        }),
        turns: [
          expect.objectContaining({
            id: 'turn-1',
            requestMessageId: 'msg-request',
          }),
        ],
      }),
    );
  });

  it('calls agent list/create/update/message/thread endpoints against an absolute gateway url', async () => {
    const seen: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      seen.push({ url, method });
      if (url === 'http://127.0.0.1:18180/agents' && method === 'GET') {
        return Promise.resolve(jsonResponse([{ id: 'agent-lisi', name: '李斯' }]));
      }
      if (url === 'http://127.0.0.1:18180/agents' && method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'agent-lisi', name: '李斯' }, { status: 201 }));
      }
      if (url === 'http://127.0.0.1:18180/agents/agent-lisi' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ id: 'agent-lisi', name: '李斯', policy: { canCreateAgents: true } }));
      }
      if (url === 'http://127.0.0.1:18180/agents/agent-lisi/messages' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({ content: '创建胡景，并赋予其建筑权限' });
        return Promise.resolve(jsonResponse({ accepted: true }, { status: 202 }));
      }
      if (url === 'http://127.0.0.1:18180/agents/agent-lisi/thread' && method === 'GET') {
        return Promise.resolve(jsonResponse({
          id: 'thread-agent-lisi',
          agentId: 'agent-lisi',
          messages: [{ role: 'assistant', content: '胡景已创建。' }],
          toolCalls: [],
          executionLogs: [],
        }));
      }
      return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
    }));

    const cliGateway = createAgentGatewayClient({ baseUrl: 'http://127.0.0.1:18180/' });
    const agents = await cliGateway.fetchAgents();
    const created = await cliGateway.createAgent({
      name: '李斯',
      providerId: 'provider-case1',
      serverUrl: 'http://127.0.0.1:18080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    const updated = await cliGateway.updateAgent('agent-lisi', { policy: { canCreateAgents: true } });
    const accepted = await cliGateway.sendAgentMessage('agent-lisi', '创建胡景，并赋予其建筑权限');
    const thread = await cliGateway.fetchAgentThread('agent-lisi');

    expect(agents[0]?.id).toBe('agent-lisi');
    expect(created.id).toBe('agent-lisi');
    expect(updated.policy?.canCreateAgents).toBe(true);
    expect(accepted.accepted).toBe(true);
    expect(thread.id).toBe('thread-agent-lisi');
    expect(seen).toHaveLength(5);
  });

  it('surfaces gateway error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'agent_not_found' }, { status: 404 }))));
    await expect(gateway.fetchAgentThread('missing')).rejects.toThrow('agent_not_found');
  });
});
