import { expect, test, type Page } from '@playwright/test';

/**
 * 群星式建造闭环验收（真实 Go 战争服）：
 * 登录 → 行星页底部建造栏点选建筑卡片（.planet-build-card）→ 在 canvas 上点击放置
 * → 命令回执出现在工作台（journal 最近结果）。
 *
 * 空地不硬编码：先通过 scene API 找到 p1 执行体，再在其操作范围内挑一块
 * 可建造、无建筑/单位/资源占用的 tile，最后用 canvas 的
 * data-camera-offset-x/y 与 data-tile-size 换算成屏幕坐标点击。
 */

const WEB_ENTRY = 'http://127.0.0.1:4173';
const BACKEND_ENTRY = 'http://127.0.0.1:19481';
const PLANET_ID = 'planet-1-1';
const OPERATE_RANGE = 6;
const BUILDING_ID = 'wind_turbine';

/**
 * 服务端 mining_machine 的 collect.allowed_resources（server/data/buildings.yaml）：
 * 只有这些矿种的资源格才能放采矿机，其余（water/sulfuric_acid/crude_oil/log 等）由抽水站、
 * 化工、伐木等建筑开采，服务端会回执「mining_machine 无法开采资源 <kind>」。
 */
const ALLOWED_MINING_RESOURCES = new Set([
  'iron_ore',
  'copper_ore',
  'stone_ore',
  'silicon_ore',
  'titanium_ore',
  'coal',
  'fire_ice',
  'fractal_silicon',
  'grating_crystal',
  'monopole_magnet',
  'kimberlite_ore',
  'spiniform_stalagmite_crystal',
  'organic_crystal',
]);

interface ScenePosition {
  x: number;
  y: number;
  z?: number;
}

interface ScenePayload {
  planet_id: string;
  map_width: number;
  map_height: number;
  terrain: string[][];
  visible?: boolean[][];
  buildings: Record<string, { id?: string; owner_id?: string; position: ScenePosition }>;
  units: Record<string, {
    id: string;
    type: string;
    owner_id: string;
    position: ScenePosition;
  }>;
  resources: Array<{ id?: string; kind?: string; position: ScenePosition }>;
}

async function fetchAuthorized<T>(path: string): Promise<T> {
  const response = await fetch(`${BACKEND_ENTRY}${path}`, {
    headers: { authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBeTruthy();
  return response.json() as Promise<T>;
}

async function installSession(page: Page) {
  await page.addInitScript((serverUrl) => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  }, WEB_ENTRY);
}

/** 记录发往 /commands 的 POST 请求体，用于断言「命令真的发到了服务端」。 */
function captureCommandRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/commands')) {
      requests.push(request.postData() ?? '');
    }
  });
  return requests;
}

/**
 * 识别「前端本地预检拦截」（LOCAL_PREFLIGHT）：命令根本没发到服务端。
 *
 * 战争服长跑后出现这类回执属于合法场景状态而非代码缺陷：p1 开局背包没有可持续的
 * 铁矿来源（config-war.yaml 的 bootstrap 只给铁块 120，地图上无采矿机、机甲也不自动
 * 采矿），跑久后 iron_ingot 归零，而风力涡轮机/采矿机都要铁块 4，于是本地预检直接
 * 拦下建造，journal 记为「建造 · 失败未生效无法建造：缺少 铁块 4」。
 * 这类用例应跳过真实闭环断言，避免把资源枯竭误判成回归失败。
 */
async function localPreflightBlock(page: Page): Promise<string | null> {
  const firstEntry = page.locator('.planet-command-history li').first();
  if ((await firstEntry.count()) === 0) {
    return null;
  }
  const text = ((await firstEntry.textContent()) ?? '').trim();
  const isFailure = /失败|未生效/.test(text);
  const isPreflightBlock = /无法建造|无法开采|缺少|LOCAL_PREFLIGHT/.test(text);
  return isFailure && isPreflightBlock ? text : null;
}

/**
 * 与前端环绕渲染一致的 tile→视口坐标换算：
 * 世界像素 > 视口像素的轴启用环面环绕（相机 offset 已归一化），
 * tile 的屏幕位置要取规范（unwrapped）坐标，而不是 raw 坐标。
 */
async function tileToScreenPosition(
  page: Page,
  surface: ReturnType<Page['locator']>,
  tile: { x: number; y: number },
  mapWidth: number,
  mapHeight: number,
) {
  const offsetX = Number(await surface.getAttribute('data-camera-offset-x'));
  const offsetY = Number(await surface.getAttribute('data-camera-offset-y'));
  const tileSize = Number(await surface.getAttribute('data-tile-size'));
  const box = await surface.boundingBox();
  if (!box) {
    throw new Error('交互面不可见');
  }
  const wrapMod = (value: number, size: number) => ((value % size) + size) % size;
  const canonAxis = (t: number, offset: number, mapTiles: number, viewportPx: number) => (
    mapTiles * tileSize > viewportPx
      ? Math.floor(-offset / tileSize) + wrapMod(t - Math.floor(-offset / tileSize), mapTiles)
      : t
  );
  return {
    x: offsetX + (canonAxis(tile.x, offsetX, mapWidth, box.width) + 0.5) * tileSize,
    y: offsetY + (canonAxis(tile.y, offsetY, mapHeight, box.height) + 0.5) * tileSize,
  };
}

/**
 * 服务端建造校验：放置后不得把任何地面单位（含己方机甲）的四邻全部堵死
 * （server/internal/gamecore/build_commands.go 的 buildingEnclosure）。
 * 战争服开局基地被自家建筑群包住，机甲四邻的空地必然被拒；这里把这类格子排除。
 */
function sealsAnyGroundUnit(scene: ScenePayload, tile: { x: number; y: number }): boolean {
  const occupied = new Set<string>();
  for (const building of Object.values(scene.buildings ?? {})) {
    occupied.add(`${building.position.x}:${building.position.y}`);
  }
  for (const unit of Object.values(scene.units ?? {})) {
    occupied.add(`${unit.position.x}:${unit.position.y}`);
  }
  return Object.values(scene.units ?? {}).some((unit) => {
    const neighbors = [
      { x: unit.position.x + 1, y: unit.position.y },
      { x: unit.position.x - 1, y: unit.position.y },
      { x: unit.position.x, y: unit.position.y + 1 },
      { x: unit.position.x, y: unit.position.y - 1 },
    ];
    const blocked = (point: { x: number; y: number }) => (
      (point.x === tile.x && point.y === tile.y)
      || occupied.has(`${point.x}:${point.y}`)
      || scene.terrain?.[point.y]?.[point.x] !== 'buildable'
    );
    return neighbors.every(blocked);
  });
}

/** 在执行体操作范围内挑一块可建造空地（按曼哈顿距离由近及远）。 */
function pickBuildTile(scene: ScenePayload): { x: number; y: number } {
  const executor = Object.values(scene.units ?? {}).find(
    (unit) => unit.owner_id === 'p1' && unit.type === 'executor',
  );
  if (!executor) {
    throw new Error('战争服中应存在 p1 的执行体单位');
  }

  const occupied = new Set<string>();
  for (const building of Object.values(scene.buildings ?? {})) {
    occupied.add(`${building.position.x}:${building.position.y}`);
  }
  for (const unit of Object.values(scene.units ?? {})) {
    occupied.add(`${unit.position.x}:${unit.position.y}`);
  }
  for (const resource of scene.resources ?? []) {
    occupied.add(`${resource.position.x}:${resource.position.y}`);
  }

  const origin = executor.position;
  for (let distance = 1; distance <= OPERATE_RANGE; distance += 1) {
    for (let dx = -distance; dx <= distance; dx += 1) {
      const dy = distance - Math.abs(dx);
      for (const stepY of distance === 0 || dy === 0 ? [0] : [-dy, dy]) {
        const x = origin.x + dx;
        const y = origin.y + stepY;
        if (x < 0 || y < 0 || x >= scene.map_width || y >= scene.map_height) {
          continue;
        }
        if (scene.terrain?.[y]?.[x] !== 'buildable') {
          continue;
        }
        if (scene.visible && scene.visible[y]?.[x] !== true) {
          continue;
        }
        if (occupied.has(`${x}:${y}`)) {
          continue;
        }
        if (sealsAnyGroundUnit(scene, { x, y })) {
          continue;
        }
        return { x, y };
      }
    }
  }
  throw new Error(`执行体 ${executor.id} 周围 ${OPERATE_RANGE} 格内没有可建造空地`);
}

test('建造栏点选建筑卡片后在地图点击放置，命令回执出现在工作台', async ({ page }) => {
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );
  const tile = pickBuildTile(scene);

  const commandRequests = captureCommandRequests(page);
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);

  // 底部建造栏就绪后点选 wind_turbine 卡片，进入建造模式（幽灵预览提示出现）。
  const buildCard = page.locator(`.planet-build-card[data-building-id="${BUILDING_ID}"]`);
  await expect(buildCard).toBeVisible({ timeout: 30_000 });
  await buildCard.click();
  await expect(page.locator('.planet-build-bar__hint')).toContainText('放置 风力涡轮机');

  // 用 canvas 上的相机参数把 tile 坐标换算成元素内点击坐标（环面规范坐标）。
  const surface = page.locator('.planet-map-canvas__surface');
  await surface.click({
    position: await tileToScreenPosition(page, surface, tile, scene.map_width, scene.map_height),
  });

  // 工作台最近结果：要么是本地预检拦下（战争服资源枯竭，合法场景状态），
  // 要么真的发出 build 命令并被服务端受理（有资源时校验真实闭环）。
  const firstEntry = page.locator('.planet-command-history li').first();
  await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
  const blocked = await localPreflightBlock(page);
  if (blocked) {
    // 本地预检失败 ⇒ 前端根本没发命令；断言这一点，避免把「假成功」当成通过。
    expect(commandRequests).toHaveLength(0);
    test.skip(true, `战争服 p1 背包已耗尽建造成本，前端本地预检拦下建造（${blocked}），跳过真实闭环断言`);
    return;
  }
  expect(commandRequests.length).toBeGreaterThan(0);
  // authoritative 回写为成功（受理→回写有时序，不断言瞬态 pending 文案）。
  await expect(firstEntry).toContainText('成功', { timeout: 10_000 });
});

test('采集建筑可直接放置在资源格上（前端不再本地拦截）', async ({ page }) => {
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );

  // 挑一个可见、地形可建、无建筑占用、矿种在采矿机白名单内、且落在机甲作业范围内的资源格
  // （采矿机必须压资源点，且服务端要求施工点在机甲作业范围内，否则回执 OUT_OF_RANGE）。
  // 战争服开局基地被自家建筑群包住，机甲四邻的矿点都会被「围死校验」拒收；候选按到机甲的
  // 距离由近及远排序，逐个尝试直到服务端受理（accepted）。
  const executor = Object.values(scene.units ?? {}).find(
    (unit) => unit.owner_id === 'p1' && unit.type === 'executor',
  );
  if (!executor) {
    throw new Error('战争服中应存在 p1 的执行体单位，用于筛选机甲作业范围内的采矿机落点');
  }
  const surfaceDistance = (a: ScenePosition, b: ScenePosition) => {
    const wrap = (delta: number, size: number) => {
      const d = Math.abs(delta) % size;
      return Math.min(d, size - d);
    };
    return wrap(a.x - b.x, scene.map_width) + wrap(a.y - b.y, scene.map_height);
  };

  const occupiedByBuilding = new Set(
    Object.values(scene.buildings ?? {}).map(
      (building) => `${building.position.x}:${building.position.y}`,
    ),
  );
  const candidates = scene.resources.filter((resource) => {
    // 服务端只允许采矿机开采 ALLOWED_MINING_RESOURCES 里的矿种（water/crude_oil/log 等由别的建筑开采）。
    if (!ALLOWED_MINING_RESOURCES.has(resource.kind ?? '')) {
      return false;
    }
    const { x, y } = resource.position;
    if (scene.terrain?.[y]?.[x] !== 'buildable') {
      return false;
    }
    if (scene.visible && scene.visible[y]?.[x] !== true) {
      return false;
    }
    if (occupiedByBuilding.has(`${x}:${y}`)) {
      return false;
    }
    return surfaceDistance(resource.position, executor.position) <= OPERATE_RANGE;
  });
  if (candidates.length === 0) {
    const kinds = [...new Set(scene.resources.map((resource) => resource.kind ?? 'unknown'))].join(', ');
    // 战争服长跑后合法场景状态：机甲作业范围内所有可开采资源格都已被采矿机占用
    // （或资源格不可见），此时没有可验证的落点，跳过而不是误判为回归失败。
    // 全新战争服开局必定存在候选格（starter 资源点保证），该断言仍会真实执行。
    test.skip(
      true,
      `机甲 ${executor.id} 周围 ${OPERATE_RANGE} 格内已无可放置采矿机的资源格`
      + `（白名单矿种 + 地形 buildable + 可见 + 无建筑占用），当前场景资源矿种为 [${kinds}]`,
    );
    return;
  }

  const commandRequests = captureCommandRequests(page);
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);

  const buildCard = page.locator('.planet-build-card[data-building-id="mining_machine"]');
  await expect(buildCard).toBeVisible({ timeout: 30_000 });
  await buildCard.click();
  await expect(page.locator('.planet-build-bar__hint')).toContainText('放置 采矿机');

  // 与前端 assessBuildTiles 同口径的候选排序：按到机甲的距离由近及远逐个尝试——「被资源点占用」
  // 是采矿机的合法目标，但服务端还会因「围死单位」「超出作业范围」拒收，且并行规格可能刚占了
  // 最近的格子。逐个点到服务端受理（accepted）为止，保证这条真实闭环断言每次都真的跑起来。
  const surface = page.locator('.planet-map-canvas__surface');
  const byDistance = [...candidates].sort((left, right) => (
    surfaceDistance(left.position, executor.position) - surfaceDistance(right.position, executor.position)
  ));
  let firstEntry = page.locator('.planet-command-history li').first();
  let blocked: string | null = null;
  let accepted = false;
  // 只重试「被服务端规则拒绝」的回执（围死/超范围/资源不足/并发上限等）：命令确实发出去了，
  // 换一格继续试；本地预检拦截（LOCAL_PREFLIGHT）说明前端根本没发命令，直接跳出。
  for (const candidate of byDistance) {
    await surface.click({
      position: await tileToScreenPosition(page, surface, candidate.position, scene.map_width, scene.map_height),
    });
    await expect
      .poll(async () => (await page.locator('.planet-command-history li').count()) > 0, { timeout: 5_000 })
      .toBe(true);
    firstEntry = page.locator('.planet-command-history li').first();
    await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
    blocked = await localPreflightBlock(page);
    if (blocked) {
      break;
    }
    if (((await firstEntry.textContent()) ?? '').includes('成功')) {
      accepted = true;
      break;
    }
  }

  if (blocked) {
    // 本地预检失败 ⇒ 前端根本没发命令，且不得是「被资源点占用」这条旧拦截。
    expect(commandRequests).toHaveLength(0);
    expect(blocked).not.toContain('被资源点占用');
    test.skip(true, `战争服 p1 背包已耗尽建造成本，前端本地预检拦下建造（${blocked}），跳过真实闭环断言`);
    return;
  }
  expect(commandRequests.length).toBeGreaterThan(0);
  // 采矿机落在资源格上必须被服务端受理（不再是 LOCAL_PREFLIGHT 的「被资源点占用」）。
  await expect(firstEntry).toContainText('成功', { timeout: 10_000 });
  expect(accepted, '至少一个资源格候选应被服务端受理').toBe(true);
  await expect(firstEntry).not.toContainText('被资源点占用');
  await expect(firstEntry).not.toContainText('LOCAL_PREFLIGHT');
});

test('首次进入行星页视角聚焦基地，基地不被信息片遮挡且可点选', async ({ page }) => {
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );
  // 与前端 resolveHomeTile 同规则：按 id 排序的第一个 p1 建筑即"基地"。
  const home = Object.entries(scene.buildings ?? {})
    .filter(([, building]) => building.owner_id === 'p1')
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))[0];
  if (!home) {
    throw new Error('战争服中应存在 p1 的基地建筑');
  }
  const [homeId, homeBuilding] = home;

  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?view=2d`);

  const surface = page.locator('.planet-map-canvas__surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });

  // 回家视角：48px/tile，基地落在视口内且不压在左上信息片区域（约 left 16..456 / top 16..150）。
  await expect
    .poll(async () => Number(await surface.getAttribute('data-tile-size')), { timeout: 10_000 })
    .toBe(48);
  const surfaceBox = await surface.boundingBox();
  if (!surfaceBox) {
    throw new Error('交互面不可见');
  }
  const screenPos = await tileToScreenPosition(
    page,
    surface,
    homeBuilding.position,
    scene.map_width,
    scene.map_height,
  );
  const screenX = screenPos.x;
  const screenY = screenPos.y;
  expect(screenX).toBeGreaterThan(0);
  expect(screenX).toBeLessThan(surfaceBox.width);
  expect(screenY).toBeGreaterThan(0);
  expect(screenY).toBeLessThan(surfaceBox.height);
  const underTitleChip = screenX < 456 && screenY < 150;
  expect(underTitleChip).toBe(false);

  // 直接点击基地所在格 → 选中该建筑（信息片不阻断画布命中）。
  await surface.click({ position: { x: screenX, y: screenY } });
  await expect(page.locator('.planet-map-canvas__status')).toContainText(`建筑 ${homeId}`);

  // 信息片可折叠成窄条（进一步减少遮挡），也可再展开。
  await page.getByRole('button', { name: '折叠行星信息' }).click();
  await expect(page.locator('.planet-title-chip__chips')).toHaveCount(0);
  await page.getByRole('button', { name: '展开行星信息' }).click();
  await expect(page.locator('.planet-title-chip__chips')).toBeVisible();
});

/**
 * 建造栏与工作台抽屉的几何关系（战争服开局即有可建造卡片）：
 * - 抽屉打开时建造栏自动收起成一行把手，不与抽屉重叠；
 * - 手动点「建造栏」把手展开后，建造栏（含横向滚动区）必须落在抽屉左侧的可用区域里，
 *   右缘不得越到抽屉左缘之上（宽屏），窄屏则让抽屉让位后同样不重叠。
 */
for (const viewport of [
  { width: 400, height: 844, label: '窄屏 400px' },
  { width: 1280, height: 900, label: '宽屏 1280px' },
]) {
  test(`工作台抽屉打开时建造栏自动收起，展开后不与抽屉重叠（${viewport.label}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installSession(page);
    await page.goto(`/planet/${PLANET_ID}?view=2d`);
    await expect(page.locator('.planet-build-card').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: '工作台' }).first().click();
    await expect(page.getByRole('tab', { name: '工作台' })).toBeVisible();

    const geometry = () => page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
      };
      return {
        drawer: rect('.planet-drawer__body'),
        drawerOpen: Boolean(document.querySelector('.planet-drawer--open')),
        buildBar: rect('[data-testid="planet-build-bar"]'),
        scroller: rect('.planet-build-bar__scroller'),
        viewportWidth: window.innerWidth,
        docked: Boolean(document.querySelector('.planet-build-bar--docked')),
      };
    });
    const overlapsOf = (
      left: { x: number; y: number; width: number; height: number } | null,
      right: { x: number; y: number; width: number; height: number } | null,
    ) => {
      if (!left || !right) return false;
      return !(
        left.x + left.width <= right.x
        || left.x >= right.x + right.width
        || left.y + left.height <= right.y
        || left.y >= right.y + right.height
      );
    };

    const collapsed = await geometry();
    expect(collapsed.docked, '抽屉打开时建造栏应自动收起成一行把手').toBe(true);
    expect(collapsed.buildBar).not.toBeNull();
    expect(collapsed.drawer).not.toBeNull();
    expect(
      overlapsOf(collapsed.buildBar, collapsed.drawer),
      `收起态建造栏 ${JSON.stringify(collapsed.buildBar)} 与抽屉 ${JSON.stringify(collapsed.drawer)} 不应重叠`,
    ).toBe(false);

    // 手动点把手展开建造栏：卡片恢复可见，展开后的建造栏与滚动区都不得压到抽屉上。
    await page.getByRole('button', { name: '建造栏', exact: true }).click();
    await expect(page.locator('.planet-build-card').first()).toBeVisible();
    // 窄屏让位时抽屉走 transform 过渡（translate 300px），要等它滑出后才量最终几何。
    await expect.poll(async () => {
      const current = await geometry();
      return overlapsOf(current.buildBar, current.drawer) || overlapsOf(current.scroller, current.drawer);
    }, { timeout: 5_000, message: '展开后建造栏与抽屉不得重叠' }).toBe(false);
    const expanded = await geometry();
    expect(expanded.docked).toBe(false);
    expect(expanded.buildBar).not.toBeNull();
    expect(expanded.scroller).not.toBeNull();
    if (expanded.drawerOpen) {
      // 抽屉仍打开（宽屏）：建造栏必须收缩到抽屉左侧的可用区域
      expect(expanded.buildBar!.right).toBeLessThanOrEqual(expanded.drawer!.x + 1);
      expect(expanded.scroller!.right).toBeLessThanOrEqual(expanded.drawer!.x + 1);
    }
    // 两种宽度下展开的建造栏都必须在视口内（卡片改横向滚动，不能把整页撑宽）
    expect(expanded.buildBar!.x).toBeGreaterThanOrEqual(0);
    expect(expanded.buildBar!.right).toBeLessThanOrEqual(expanded.viewportWidth);
    expect(expanded.scroller!.x).toBeGreaterThanOrEqual(0);
    expect(expanded.scroller!.right).toBeLessThanOrEqual(expanded.viewportWidth);
  });
}
