import { expect, test, type Page } from '@playwright/test';

/**
 * 中英混杂防回流扫描（对应试玩报告「字段名/内部 id 裸露」类问题）：
 * 在真实战争服上遍历主要页面与抽屉页签，扫描渲染文本（含 <option>、title、aria-label）
 * 里的 snake_case 裸字段名/裸 id。允许清单只放确有必要的少量例外。
 *
 * 与之互补的单测：src/i18n/event-payload.test.ts（payload → 中文描述的纯函数）。
 */

const WEB_ENTRY = 'http://127.0.0.1:4173';
const PLANET_ID = 'planet-1-1';

/** 允许出现的 snake_case（当前为空：界面上不应有任何裸字段名/内部 id）。 */
const ALLOWED_TOKENS = new Set<string>([]);

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, WEB_ENTRY);
}

async function snakeCaseHits(page: Page): Promise<string[]> {
  return page.evaluate((allowed: string[]) => {
    const allow = new Set(allowed);
    const texts: string[] = [];
    document.querySelectorAll('select').forEach((select) => {
      Array.from(select.options).forEach((option) => texts.push(option.textContent ?? ''));
    });
    document.querySelectorAll('button, a, span, strong, dd, dt, p, li, h1, h2, h3, summary, label').forEach((element) => {
      if (element.children.length > 0) return;
      texts.push(element.textContent ?? '');
    });
    document.querySelectorAll('[title]').forEach((element) => texts.push(element.getAttribute('title') ?? ''));
    document.querySelectorAll('[aria-label]').forEach((element) => texts.push(element.getAttribute('aria-label') ?? ''));
    const hits = new Set<string>();
    texts.forEach((text) => {
      const words = text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
      words.forEach((word) => {
        if (!allow.has(word)) hits.add(word);
      });
    });
    return [...hits];
  }, [...ALLOWED_TOKENS]);
}

test('行星页/总览/大厅渲染文本无 snake_case 裸字段名', async ({ page }) => {
  test.setTimeout(120_000);
  await installSession(page);
  await page.goto(`${WEB_ENTRY}/planet/${PLANET_ID}?view=2d`);
  await expect(page.locator('.planet-build-card').first()).toBeVisible({ timeout: 30_000 });
  expect(await snakeCaseHits(page), '行星页初始').toEqual([]);

  // 建造栏展开 + 显示未解锁（锁定卡的 aria-label 里会带解锁科技名）
  await page.getByRole('button', { name: '显示未解锁' }).click();
  expect(await snakeCaseHits(page), '建造栏（含未解锁）').toEqual([]);

  // 抽屉四个页签
  await page.getByRole('button', { name: '工作台' }).first().click();
  for (const tab of ['工作台', '选中对象', '生产', '活动流']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(await snakeCaseHits(page), `抽屉/${tab}`).toEqual([]);
  }

  await page.goto(`${WEB_ENTRY}/overview`);
  await expect(page.getByRole('heading', { name: '全局总览' })).toBeVisible({ timeout: 20_000 });
  // 情报时间线的正文（事件 payload 的中文化）要等快照到齐再扫：
  // 这里覆盖 building_state_changed 的 reason 枚举（如 power_no_provider）这类值，
  // 它们在事件拉回来之前根本不渲染，早扫会漏。
  await expect(
    page.locator('.command-feed__item').first().or(page.locator('.command-feed__empty')),
  ).toBeVisible({ timeout: 20_000 });
  expect(await snakeCaseHits(page), '总览页（含情报时间线）').toEqual([]);
  const timelineText = await page.locator('.command-timeline').innerText();
  expect(timelineText).not.toMatch(/[a-z]{2,}_[a-z]{2,}/);

  await page.goto(`${WEB_ENTRY}/lobby`);
  await expect(page.getByRole('heading', { name: '对局大厅' })).toBeVisible({ timeout: 20_000 });
  expect(await snakeCaseHits(page), '大厅页').toEqual([]);

  await page.goto(`${WEB_ENTRY}/tech`);
  await expect(page.getByRole('heading', { name: /科技/ }).first()).toBeVisible({ timeout: 20_000 });
  expect(await snakeCaseHits(page), '科技页').toEqual([]);
});
