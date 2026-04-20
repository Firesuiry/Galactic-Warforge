import { expect, test, type Page } from '@playwright/test';

const WEB_ENTRY = 'http://127.0.0.1:4173';
const BACKEND_ENTRY = 'http://127.0.0.1:19481';

type Auth = {
  playerId: string;
  playerKey: string;
};

async function apiCommand(auth: Auth, type: string, payload: Record<string, unknown>) {
  const response = await fetch(`${BACKEND_ENTRY}/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.playerKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      request_id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      issuer_type: 'player',
      issuer_id: auth.playerId,
      commands: [{ type, payload }],
    }),
  });
  expect(response.ok).toBeTruthy();
}

async function waitForCondition(fn: () => Promise<boolean>) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for authoritative war state');
}

async function fetchAuthorized<T>(auth: Auth, path: string): Promise<T> {
  const response = await fetch(`${BACKEND_ENTRY}${path}`, {
    headers: {
      authorization: `Bearer ${auth.playerKey}`,
    },
  });
  expect(response.ok).toBeTruthy();
  return response.json() as Promise<T>;
}

async function findBuildingId(ownerID: string, buildingType: string) {
  const body = await fetchAuthorized<{
    buildings?: Record<string, {
      id: string;
      owner_id: string;
      type: string;
    }>;
  }>({ playerId: 'p1', playerKey: 'key_player_1' }, '/world/planets/planet-1-1/scene?x=0&y=0&width=48&height=48');
  const building = Object.values(body.buildings ?? {}).find((entry) => (
    entry.owner_id === ownerID && entry.type === buildingType
  ));
  expect(building).toBeTruthy();
  return building!.id;
}

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({
        state: {
          serverUrl,
          playerId: 'p1',
          playerKey: 'key_player_1',
        },
        version: 0,
      }),
    );
  }, WEB_ENTRY);
}

test('战争工作台可直接连接 authoritative 战争场景并操作核心流程', async ({ page }) => {
  const p1 = { playerId: 'p1', playerKey: 'key_player_1' };
  const p1HubId = await findBuildingId('p1', 'battlefield_analysis_base');
  const p1FactoryId = await findBuildingId('p1', 'recomposing_assembler');

  await apiCommand(p1, 'blueprint_variant', {
    parent_blueprint_id: 'corvette',
    blueprint_id: 'corvette_web_t122',
    allowed_slot_ids: ['utility'],
  });
  await apiCommand(p1, 'blueprint_validate', { blueprint_id: 'corvette_web_t122' });
  await apiCommand(p1, 'blueprint_finalize', {
    blueprint_id: 'corvette_web_t122',
    target_state: 'prototype',
  });
  await apiCommand(p1, 'queue_military_production', {
    building_id: p1FactoryId,
    deployment_hub_id: p1HubId,
    blueprint_id: 'corvette_web_t122',
    count: 1,
  });

  await waitForCondition(async () => {
    const body = await fetchAuthorized<{ deployment_hubs?: Array<{ ready_payloads?: Record<string, number> }> }>(p1, '/world/warfare/industry');
    return (body.deployment_hubs ?? []).some((hub) => (hub.ready_payloads?.corvette_web_t122 ?? 0) >= 1);
  });

  await apiCommand(p1, 'commission_fleet', {
    building_id: p1HubId,
    blueprint_id: 'corvette_web_t122',
    count: 1,
    system_id: 'sys-1',
    fleet_id: 'fleet-web-t122',
  });
  await apiCommand(p1, 'task_force_create', {
    task_force_id: 'tf-web-t122',
    name: 'Web验证群',
    stance: 'escort',
  });
  await apiCommand(p1, 'task_force_assign', {
    task_force_id: 'tf-web-t122',
    member_kind: 'fleet',
    member_ids: ['fleet-web-t122'],
    system_id: 'sys-1',
    planet_id: 'planet-1-1',
  });
  await apiCommand(p1, 'task_force_deploy', {
    task_force_id: 'tf-web-t122',
    system_id: 'sys-1',
    planet_id: 'planet-1-1',
  });
  await apiCommand(p1, 'theater_create', {
    theater_id: 'theater-web-t122',
    name: 'Web战区',
  });
  await apiCommand(p1, 'theater_define_zone', {
    theater_id: 'theater-web-t122',
    zone_type: 'primary',
    system_id: 'sys-1',
    planet_id: 'planet-1-1',
    radius: 8,
  });
  await apiCommand(p1, 'theater_set_objective', {
    theater_id: 'theater-web-t122',
    objective_type: 'secure_planet',
    system_id: 'sys-1',
    planet_id: 'planet-1-1',
    description: 'authoritative web regression',
  });

  await installSession(page);
  await page.goto('/war');

  await expect(page.getByRole('heading', { name: '战争工作台' })).toBeVisible();
  await expect(page.getByText('蓝图工作台')).toBeVisible();
  await expect(page.getByText('军工总览')).toBeVisible();
  await expect(page.getByText('战区面板')).toBeVisible();
  await expect(page.getByText('战报与情报')).toBeVisible();
  await expect(page.getByLabel('蓝图选择')).toContainText('corvette_web_t122');
  await expect(page.getByText('Planetary Logistics Station').first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^任务群$/ })).toContainText('Web验证群');

  await page.getByLabel('任务群姿态').selectOption('siege');
  await page.getByRole('button', { name: '更新姿态' }).click();
  await expect(page.getByText('accepted, will execute at next tick')).toBeVisible();

  await page.getByRole('button', { name: '发起封锁' }).click();
  await expect(page.getByText('accepted, will execute at next tick')).toBeVisible();
  await expect(page.getByText('planet-1-1 · intensity')).toBeVisible();

  await page.getByRole('button', { name: '发起登陆' }).click();
  await expect(page.getByText('暂无登陆行动。')).toBeVisible();
});
