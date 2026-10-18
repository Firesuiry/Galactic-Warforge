import { expect, test, type Page } from '@playwright/test';

/**
 * 试玩 1012 问题 1：1200×1000 下行星页的抽屉页签、工作台按钮与建造卡必须真的能点。
 *
 * 用 elementFromPoint 做几何断言（不依赖截图）：
 * - 抽屉收起时，抽屉体滑出右缘之外，但它的盒子仍横跨视口右缘（1200 宽时 x 959–1259，
 *   正好压在地图右缘上）。若收起态仍可命中，点击会被这层「幽灵抽屉」拦走
 *   （试玩 1012：窄屏点地图、宽屏点右侧命中的是抽屉里滚到顶的详情页签）。
 *   契约：收起态的抽屉体不得可命中——要么不可见（visibility:hidden，滑出动画结束后生效），
 *   要么整块盒子都在视口之外。
 * - 抽屉展开时，工作台按钮曾被右下角 toast 栈（z-index 90）拦走；抽屉所在的地图壳必须
 *   抬到 toast 栈之上（壳自带 backdrop-filter，是原子堆叠上下文，只抬抽屉自身没用）。
 *   §3.2 把 toast 栈搬到右上角后这条仍然成立（注入块仍按 toast 栈的 z-index 压右下角）。
 * - 建造栏滚动区里的每张完整可见卡片，中心点必须落在卡片自身上。
 * - §3.2：抽屉打开时建造栏自动收起为一行把手（.planet-build-bar--docked）。
 *
 * 真实 Go 战争服由 playwright.config.ts 的 webServer 拉起（离线样例没有建造目录）。
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

/** 关掉进入页面时弹出的告警 toast：它们浮在 HUD 之上，会干扰命中判定。 */
async function dismissToasts(page: Page) {
  const close = page.locator('.toast__close');
  for (let remaining = await close.count(); remaining > 0; remaining -= 1) {
    await close.first().click();
  }
  await expect(page.locator('.toast')).toHaveCount(0);
}

interface HitReport {
  selector: string;
  text: string;
  x: number;
  y: number;
  hit: string;
  self: boolean;
}

/** 逐个取元素中心点做 elementFromPoint：命中自身或后代才算「可点」。
 *  只统计中心落在视口内的元素——抽屉体内部滚动后露出的按钮要滚动后再断言。 */
async function centerHits(page: Page, selector: string): Promise<HitReport[]> {
  return page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        return x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const top = document.elementFromPoint(x, y) as HTMLElement | null;
        return {
          selector: sel,
          text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 20),
          x: Math.round(x),
          y: Math.round(y),
          hit: top ? `${top.tagName}.${typeof top.className === 'string' ? top.className : ''}` : 'none',
          self: top === element || (top ? element.contains(top) : false),
        };
      });
  }, selector);
}

/** 只保留完整落在滚动区可视范围内的卡片：被横向裁掉的那些本来就不该点。 */
async function visibleBuildCards(page: Page): Promise<HitReport[]> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.planet-build-bar__scroller');
    if (!scroller) return [];
    const scrollerRect = scroller.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.planet-build-card'))
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.x >= scrollerRect.x - 1 && rect.x + rect.width <= scrollerRect.right + 1;
      })
      .map((card) => {
        const rect = card.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const top = document.elementFromPoint(x, y) as HTMLElement | null;
        return {
          selector: '.planet-build-card',
          text: (card.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 20),
          x: Math.round(x),
          y: Math.round(y),
          hit: top ? `${top.tagName}.${typeof top.className === 'string' ? top.className : ''}` : 'none',
          self: top === card || (top ? card.contains(top) : false),
        };
      });
  });
}

test('行星页 1200×1000：抽屉页签、工作台与建造卡的中心点都命中自身', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}`);
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await dismissToasts(page);

  // 1) 抽屉收起：整块抽屉体的盒子横跨视口右缘，但一个点都不许被它抢走（幽灵抽屉）
  const closed = await page.evaluate(() => {
    const drawer = document.querySelector('.planet-drawer')!;
    const body = document.querySelector('.planet-drawer__body')!;
    const rect = body.getBoundingClientRect();
    const x0 = Math.max(rect.x, 0);
    const x1 = Math.min(rect.right, window.innerWidth);
    const y0 = Math.max(rect.y, 0);
    const y1 = Math.min(rect.bottom, window.innerHeight);
    const probes: Array<{ label: string; hit: string; insideDrawer: boolean }> = [];
    const probe = (label: string, x: number, y: number) => {
      const top = document.elementFromPoint(x, y) as HTMLElement | null;
      probes.push({
        label,
        hit: top ? `${top.tagName}.${typeof top.className === 'string' ? top.className : ''}` : 'none',
        insideDrawer: top ? drawer.contains(top) : false,
      });
    };
    // 详情页签：收起时它们在视口右缘之外，点到的应该是地图画布
    document.querySelectorAll('.planet-detail-tabs__tab').forEach((tab, index) => {
      const tabRect = tab.getBoundingClientRect();
      probe(`tab-${index}`, tabRect.x + tabRect.width / 2, tabRect.y + tabRect.height / 2);
    });
    // 抽屉体在视口内的投影：逐点扫一遍
    for (let y = y0 + 5; y < y1; y += 20) {
      for (let x = x0 + 5; x < x1; x += 20) {
        probe(`scan-${Math.round(x)}x${Math.round(y)}`, x, y);
      }
    }
    return {
      probes,
      bodyIntersectsViewport: x1 > x0 && y1 > y0,
      bodyVisibility: getComputedStyle(body).visibility,
    };
  });

  expect(closed.probes.length).toBeGreaterThan(0);
  const ghostHits = closed.probes.filter((probe) => probe.insideDrawer);
  expect(ghostHits, `收起态的抽屉抢走了视口右缘的命中：${JSON.stringify(ghostHits)}`).toEqual([]);

  // 契约：收起态抽屉体的盒子若仍与视口相交，它必须不可命中（visibility:hidden）。
  // 这条是「幽灵抽屉」的环境无关守卫——即使某个布局下地图上另有浮层盖住它，也不该被点中。
  if (closed.bodyIntersectsViewport) {
    expect(
      closed.bodyVisibility,
      '收起态的抽屉体横跨视口时必须是 visibility:hidden，否则它会拦走地图上的点击',
    ).toBe('hidden');
  }

  // 2) 建造卡：滚动区内每张卡的中心点必须落在卡片自身（或其子节点）上，不能被小地图拦走
  const cards = await visibleBuildCards(page);
  expect(cards.length).toBeGreaterThan(0);
  expect(
    cards.filter((card) => !card.self),
    `被遮挡的建造卡：${JSON.stringify(cards.filter((card) => !card.self))}`,
  ).toEqual([]);

  // 3) 抽屉展开：地图壳必须抬到右下角 toast 栈（z-index 90）之上。
  //    抽屉所在的地图壳自带 backdrop-filter，是原子堆叠上下文——只把抽屉自身抬到 95
  //    仍会被壳外的 toast 栈盖住。这里注入一个与 toast 栈同尺寸同层级的
  //    固定覆盖块压住抽屉右下角：若壳没有整体抬升，探测点命中的是覆盖块而不是抽屉控件。
  //    （§3.2 起 toast 栈实际在右上角，但层级契约不变，注入块仍按它的 z-index 压右下角。）
  await page.locator('.planet-drawer__handle').click();
  await expect(page.locator('.planet-drawer--open')).toHaveCount(1);
  await page.waitForTimeout(600);

  const toastZ = await page.evaluate(() => {
    const stack = document.querySelector('.toast-stack');
    return stack ? Number(getComputedStyle(stack).zIndex) : 90;
  });

  await page.addStyleTag({
    content: `#toast-stub {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: min(320px, calc(100vw - 32px));
      height: 240px;
      z-index: ${toastZ};
    }`,
  });
  await page.evaluate(() => {
    const stub = document.createElement('div');
    stub.id = 'toast-stub';
    stub.textContent = 'toast-stub';
    document.body.appendChild(stub);
  });
  await page.waitForTimeout(150);

  const drawerVsToast = await page.evaluate(() => {
    const drawer = document.querySelector('.planet-drawer--open')!;
    const body = drawer.querySelector('.planet-drawer__body')!;
    const rect = body.getBoundingClientRect();
    const stub = document.getElementById('toast-stub')!;
    const stubRect = stub.getBoundingClientRect();
    // 抽屉体右下角、被覆盖块压住的一点
    const x = Math.round(Math.min(rect.right, stubRect.right) - 40);
    const y = Math.round(Math.min(rect.bottom, stubRect.bottom) - 40);
    const top = document.elementFromPoint(x, y) as HTMLElement | null;
    return {
      overlaps: rect.right > stubRect.x && rect.bottom > stubRect.y,
      at: `${x},${y}`,
      hit: top ? `${top.tagName}.${typeof top.className === 'string' ? top.className : ''}` : 'none',
      inDrawer: top ? drawer.contains(top) : false,
    };
  });

  expect(drawerVsToast.overlaps, '注入的覆盖块必须真的压住抽屉右下角，否则这条断言没有意义').toBe(true);
  expect(
    drawerVsToast.inDrawer,
    `展开的抽屉被右下角的覆盖块拦走（${drawerVsToast.at} → ${drawerVsToast.hit}），实际使用中就是 toast 栈挡住「装入建筑」`,
  ).toBe(true);

  await page.evaluate(() => document.getElementById('toast-stub')?.remove());

  const tabsWhileOpen = await centerHits(page, '.planet-detail-tabs__tab');
  expect(tabsWhileOpen.length).toBeGreaterThan(0);
  expect(
    tabsWhileOpen.filter((tab) => !tab.self),
    `展开后不可点的页签：${JSON.stringify(tabsWhileOpen.filter((tab) => !tab.self))}`,
  ).toEqual([]);

  const drawerButtons = await centerHits(page, '.planet-drawer__body button');
  expect(drawerButtons.length).toBeGreaterThan(0);
  expect(
    drawerButtons.filter((button) => !button.self),
    `展开后不可点的抽屉按钮：${JSON.stringify(drawerButtons.filter((button) => !button.self))}`,
  ).toEqual([]);

  // 抽屉打开时建造栏自动收起为一行把手（覆盖式抽屉不与卡片抢底部空间）
  await expect(page.locator('.planet-build-bar--docked')).toHaveCount(1);
});
