import { expect, test, type Page } from '@playwright/test';

/**
 * 工作台抽屉不得遮挡底部选择条（窄屏与宽屏都要成立）：
 * - 宽屏（>900px）：选择条右移让位（CSS `:has(.planet-drawer--open)`），与抽屉体不重叠；
 * - 窄屏（400px）：抽屉是覆盖式，抽屉体底部为选择条留出高度（--planet-bottom-reserve），
 *   选择条按钮仍可点击。
 * 用 fixture（离线样例）模式，不依赖战争服当前局势。
 */

async function openFixturePlanet(page: Page) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await page.waitForURL(/\/planet\//, { timeout: 15_000 });
  await page.goto('/planet/planet-1-1?view=2d');
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible({ timeout: 15_000 });
}

/** 关掉进入页面时弹出的告警 toast：它浮在选择条之上，会挡住按钮命中。 */
async function dismissToasts(page: Page) {
  const close = page.locator('.toast__close');
  for (let remaining = await close.count(); remaining > 0; remaining -= 1) {
    await close.first().click();
  }
  await expect(page.locator('.toast')).toHaveCount(0);
}

/** 点地图上的一个实体 → 底部选择条出现（挑中心点没被 HUD 按钮盖住的实体）。 */
async function selectFirstBuilding(page: Page) {
  const surface = page.locator('.planet-map-canvas__surface');
  const entities = page.locator('[data-entity-kind="building"]');
  const count = await entities.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const entityBox = await entities.nth(index).boundingBox();
    if (!entityBox) continue;
    const centerX = entityBox.x + entityBox.width / 2;
    const centerY = entityBox.y + entityBox.height / 2;
    const top = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.tagName ?? '',
      [centerX, centerY],
    );
    if (top !== 'CANVAS') continue;

    const surfaceBox = (await surface.boundingBox())!;
    await surface.click({ position: { x: centerX - surfaceBox.x, y: centerY - surfaceBox.y } });
    await expect(page.getByTestId('planet-selection-bar')).toBeVisible({ timeout: 10_000 });
    return;
  }
  throw new Error('所有实体中心点都被 HUD 覆盖，无法用画布点选');
}

async function barAndDrawerGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
    };
    return {
      bar: rect('[data-testid="planet-selection-bar"]'),
      drawer: rect('.planet-drawer__body'),
    };
  });
}

for (const viewport of [
  { width: 400, height: 844, label: '窄屏 400px' },
  { width: 1280, height: 900, label: '宽屏 1280px' },
]) {
  test(`工作台抽屉打开后不遮挡底部选择条（${viewport.label}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFixturePlanet(page);
    await dismissToasts(page);
    await selectFirstBuilding(page);

    await page.getByRole('button', { name: '工作台' }).first().click();
    await expect(page.getByRole('tab', { name: '工作台' })).toBeVisible();

    const { bar, drawer } = await barAndDrawerGeometry(page);
    expect(bar).not.toBeNull();
    expect(drawer).not.toBeNull();
    const barRect = bar!;
    const drawerRect = drawer!;
    const overlaps = !(
      barRect.x + barRect.width <= drawerRect.x
      || barRect.x >= drawerRect.x + drawerRect.width
      || barRect.y + barRect.height <= drawerRect.y
      || barRect.y >= drawerRect.y + drawerRect.height
    );
    expect(overlaps, `选择条 ${JSON.stringify(barRect)} 与抽屉 ${JSON.stringify(drawerRect)} 不应重叠`).toBe(false);

    if (viewport.width <= 900) {
      // 窄屏抽屉覆盖式：抽屉体底边必须让在选择条上方
      expect(drawerRect.bottom).toBeLessThanOrEqual(barRect.y);
    }

    // 选择条按钮仍可点击（详情页签随之打开）
    await page.getByTestId('planet-selection-bar').getByRole('button', { name: '详情', exact: true }).click();
    await expect(page.locator('#planet-detail-panel-selection')).toBeVisible();
  });

}
