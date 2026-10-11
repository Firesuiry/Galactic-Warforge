import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

/**
 * 试玩 1014 层 16 问题 1 / 层 15 问题 2 / 层 13 问题 3：任何 HUD 浮层都不得覆盖
 * 小地图的可交互区域，否则「选中单位 → 用缩略图下令」的必经时刻右键会被静默吞掉。
 *
 * 这里不逐个断言浮层的盒子，而是把「小地图还能不能用」写成几何契约：在三种状态
 * （选中多个单位 / 建造栏展开 / 总览栏展开）下，小地图 canvas 的中心与四角
 * `elementFromPoint` 必须都命中 canvas 本身，且派发的 contextmenu 必须真的到达 canvas。
 *
 * 修复不是给浮层逐个打补丁，而是让小地图把「自己占了右下角多少宽」写进 :root
 * （--planet-minimap-width，PlanetMinimap 的 ResizeObserver），底部浮层统一读
 * --planet-hud-right-reserve 让出这条走廊；窄屏（<1100px）小地图不渲染，走廊归零。
 *
 * 选中多个单位需要服务端真有 ≥2 个 p1 单位：战争服预置只有 1 个（executor），
 * 因此用例先用 API 建兵营并量产一个 worker（幂等：已存在就复用）。
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

async function dismissToasts(page: Page) {
  const close = page.locator('.toast__close');
  for (let remaining = await close.count(); remaining > 0; remaining -= 1) {
    await close.first().click();
  }
  await expect(page.locator('.toast')).toHaveCount(0);
}

interface SceneUnit {
  id: string;
  type: string;
  owner_id: string;
  position: { x: number; y: number };
  mecha?: unknown;
}

interface SceneBuilding {
  id: string;
  type?: string;
  owner_id?: string;
  position: { x: number; y: number };
}

interface ScenePayload {
  map_width: number;
  map_height: number;
  terrain: string[][];
  buildings: Record<string, SceneBuilding>;
  units: Record<string, SceneUnit>;
  resources: Array<{ position: { x: number; y: number } }>;
}

async function fetchScene(request: APIRequestContext): Promise<ScenePayload> {
  const response = await request.get(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
    { headers: { Authorization: 'Bearer key_player_1' } },
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

async function sendCommand(
  request: APIRequestContext,
  command: Record<string, unknown>,
): Promise<{ accepted?: boolean; results?: Array<{ accepted?: boolean; reason?: string }> }> {
  const response = await request.post('/commands', {
    headers: { Authorization: 'Bearer key_player_1', 'Content-Type': 'application/json' },
    data: {
      request_id: `spec-hit-targets-${Math.random().toString(36).slice(2)}`,
      issuer_type: 'player',
      issuer_id: 'p1',
      commands: [command],
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

/** 可被框选的己方地面单位：排除机甲（机甲有独立面板，框选口径与普通单位不同）。 */
function selectableUnits(scene: ScenePayload): SceneUnit[] {
  return Object.values(scene.units ?? {}).filter(
    (unit) => unit.owner_id === 'p1' && unit.mecha == null,
  );
}

/**
 * 保证服务端至少有两个可框选的 p1 单位。
 *
 * 战争服开局只有 1 个 executor（机甲）：先建兵营，再装入 铁块 8 + 电路板 4，最后量产
 * 一个 worker（units.yaml：worker 的 producer = barracks）。每一步都先看服务端现状，
 * 已存在就跳过，因此在同一个战争服上重复跑这个用例是幂等的。
 */
async function ensureTwoOwnUnits(request: APIRequestContext) {
  let scene = await fetchScene(request);
  if (selectableUnits(scene).length >= 2) {
    return;
  }

  let barracks = Object.values(scene.buildings ?? {}).find(
    (building) => building.owner_id === 'p1' && building.type === 'barracks',
  );

  if (!barracks) {
    const executor = Object.values(scene.units ?? {}).find(
      (unit) => unit.owner_id === 'p1' && unit.type === 'executor',
    );
    expect(executor, '战争服应预置 p1 执行体').toBeTruthy();
    const origin = executor!.position;
    const occupied = new Set<string>();
    for (const building of Object.values(scene.buildings ?? {})) {
      occupied.add(`${building.position.x}:${building.position.y}`);
    }
    for (const unit of Object.values(scene.units ?? {})) {
      occupied.add(`${unit.position.x}:${unit.position.y}`);
    }
    let tile: { x: number; y: number } | undefined;
    for (let distance = 1; distance <= 6 && !tile; distance += 1) {
      for (let dx = -distance; dx <= distance && !tile; dx += 1) {
        const dy = distance - Math.abs(dx);
        for (const stepY of dy === 0 ? [0] : [-dy, dy]) {
          const x = origin.x + dx;
          const y = origin.y + stepY;
          if (x < 0 || y < 0 || x >= scene.map_width || y >= scene.map_height) continue;
          if (scene.terrain?.[y]?.[x] !== 'buildable') continue;
          if (occupied.has(`${x}:${y}`)) continue;
          tile = { x, y };
          break;
        }
      }
    }
    expect(tile, '执行体周围应有可建造空地').toBeTruthy();

    await sendCommand(request, {
      type: 'build',
      target: { layer: 'planet', position: { z: 0, ...tile! } },
      payload: { building_type: 'barracks' },
    });

    // 建造按 tick 结算（defaultConstructionDurationTick = 1），轮询到兵营出现为止。
    for (let attempt = 0; attempt < 40 && !barracks; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      scene = await fetchScene(request);
      barracks = Object.values(scene.buildings ?? {}).find(
        (building) => building.owner_id === 'p1' && building.type === 'barracks',
      );
    }
    expect(barracks, '兵营应在数秒内建成').toBeTruthy();
  }

  // 装料：兵营产出单位要 铁块 + 电路板（units.yaml 的 worker 造价）。
  // 服务端 transfer_item 校验 payload.building_id（缺了会回「缺少 payload.building_id」）。
  const inventory = await request.get('/state/summary', {
    headers: { Authorization: 'Bearer key_player_1' },
  });
  const backpack = ((await inventory.json()).players?.p1?.inventory ?? {}) as Record<string, number>;
  const loads: Array<[string, number]> = [
    ['iron_ingot', Math.min(16, backpack.iron_ingot ?? 0)],
    ['circuit_board', Math.min(8, backpack.circuit_board ?? 0)],
  ];
  for (const [itemId, quantity] of loads) {
    if (quantity > 0) {
      await sendCommand(request, {
        type: 'transfer_item',
        target: { layer: 'planet', entity_id: barracks!.id },
        payload: { building_id: barracks!.id, item_id: itemId, quantity, direction: 'to_building' },
      });
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    scene = await fetchScene(request);
    if (selectableUnits(scene).length >= 2) {
      return;
    }
    await sendCommand(request, {
      type: 'produce',
      target: { layer: 'planet', entity_id: barracks!.id },
      payload: { unit_type: 'worker' },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  scene = await fetchScene(request);
  expect(
    selectableUnits(scene).length,
    '兵营装料后应能产出第二个 p1 单位（框选需要）',
  ).toBeGreaterThanOrEqual(2);
}

/** 己方单位当前的屏幕中心（2D 渲染把单位也画成 DOM 覆盖层，带 data-entity-kind）。 */
async function unitScreenPositions(page: Page): Promise<Array<{ id: string; x: number; y: number }>> {
  const units = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-entity-kind="unit"]')).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute('data-entity-id') ?? '',
        owner: element.getAttribute('data-owner'),
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    }),
  );
  return units
    .filter((unit) => unit.owner === 'self')
    .map((unit) => ({ id: unit.id, x: unit.x, y: unit.y }));
}

interface MinimapHitReport {
  canvas: { x: number; y: number; w: number; h: number } | null;
  probes: Record<string, string>;
  allHitCanvas: boolean;
  reportedWidth: number;
}

async function minimapHits(page: Page): Promise<MinimapHitReport> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.planet-minimap__canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return { canvas: null, probes: {}, allHitCanvas: false, reportedWidth: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const points: Record<string, [number, number]> = {
      center: [rect.x + rect.width / 2, rect.y + rect.height / 2],
      tl: [rect.x + 4, rect.y + 4],
      tr: [rect.right - 4, rect.y + 4],
      bl: [rect.x + 4, rect.bottom - 4],
      br: [rect.right - 4, rect.bottom - 4],
    };
    const probes: Record<string, string> = {};
    let allHitCanvas = true;
    for (const [key, [x, y]] of Object.entries(points)) {
      const top = document.elementFromPoint(x, y);
      probes[key] = top
        ? `${top.tagName}.${typeof top.className === 'string' ? top.className.split(' ')[0] : ''}`
        : 'none';
      if (top !== canvas) {
        allHitCanvas = false;
      }
    }
    return {
      canvas: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      probes,
      allHitCanvas,
      reportedWidth: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--planet-minimap-width'),
      ),
    };
  });
}

/** 在画布中心派发 contextmenu：事件必须到达 canvas（派发点与命中点同源）。 */
async function contextMenuReachesCanvas(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.planet-minimap__canvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    return new Promise<boolean>((resolve) => {
      let seen = false;
      canvas.addEventListener('contextmenu', () => { seen = true; }, { once: true });
      const top = document.elementFromPoint(x, y);
      top?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }));
      window.setTimeout(() => resolve(seen), 50);
    });
  });
}

async function assertMinimapUsable(page: Page, state: string) {
  const report = await minimapHits(page);
  expect(report.canvas, `${state}：小地图 canvas 应存在（宽屏 ≥1101px）`).toBeTruthy();
  expect(
    report.allHitCanvas,
    `${state}：小地图中心/四角被浮层抢走命中 ${JSON.stringify(report.probes)}（canvas ${JSON.stringify(report.canvas)}）`,
  ).toBe(true);
  expect(
    await contextMenuReachesCanvas(page),
    `${state}：在小地图上派发的 contextmenu 没有到达 canvas（右键移动令会被静默吞掉）`,
  ).toBe(true);
}

test('行星页宽屏：三种 HUD 状态下小地图中心与四角都命中 canvas、右键都到达 canvas', async ({ page, request }) => {
  test.setTimeout(180_000);
  await ensureTwoOwnUnits(request);

  await page.setViewportSize({ width: 1440, height: 1080 });
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.planet-minimap__canvas')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await dismissToasts(page);

  // 契约 0：小地图把实测宽度写进 :root，浮层据此让出走廊（写死常量会在字号变化时失效）。
  const baseline = await minimapHits(page);
  expect(
    baseline.reportedWidth,
    '--planet-minimap-width 必须由小地图实测写入（PlanetMinimap 的 ResizeObserver）',
  ).toBeGreaterThan(0);

  // 状态 1：建造栏展开（默认态）——建造栏滚动区过去盖住小地图左上角（层 15 问题 2）。
  await expect(page.locator('.planet-build-bar')).toBeVisible();
  await assertMinimapUsable(page, '建造栏展开');

  // 状态 2：选中多个单位——选中条过去压住小地图下半部（层 16 问题 1）。
  const units = await unitScreenPositions(page);
  expect(units.length, '需要至少两个 p1 单位才能触发多选选中条').toBeGreaterThanOrEqual(2);
  const minX = Math.min(...units.map((unit) => unit.x));
  const maxX = Math.max(...units.map((unit) => unit.x));
  const minY = Math.min(...units.map((unit) => unit.y));
  const maxY = Math.max(...units.map((unit) => unit.y));
  await page.mouse.move(minX - 60, minY - 60);
  await page.mouse.down();
  await page.mouse.move(minX - 40, minY - 40, { steps: 4 });
  await page.mouse.move(maxX + 60, maxY + 60, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="planet-selection-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="planet-selection-bar"]')).toContainText('已选');
  await page.waitForTimeout(300);
  await assertMinimapUsable(page, '多选单位（选中条浮出）');

  // 状态 3：总览栏展开——过去盖住地图右半区、吃掉小地图右键（层 13 问题 3）。
  const outlinerHandle = page.locator('.outliner-handle');
  if (await outlinerHandle.count() > 0) {
    await outlinerHandle.click();
  }
  await expect(page.locator('.outliner')).toBeVisible();
  await page.waitForTimeout(300);
  await assertMinimapUsable(page, '总览栏展开');

  // 状态 4：工作台抽屉展开——最右侧停靠栏，小地图整体左移后仍须完整可命中。
  await page.getByRole('button', { name: '工作台' }).click();
  await expect(page.locator('.planet-drawer--open')).toHaveCount(1);
  await page.waitForTimeout(700);
  await assertMinimapUsable(page, '工作台抽屉展开');

  // 小地图让位给抽屉后，其右缘必须落在抽屉左缘之外（几何避让，不是靠层级硬压）。
  const drawerVsMinimap = await page.evaluate(() => {
    const drawer = document.querySelector('.planet-drawer--open .planet-drawer__body');
    const minimap = document.querySelector('.planet-minimap');
    if (!drawer || !minimap) return null;
    const drawerRect = drawer.getBoundingClientRect();
    const minimapRect = minimap.getBoundingClientRect();
    return { drawerX: drawerRect.x, minimapRight: minimapRect.right };
  });
  expect(drawerVsMinimap).toBeTruthy();
  expect(
    drawerVsMinimap!.minimapRight,
    `小地图右缘 ${drawerVsMinimap!.minimapRight} 应在抽屉左缘 ${drawerVsMinimap!.drawerX} 之左`,
  ).toBeLessThanOrEqual(drawerVsMinimap!.drawerX + 1);
});

test('行星页窄屏：小地图不渲染，右下角浮层不溢出视口右缘', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => {
    const minimap = document.querySelector('.planet-minimap') as HTMLElement | null;
    const minimapRect = minimap?.getBoundingClientRect();
    const minimapVisible =
      minimapRect ? minimapRect.width > 0 && getComputedStyle(minimap!).display !== 'none' : false;
    // 建造栏滚动区（过去盖住小地图左上角的那块）必须完整落在视口内。
    const scroller = document.querySelector('.planet-build-bar__scroller') as HTMLElement | null;
    const scrollerRect = scroller?.getBoundingClientRect();
    return {
      minimapVisible,
      scrollerRight: scrollerRect?.right ?? null,
      scrollerLeft: scrollerRect?.left ?? null,
      viewport: window.innerWidth,
      reserve: getComputedStyle(document.documentElement).getPropertyValue('--planet-hud-right-reserve').trim(),
    };
  });

  expect(report.minimapVisible, '窄屏（<1100px）小地图不应渲染').toBe(false);
  expect(report.scrollerRight, '建造栏滚动区应存在').not.toBeNull();
  expect(report.scrollerLeft!).toBeGreaterThanOrEqual(0);
  expect(
    report.scrollerRight!,
    `窄屏走廊应归零：建造栏滚动区右缘 ${report.scrollerRight} 不得溢出视口 ${report.viewport}`,
  ).toBeLessThanOrEqual(report.viewport);
  expect(report.reserve, '窄屏 --planet-hud-right-reserve 应为 0px').toBe('0px');
});
