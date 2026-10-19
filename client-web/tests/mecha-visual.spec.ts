import { expect, test, type Page } from '@playwright/test';

/**
 * 视觉夹具回归（第 21 轮契约 §7.3 第 6 条）：机甲三态侧栏、总览机甲卡片、HUD 背包 chip。
 *
 * 故事全部是固定数据（`client-web/src/features/mecha/mecha-stories-fixture.ts`），
 * 不起服务端、不读档、不登录；截图可直接当交付物。
 *
 * 运行（**不拉起任何 webServer**）：
 *   SW_SKIP_WEBSERVER=1 npx playwright test tests/mecha-visual.spec.ts
 *   SW_SKIP_WEBSERVER=1 npx playwright test tests/mecha-visual.spec.ts --update-snapshots
 *
 * 与 `belt-visual.spec.ts` 同口径：自起 `storybook dev`（SW_STORYBOOK_PORT，默认 24617，
 * 与传送带夹具的 24606 错开，两个 spec 可并行），容差 0.1%。
 */
const STORYBOOK_PORT = Number(process.env.SW_MECHA_STORYBOOK_PORT ?? 24617);
const STORYBOOK_ENTRY = `http://127.0.0.1:${STORYBOOK_PORT}`;
const MAX_DIFF_PIXEL_RATIO = 0.001;

const STORIES = [
  { id: 'mecha-controls--mine', snapshot: 'mecha-controls-mine.png', selector: '.mecha-controls' },
  { id: 'mecha-controls--other-agent', snapshot: 'mecha-controls-other-agent.png', selector: '.mecha-controls' },
  { id: 'mecha-controls--idle', snapshot: 'mecha-controls-idle.png', selector: '.mecha-controls' },
  { id: 'mecha-fleetcard--overview-card', snapshot: 'mecha-fleet-card.png', selector: '.command-mechas' },
  { id: 'mecha-hudchip--bound', snapshot: 'mecha-hudchip-bound.png', selector: '.top-nav__status' },
  { id: 'mecha-hudchip--unbound', snapshot: 'mecha-hudchip-unbound.png', selector: '.top-nav__status' },
] as const;

test.describe.configure({ mode: 'default' });

let startedStorybook = false;
let storybookProcess: import('node:child_process').ChildProcess | null = null;

async function storybookReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${STORYBOOK_ENTRY}/iframe.html`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function stopOwnStorybook() {
  if (!startedStorybook || !storybookProcess?.pid) return;
  try {
    process.kill(-storybookProcess.pid, 'SIGTERM');
  } catch {
    // 已退出
  }
  startedStorybook = false;
}

test.beforeAll(async () => {
  test.setTimeout(150_000);
  if (await storybookReachable()) {
    return;
  }
  const { spawn } = await import('node:child_process');
  storybookProcess = spawn(
    'npx',
    ['storybook', 'dev', '-p', String(STORYBOOK_PORT), '--exact-port', '--ci', '--no-open'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  storybookProcess.unref();
  startedStorybook = true;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await storybookReachable()) return;
    if (storybookProcess.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  stopOwnStorybook();
  throw new Error(`Storybook 未在 ${STORYBOOK_ENTRY} 就绪（端口 ${STORYBOOK_PORT} 可能被占用）`);
});

test.afterAll(() => {
  stopOwnStorybook();
});

/** 等字体与布局稳定：连续两次截图字节一致再拍。 */
async function waitForStable(page: Page, selector: string) {
  await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  let previous: Buffer | null = null;
  await expect.poll(async () => {
    const shot = await page.locator(selector).screenshot({ animations: 'disabled' });
    const settled = previous !== null && shot.equals(previous);
    previous = shot;
    return settled;
  }, { timeout: 20_000, intervals: [300, 400, 500, 600] }).toBe(true);
}

for (const story of STORIES) {
  test(`截图基线 ${story.snapshot}`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.goto(
      `${STORYBOOK_ENTRY}/iframe.html?id=${story.id}&viewMode=story`,
      { waitUntil: 'domcontentloaded' },
    );
    await waitForStable(page, story.selector);

    const bounds = await page.locator(story.selector).boundingBox();
    if (!bounds) throw new Error(`${story.selector} is not visible`);
    const screenshot = await page.screenshot({
      animations: 'disabled',
      clip: {
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height),
      },
    });
    expect(screenshot).toMatchSnapshot(story.snapshot, { maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO });
  });
}
