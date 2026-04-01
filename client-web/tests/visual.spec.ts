import { expect, test, type Page } from '@playwright/test';

async function openFixtureMode(page: Page) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await expect(page.getByRole('heading', { name: '全局总览' })).toBeVisible();
}

test('总览页截图基线', async ({ page }) => {
  await openFixtureMode(page);
  await expect(page.locator('.page-shell')).toHaveScreenshot('overview-dashboard.png', {
    animations: 'disabled',
  });
});

test('行星地图主视图截图基线', async ({ page }) => {
  await openFixtureMode(page);
  await page.goto('/planet/planet-1-1');
  await expect(page.getByRole('heading', { name: 'Gaia' })).toBeVisible();
  const expandDebugButton = page.getByRole('button', { name: '展开调试' });
  if (!(await expandDebugButton.isVisible())) {
    await page.getByRole('button', { name: '收起调试' }).click();
    await expect(expandDebugButton).toBeVisible();
  }
  await page.waitForTimeout(500);

  const mapShell = page.locator('.planet-map-shell');
  const bounds = await mapShell.boundingBox();
  if (!bounds) {
    throw new Error('planet map shell is not visible');
  }

  const screenshot = await page.screenshot({
    animations: 'disabled',
    clip: {
      x: Math.floor(bounds.x),
      y: Math.floor(bounds.y),
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
    },
  });
  expect(screenshot).toMatchSnapshot('planet-map-shell.png');
});

test('回放 digest 截图基线', async ({ page }) => {
  await openFixtureMode(page);
  await page.getByRole('navigation').getByRole('link', { name: '回放' }).click();
  await expect(page.getByRole('heading', { name: 'Replay 调试台' })).toBeVisible();
  await expect(page.getByLabel('to_tick')).toHaveValue('128');
  await page.getByRole('button', { name: '执行 replay' }).click();
  await expect(page.getByText('Replay Digest', { exact: true })).toBeVisible();

  await expect(page.locator('.page-shell')).toHaveScreenshot('replay-digest.png', {
    animations: 'disabled',
  });
});
