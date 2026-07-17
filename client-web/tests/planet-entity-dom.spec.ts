import { expect, test, type Page } from '@playwright/test';

async function openFixtureMode(page: Page) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await expect(page.getByRole('button', { name: 'Silicon Frontier' })).toBeVisible();
}

// 验证棋盘实体已成为 agent/DevTools 可定位的真实 DOM 节点（重构前是读不到的 canvas 位图）。
test('棋盘实体为可被 agent 定位的 DOM 节点（data-entity-*）', async ({ page }) => {
  await openFixtureMode(page);
  await page.goto('/planet/planet-1-1');
  await expect(page.getByRole('heading', { name: 'Gaia' })).toBeVisible();
  await page.waitForTimeout(300);

  // 建筑渲染为带 data-* 的 DOM 节点，可被 locator('[data-entity-id=...]') 精确定位
  const miner = page.locator('[data-entity-kind="building"][data-entity-id="miner-1"]');
  await expect(miner).toBeVisible();
  await expect(miner).toHaveAttribute('data-building-type', 'mining_machine');
  await expect(miner).toHaveAttribute('data-owner', 'self');

  // 三个建筑都应是独立可定位节点
  await expect(page.locator('[data-entity-kind="building"]')).toHaveCount(3);

  // 单位/资源也应是 DOM 节点
  await expect(page.locator('[data-entity-kind="unit"]').first()).toBeVisible();
  await expect(page.locator('[data-entity-kind="resource"]').first()).toBeVisible();

  // 点击穿透：实体节点 pointer-events:none，点击落到 canvas → 命中检测走 canvas 的 pointToTile → 选中该建筑。
  // 这里在 miner 节点的中心坐标处点击 canvas（等价于 agent 对 [data-entity-id] 取 boundingBox 后点击）。
  const minerBox = await miner.boundingBox();
  const canvasBox = await page.locator('.planet-map-canvas__surface').boundingBox();
  if (!minerBox || !canvasBox) {
    throw new Error('missing bounding box');
  }
  await page.locator('.planet-map-canvas__surface').click({
    position: {
      x: minerBox.x + minerBox.width / 2 - canvasBox.x,
      y: minerBox.y + minerBox.height / 2 - canvasBox.y,
    },
  });
  await expect(page.locator('.planet-map-canvas__status')).toContainText('miner-1');
});
