import { expect, test, type Page } from '@playwright/test';

/**
 * 临时验收（2026-07-18 批次2 修复：web-08/12/13/14）：
 * - web-08：顶栏矿产位显示 resources.minerals（建设资金），而非背包矿石库存；
 * - web-12：建造卡片名统一中文（无 snake_case 裸 ID）；
 * - web-14：选中建筑出现库存摘要 + 自动切到"选中对象"页签展示本地存储；
 * - web-13：toast 文案本地化（单测覆盖，浏览器端抽查顶栏告警文案）。
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

test('顶栏矿产位显示 minerals 余额，建造卡片名全部本地化', async ({ page }) => {
  await installSession(page);
  await page.goto(`${WEB_ENTRY}/planet/planet-1-1`);

  // web-08：顶栏矿产 chip 是建设资金（数字），title 提示背包库存
  const mineralChip = page.locator('.top-nav__chip[title*="建设资金（矿石）"]');
  await expect(mineralChip).toBeVisible({ timeout: 30_000 });
  await expect(mineralChip).not.toContainText('暂无矿石库存');
  const balanceText = (await mineralChip.textContent()) ?? '';
  const balance = Number(balanceText.replace(/\D/g, ''));
  expect(balance).toBeGreaterThan(0);

  // web-12：建造卡片名无 snake_case 裸 ID
  await expect(page.locator('.planet-build-card').first()).toBeVisible({ timeout: 30_000 });
  const cardNames = await page.locator('.planet-build-card__name').allTextContents();
  expect(cardNames.length).toBeGreaterThan(0);
  for (const name of cardNames) {
    expect(name.trim()).not.toMatch(/^[a-z0-9_]+$/);
  }
  await expect(page.locator('.planet-build-card', { hasText: '风力涡轮机' })).toBeVisible();

  // 卡片 title 含成本；余额充足时可用
  const windCard = page.locator('.planet-build-card[data-building-id="wind_turbine"]');
  await expect(windCard).toHaveAttribute('title', /风力涡轮机 · 矿 \d+/);
  await expect(windCard).toBeEnabled();
});

test('选中建筑：迷你条显示库存摘要，自动切到选中对象页签展示本地存储', async ({ page }) => {
  await installSession(page);
  // 战争服 b-1 = battlefield_analysis_base（战地分析基站），带 60 格本地存储
  await page.goto(`${WEB_ENTRY}/planet/planet-1-1?select=building:b-1`);

  // web-14：深链选中建筑 → 迷你条 + 侧栏"选中对象"页签
  const bar = page.locator('[data-testid="planet-selection-bar"]');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar).toContainText('战地分析基站');
  // 建筑有存储模块 → 迷你条出现库存/容量摘要行
  await expect(bar).toContainText(/容量 \d+\/60/, { timeout: 15_000 });
  await expect(bar.getByRole('button', { name: '详情' })).toBeVisible();

  // 侧栏自动落在"选中对象"页签，结构化展示本地存储（非 JSON dump）
  await expect(page.getByRole('tab', { name: '选中对象' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.planet-side-section', { hasText: '库存与任务' })).toContainText('本地存储');
  await expect(page.locator('.planet-side-section', { hasText: '库存与任务' })).toContainText(/\d+\/60/);

  // 点"详情"按钮不报错（抽屉/页签保持选中对象）
  await bar.getByRole('button', { name: '详情' }).click();
  await expect(page.getByRole('tab', { name: '选中对象' })).toHaveAttribute('aria-selected', 'true');
});
