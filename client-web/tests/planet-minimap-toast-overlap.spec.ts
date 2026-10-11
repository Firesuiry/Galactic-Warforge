import { expect, test, type Page } from '@playwright/test';

/**
 * 试玩 1014 层 14 问题 1（bug-1014-toast-blocks-minimap）：
 * 右下角 toast 栈压在小地图上，把右键 contextmenu 吃掉，移动令被静默吞掉
 * （层 13「小地图右键无命令反馈」的真正原因）。
 *
 * 几何契约（不依赖截图）：
 * - 小地图在场时（.planet-minimap 渲染，宽屏 ≥1101px），toast 栈的盒子不得与小地图相交；
 * - 小地图 canvas 的中心点 elementFromPoint 必须命中 canvas 自身，而不是 .toast；
 * - 在 canvas 上派发 contextmenu，事件必须真的到达 canvas（派发点与命中点同源）。
 *
 * 真实 Go 战争服由 playwright.config.ts 的 webServer 拉起。
 */

const PLANET_ID = 'planet-1-1';

async function installSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({
        state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' },
        version: 0,
      }),
    );
  });
}

/** 注入一叠与真实 toast 同层级同尺寸的卡片，压住右下角（复现「黑雾报复时 toast 成堆」）。 */
async function stackToasts(page: Page, count: number) {
  await page.evaluate((toastCount) => {
    document.getElementById('toast-stub')?.remove();
    const stack = document.createElement('div');
    stack.id = 'toast-stub';
    stack.className = 'toast-stack';
    for (let index = 0; index < toastCount; index += 1) {
      const toast = document.createElement('div');
      toast.className = 'toast toast--danger';
      toast.textContent = `黑雾正在报复你 ${index + 1}`;
      stack.appendChild(toast);
    }
    document.body.appendChild(stack);
  }, count);
}

test('行星页宽屏：右下角 toast 栈不得盖住小地图、不得吞掉小地图右键', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.planet-minimap__canvas')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  // 清掉真实 toast（进页面时的告警），换成可控的一叠。
  const realClose = page.locator('.toast__close');
  for (let remaining = await realClose.count(); remaining > 0; remaining -= 1) {
    await realClose.first().click();
  }
  await stackToasts(page, 3);
  await page.waitForTimeout(200);

  const report = await page.evaluate(() => {
    const minimap = document.querySelector('.planet-minimap') as HTMLElement;
    const canvas = document.querySelector('.planet-minimap__canvas') as HTMLCanvasElement;
    const stack = document.getElementById('toast-stub') as HTMLElement;
    const minimapRect = minimap.getBoundingClientRect();
    const stackRect = stack.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const cx = canvasRect.x + canvasRect.width / 2;
    const cy = canvasRect.y + canvasRect.height / 2;
    const top = document.elementFromPoint(cx, cy) as HTMLElement | null;
    return {
      minimapRect: { x: minimapRect.x, y: minimapRect.y, w: minimapRect.width, h: minimapRect.height },
      stackRect: { x: stackRect.x, y: stackRect.y, w: stackRect.width, h: stackRect.height },
      canvasCenter: { x: cx, y: cy },
      overlaps:
        minimapRect.right > stackRect.x
        && minimapRect.x < stackRect.right
        && minimapRect.bottom > stackRect.y
        && minimapRect.top < stackRect.bottom,
      hit: top ? `${top.tagName}.${typeof top.className === 'string' ? top.className : ''}` : 'none',
      hitIsCanvas: top === canvas,
      // 抬升量必须来自小地图实测高度（PlanetMinimap 的 ResizeObserver 写进 :root），
      // 而不是写死的常量——写死会在字号/label 换行时差几像素重新压住画布。
      reportedHeight: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--planet-minimap-height'),
      ),
    };
  });

  // 前提：注入的 toast 栈必须真的铺在右下角（否则这条断言没有意义）。
  expect(report.stackRect.h, '注入的 toast 栈必须有高度').toBeGreaterThan(0);

  expect(
    report.reportedHeight,
    '--planet-minimap-height 必须由小地图实测写入（PlanetMinimap 的 ResizeObserver）',
  ).toBeGreaterThan(0);

  expect(
    report.reportedHeight,
    `--planet-minimap-height=${report.reportedHeight} 与实际小地图高度 ${report.minimapRect.h} 不符：toast 栈抬升量算错`,
  ).toBeCloseTo(report.minimapRect.h, 0);

  expect(
    report.overlaps,
    `toast 栈与小地图相交（toast ${JSON.stringify(report.stackRect)} vs 小地图 ${JSON.stringify(report.minimapRect)}）：右键会被 toast 卡片吃掉`,
  ).toBe(false);

  expect(
  report.hitIsCanvas,
    `小地图画布中心 ${JSON.stringify(report.canvasCenter)} 命中的是 ${report.hit}，不是 canvas：右键移动令会被静默吞掉`,
  ).toBe(true);

  // 端到端：在画布中心派发 contextmenu，事件必须到达 canvas（preventDefault 由组件负责）。
  const reached = await page.evaluate(() => {
    const canvas = document.querySelector('.planet-minimap__canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return new Promise<boolean>((resolve) => {
      let seen = false;
      canvas.addEventListener('contextmenu', () => { seen = true; }, { once: true });
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      top?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }));
      window.setTimeout(() => resolve(seen), 50);
    });
  });
  expect(reached, '在命中点上派发的 contextmenu 没有到达小地图 canvas').toBe(true);

  await page.evaluate(() => document.getElementById('toast-stub')?.remove());
});
