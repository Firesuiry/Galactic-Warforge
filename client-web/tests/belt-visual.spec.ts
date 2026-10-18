import { expect, test, type Page } from '@playwright/test';

/**
 * 视觉夹具回归（第 19 轮）：用 Storybook 的静态故事渲染 3D 行星地图，
 * 不起服务端、不读档、不需要登录。
 *
 * 故事：`Planet/BeltDspFixture`（client-web/src/features/planet-map/PlanetMapThree.stories.tsx）
 * 夹具：`client-web/src/stories/fixtures/belt-dsp-scene.json`（scripts/export-scene-fixture.mjs 导出）
 *
 * 运行方式（**不拉起任何 webServer**）：
 *   SW_SKIP_WEBSERVER=1 npx playwright test tests/belt-visual.spec.ts
 *   SW_SKIP_WEBSERVER=1 npx playwright test tests/belt-visual.spec.ts --update-snapshots
 *
 * `SW_SKIP_WEBSERVER=1` 时 playwright.config.ts 不注册 webServer；本 spec 自己起
 * `storybook dev`（`SW_STORYBOOK_PORT`，默认 24606；已有实例则复用，退出时只杀自己起的那个）。
 * 加 `--update-snapshots` 即重生成基线。
 */
const STORYBOOK_PORT = Number(process.env.SW_STORYBOOK_PORT ?? 24606);
const STORYBOOK_ENTRY = `http://127.0.0.1:${STORYBOOK_PORT}`;
/** 故事 id（Storybook 由 title + export 名推导：Planet/BeltDspFixture → planet-beltdspfixture）。 */
const STORY_ID = 'planet-beltdspfixture';
/** 与 Playwright 其它视觉基线同口径：GPU 亚像素抖动容忍 0.1%。 */
const MAX_DIFF_PIXEL_RATIO = 0.001;

const STORIES = [
  // 俯视全景：整条立体交叉
  { name: 'belt-dsp-top', snapshot: 'belt-dsp-top.png' },
  // 立交斜视：高架跨地面带
  { name: 'belt-dsp-oblique', snapshot: 'belt-dsp-oblique.png' },
  // 跨格分拣器特写
  { name: 'belt-dsp-sorter', snapshot: 'belt-dsp-sorter.png' },
  // 真死端带特写：(45,156..158) 带尾堆货、前方空、无分拣器
  { name: 'belt-dsp-dead-end', snapshot: 'belt-dsp-dead-end.png' },
] as const;

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
    // --exact-port：端口被别的服务占着时直接失败，不悄悄退到下一个端口（否则探测永远等不到）。
    ['storybook', 'dev', '-p', String(STORYBOOK_PORT), '--exact-port', '--ci', '--no-open'],
    { cwd: process.cwd(), stdio: 'ignore', detached: true },
  );
  let spawnError: Error | null = null;
  storybookProcess.on('error', (error) => { spawnError = error; });
  storybookProcess.unref();
  startedStorybook = true;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await storybookReachable()) return;
    if (spawnError || storybookProcess.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  stopOwnStorybook();
  throw new Error(spawnError
    ? `起 Storybook 失败：${(spawnError as Error).message}`
    : `Storybook 未在 ${STORYBOOK_ENTRY} 就绪（端口 ${STORYBOOK_PORT} 可能被非 Storybook 服务占用；可设 SW_STORYBOOK_PORT 换端口，或先手工跑 npm run storybook 看日志）`);
});

test.afterAll(() => {
  stopOwnStorybook();
});

/**
 * 等 3D 画布稳定：连续两次截图字节一致（地形烘焙 / 相机补间 / 模型构建都在首帧后若干帧完成）。
 * `?freeze=1` 由故事壳写入，动画相位固定，所以稳定帧可复现。
 */
async function waitForStableCanvas(page: Page) {
  // 故事壳在首次布局 effect 里写 `?freeze=1`（场景构造时读一次），所以场景必须已冻结；
  // 冻结后画面是时间的纯函数，连续两帧应逐字节一致。先确认冻结标志，避免把
  // 「动画恰好两帧相同」误当稳定帧。
  // 冻结标志：故事壳在场景构造前把 ?freeze=1 写进 URL（场景在构造函数里读一次）。
  // R20-A 起 `__planetThree` 是绑定方法的包装对象，不再暴露场景私有字段 `frozen`，
  // 这里改断言 URL（写 URL 早于场景构造，等价保证）。
  await expect.poll(async () => page.evaluate(() => (
    new URLSearchParams(window.location.search).has('freeze')
  )), { timeout: 60_000 }).toBe(true);
  let previous: Buffer | null = null;
  await expect.poll(async () => {
    const shot = await page.locator('.belt-fixture-stage').screenshot({ animations: 'disabled' });
    const settled = previous !== null && shot.equals(previous);
    previous = shot;
    return settled;
  }, { timeout: 90_000, intervals: [400, 600, 800, 1000, 1200] }).toBe(true);
}

for (const story of STORIES) {
  test(`截图基线 ${story.snapshot}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(
      `${STORYBOOK_ENTRY}/iframe.html?id=${STORY_ID}--${story.name}&viewMode=story`,
      { waitUntil: 'domcontentloaded' },
    );

    // 场景就绪：画布挂载 + 测试句柄可用（故事壳用它设置固定机位）。
    await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => page.evaluate(() => Boolean(
      (window as unknown as { __planetThree?: unknown }).__planetThree,
    )), { timeout: 60_000 }).toBe(true);
    // 故事壳的机位 effect 在句柄出现后立刻执行；留出相机补间与首帧渲染时间。
    await page.waitForTimeout(800);
    await waitForStableCanvas(page);

    const bounds = await page.locator('.belt-fixture-stage').boundingBox();
    if (!bounds) throw new Error('planet-three shell is not visible');
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
