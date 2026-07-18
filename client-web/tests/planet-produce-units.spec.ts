import { expect, test, type Page } from '@playwright/test';

/**
 * web-09 回归（真实 Go 战争服）：
 * 行星工作台「战斗与制造」页签 → 选生产建筑 → 单位类型下拉出现可量产单位
 * （worker / soldier，production_mode = world_produce）→ 下达量产 → 回执受理。
 */

const WEB_ENTRY = 'http://127.0.0.1:4173';

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, WEB_ENTRY);
}

test('行星工作台可纯 GUI 量产单位', async ({ page }) => {
  await installSession(page);
  await page.goto('/planet/planet-1-1');

  // 打开命令工作台抽屉并切到「战斗与制造」
  await page.getByRole('button', { name: '工作台' }).click();
  await page.getByRole('tab', { name: '战斗与制造' }).click();

  // 选生产建筑（战争服 p1 出生基地 b-1）
  await page.getByLabel('生产建筑').selectOption('b-1');

  // 单位类型下拉应列出 world_produce 单位，而不是空 select
  const unitSelect = page.getByLabel('单位类型');
  await expect(unitSelect.locator('option[value="worker"]')).toHaveCount(1);
  await expect(unitSelect.locator('option[value="soldier"]')).toHaveCount(1);

  await unitSelect.selectOption('soldier');
  await page.getByRole('button', { name: '下达量产' }).click();

  // 命令回执出现在最近结果里（受理态）
  await expect(page.getByText(/已受理/).first()).toBeVisible({ timeout: 10_000 });
});
