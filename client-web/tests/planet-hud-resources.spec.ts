import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

import { backendEntry, webEntry } from './support/scenario';
import { requireScenario } from './support/scenario-gate';

requireScenario('war', '需要官方战争场景（预置 battlefield_analysis_base），默认遭遇战场景跳过。');

/**
 * 临时验收（2026-07-18 批次2 修复：web-08/12/13/14）：
 * - web-08（第 16 轮契约改写）：顶栏资金位已删，只剩「电网结余」（只读），背包库存走 title；
 * - web-12：建造卡片名统一中文（无 snake_case 裸 ID）；
 * - web-14：选中建筑出现库存摘要 + 自动切到"选中对象"页签展示本地存储；
 * - web-13：toast 文案本地化（单测覆盖，浏览器端抽查顶栏告警文案）。
 */

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, webEntry());
}

/** 战争服预置建筑 ID 随场景播种顺序变化，按类型动态解析 p1 的建筑 ID。 */
async function findOwnedBuildingId(request: APIRequestContext, buildingType: string): Promise<string> {
  const response = await request.get(`${backendEntry()}/world/planets/planet-1-1/scene`, {
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

test('顶栏只展示电网结余（无资金位），建造卡片名全部本地化', async ({ page }) => {
  await installSession(page);
  await page.goto(`${webEntry()}/planet/planet-1-1`);

  // web-08（第 16 轮契约）：资金位已删，顶栏那一格是「电网结余」只读展示，背包库存收进 title。
  // 断言的是 title 属性本身（chip 的可见文本是电网结余数字，toContainText 只看文本节点）。
  const powerChip = page.locator('.top-nav__chip[title*="电网结余"]');
  await expect(powerChip).toBeVisible({ timeout: 30_000 });
  await expect(powerChip).toHaveAttribute('title', /电网结余（只读展示）· 背包库存：/);

  // web-12：建造卡片名无 snake_case 裸 ID（§3.2 复核后格子里不再写名称，
  // 可读名在 aria-label 的第一段：`${name} · 铁块 2/6 · …`）
  await expect(page.locator('.planet-build-card').first()).toBeVisible({ timeout: 30_000 });
  const cardNames = (await page.locator('.planet-build-card').evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute('aria-label')?.split(' · ')[0] ?? '')))
    .filter(Boolean);
  expect(cardNames.length).toBeGreaterThan(0);
  for (const name of cardNames) {
    expect(name.trim()).not.toMatch(/^[a-z0-9_]+$/);
  }
  // 格子里只剩图标，中文名在 aria-label 里（不再用 hasText 找卡片）
  await expect(page.locator('.planet-build-card[data-building-id="wind_turbine"]')).toHaveAttribute('aria-label', /^风力涡轮机/);

  // 卡片成本文案在 aria-label（title 已移除，改用悬浮详情）：只有物品造价，没有资金项。
  // aria-label 形状：`<名称> · <物品造价> · 物品（背包有/需要）：<逐项 有/需要>`。
  const windCard = page.locator('.planet-build-card[data-building-id="wind_turbine"]');
  const windLabel = (await windCard.getAttribute('aria-label')) ?? '';
  expect(windLabel).toMatch(/^风力涡轮机 · /);
  expect(windLabel).toContain('物品（背包有/需要）：');
  expect(windLabel).not.toMatch(/矿不足|建设资金|矿 \d/);
  await expect(windCard).toBeEnabled();
});

test('选中建筑：迷你条显示库存摘要，自动切到选中对象页签展示本地存储', async ({ page, request }) => {
  await installSession(page);
  // 战争服 p1 的 battlefield_analysis_base（战场分析基站），带 60 格本地存储
  const baseId = await findOwnedBuildingId(request, 'battlefield_analysis_base');
  await page.goto(`${webEntry()}/planet/planet-1-1?select=building:${baseId}`);

  // web-14：深链选中建筑 → 迷你条 + 侧栏"选中对象"页签
  const bar = page.locator('[data-testid="planet-selection-bar"]');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar).toContainText('战场分析基站');
  // 建筑有存储模块 → 迷你条出现库存/容量摘要行
  await expect(bar).toContainText(/容量 \d+\/60/, { timeout: 15_000 });
  await expect(bar.getByRole('button', { name: '详情' })).toBeVisible();

  // 侧栏（工作台抽屉）自动落在"选中对象"页签，结构化展示本地存储（非 JSON dump）。
  // §3.2：抽屉不再常驻——深链只切页签，抽屉仍由玩家点「工作台」把手拉开。
  await page.getByRole('button', { name: '工作台' }).first().click();
  await expect(page.getByRole('tab', { name: '选中对象' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.planet-side-section', { hasText: '库存与任务' })).toContainText('本地存储');
  await expect(page.locator('.planet-side-section', { hasText: '库存与任务' })).toContainText(/\d+\/60/);

  // 点"详情"按钮不报错（抽屉/页签保持选中对象）
  await bar.getByRole('button', { name: '详情' }).click();
  await expect(page.getByRole('tab', { name: '选中对象' })).toHaveAttribute('aria-selected', 'true');
});
