import { expect, test, type Page } from '@playwright/test';

const WEB_ENTRY = 'http://127.0.0.1:4173';

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

test('开局无自有蓝图时可从公开预置蓝图派生变体', async ({ page }) => {
  await installSession(page);
  await page.goto('/war');

  await expect(page.getByRole('heading', { name: '战争工作台' })).toBeVisible();
  await page.getByRole('button', { name: '工作台' }).click();

  // 蓝图改型表单始终可见，父蓝图下拉包含公开预置蓝图分组
  await expect(page.getByRole('heading', { name: '蓝图改型' })).toBeVisible();
  const parentSelect = page.getByLabel('父蓝图');
  await expect(parentSelect.locator('optgroup[label="公开预置蓝图"]')).toHaveCount(1);
  await expect(parentSelect.locator('option[value="corvette"]')).toHaveCount(1);

  // 选公开预置父本 + 填变体 ID，纯 GUI 派生变体
  await parentSelect.selectOption('corvette');
  await page.getByLabel('变体 ID').fill(`corvette_pw_${Date.now().toString(36)}`);
  await page.getByRole('button', { name: '派生变体' }).click();
  await expect(page.getByText('accepted, will execute at next tick').first()).toBeVisible({ timeout: 10_000 });
});
