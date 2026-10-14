/**
 * 狂飙模式调试面板截图（真实显卡 + 真实服务端 20600）。
 *
 * 用法（先起服务端与 vite dev，端口避开 8080/18080/19900/4400/4199/205xx）：
 *   cd client-web && SW_WEB_PORT=2073 SW_SKIP_WEBSERVER=1 \
 *     SW_FF_SHOT_DIR=/abs/path npx playwright test --config playwright.manual.config.ts
 */
import { expect, test } from '@playwright/test';

const shotDir = process.env.SW_FF_SHOT_DIR ?? 'test-results';
const webEntry = process.env.SW_WEB_ENTRY ?? 'http://127.0.0.1:2073';

test('调试面板显示狂飙模式控件（Ctrl+Shift+D 打开）', async ({ page }) => {
  await page.goto(`${webEntry}/planet/planet-1-1?view=2d&as=p1&key=key_player_1`);
  await expect(page.getByText('调试面板')).toHaveCount(0);

  const opened = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', ctrlKey: true, shiftKey: true, bubbles: true }));
    return true;
  });
  expect(opened).toBe(true);
  await page.waitForTimeout(500);
  await expect(page.getByText('调试面板')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('快进 tick 数')).toHaveValue('500');
  await expect(page.getByRole('button', { name: '开始快进' })).toBeVisible();
  await expect(page.getByText('受袭即停')).toBeVisible();
  await expect(page.getByText('关键警报即停')).toBeVisible();
  await expect(page.getByText('对局结束即停')).toBeVisible();

  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${shotDir}/debug-panel-2d.png` });

  // 真的跑一次快进（推进到当前 tick + 3），确认结果行出现
  const currentTickText = await page
    .locator('.debug-panel__body dl > div', { hasText: '当前 tick' })
    .locator('dd')
    .first()
    .innerText();
  const currentTick = Number(currentTickText.trim());
  expect(Number.isFinite(currentTick)).toBe(true);

  await page.getByRole('radio').nth(1).check();
  await page.getByLabel('快进目标 tick').fill(String(currentTick + 3000));
  await page.getByRole('button', { name: '开始快进' }).click();
  await expect(page.getByText(/停在 tick \d+（/).first()).toBeVisible({ timeout: 120_000 });
  // 面板内容比 max-height 高，点按钮后浏览器会把面板滚到底：截图前滚回顶部，
  // 让「调试面板 + 快捷键提示 + 快进控件」同框。
  await page.locator('.debug-panel__body').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotDir}/debug-panel-2d-result.png` });
});
