import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { useSessionStore } from '@/stores/session';
import { jsonResponse, renderApp } from '@/test/utils';

describe('AgentsPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('renders the IM workspace with conversations, messages, and agent policy details', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            id: 'conv-1',
            type: 'channel',
            name: '星球A协作',
            topic: '协调建设',
            memberIds: ['player:p1', 'agent:agent-builder'],
          },
        ]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'agent-builder',
            name: '建造官',
            templateId: 'tpl-1',
            serverUrl: 'http://localhost:18080',
            playerId: 'p1',
            status: 'running',
            role: 'worker',
            policy: {
              planetIds: ['planet-a'],
              commandCategories: ['build'],
              canCreateChannel: false,
              canManageMembers: false,
              canInviteByPlanet: false,
              canCreateSchedules: false,
              canDirectMessageAgentIds: [],
              canDispatchAgentIds: [],
            },
          },
        ]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'msg-1',
            conversationId: 'conv-1',
            senderType: 'player',
            senderId: 'p1',
            kind: 'chat',
            content: '@建造官 检查产线',
            mentions: [{ type: 'agent', id: 'agent-builder' }],
            createdAt: '2026-04-03T00:00:00.000Z',
          },
        ]));
      }
      if (url.endsWith('/agent-api/schedules')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'schedule-1',
            targetId: 'conv-1',
            targetType: 'conversation',
            intervalSeconds: 300,
            messageTemplate: '@建造官 每五分钟检查一次',
            enabled: true,
          },
        ]));
      }
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-a',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 42,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      return Promise.reject(new Error(`unexpected url ${method} ${url}`));
    }));

    renderApp(['/agents']);

    expect(await screen.findByText('星球A协作')).toBeTruthy();
    expect(await screen.findByText('@建造官 检查产线')).toBeInTheDocument();
    expect(screen.getByText('build')).toBeInTheDocument();
    expect(screen.getByText('每 300 秒')).toBeInTheDocument();
  });

  it('lets the player create a channel and send a message from the composer', async () => {
    const user = userEvent.setup();
    const conversations = [
      {
        id: 'conv-1',
        type: 'channel',
        name: '星球A协作',
        topic: '协调建设',
        memberIds: ['player:p1'],
      },
    ];
    const messages = new Map<string, Array<{
      id: string;
      conversationId: string;
      senderType: string;
      senderId: string;
      kind: string;
      content: string;
      mentions: Array<{ type: string; id: string }>;
      createdAt: string;
    }>>([
      ['conv-1', []],
      ['conv-2', []],
    ]);

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse(conversations));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'POST') {
        const payload = JSON.parse(String(init?.body));
        const created = {
          id: 'conv-2',
          type: 'channel',
          name: payload.name,
          topic: payload.topic,
          memberIds: payload.memberIds,
        };
        conversations.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/agent-api/conversations/') && url.endsWith('/messages') && method === 'GET') {
        const conversationId = url.split('/agent-api/conversations/')[1]?.replace('/messages', '') ?? '';
        return Promise.resolve(jsonResponse(messages.get(conversationId) ?? []));
      }
      if (url.includes('/agent-api/conversations/') && url.endsWith('/messages') && method === 'POST') {
        const conversationId = url.split('/agent-api/conversations/')[1]?.replace('/messages', '') ?? '';
        const payload = JSON.parse(String(init?.body));
        const bucket = messages.get(conversationId) ?? [];
        bucket.push({
          id: `msg-${bucket.length + 1}`,
          conversationId,
          senderType: payload.senderType,
          senderId: payload.senderId,
          kind: 'chat',
          content: payload.content,
          mentions: [],
          createdAt: '2026-04-03T00:00:00.000Z',
        });
        messages.set(conversationId, bucket);
        return Promise.resolve(jsonResponse({ accepted: true }, { status: 202 }));
      }
      if (url.endsWith('/agent-api/schedules')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-a',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 42,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      return Promise.reject(new Error(`unexpected url ${method} ${url}`));
    }));

    renderApp(['/agents']);

    await user.click(await screen.findByRole('button', { name: '新建频道' }));
    await user.type(await screen.findByLabelText('频道名称'), '物流指挥');
    await user.type(await screen.findByLabelText('频道主题'), '协调物流');
    await user.click(screen.getByRole('button', { name: '创建频道' }));

    expect(await screen.findByRole('heading', { name: '物流指挥' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('发送消息'), '先同步一下当前状态');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(screen.getByText('先同步一下当前状态')).toBeInTheDocument());
  });

  it('shows an auto reply after a delayed fallback refresh when the first refetch misses it', async () => {
    const user = userEvent.setup();
    let messageFetchCount = 0;

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([
          {
            id: 'conv-1',
            type: 'channel',
            name: '星球A协作',
            topic: '协调建设',
            memberIds: ['player:p1', 'agent:agent-builder'],
          },
        ]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'agent-builder',
            name: '建造官',
            templateId: 'tpl-1',
            serverUrl: 'http://localhost:18080',
            playerId: 'p1',
            status: 'running',
            role: 'worker',
            policy: {
              planetIds: ['planet-a'],
              commandCategories: ['build'],
              canCreateChannel: false,
              canManageMembers: false,
              canInviteByPlanet: false,
              canCreateSchedules: false,
              canDirectMessageAgentIds: [],
              canDispatchAgentIds: [],
            },
          },
        ]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages') && method === 'GET') {
        messageFetchCount += 1;
        if (messageFetchCount === 1) {
          return Promise.resolve(jsonResponse([]));
        }
        if (messageFetchCount === 2) {
          return Promise.resolve(jsonResponse([
            {
              id: 'msg-player',
              conversationId: 'conv-1',
              senderType: 'player',
              senderId: 'p1',
              kind: 'chat',
              content: '@建造官 检查产线',
              mentions: [{ type: 'agent', id: 'agent-builder' }],
              createdAt: '2026-04-03T00:00:00.000Z',
            },
          ]));
        }
        return Promise.resolve(jsonResponse([
          {
            id: 'msg-player',
            conversationId: 'conv-1',
            senderType: 'player',
            senderId: 'p1',
            kind: 'chat',
            content: '@建造官 检查产线',
            mentions: [{ type: 'agent', id: 'agent-builder' }],
            createdAt: '2026-04-03T00:00:00.000Z',
          },
          {
            id: 'msg-agent',
            conversationId: 'conv-1',
            senderType: 'agent',
            senderId: 'agent-builder',
            kind: 'chat',
            content: '已收到：@建造官 检查产线',
            mentions: [{ type: 'agent', id: 'agent-builder' }],
            createdAt: '2026-04-03T00:00:01.000Z',
          },
        ]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages') && method === 'POST') {
        return Promise.resolve(jsonResponse({ accepted: true }, { status: 202 }));
      }
      if (url.endsWith('/agent-api/schedules')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-a',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 42,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      return Promise.reject(new Error(`unexpected url ${method} ${url}`));
    }));

    renderApp(['/agents']);

    await screen.findByText('星球A协作');
    await user.type(screen.getByLabelText('发送消息'), '@建造官 检查产线');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('@建造官 检查产线')).toBeInTheDocument();
    expect(await screen.findByText('已收到：@建造官 检查产线')).toBeInTheDocument();
  });

  it('shows the new navigation entry in TopNav', async () => {
    const user = userEvent.setup();

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-a',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 42,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/schedules')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    renderApp(['/overview']);
    await user.click(await screen.findByRole('link', { name: '智能体' }));

    expect(await screen.findByRole('heading', { name: '智能体协作台' })).toBeInTheDocument();
  });
});
