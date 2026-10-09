import { expect, test, type Page } from '@playwright/test';

/**
 * 抽屉打开/关闭不得让地图画布横向位移（试玩 1009 H）：
 * `.planet-map-shell` 的 overflow 若还是 hidden，它仍是滚动容器——抽屉展开时右侧内容
 * 比壳宽，浏览器会为「聚焦/滚动到可见」把壳 scrollLeft 改写成 300，整个地图横向滚走
 * 300px，点格与悬停全部错位。改为 overflow:clip 后画布 rect.x 在两种状态下必须一致，
 * 且点击某格得到的悬停/选中坐标必须与换算出的格子相同（400px 与 1280px 两档）。
 */

async function openFixturePlanet(page: Page) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await page.waitForURL(/\/planet\//, { timeout: 15_000 });
  await page.goto('/planet/planet-1-1?view=2d');
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible({ timeout: 15_000 });
}

async function dismissToasts(page: Page) {
  const close = page.locator('.toast__close');
  for (let remaining = await close.count(); remaining > 0; remaining -= 1) {
    await close.first().click();
  }
  await expect(page.locator('.toast')).toHaveCount(0);
}

interface CanvasGeometry {
  x: number;
  width: number;
  scrollLeft: number;
  shellScrollLeft: number;
  shellOverflowX: string;
  windowScrollX: number;
}

async function canvasGeometry(page: Page): Promise<CanvasGeometry> {
  return page.evaluate(() => {
    const surface = document.querySelector('.planet-map-canvas__surface')!;
    const shell = document.querySelector('.planet-map-shell')!;
    const rect = surface.getBoundingClientRect();
    // 取整到 0.5px：GPU 下滚动条出现/消失会让宽度有 <0.1px 的亚像素抖动，
    // 要断言的是「没有 300px 级别的横向位移」，不是亚像素。
    const round = (value: number) => Math.round(value * 2) / 2;
    return {
      x: round(rect.x),
      width: round(rect.width),
      scrollLeft: Math.round(shell.scrollLeft),
      shellScrollLeft: Math.round(shell.scrollLeft),
      shellOverflowX: getComputedStyle(shell).overflowX,
      windowScrollX: Math.round(window.scrollX),
    };
  });
}

/** 用画布上的相机参数把 tile 换算成元素内点击坐标（与前端 pointToTile 同口径）。 */
async function tileToLocalPoint(page: Page, tile: { x: number; y: number }) {
  return page.evaluate((target) => {
    const surface = document.querySelector('.planet-map-canvas__surface') as HTMLElement;
    const offsetX = Number(surface.getAttribute('data-camera-offset-x'));
    const offsetY = Number(surface.getAttribute('data-camera-offset-y'));
    const tileSize = Number(surface.getAttribute('data-tile-size'));
    const width = surface.clientWidth;
    const height = surface.clientHeight;
    // 与前端 pointToTile 同口径：mapWidth*tileSize > 视口时启用环面回绕，
    // 命中格取规范（unwrapped）坐标。
    const mapWidth = Number(surface.getAttribute('data-map-width') ?? 0);
    const mapHeight = Number(surface.getAttribute('data-map-height') ?? 0);
    const wrapMod = (value: number, size: number) => ((value % size) + size) % size;
    const canonAxis = (value: number, offset: number, mapTiles: number, viewportPx: number) => (
      mapTiles * tileSize > viewportPx
        ? Math.floor(-offset / tileSize) + wrapMod(value - Math.floor(-offset / tileSize), mapTiles)
        : value
    );
    return {
      x: offsetX + (canonAxis(target.x, offsetX, mapWidth, width) + 0.5) * tileSize,
      y: offsetY + (canonAxis(target.y, offsetY, mapHeight, height) + 0.5) * tileSize,
      offsetX,
      offsetY,
      tileSize,
      width,
      height,
    };
  }, tile);
}

async function hoveredTile(page: Page): Promise<{ x: number; y: number } | null> {
  const text = await page.locator('.planet-map-canvas__status').innerText();
  const match = text.match(/Hover \((\d+), (\d+)\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

for (const viewport of [
  { width: 400, height: 844, label: '窄屏 400px' },
  { width: 1280, height: 900, label: '宽屏 1280px' },
]) {
  test(`抽屉开/关画布不横向位移且点格命中正确（${viewport.label}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFixturePlanet(page);
    await dismissToasts(page);

    const closed = await canvasGeometry(page);

    await page.getByRole('button', { name: '工作台' }).first().click();
    await expect(page.getByRole('tab', { name: '工作台' })).toBeVisible();
    const opened = await canvasGeometry(page);

    // 画布不横向位移：x 一致、壳没有横向滚动、overflow 不是可滚动的 hidden/auto/scroll
    expect(opened.x, `画布 x 从 ${closed.x} 变成 ${opened.x}`).toBe(closed.x);
    expect(opened.width).toBe(closed.width);
    expect(opened.shellScrollLeft).toBe(0);
    expect(opened.windowScrollX).toBe(0);
    expect(opened.shellOverflowX).toBe('clip');

    // 抽屉开着时点击指定格子：悬停坐标必须就是那一格（与布局换算一致）。
    // 只取屏幕点真的落在画布上的格子（抽屉覆盖的右侧格子跳过）。
    const surface = page.locator('.planet-map-canvas__surface');
    const box = (await surface.boundingBox())!;
    const hitCanvas = (x: number, y: number) => page.evaluate(
      ([px, py]) => {
        const element = document.elementFromPoint(px, py);
        return Boolean(element?.closest('.planet-map-canvas__surface'));
      },
      [x, y],
    );
    let verified = 0;
    for (const tile of [
      { x: 6, y: 6 }, { x: 4, y: 6 }, { x: 6, y: 8 }, { x: 9, y: 4 }, { x: 12, y: 6 },
    ]) {
      const local = await tileToLocalPoint(page, tile);
      if (local.x < 4 || local.y < 4 || local.x > local.width - 4 || local.y > local.height - 4) {
        continue; // 该格在当前缩放下不在画布内
      }
      const screenX = box.x + local.x;
      const screenY = box.y + local.y;
      if (!(await hitCanvas(screenX, screenY))) {
        continue; // 被抽屉/建造栏等 HUD 覆盖
      }
      await page.mouse.move(screenX, screenY);
      await expect
        .poll(() => hoveredTile(page), { timeout: 5_000 })
        .toEqual(tile);
      // 点击同一格：悬停/选中坐标必须仍是该格（不能偏到左边一格）。
      // 焦点跟随「选中/地块」标签——它由点击格算出，偏移就会写成相邻格。
      await page.mouse.click(screenX, screenY);
      await expect
        .poll(() => hoveredTile(page), { timeout: 5_000 })
        .toEqual(tile);
      const status = await page.locator('.planet-map-canvas__status').innerText();
      const selectionLine = status.split('\n').find((line) => /地块|建筑|单位|资源|小队|未选中对象/.test(line)) ?? '';
      expect(selectionLine, `点击 (${tile.x}, ${tile.y}) 后状态栏应报同一格`).toMatch(
        new RegExp(`(未选中对象|\\(${tile.x}, ${tile.y}, \\d+\\))`),
      );
      expect(selectionLine).not.toMatch(new RegExp(`\\(${tile.x - 1}, ${tile.y},`));
      verified += 1;
      if (verified >= 2) {
        break;
      }
    }
    expect(verified, '抽屉开着时至少要有 2 个可点格子完成命中校验').toBeGreaterThanOrEqual(2);

    // 关抽屉后再量一次：同样不能位移。
    // 窄屏下新手引导面板与抽屉把手在垂直方向重叠（点不到把手），直接刷新页面拿到
    // 收起态（抽屉默认收起），避免依赖命中判定。
    await page.reload();
    await expect(page.locator('.planet-map-canvas__surface')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.planet-drawer--open')).toHaveCount(0);
    const reclosed = await canvasGeometry(page);
    expect(reclosed.x).toBe(closed.x);
    expect(reclosed.width).toBe(closed.width);
    expect(reclosed.shellScrollLeft).toBe(0);
    expect(reclosed.windowScrollX).toBe(0);
  });
}
