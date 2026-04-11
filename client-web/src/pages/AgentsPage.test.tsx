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

  it('renders the IM workspace with conversations, messages, and a channel settings entry', async () => {
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
            providerId: 'provider-1',
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
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
      if (url.endsWith('/agent-api/conversations/conv-1/turns')) {
        return Promise.resolve(jsonResponse([]));
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
    expect(screen.getByRole('button', { name: '频道设置' })).toBeInTheDocument();
  });

  it('switches between channel and member panes', async () => {
    const user = userEvent.setup();

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
            providerId: 'provider-1',
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/turns')) {
        return Promise.resolve(jsonResponse([]));
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

    expect(await screen.findByRole('button', { name: '频道' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '成员' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: '成员' }));

    expect(screen.getByRole('button', { name: '成员' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: '新建成员' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /建造官/ })).toBeInTheDocument();
  });

  it('invites an existing member from channel settings', async () => {
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

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse(conversations));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'agent-builder',
            name: '建造官',
            providerId: 'provider-1',
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/turns')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/members') && method === 'POST') {
        conversations[0] = {
          ...conversations[0],
          memberIds: ['player:p1', 'agent:agent-builder'],
        };
        return Promise.resolve(jsonResponse({
          conversationId: 'conv-1',
          memberIds: conversations[0].memberIds,
        }));
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

    await user.click(await screen.findByRole('button', { name: '频道设置' }));
    await user.selectOptions(screen.getByLabelText('选择成员'), 'agent-builder');
    await user.click(screen.getByRole('button', { name: '添加到频道' }));

    expect(await screen.findByText('建造官')).toBeInTheDocument();
  });

  it('creates a member after creating a template inline', async () => {
    const user = userEvent.setup();
    const templates: Array<Record<string, unknown>> = [];
    const agents: Array<Record<string, unknown>> = [];

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents') && method === 'GET') {
        return Promise.resolve(jsonResponse(agents));
      }
      if (url.endsWith('/agent-api/agents') && method === 'POST') {
        const payload = JSON.parse(String(init?.body));
        const created = {
          id: 'agent-builder',
          name: payload.name,
          providerId: payload.providerId,
          serverUrl: payload.serverUrl,
          playerId: payload.playerId,
          status: 'idle',
          role: 'worker',
          policy: {
            planetIds: [],
            commandCategories: [],
            canCreateChannel: false,
            canManageMembers: false,
            canInviteByPlanet: false,
            canCreateSchedules: false,
            canDirectMessageAgentIds: [],
            canDispatchAgentIds: [],
          },
        };
        agents.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (url.endsWith('/agent-api/providers') && method === 'GET') {
        return Promise.resolve(jsonResponse(templates));
      }
      if (url.endsWith('/agent-api/providers') && method === 'POST') {
        const payload = JSON.parse(String(init?.body));
        const created = {
          id: 'tpl-builder',
          name: payload.name,
          description: payload.description ?? '',
          providerKind: payload.providerKind,
          defaultModel: payload.defaultModel,
          systemPrompt: payload.systemPrompt,
          toolPolicy: payload.toolPolicy,
          providerConfig: payload.providerConfig,
        };
        templates.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(screen.getByRole('button', { name: '新建成员' }));
    await user.click(screen.getByRole('button', { name: '新建模型 Provider' }));
    await user.type(await screen.findByLabelText('模型 Provider 名称'), '建造 Provider');
    await user.click(screen.getByRole('button', { name: '保存模型 Provider' }));
    await user.type(await screen.findByLabelText('成员名称'), '建造官');
    await user.click(screen.getByRole('button', { name: '保存成员' }));

    expect(await screen.findByRole('heading', { name: '建造官' })).toBeInTheDocument();
    expect(screen.getAllByText('建造 Provider').length).toBeGreaterThan(0);
  });

  it('captures provider config when creating a cli model provider inline', async () => {
    const user = userEvent.setup();
    const templates: Array<Record<string, unknown>> = [];
    let templatePayload: Record<string, unknown> | null = null;

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/providers') && method === 'GET') {
        return Promise.resolve(jsonResponse(templates));
      }
      if (url.endsWith('/agent-api/providers') && method === 'POST') {
        templatePayload = JSON.parse(String(init?.body));
        const created = {
          id: 'tpl-claude',
          ...templatePayload,
        };
        templates.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(screen.getByRole('button', { name: '新建成员' }));
    await user.click(screen.getByRole('button', { name: '新建模型 Provider' }));

    await user.type(await screen.findByLabelText('模型 Provider 名称'), '总管 Provider');
    await user.type(screen.getByLabelText('模型 Provider 说明'), '负责统筹调度');
    await user.selectOptions(screen.getByLabelText('Provider 类型'), 'claude_code_cli');
    await user.clear(screen.getByLabelText('模型名称'));
    await user.type(screen.getByLabelText('模型名称'), 'sonnet');
    await user.clear(screen.getByLabelText('系统提示词'));
    await user.type(screen.getByLabelText('系统提示词'), '你是总管。只做简洁回复。');
    await user.clear(screen.getByLabelText('启动命令'));
    await user.type(screen.getByLabelText('启动命令'), 'claude');
    await user.clear(screen.getByLabelText('工作目录'));
    await user.type(screen.getByLabelText('工作目录'), '/tmp/claude-workdir');
    await user.type(screen.getByLabelText('启动参数'), '--append-system-prompt\n保持简洁');
    await user.click(screen.getByRole('button', { name: '保存模型 Provider' }));

    await waitFor(() => expect(templatePayload).not.toBeNull());
    expect(templatePayload).toMatchObject({
      name: '总管 Provider',
      description: '负责统筹调度',
      providerKind: 'claude_code_cli',
      defaultModel: 'sonnet',
      systemPrompt: '你是总管。只做简洁回复。',
      providerConfig: {
        command: 'claude',
        model: 'sonnet',
        workdir: '/tmp/claude-workdir',
        argsTemplate: ['--append-system-prompt', '保持简洁'],
      },
    });
  });

  it('creates an api model provider and switches member provider binding', async () => {
    const user = userEvent.setup();
    const providers: Array<Record<string, unknown>> = [
      {
        id: 'provider-worker',
        name: 'Worker Provider',
        description: '默认 Provider',
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
    ];
    const agents = [
      {
        id: 'agent-builder',
        name: '建造官',
        providerId: 'provider-worker',
        serverUrl: 'http://localhost:18080',
        playerId: 'p1',
        status: 'idle',
        role: 'worker',
        policy: {
          planetIds: [],
          commandCategories: [],
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      },
    ];
    let createdProviderPayload: Record<string, unknown> | null = null;
    let updatedAgentPayload: Record<string, unknown> | null = null;

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents') && method === 'GET') {
        return Promise.resolve(jsonResponse(agents));
      }
      if (url.endsWith('/agent-api/agents/agent-builder') && method === 'PATCH') {
        updatedAgentPayload = JSON.parse(String(init?.body));
        agents[0] = {
          ...agents[0],
          ...updatedAgentPayload,
        };
        return Promise.resolve(jsonResponse(agents[0]));
      }
      if (url.endsWith('/agent-api/providers') && method === 'GET') {
        return Promise.resolve(jsonResponse(providers));
      }
      if (url.endsWith('/agent-api/providers') && method === 'POST') {
        createdProviderPayload = JSON.parse(String(init?.body));
        const created = {
          id: 'provider-api',
          ...createdProviderPayload,
        };
        providers.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(screen.getByRole('button', { name: '新建成员' }));
    await user.click(screen.getByRole('button', { name: '新建模型 Provider' }));
    await user.type(await screen.findByLabelText('模型 Provider 名称'), 'MiniMax Provider');
    await user.type(screen.getByLabelText('模型 Provider 说明'), 'API 模式');
    await user.selectOptions(screen.getByLabelText('Provider 类型'), 'http_api');
    await user.clear(screen.getByLabelText('API URL'));
    await user.type(screen.getByLabelText('API URL'), 'https://api.minimaxi.com/v1');
    await user.selectOptions(screen.getByLabelText('接口类型'), 'openai');
    await user.clear(screen.getByLabelText('模型名称'));
    await user.type(screen.getByLabelText('模型名称'), 'MiniMax-M2.1');
    await user.type(screen.getByLabelText('API Key'), 'sk-demo-value');
    await user.click(screen.getByRole('button', { name: '保存模型 Provider' }));

    expect(createdProviderPayload).toMatchObject({
      name: 'MiniMax Provider',
      providerKind: 'http_api',
      providerConfig: {
        apiUrl: 'https://api.minimaxi.com/v1',
        apiStyle: 'openai',
        model: 'MiniMax-M2.1',
        apiKey: 'sk-demo-value',
      },
    });

    await user.click(screen.getByRole('button', { name: /^建造官/ }));
    await user.selectOptions(await screen.findByLabelText('绑定模型 Provider'), 'provider-api');
    await user.click(screen.getByRole('button', { name: '保存模型 Provider 绑定' }));

    expect(updatedAgentPayload).toEqual({
      providerId: 'provider-api',
    });
  });

  it('captures api provider config when creating an http template inline', async () => {
    const user = userEvent.setup();
    const templates: Array<Record<string, unknown>> = [];
    let templatePayload: Record<string, unknown> | null = null;

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/providers') && method === 'GET') {
        return Promise.resolve(jsonResponse(templates));
      }
      if (url.endsWith('/agent-api/providers') && method === 'POST') {
        templatePayload = JSON.parse(String(init?.body));
        const created = {
          id: 'tpl-http',
          ...templatePayload,
        };
        templates.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(screen.getByRole('button', { name: '新建成员' }));
    await user.click(screen.getByRole('button', { name: '新建模型 Provider' }));

    await user.type(await screen.findByLabelText('模型 Provider 名称'), 'MiniMax Provider');
    await user.selectOptions(screen.getByLabelText('Provider 类型'), 'http_api');
    await user.clear(screen.getByLabelText('API URL'));
    await user.clear(screen.getByLabelText('API URL'));
    await user.type(screen.getByLabelText('API URL'), 'https://api.minimaxi.com/v1');
    await user.selectOptions(screen.getByLabelText('接口类型'), 'openai');
    await user.clear(screen.getByLabelText('模型名称'));
    await user.type(screen.getByLabelText('模型名称'), 'MiniMax-M2.1');
    await user.type(screen.getByLabelText('API Key'), 'sk-demo-value');
    await user.click(screen.getByRole('button', { name: '保存模型 Provider' }));

    await waitFor(() => expect(templatePayload).not.toBeNull());
    expect(templatePayload).toMatchObject({
      name: 'MiniMax Provider',
      providerKind: 'http_api',
      defaultModel: 'MiniMax-M2.1',
      providerConfig: {
        apiUrl: 'https://api.minimaxi.com/v1',
        apiStyle: 'openai',
        apiKey: 'sk-demo-value',
        model: 'MiniMax-M2.1',
      },
    });
  });

  it('opens or creates a dm from member detail', async () => {
    const user = userEvent.setup();
    const conversations: Array<Record<string, unknown>> = [];

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
          id: 'dm-1',
          type: payload.type,
          name: payload.name,
          topic: payload.topic,
          memberIds: payload.memberIds,
        };
        conversations.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'agent-builder',
            name: '建造官',
            providerId: 'provider-builder',
            serverUrl: 'http://localhost:18080',
            playerId: 'p1',
            status: 'idle',
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
      if (url.endsWith('/agent-api/providers')) {
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
      }
      if (url.endsWith('/agent-api/conversations/dm-1/messages')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/dm-1/turns')) {
        return Promise.resolve(jsonResponse([]));
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(await screen.findByRole('button', { name: /建造官/ }));
    await user.click(screen.getByRole('button', { name: '发起私聊' }));

    expect(await screen.findByRole('heading', { name: /私聊/ })).toBeInTheDocument();
  });

  it('updates agent policy from member detail', async () => {
    const user = userEvent.setup();
    const agents = [
      {
        id: 'agent-builder',
        name: '建造官',
        providerId: 'provider-builder',
        serverUrl: 'http://localhost:18080',
        playerId: 'p1',
        status: 'idle',
        role: 'worker',
        policy: {
          planetIds: [],
          commandCategories: [],
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      },
    ];
    let updatePayload: Record<string, unknown> | null = null;

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents') && method === 'GET') {
        return Promise.resolve(jsonResponse(agents));
      }
      if (url.endsWith('/agent-api/agents/agent-builder') && method === 'PATCH') {
        updatePayload = JSON.parse(String(init?.body));
        agents[0] = {
          ...agents[0],
          ...updatePayload,
          policy: {
            ...agents[0].policy,
            ...(updatePayload?.policy as Record<string, unknown>),
          },
        };
        return Promise.resolve(jsonResponse(agents[0]));
      }
      if (url.endsWith('/agent-api/providers')) {
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(await screen.findByRole('button', { name: /建造官/ }));
    await user.clear(await screen.findByLabelText('星球范围'));
    await user.type(screen.getByLabelText('星球范围'), 'planet-a, planet-b');
    await user.clear(screen.getByLabelText('命令分类'));
    await user.type(screen.getByLabelText('命令分类'), 'build, observe');
    await user.click(screen.getByRole('checkbox', { name: '允许按星球拉人' }));
    await user.click(screen.getByRole('checkbox', { name: '允许创建定时任务' }));
    await user.click(screen.getByRole('button', { name: '保存权限配置' }));

    await waitFor(() => expect(updatePayload).not.toBeNull());
    expect(updatePayload).toMatchObject({
      policy: {
        planetIds: ['planet-a', 'planet-b'],
        commandCategories: ['build', 'observe'],
        canInviteByPlanet: true,
        canCreateSchedules: true,
      },
    });
  });

  it('manages member-owned schedules from member detail', async () => {
    const user = userEvent.setup();
    const schedules: Array<Record<string, unknown>> = [
      {
        id: 'schedule-1',
        ownerAgentId: 'agent-builder',
        targetType: 'agent_dm',
        targetId: 'agent-builder',
        intervalSeconds: 300,
        messageTemplate: '@建造官 每五分钟汇报一次',
        enabled: true,
      },
    ];

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/conversations') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'agent-builder',
            name: '建造官',
            providerId: 'provider-builder',
            serverUrl: 'http://localhost:18080',
            playerId: 'p1',
            status: 'idle',
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
      if (url.endsWith('/agent-api/providers')) {
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
      }
      if (url.endsWith('/agent-api/schedules') && method === 'GET') {
        return Promise.resolve(jsonResponse(schedules));
      }
      if (url.endsWith('/agent-api/schedules') && method === 'POST') {
        const payload = JSON.parse(String(init?.body));
        const created = {
          id: 'schedule-2',
          ownerAgentId: payload.ownerAgentId,
          targetType: payload.targetType,
          targetId: payload.targetId,
          intervalSeconds: payload.intervalSeconds,
          messageTemplate: payload.messageTemplate,
          enabled: true,
        };
        schedules.push(created);
        return Promise.resolve(jsonResponse(created, { status: 201 }));
      }
      if (url.endsWith('/agent-api/schedules/schedule-1') && method === 'PATCH') {
        const payload = JSON.parse(String(init?.body));
        schedules[0] = {
          ...schedules[0],
          ...payload,
        };
        return Promise.resolve(jsonResponse(schedules[0]));
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

    await user.click(await screen.findByRole('button', { name: '成员' }));
    await user.click(await screen.findByRole('button', { name: /建造官/ }));

    expect(await screen.findByText('每 300 秒发送一次')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '停用任务' }));
    expect(await screen.findByText('已停用')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('任务间隔（秒）'));
    await user.type(screen.getByLabelText('任务间隔（秒）'), '600');
    await user.type(screen.getByLabelText('任务内容'), '@建造官 每十分钟汇报一次');
    await user.click(screen.getByRole('button', { name: '创建定时任务' }));

    expect(await screen.findByText('每 600 秒发送一次')).toBeInTheDocument();
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/agent-api/conversations/') && url.endsWith('/messages') && method === 'GET') {
        const conversationId = url.split('/agent-api/conversations/')[1]?.replace('/messages', '') ?? '';
        return Promise.resolve(jsonResponse(messages.get(conversationId) ?? []));
      }
      if (url.includes('/agent-api/conversations/') && url.endsWith('/turns') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/agent-api/conversations/') && url.endsWith('/messages') && method === 'POST') {
        const conversationId = url.split('/agent-api/conversations/')[1]?.replace('/messages', '') ?? '';
        const payload = JSON.parse(String(init?.body));
        const bucket = messages.get(conversationId) ?? [];
        const message = {
          id: `msg-${bucket.length + 1}`,
          conversationId,
          senderType: payload.senderType,
          senderId: payload.senderId,
          kind: 'chat',
          content: payload.content,
          mentions: [],
          createdAt: '2026-04-03T00:00:00.000Z',
        };
        bucket.push(message);
        messages.set(conversationId, bucket);
        return Promise.resolve(jsonResponse({
          accepted: true,
          message,
          turns: [],
        }, { status: 202 }));
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
            providerId: 'provider-1',
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
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
        return Promise.resolve(jsonResponse({
          accepted: true,
          message: {
            id: 'msg-player',
            conversationId: 'conv-1',
            senderType: 'player',
            senderId: 'p1',
            kind: 'chat',
            content: '@建造官 检查产线',
            mentions: [{ type: 'agent', id: 'agent-builder' }],
            createdAt: '2026-04-03T00:00:00.000Z',
          },
          turns: [],
        }, { status: 202 }));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/turns') && method === 'GET') {
        return Promise.resolve(jsonResponse([]));
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
      if (url.endsWith('/agent-api/providers')) {
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

  it('renders conversation turns as request lifecycle cards', async () => {
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
            providerId: 'provider-1',
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'msg-request',
            conversationId: 'conv-1',
            senderType: 'player',
            senderId: 'p1',
            kind: 'chat',
            content: '@建造官 检查产线',
            mentions: [{ type: 'agent', id: 'agent-builder' }],
            createdAt: '2026-04-03T00:00:00.000Z',
          },
          {
            id: 'msg-final',
            conversationId: 'conv-1',
            senderType: 'agent',
            senderId: 'agent-builder',
            kind: 'chat',
            content: '已安排矿机检查。',
            mentions: [],
            replyToMessageId: 'msg-request',
            turnId: 'turn-1',
            createdAt: '2026-04-03T00:00:02.000Z',
          },
        ]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/turns')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'turn-1',
            conversationId: 'conv-1',
            requestMessageId: 'msg-request',
            actorType: 'player',
            actorId: 'p1',
            targetAgentId: 'agent-builder',
            status: 'succeeded',
            assistantPreview: '先检查矿机和电力，再决定是否补建。',
            finalMessageId: 'msg-final',
            actionSummaries: [
              {
                type: 'conversation.send_message',
                status: 'succeeded',
                detail: '已向建造官发送检查指令。',
              },
            ],
            createdAt: '2026-04-03T00:00:00.000Z',
            updatedAt: '2026-04-03T00:00:02.000Z',
          },
        ]));
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

    expect(await screen.findByText('@建造官 检查产线')).toBeInTheDocument();
    expect(
      await screen.findByText('先检查矿机和电力，再决定是否补建。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('已向建造官发送检查指令。'),
    ).toBeInTheDocument();
    expect(screen.getByText('已安排矿机检查。')).toBeInTheDocument();
  });

  it('shows failure reason, raw error, and recovery hint for failed turns', async () => {
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
            type: 'dm',
            name: '与 科研官 私聊',
            topic: '科研委派',
            memberIds: ['player:p1', 'agent:agent-researcher'],
          },
        ]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'agent-researcher',
            name: '科研官',
            providerId: 'provider-1',
            serverUrl: 'http://localhost:18080',
            playerId: 'p1',
            status: 'running',
            role: 'worker',
            policy: {
              planetIds: ['planet-1-1'],
              commandCategories: ['research'],
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
      if (url.endsWith('/agent-api/providers')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/messages')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'msg-1',
            conversationId: 'conv-1',
            senderType: 'player',
            senderId: 'p1',
            kind: 'chat',
            content: '把 10 个 electromagnetic_matrix 装入 b-9，然后启动研究',
            mentions: [],
            createdAt: '2026-04-11T00:00:00.000Z',
          },
        ]));
      }
      if (url.endsWith('/agent-api/conversations/conv-1/turns')) {
        return Promise.resolve(jsonResponse([
          {
            id: 'turn-1',
            conversationId: 'conv-1',
            requestMessageId: 'msg-1',
            actorType: 'player',
            actorId: 'p1',
            targetAgentId: 'agent-researcher',
            status: 'failed',
            errorCode: 'provider_schema_invalid',
            errorMessage: '模型返回结构无效，请稍后重试。',
            rawErrorMessage: 'transfer_item requires buildingId',
            errorHint: '缺少目标建筑 ID，请明确研究站或装料建筑，例如 b-9。',
            actionSummaries: [],
            createdAt: '2026-04-11T00:00:01.000Z',
            updatedAt: '2026-04-11T00:00:02.000Z',
          },
        ]));
      }
      if (url.endsWith('/agent-api/schedules')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-1-1',
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

    expect(await screen.findByText('失败原因')).toBeInTheDocument();
    expect(screen.getByText(/provider_schema_invalid/)).toBeInTheDocument();
    expect(screen.getByText('transfer_item requires buildingId')).toBeInTheDocument();
    expect(
      screen.getByText('缺少目标建筑 ID，请明确研究站或装料建筑，例如 b-9。'),
    ).toBeInTheDocument();
  });
});
