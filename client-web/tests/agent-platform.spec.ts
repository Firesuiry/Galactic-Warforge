import { expect, test } from '@playwright/test';

test('智能体平台支持模型 Provider 配置与成员 Provider 切换', async ({ page }) => {
  const providers: Array<Record<string, unknown>> = [];
  const agent = {
    id: 'agent-builder',
    name: '建造官',
    providerId: 'provider-existing',
    serverUrl: 'http://localhost:18080',
    playerId: 'p1',
    status: 'idle',
    role: 'worker',
    policy: {
      planetIds: [],
      commandCategories: [],
      canCreateAgents: false,
      canCreateChannel: false,
      canManageMembers: false,
      canInviteByPlanet: false,
      canCreateSchedules: false,
      canDirectMessageAgentIds: [],
      canDispatchAgentIds: [],
    },
  };
  let latestAgentPatchPayload: Record<string, unknown> | null = null;

  await page.addInitScript(() => {
    window.localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
      state: {
        serverUrl: 'http://localhost:5173',
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
      version: 0,
    }));
  });

  await page.route('**/state/summary', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tick: 42,
        active_planet_id: 'planet-a',
        players: {
          p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
        },
      }),
    });
  });
  await page.route('**/state/stats', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        player_id: 'p1',
        tick: 42,
        production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
        energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
        combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
      }),
    });
  });
  await page.route('**/agent-api/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === '/agent-api/health') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
      return;
    }

    if (pathname === '/agent-api/conversations') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    if (pathname === '/agent-api/providers' && method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(providers) });
      return;
    }

    if (pathname === '/agent-api/providers' && method === 'POST') {
      const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      const created = {
        id: `provider-${providers.length + 1}`,
        ...payload,
      };
      providers.push(created);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
      return;
    }

    if (pathname === '/agent-api/agents' && method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([agent]) });
      return;
    }

    if (pathname === '/agent-api/agents/agent-builder' && method === 'PATCH') {
      latestAgentPatchPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      Object.assign(agent, latestAgentPatchPayload);
      agent.policy = {
        ...agent.policy,
        ...((latestAgentPatchPayload.policy as Record<string, unknown>) ?? {}),
      };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(agent) });
      return;
    }

    if (pathname === '/agent-api/schedules') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: `unexpected ${method} ${pathname}` }),
    });
  });

  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: '智能体协作台' })).toBeVisible();

  await page.getByRole('button', { name: '成员' }).click();
  await page.getByRole('button', { name: '新建成员' }).click();
  await page.getByRole('button', { name: '新建模型 Provider' }).click();

  await expect(page.getByLabel('Provider 类型')).toBeVisible();
  await page.getByLabel('模型 Provider 名称').fill('总管 Provider');
  await page.getByLabel('模型 Provider 说明').fill('负责统筹调度');
  await page.getByLabel('Provider 类型').selectOption('claude_code_cli');
  await page.getByLabel('模型名称').fill('sonnet');
  await page.getByLabel('系统提示词').fill('你是总管。只做简洁回复。');
  await page.getByLabel('启动命令').fill('claude');
  await page.getByLabel('工作目录').fill('/tmp/claude-workdir');
  await page.getByLabel('启动参数').fill('--append-system-prompt\n保持简洁');
  await page.getByRole('button', { name: '保存模型 Provider' }).click();

  await expect(page.getByLabel('绑定模型 Provider')).toHaveValue('provider-1');
  await page.getByRole('button', { name: '新建模型 Provider' }).click();
  await expect(page.getByText('claude_code_cli / sonnet')).toBeVisible();
  await expect(page.getByText('命令 claude')).toBeVisible();

  await page.getByRole('button', { name: '新建模型 Provider' }).click();
  await page.getByLabel('模型 Provider 名称').fill('MiniMax Provider');
  await page.getByLabel('Provider 类型').selectOption('http_api');
  await page.getByLabel('API URL').fill('https://api.minimaxi.com/v1');
  await page.getByLabel('接口类型').selectOption('openai');
  await page.getByLabel('模型名称').fill('MiniMax-M2.1');
  await page.getByLabel('API Key').fill('sk-demo-value');
  await page.getByRole('button', { name: '保存模型 Provider' }).click();

  await page.getByRole('button', { name: '新建模型 Provider' }).click();
  await expect(page.getByText('http_api / MiniMax-M2.1')).toBeVisible();
  await expect(page.getByText('API https://api.minimaxi.com/v1')).toBeVisible();

  await page.getByRole('button', { name: /^建造官/ }).click();
  await page.getByLabel('绑定模型 Provider').selectOption('provider-2');
  await page.getByRole('button', { name: '保存模型 Provider 绑定' }).click();
  await expect(page.getByLabel('星球范围')).toBeVisible();
  await page.getByLabel('星球范围').fill('planet-a, planet-b');
  await page.getByLabel('命令分类').fill('build, observe');
  await page.getByRole('checkbox', { name: '允许创建智能体' }).check();
  await page.getByRole('checkbox', { name: '允许按星球拉人' }).check();
  await page.getByRole('checkbox', { name: '允许创建定时任务' }).check();
  await page.getByRole('button', { name: '保存权限配置' }).click();

  await expect.poll(() => latestAgentPatchPayload).not.toBeNull();
  const patchedPayload = (latestAgentPatchPayload ?? {}) as Record<string, unknown>;
  const patchedPolicy = (patchedPayload['policy'] ?? null) as Record<string, unknown> | null;
  expect(patchedPolicy?.canCreateAgents).toBe(true);
});

test('案例1：浏览器中李斯创建胡景并委派建矿场', async ({ page }) => {
  const providers = [{
    id: 'provider-case1',
    name: 'Case1 Provider',
    description: '案例 1 provider',
    providerKind: 'codex_cli',
    defaultModel: 'gpt-5-codex',
    systemPrompt: 'Return JSON.',
    toolPolicy: {
      cliEnabled: true,
      maxSteps: 4,
      maxToolCallsPerTurn: 4,
      commandWhitelist: [],
    },
    providerConfig: {
      command: 'codex',
      model: 'gpt-5-codex',
      workdir: '/tmp',
      argsTemplate: [],
      envOverrides: {},
    },
  }];
  const agents: Array<Record<string, unknown>> = [{
    id: 'agent-lisi',
    name: '李斯',
    providerId: 'provider-case1',
    serverUrl: 'http://localhost:18080',
    playerId: 'p1',
    status: 'idle',
    role: 'director',
    policy: {
      planetIds: ['planet-1-1'],
      commandCategories: ['observe', 'build', 'combat', 'research', 'management'],
      canCreateAgents: true,
      canCreateChannel: true,
      canManageMembers: true,
      canInviteByPlanet: true,
      canCreateSchedules: false,
      canDirectMessageAgentIds: [],
      canDispatchAgentIds: [],
    },
  }];
  const conversations: Array<Record<string, unknown>> = [{
    id: 'dm-lisi',
    type: 'dm',
    name: '与 李斯 私聊',
    topic: '',
    memberIds: ['player:p1', 'agent:agent-lisi'],
  }];
  const messagesByConversation: Record<string, Array<Record<string, unknown>>> = {
    'dm-lisi': [],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
      state: {
        serverUrl: 'http://localhost:5173',
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
      version: 0,
    }));
  });

  await page.route('**/state/summary', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tick: 42,
        active_planet_id: 'planet-1-1',
        players: {
          p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
        },
      }),
    });
  });
  await page.route('**/state/stats', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        player_id: 'p1',
        tick: 42,
        production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
        energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
        combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
      }),
    });
  });
  await page.route('**/agent-api/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === '/agent-api/health') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
      return;
    }
    if (pathname === '/agent-api/providers') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(providers) });
      return;
    }
    if (pathname === '/agent-api/agents') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(agents) });
      return;
    }
    if (pathname === '/agent-api/conversations') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(conversations) });
      return;
    }
    if (pathname === '/agent-api/schedules') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }
    if (pathname === '/agent-api/conversations/dm-lisi/messages' && method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(messagesByConversation['dm-lisi']) });
      return;
    }
    if (pathname === '/agent-api/conversations/dm-lisi/turns' && method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
      return;
    }
    if (pathname === '/agent-api/conversations/dm-lisi/messages' && method === 'POST') {
      const payload = JSON.parse(route.request().postData() ?? '{}') as { senderType: string; senderId: string; content: string };
      const message = {
        id: `msg-${messagesByConversation['dm-lisi'].length + 1}`,
        conversationId: 'dm-lisi',
        senderType: payload.senderType,
        senderId: payload.senderId,
        kind: 'chat',
        content: payload.content,
        mentions: [],
        createdAt: new Date().toISOString(),
      };
      messagesByConversation['dm-lisi'].push(message);

      if (payload.content.includes('创建胡景')) {
        agents.push({
          id: 'agent-hujing',
          name: '胡景',
          providerId: 'provider-case1',
          serverUrl: 'http://localhost:18080',
          playerId: 'p1',
          status: 'idle',
          role: 'worker',
          policy: {
            planetIds: ['planet-1-1'],
            commandCategories: ['build'],
            canCreateAgents: false,
            canCreateChannel: false,
            canManageMembers: false,
            canInviteByPlanet: false,
            canCreateSchedules: false,
            canDirectMessageAgentIds: [],
            canDispatchAgentIds: [],
          },
        });
        messagesByConversation['dm-lisi'].push({
          id: `msg-${messagesByConversation['dm-lisi'].length + 1}`,
          conversationId: 'dm-lisi',
          senderType: 'agent',
          senderId: 'agent-lisi',
          kind: 'chat',
          content: '胡景已创建，并已赋予建筑权限。',
          mentions: [],
          createdAt: new Date().toISOString(),
        });
      } else if (payload.content.includes('新建一个矿场')) {
        messagesByConversation['dm-lisi'].push({
          id: `msg-${messagesByConversation['dm-lisi'].length + 1}`,
          conversationId: 'dm-lisi',
          senderType: 'agent',
          senderId: 'agent-lisi',
          kind: 'chat',
          content: '我已通知胡景去建矿场，胡景已开始建造 mining_machine。',
          mentions: [],
          createdAt: new Date().toISOString(),
        });
      }

      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true, message, turns: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: `unexpected ${method} ${pathname}` }),
    });
  });

  await page.goto('/agents');
  await expect(page.getByRole('button', { name: /与 李斯 私聊/ })).toBeVisible();
  await page.getByRole('button', { name: /与 李斯 私聊/ }).click();
  await page.getByLabel('发送消息').fill('创建胡景，并赋予其建筑权限');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('胡景已创建，并已赋予建筑权限。')).toBeVisible();

  await page.getByRole('button', { name: '成员' }).click();
  await expect(page.getByRole('button', { name: /^胡景/ })).toBeVisible();

  await page.getByRole('button', { name: '频道' }).click();
  await page.getByRole('button', { name: /与 李斯 私聊/ }).click();
  await page.getByLabel('发送消息').fill('新建一个矿场');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('我已通知胡景去建矿场，胡景已开始建造 mining_machine。')).toBeVisible();
});
