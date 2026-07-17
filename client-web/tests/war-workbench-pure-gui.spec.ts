import { expect, test, type Page } from '@playwright/test';

/**
 * P0 验收：全程只用 client-web GUI 打完一场 T122 官方战争局。
 *
 * 与 war-workbench-authoritative.spec.ts 的区别：本 spec 禁止用 apiCommand
 * 直打 HTTP 做战争准备，蓝图改型、量产、舰队编成、任务群组建/部署、战区
 * 创建/目标、封锁/登陆全部通过 GUI 表单下达。这是 P0「人类可玩性闭环」的
 * 唯一验收问题：一个不碰 CLI/API 的玩家能不能打完一仗。
 */

const WEB_ENTRY = 'http://127.0.0.1:4173';
const BACKEND_ENTRY = 'http://127.0.0.1:19481';

const BLUEPRINT_ID = 'corvette_pure_gui';
const TASK_FORCE_ID = 'tf_pure_gui';
const THEATER_ID = 'theater_pure_gui';

const SLOT_COMPONENTS: Array<{ slot: string; component: string }> = [
  { slot: 'reactor', component: 'naval_fission_core' },
  { slot: 'drive', component: 'vector_thrusters' },
  { slot: 'armor', component: 'reactive_armor' },
  { slot: 'sensor', component: 'tactical_radar' },
  { slot: 'weapon_primary', component: 'coilgun_battery' },
  { slot: 'utility', component: 'ecm_suite' },
];

async function fetchAuthorized<T>(path: string): Promise<T> {
  const response = await fetch(`${BACKEND_ENTRY}${path}`, {
    headers: { authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBeTruthy();
  return response.json() as Promise<T>;
}

async function waitForCondition(label: string, fn: () => Promise<boolean>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, WEB_ENTRY);
}

async function readBlueprintState(blueprintId: string) {
  const body = await fetchAuthorized<{ blueprints: Array<{ id: string; state: string; validation?: { valid?: boolean } }> }>(
    '/world/warfare/blueprints',
  );
  return body.blueprints.find((item) => item.id === blueprintId);
}

async function blueprintIsValid(blueprintId: string) {
  const blueprint = await readBlueprintState(blueprintId);
  return blueprint?.validation?.valid === true;
}

async function readIndustryReadyPayload(blueprintId: string) {
  const body = await fetchAuthorized<{ deployment_hubs?: Array<{ ready_payloads?: Record<string, number> }> }>(
    '/world/warfare/industry',
  );
  return (body.deployment_hubs ?? []).some((hub) => (hub.ready_payloads?.[blueprintId] ?? 0) >= 1);
}

async function readAnyFleetExists() {
  const body = await fetchAuthorized<Array<{ fleet_id: string }>>('/world/fleets');
  return body.length > 0;
}

async function readTaskForceExists(taskForceId: string) {
  const body = await fetchAuthorized<{ task_forces?: Array<{ id: string }> }>('/world/warfare/task-forces');
  return (body.task_forces ?? []).some((item) => item.id === taskForceId);
}

async function readTheaterExists(theaterId: string) {
  const body = await fetchAuthorized<{ theaters?: Array<{ id: string }> }>('/world/warfare/theaters');
  return (body.theaters ?? []).some((item) => item.id === theaterId);
}

test('纯 GUI 打完官方战争局：蓝图→量产→舰队→任务群→战区→封锁', async ({ page }) => {
  test.setTimeout(420_000);
  await installSession(page);
  await page.goto('/war');

  await expect(page.getByRole('heading', { name: '战争工作台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '战场态势', exact: true })).toBeVisible();

  // 期6a 全屏化：面板收进右侧抽屉，先点开边缘把手（默认落在蓝图组）
  await page.getByRole('button', { name: '工作台' }).click();

  // 1. 蓝图工作台：从零创建一个护航舰蓝图（GUI 全程）
  await page.getByLabel('蓝图 ID').fill(BLUEPRINT_ID);
  await page.getByLabel('作战域').selectOption('space');
  await page.getByLabel('底盘').selectOption('corvette_hull');
  await page.getByRole('button', { name: '创建蓝图' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });

  // 等蓝图进入 blueprints 列表后选中它
  await waitForCondition('blueprint created', async () => Boolean(await readBlueprintState(BLUEPRINT_ID)));
  await page.getByLabel('蓝图选择').selectOption(BLUEPRINT_ID);
  await page.waitForTimeout(500);

  // 2. 逐槽位填组件（GUI 槽位编辑器）
  for (const { slot, component } of SLOT_COMPONENTS) {
    const row = page.locator('.war-slot-row').filter({ hasText: slot });
    await row.getByLabel(`槽位 ${slot}`).selectOption(component);
    await row.getByRole('button', { name: '保存槽位' }).click();
    await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
  }

  // 3. 校验 + 定型（等校验真正执行完、蓝图进入 validated 再定型，避免 state 依赖竞态）
  await page.getByRole('button', { name: '校验蓝图' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
  await waitForCondition('blueprint validated', () => blueprintIsValid(BLUEPRINT_ID));
  await page.getByRole('button', { name: '定型蓝图' }).click();
  await waitForCondition('blueprint prototype', async () => {
    const blueprint = await readBlueprintState(BLUEPRINT_ID);
    return blueprint?.state === 'prototype' || blueprint?.state === 'adopted';
  });

  // 4. 军工总览：量产排队（GUI 表单）
  await page.getByRole('tab', { name: '军工' }).click();
  await page.getByLabel('量产蓝图').selectOption(BLUEPRINT_ID);
  await page.getByLabel('量产工厂').selectOption({ index: 0 });
  await page.getByLabel('量产部署枢纽').selectOption({ index: 0 });
  await page.getByRole('button', { name: '下达量产' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });

  // 5. 等 ready_payload，然后 commission_fleet（GUI 部署按钮，scope 到「部署尝试」卡避免与量产表单冲突）
  await waitForCondition('ready payload', () => readIndustryReadyPayload(BLUEPRINT_ID), 150_000);
  const deployCard = page.locator('.war-card').filter({ hasText: '部署尝试' });
  await deployCard.getByLabel('部署蓝图').selectOption(BLUEPRINT_ID);
  await deployCard.getByLabel('部署枢纽').selectOption({ index: 0 });
  await deployCard.getByRole('button', { name: '尝试部署' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
  await waitForCondition('fleet commissioned', () => readAnyFleetExists(), 60_000);

  // 6. 战区面板：组建任务群 → 编入舰队 → 部署到位（GUI 表单）
  await page.getByRole('tab', { name: '战区' }).click();
  await page.getByLabel('任务群 ID').fill(TASK_FORCE_ID);
  await page.getByRole('button', { name: '组建任务群' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
  await waitForCondition('task force created', () => readTaskForceExists(TASK_FORCE_ID));

  // 编入第一支舰队
  const fleetCheckbox = page.locator('.war-card').filter({ hasText: '编组成员' }).getByRole('checkbox').first();
  await fleetCheckbox.check();
  await page.getByRole('button', { name: '编入任务群' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: '部署到位' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });

  // 7. 战区创建 → 定义区域 → 设定目标（GUI 表单）
  await page.getByLabel('战区 ID').fill(THEATER_ID);
  await page.getByRole('button', { name: '创建战区' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
  await waitForCondition('theater created', () => readTheaterExists(THEATER_ID));

  await page.getByRole('button', { name: '定义区域' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '设定目标' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });

  // 8. 发起封锁（GUI；tf_pure_gui 是唯一任务群，默认已选中，直接封锁）
  const controlCard = page.locator('.war-card').filter({ hasText: '任务群控制' });
  await controlCard.getByRole('button', { name: '发起封锁' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });

  // 验收：全程 0 处 apiCommand 直打 HTTP 做战争准备（本 spec 仅用 fetch 做 readOnly 轮询确认状态，不下命令）
});
