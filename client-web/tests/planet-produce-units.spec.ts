import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

/**
 * web-09 回归（真实 Go 战争服）：
 * 行星工作台「战斗与制造」页签 → 选生产建筑 → 单位类型下拉出现可量产单位
 * （worker / soldier，production_mode = world_produce）→ 下达量产 → 回执受理。
 */

const WEB_ENTRY = 'http://127.0.0.1:4173';
const BACKEND_ENTRY = process.env.SW_BACKEND_ENTRY ?? 'http://127.0.0.1:19481';

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, WEB_ENTRY);
}

/** 战争服预置建筑 ID 随场景播种顺序变化，按类型动态解析 p1 的生产建筑 ID。 */
async function findOwnedBuildingId(request: APIRequestContext, buildingType: string): Promise<string> {
  const response = await request.get(`${BACKEND_ENTRY}/world/planets/planet-1-1/scene`, {
    headers: { Authorization: 'Bearer key_player_1' },
  });
  expect(response.ok()).toBe(true);
  const scene = await response.json();
  const match = Object.values(scene.buildings ?? {}).find(
    (building) => (building as { type?: string; owner_id?: string }).type === buildingType
      && (building as { owner_id?: string }).owner_id === 'p1',
  ) as { id?: string } | undefined;
  expect(match?.id, `p1 building of type ${buildingType} should exist`).toBeTruthy();
  return match!.id!;
}

test('行星工作台可纯 GUI 量产单位', async ({ page, request }) => {
  await installSession(page);
  await page.goto('/planet/planet-1-1?view=2d');

  // 打开命令工作台抽屉并切到「战斗与制造」
  await page.getByRole('button', { name: '工作台' }).click();
  await page.getByRole('tab', { name: '战斗与制造' }).click();

  // 选生产建筑（战争服 p1 出生基地重组装配台）
  const factoryId = await findOwnedBuildingId(request, 'recomposing_assembler');
  await page.getByLabel('生产建筑').selectOption(factoryId);

  // 单位类型下拉应列出 world_produce 单位，而不是空 select
  const unitSelect = page.getByLabel('单位类型');
  await expect(unitSelect.locator('option[value="worker"]')).toHaveCount(1);
  await expect(unitSelect.locator('option[value="soldier"]')).toHaveCount(1);

  await unitSelect.selectOption('soldier');
  await page.getByRole('button', { name: '下达量产' }).click();

  // 命令回执出现在最近结果里（受理态）
  await expect(page.getByText(/已受理/).first()).toBeVisible({ timeout: 10_000 });
});
