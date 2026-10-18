import { expect, test, type Page } from '@playwright/test';

import { entityScreenPos, waitPlanetThree } from './support/planet-three';

/**
 * 工作台抽屉不得遮挡底部选择条（窄屏与宽屏都要成立）：
 * - 宽屏（>900px）：选择条右移让位（CSS `:has(.planet-drawer--open)`），与抽屉体不重叠；
 * - 窄屏（400px）：抽屉是覆盖式，抽屉体底部为选择条留出高度（--planet-bottom-reserve），
 *   选择条按钮仍可点击。
 * 用 fixture（离线样例）模式，不依赖战争服当前局势。
 *
 * R20-C1：2D 视图删除后不再有 DOM 实体层（D1），选中改用 3D 投影点击
 * （`window.__planetThree.entityScreenPos` → 真实鼠标）；投影点不可用时退回 `?select=` 深链。
 */

/** 离线样例里 p1 的建筑（fixtures/scenarios/baseline.ts，2×2 占地）。 */
const SELECTED_BUILDING = 'assembler-1';

async function openFixturePlanet(page: Page) {
  await page.goto('/login');
  await page.getByRole('radio', { name: '离线样例' }).click();
  await page.getByRole('button', { name: '打开离线场景' }).click();
  await page.waitForURL(/\/planet\//, { timeout: 15_000 });
  await page.goto('/planet/planet-1-1');
  await waitPlanetThree(page);
}

/** 关掉进入页面时弹出的告警 toast：它浮在选择条之上，会挡住按钮命中。 */
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

/**
 * 收起会盖住地图的浮层：左上行星胶囊（§3.2 默认收起，展开态的四张资源芯片会压住
 * 上方格子）、警报条（顶栏下方居中的窄条）。两者都不在 HUD 清单里，
 * 但它们确实盖住地图——不收起来，这条「点实体 → 选择条」的用例会挑不到干净格子。
 */
async function collapseHudOverlays(page: Page) {
  const collapse = page.getByRole('button', { name: '折叠行星信息' });
  if (await collapse.count() > 0) {
    await collapse.click();
  }
  await expect(page.locator('.planet-title-chip--collapsed')).toHaveCount(1);
}

/** 点地图上的一个实体 → 底部选择条出现（投影点被 HUD 盖住时退回深链）。 */
async function selectFirstBuilding(page: Page) {
  const selectionBar = page.getByTestId('planet-selection-bar');
  await expect(selectionBar).toHaveCount(0);
  const point = await entityScreenPos(page, SELECTED_BUILDING);
  const covered = await page.evaluate(([x, y]) => {
    const top = document.elementFromPoint(x, y);
    return !top?.closest('.planet-three__surface');
  }, [point.x, point.y] as const);
  if (!covered) {
    await page.mouse.click(point.x, point.y);
  }
  if (covered || !(await selectionBar.isVisible().catch(() => false))) {
    // 投影点被浮层盖住（或点击被软渲染吞掉）：深链选中同一栋建筑，
    // 选择条与抽屉的几何契约照常校验。
    await page.goto(`/planet/planet-1-1?select=building:${SELECTED_BUILDING}`);
    await waitPlanetThree(page);
  }
  await expect(selectionBar).toBeVisible({ timeout: 10_000 });
  await expect(selectionBar).toContainText('制造台');
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
    await collapseHudOverlays(page);
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
