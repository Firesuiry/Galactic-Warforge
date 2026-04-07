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
  await page.getByRole('checkbox', { name: '允许按星球拉人' }).check();
  await page.getByRole('checkbox', { name: '允许创建定时任务' }).check();
  await page.getByRole('button', { name: '保存权限配置' }).click();

  await expect(page.getByText('星球 planet-a, planet-b')).toBeVisible();
  await expect.poll(() => latestAgentPatchPayload).not.toBeNull();
});
