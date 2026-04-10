import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/utils';

import {
  addConversationMembers,
  createAgent,
  createProvider,
  createSchedule,
  fetchConversationTurns,
  fetchProviders,
  sendConversationMessage,
  updateSchedule,
  updateAgent,
} from './api';

describe('agents api', () => {
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

    await expect(fetchProviders()).resolves.toEqual([
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

    await createProvider({
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

    await createAgent({
      name: '建造官',
      providerId: 'provider-builder',
      serverUrl: 'http://localhost:8080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    await updateAgent('agent-builder', {
      providerId: 'provider-director',
    });

    await addConversationMembers('conv-a', {
      actorType: 'player',
      actorId: 'p1',
      memberIds: ['agent:agent-builder'],
    });

    await createSchedule({
      ownerAgentId: 'agent-builder',
      creatorType: 'player',
      creatorId: 'p1',
      targetType: 'conversation',
      targetId: 'conv-a',
      intervalSeconds: 300,
      messageTemplate: '@建造官 每五分钟汇报一次',
    });

    await updateSchedule('schedule-a', {
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

    await expect(fetchConversationTurns('conv-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'turn-1',
        assistantPreview: '先检查矿机。',
      }),
    ]);

    await expect(sendConversationMessage('conv-a', {
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
});
