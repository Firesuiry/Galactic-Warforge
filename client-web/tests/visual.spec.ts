import { expect, test, type Page } from '@playwright/test';

/**
 * 进入离线样例（fixture）会话。
 * 登录后落在 fixture 行星页（不再有旧版的「Silicon Frontier」服务端切换按钮，属有意改动）；
 * 顶栏 tick chip 显示 fixture 基线 tick=128，用它确认已进入样例会话。
 */
async function openFixtureMode(page: Page) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await expect(page.getByTitle('游戏 tick')).toContainText('tick 128', { timeout: 20_000 });
  // 等字体就位再截图：HUD 文本（display 字体）在字体切换前后有亚像素差，
  // 满载跑全量用例时字体可能还没加载完，会让基线截图偶发 0.01% 像素漂移。
  await page.evaluate(() => document.fonts?.ready);
}

test('总览页截图基线', async ({ page }) => {
  await openFixtureMode(page);
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: '全局总览' })).toBeVisible();
  await expect(page.locator('.page-shell')).toHaveScreenshot('overview-dashboard.png', {
    animations: 'disabled',
  });
});

test('银河星图截图基线', async ({ page }) => {
  await openFixtureMode(page);
  // freeze 模式冻结相机/脉冲/公转动画，保证截图确定性
  await page.goto('/galaxy?freeze=1');
  await expect(page.locator('.starmap-stage canvas')).toBeVisible();
  await page.waitForTimeout(800);
  const screenshot = await page.screenshot({ animations: 'disabled' });
  // 容差 0.1%：GPU 光栅化在满载跑全量用例时会让星点/文字边缘出现 1 单位亚像素抖动，
  // 真实 UI 回归（节点/文字位移）是数万像素级别，这点容差不会掩盖回归。
  expect(screenshot).toMatchSnapshot('starmap-galaxy.png', { maxDiffPixelRatio: 0.001 });
});

test('行星地图主视图截图基线', async ({ page }) => {
  await openFixtureMode(page);
  // freeze 模式冻结氛围动效（水面流光/岩浆呼吸）与脉冲，保证截图确定性
  await page.goto('/planet/planet-1-1?view=2d&freeze=1');
  await expect(page.getByRole('heading', { name: 'Gaia' })).toBeVisible();
  const expandDebugButton = page.getByRole('button', { name: '展开调试' });
  if (!(await expandDebugButton.isVisible())) {
    await page.getByRole('button', { name: '收起调试' }).click();
    await expect(expandDebugButton).toBeVisible();
  }
  // 等地形分块烘焙完成：连续两次截图像素一致再拍基线，避免高负载下拍到半渲染帧
  let previousShot: Buffer | null = null;
  await expect.poll(async () => {
    const shot = await page.locator('.planet-map-shell').screenshot({ animations: 'disabled' });
    const settled = previousShot !== null && shot.equals(previousShot);
    previousShot = shot;
    return settled;
  }, { timeout: 20_000, intervals: [600, 800, 1000, 1200, 1500] }).toBe(true);

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
  // 容差 0.1%（约 1200 px）：GPU 光栅化在满载跑全量用例时会让中文字形边缘出现 1 单位
  // 亚像素抖动（实测 10–320 px，最大色差 8），而真实 UI 回归（建造栏/抽屉位移）是数万像素级别，
  // 因此这点容差不会掩盖回归。
  expect(screenshot).toMatchSnapshot('planet-map-shell.png', { maxDiffPixelRatio: 0.001 });
});

test('移动端行星页保留地图首屏并提供工作台切换', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixtureMode(page);
  await page.goto('/planet/planet-1-1?view=2d');
  await expect(page.getByRole('img', { name: '行星地图' })).toBeVisible();
  // V3 全屏布局：工作台默认收起为右侧边缘把手，点击滑出抽屉
  await page.getByRole('button', { name: '工作台' }).click();
  await expect(page.getByRole('tab', { name: '工作台' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '选中对象' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '活动流' })).toBeVisible();
  await page.getByRole('tab', { name: '活动流' }).click();
  await expect(page.getByText('事件时间线')).toBeVisible();
});

test('深链 /system/:id 进入对应恒星系星图', async ({ page }) => {
  await openFixtureMode(page);
  await page.goto('/system/sys-1?view=2d');
  // 面包屑显示当前恒星系，Pixi 画布可见
  await expect(page.locator('.starmap-breadcrumb__current')).toHaveText('Aster');
  await expect(page.locator('.starmap-stage canvas')).toBeVisible();
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
