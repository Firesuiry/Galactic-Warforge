import { expect, test, type Page } from '@playwright/test';

import { hoveredTile, statusText, waitPlanetThree } from './support/planet-three';

/**
 * 抽屉打开/关闭不得让地图画布横向位移（试玩 1009 H）：
 * `.planet-map-shell` 的 overflow 若还是 hidden，它仍是滚动容器——抽屉展开时右侧内容
 * 比壳宽，浏览器会为「聚焦/滚动到可见」把壳 scrollLeft 改写成 300，整个地图横向滚走
 * 300px，点格与悬停全部错位。改为 overflow:clip 后画布 rect.x 在两种状态下必须一致，
 * 且点击某格得到的悬停/选中坐标必须与投影出的格子相同（400px 与 1280px 两档）。
 *
 * R20-C1：2D 视图删除后画布是 `.planet-three__surface canvas`（WebGL），
 * 格子的屏幕位置由 `window.__planetThree.tileScreenPos` 给出（页面 CSS 像素）。
 */

/**
 * 打开离线样例行星页（3D）。
 *
 * fixture 图只有 24×16 cell：深链 `x`/`y` 让 3D 相机聚焦到图内，
 * 无深链时页面会按基地自适应占屏。窄屏下抽屉（300px）会盖住右半边，
 * 左侧仍留出可点区域——这才是这条用例要验证的「抽屉覆盖下点格仍然命中」。
 */
async function openFixturePlanet(page: Page, focus?: { x: number; y: number }) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await page.waitForURL(/\/planet\//, { timeout: 15_000 });
  const query = focus ? `?x=${focus.x}&y=${focus.y}` : '';
  await page.goto(`/planet/planet-1-1${query}`);
  await waitPlanetThree(page);
}

async function dismissToasts(page: Page) {
  // toast 会自己超时消退：出场动画期间元素不可见/正在 detach，Playwright 的 click
  // 会一直等可操作性。直接在 DOM 上点关闭按钮（与用户点 × 同一条 React 路径），
  // 并轮询到真正清零。
  await expect.poll(async () => {
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('.toast__close').forEach((button) => button.click());
    });
    return page.locator('.toast').count();
  }, { timeout: 10_000 }).toBe(0);
}

interface CanvasGeometry {
  x: number;
  width: number;
  shellScrollLeft: number;
  shellOverflowX: string;
  windowScrollX: number;
}

async function canvasGeometry(page: Page): Promise<CanvasGeometry> {
  return page.evaluate(() => {
    const surface = document.querySelector('.planet-three__surface')!;
    const shell = document.querySelector('.planet-map-shell')!;
    const rect = surface.getBoundingClientRect();
    // 取整到 0.5px：GPU 下滚动条出现/消失会让宽度有 <0.1px 的亚像素抖动，
    // 要断言的是「没有 300px 级别的横向位移」，不是亚像素。
    const round = (value: number) => Math.round(value * 2) / 2;
    return {
      x: round(rect.x),
      width: round(rect.width),
      shellScrollLeft: Math.round(shell.scrollLeft),
      shellOverflowX: getComputedStyle(shell).overflowX,
      windowScrollX: Math.round(window.scrollX),
    };
  });
}

/** 屏幕点是否真的落在 3D 画布上（没有被抽屉/建造栏等 HUD 覆盖）。 */
async function hitCanvas(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(([px, py]) => {
    const element = document.elementFromPoint(px, py);
    return Boolean(element?.closest('.planet-three__surface'));
  }, [x, y]);
}

for (const viewport of [
  { width: 400, height: 844, label: '窄屏 400px' },
  { width: 1280, height: 900, label: '宽屏 1280px' },
]) {
  test(`抽屉开/关画布不横向位移且点格命中正确（${viewport.label}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openFixturePlanet(page, { x: 4, y: 3 });
    await dismissToasts(page);

    const closed = await canvasGeometry(page);

    await page.getByRole('button', { name: '工作台' }).first().click();
    await expect(page.getByRole('tab', { name: '工作台' })).toBeVisible();
    // 抽屉是覆盖式的（不挤压画布），展开动画 300ms 后才完全盖住右侧格子。
    await page.waitForTimeout(600);
    const opened = await canvasGeometry(page);

    // 画布不横向位移：x 一致、壳没有横向滚动、overflow 不是可滚动的 hidden/auto/scroll
    expect(opened.x, `画布 x 从 ${closed.x} 变成 ${opened.x}`).toBe(closed.x);
    expect(opened.width).toBe(closed.width);
    expect(opened.shellScrollLeft).toBe(0);
    expect(opened.windowScrollX).toBe(0);
    expect(opened.shellOverflowX).toBe('clip');

    // 抽屉开着时点几格空地：悬停坐标必须就是那一格（与投影一致）。
    // 只取屏幕点真的落在画布上的格子（抽屉覆盖的右侧格子跳过）。
    //
    // 候选不能用 tileScreenPos 生成：它在该格不可见时会**先聚焦**（把格子挪到屏幕中心），
    // 窄屏下中心正好被抽屉盖住。这里用 project()（相对画布、不移动相机）在相机中心附近
    // 扫一圈，取真正露在 HUD 之外的点。
    // 窄屏（400px）下默认聚焦高度里只有相机中心附近 1–2 格投在画布内，
    // 还要再扣掉抽屉与图标列——显式把相机拉远（`zoom(factor)` 是相对倍率，<1 = 拉远），
    // 让画布左侧露出足够多可点格。贴地高度 < ~2.8 时相邻格会投到画布外，只拉远不拉近。
    if (viewport.width <= 900) {
      await page.evaluate(() => window.__planetThree!.zoom(0.5));
      await page.waitForTimeout(400);
    }
    const canvasBox = (await page.locator('.planet-three__surface').boundingBox())!;
    const center = await page.evaluate(() => window.__planetThree!.getCenterTile()) ?? { x: 0, y: 0 };
    const candidates: Array<{ tile: { x: number; y: number }; x: number; y: number }> = [];
    for (let dy = -7; dy <= 7; dy += 1) {
      for (let dx = -7; dx <= 7; dx += 1) {
        const tile = { x: center.x + dx, y: center.y + dy };
        const projected = await page.evaluate((target) => window.__planetThree!.project(target), tile);
        if (!projected?.visible) continue;
        const x = canvasBox.x + projected.x;
        const y = canvasBox.y + projected.y;
        if (x < canvasBox.x + 8 || x > canvasBox.x + canvasBox.width - 8) continue;
        if (y < canvasBox.y + 8 || y > canvasBox.y + canvasBox.height - 8) continue;
        if (!(await hitCanvas(page, x, y))) continue;
        // 投影与拾取必须一致：球面倾斜时边缘格的投影点可能落在另一格上，
        // 用场景自己的拾取再核一次（pickAt 与真实鼠标同一条射线）。
        const picked = await page.evaluate(
          ([px, py]) => window.__planetThree!.pickAt(px, py),
          [x, y] as const,
        );
        if (!picked || Math.round(picked.x) !== tile.x || Math.round(picked.y) !== tile.y) continue;
        candidates.push({ tile, x, y });
      }
    }
    expect(candidates.length, '抽屉开着时画布上应仍有可点的格子').toBeGreaterThan(0);
    let verified = 0;
    for (const { tile, x, y } of candidates) {
      await page.mouse.move(x, y);
      await expect.poll(() => hoveredTile(page), { timeout: 5_000 }).toEqual(tile);
      // 点击同一格：选中坐标必须仍是该格（不能偏到相邻格）。选中状态经 React 提交，
      // 状态行可能晚一帧出现——轮询到出现「地块」行为止。
      await page.mouse.click(x, y);
      const selectionOf = async () => (
        (await statusText(page)).split('\n').find((line) => /地块|建筑|单位|资源|小队|未选中对象/.test(line)) ?? ''
      );
      // 未探索格（fixture 的测绘面纱之外）点击只弹「该区域尚未探索」提示、不产生选中文案：
      // 那不是命中错位，清掉提示后换下一个候选。
      await page.waitForTimeout(400);
      if (await page.locator('.planet-three__fog-notice').count() > 0) {
        continue;
      }
      await expect.poll(selectionOf, { timeout: 5_000 }).not.toBe('');
      const selectionLine = await selectionOf();
      if (/^(资源|建筑|单位|小队) /.test(selectionLine) && !/\(\d+, \d+/.test(selectionLine)) {
        continue; // 点中了格上的实体（状态栏只报实体名、不带坐标），换一格校验坐标
      }
      expect(selectionLine, `点击 (${tile.x}, ${tile.y}) 后状态行应报同一格`).toMatch(
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
    await waitPlanetThree(page);
    await expect(page.locator('.planet-drawer--open')).toHaveCount(0);
    const reclosed = await canvasGeometry(page);
    // 断言的是「没有 300px 级别的横向位移」，不是亚像素：生产构建（vite preview）下
    // 刷新后滚动条/小数布局会让 0.5px 取整后的 x、width 差半格（实测 1 → 1.5、
    // 398 → 397.5，main 上也复现），所以给 1px 容差。
    expect(Math.abs(reclosed.x - closed.x), `画布 x 从 ${closed.x} 变成 ${reclosed.x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(reclosed.width - closed.width), `画布宽从 ${closed.width} 变成 ${reclosed.width}`).toBeLessThanOrEqual(1);
    expect(reclosed.shellScrollLeft).toBe(0);
    expect(reclosed.windowScrollX).toBe(0);
  });
}
