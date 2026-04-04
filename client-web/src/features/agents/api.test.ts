import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/utils';

import {
  addConversationMembers,
  createAgent,
  createSchedule,
  createTemplate,
  fetchTemplates,
  updateSchedule,
} from './api';

describe('agents api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches templates from the agent gateway', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      expect(String(input)).toBe('/agent-api/templates');
      return Promise.resolve(jsonResponse([
        {
          id: 'tpl-builder',
          name: '建造模板',
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

    await expect(fetchTemplates()).resolves.toEqual([
      expect.objectContaining({
        id: 'tpl-builder',
        name: '建造模板',
      }),
    ]);
  });

  it('posts template, agent, member invite, and owned schedule payloads', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === '/agent-api/templates' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: '建造模板',
          providerKind: 'codex_cli',
        });
        return Promise.resolve(jsonResponse({ id: 'tpl-builder', name: '建造模板' }, { status: 201 }));
      }

      if (url === '/agent-api/agents' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          name: '建造官',
          templateId: 'tpl-builder',
          playerId: 'p1',
          playerKey: 'key_player_1',
        });
        return Promise.resolve(jsonResponse({ id: 'agent-builder', name: '建造官', templateId: 'tpl-builder' }, { status: 201 }));
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

    await createTemplate({
      name: '建造模板',
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
      templateId: 'tpl-builder',
      serverUrl: 'http://localhost:8080',
      playerId: 'p1',
      playerKey: 'key_player_1',
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

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
