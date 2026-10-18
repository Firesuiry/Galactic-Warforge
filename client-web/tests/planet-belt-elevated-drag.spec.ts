import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

import { backendEntry } from './support/scenario';
import { requireScenario } from './support/scenario-gate';
import {
  buildCommandPlacements,
  captureCommandRequests,
  focusTile,
  settleProjection,
  THREE_CANVAS,
  waitPlanetThree,
} from './support/planet-three';

requireScenario('war', '需要官方战争场景（p1 有整套军用物资，可铺高架带），默认遭遇战场景跳过。');

/**
 * 第 19 轮遗留用例：高架带跨越地面带（3D 真实鼠标拖拽）。
 *
 * 流程（契约 R20-C1 第 5 条）：
 * 1. 先用 API 在场景里铺一条 3 格**地面带**（只发玩家 build 命令，不用管理员发料）；
 * 2. UI：进入传送带建造模式 → PageUp 升到 1 层（建造栏状态行显示「高度 1」）；
 * 3. 用真实鼠标沿垂直方向拖一条 ≥7 格的带，跨过那条地面带；
 * 4. 断言：拖拽中 ghost 存在（场景的 beltDragPath 非空）→ 松手后发出的 build 命令里
 *    跨越格 `elevation=1` → 落成后两条带都在（地面带没被替换）。
 *
 * 地面带与高架带都用 mk1（铁块 2 + 齿轮 1）：war 局 p1 开局各 120，足够；
 * 传送带科技由 config-war.yaml 的 completed_techs（electromagnetism）解锁，无需额外补科技。
 */

const PLANET_ID = 'planet-1-1';
const BELT = 'conveyor_belt_mk1';
/** 高架带需要的格数（契约 ≥7）。 */
const SPAN = 8;
const GROUND_SPAN = 3;
/** 报告目录（R20-E）。 */
const REPORT_DIR = '/home/firesuiry/develop/siliconWorld/tmp/playtest-1020-e';

interface ScenePayload {
  map_width: number;
  map_height: number;
  terrain: string[][];
  visible?: boolean[][];
  buildings: Record<string, { id: string; type?: string; owner_id?: string; position: { x: number; y: number; z?: number } }>;
  units: Record<string, { id: string; type: string; owner_id: string; position: { x: number; y: number } }>;
  resources: Array<{ kind?: string; position: { x: number; y: number } }>;
}

async function installSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
    );
  });
}

async function fetchScene(): Promise<ScenePayload> {
  const response = await fetch(
    `${backendEntry()}/world/planets/${PLANET_ID}/scene?x=0&y=0&width=80&height=80`,
    { headers: { authorization: 'Bearer key_player_1' } },
  );
  expect(response.ok).toBeTruthy();
  return response.json() as Promise<ScenePayload>;
}

async function sendBuild(request: APIRequestContext, position: { x: number; y: number }, payload: Record<string, unknown>) {
  const response = await request.post('/commands', {
    headers: { Authorization: 'Bearer key_player_1', 'Content-Type': 'application/json' },
    data: {
      request_id: `spec-elevated-${Math.random().toString(36).slice(2)}`,
      issuer_type: 'player',
      issuer_id: 'p1',
      commands: [{
        type: 'build',
        target: { layer: 'planet', position: { z: 0, ...position }, planet_id: PLANET_ID },
        payload: { building_type: BELT, direction: 'south', ...payload },
      }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { accepted?: boolean; results?: Array<{ accepted?: boolean; code?: string; message?: string }> };
  return body;
}

/** 场景里已占用的格（建筑按整块占地、单位、资源格）。 */
function occupied(scene: ScenePayload): Set<string> {
  const cells = new Set<string>();
  for (const building of Object.values(scene.buildings ?? {})) {
    // 只把地面层（elevation 0/未标注）算作占用：高架带不占地面。
    const elevation = (building as { conveyor?: { elevation?: number } }).conveyor?.elevation ?? 0;
    if (elevation > 0) continue;
    cells.add(`${building.position.x}:${building.position.y}`);
  }
  for (const unit of Object.values(scene.units ?? {})) cells.add(`${unit.position.x}:${unit.position.y}`);
  for (const resource of scene.resources ?? []) cells.add(`${resource.position.x}:${resource.position.y}`);
  return cells;
}

/**
 * 挑一条可铺的竖直走廊：同一列 x、从 y0 到 y0+SPAN-1 全是可建、可见、无占用的空格，
 * 且落在机甲作业半径内（服务端 requireBuildRange；地面带由机甲施工）。
 * 返回地面带 3 格（走廊中间）与整条高架带路径（北 → 南）。
 */
function pickCorridor(scene: ScenePayload): { x: number; ground: Array<{ x: number; y: number }>; path: Array<{ x: number; y: number }> } {
  const executor = Object.values(scene.units ?? {}).find((unit) => unit.owner_id === 'p1' && unit.type === 'executor');
  if (!executor) throw new Error('战争服应预置 p1 执行体');
  const blocked = occupied(scene);
  const distance = (x: number, y: number) => Math.abs(x - executor.position.x) + Math.abs(y - executor.position.y);
  const free = (x: number, y: number) => (
    x >= 0 && y >= 0 && x < scene.map_width && y < scene.map_height
    && scene.terrain?.[y]?.[x] === 'buildable'
    && (!scene.visible || scene.visible[y]?.[x] === true)
    && !blocked.has(`${x}:${y}`)
    && distance(x, y) <= 18
  );
  // 并行 spec（planet-build-workflow 等）会抢机甲附近最近的空地：走廊必须离所有
  // 现成建筑 ≥3 格（Chebyshev），否则拖拽途中那一格可能已被别人建成风机，
  // 高架带会以「不能架在建筑上方」被本地预检拦下。
  const clearOfBuildings = (x: number, y: number) => Object.values(scene.buildings ?? {}).every((building) => (
    Math.max(Math.abs(building.position.x - x), Math.abs(building.position.y - y)) >= 3
  ));
  // 由近及远扫：优先机甲作业范围内、但仍离建筑群有一点余量的走廊。
  for (let radius = 2; radius <= 24; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = executor.position.x + dx;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const y0 = executor.position.y + dy;
        const path = Array.from({ length: SPAN }, (_, index) => ({ x, y: y0 + index }));
        if (!path.every((tile) => free(tile.x, tile.y) && clearOfBuildings(tile.x, tile.y))) continue;
        const groundStart = Math.floor((SPAN - GROUND_SPAN) / 2);
        return { x, ground: path.slice(groundStart, groundStart + GROUND_SPAN), path };
      }
    }
  }
  throw new Error('机甲作业范围内找不到一条干净的竖直走廊（可建/可见/无占用）');
}

test('高架带跨越地面带：PageUp 升层后真实鼠标拖拽，跨越格 elevation=1 且地面带保留', async ({ page, request }) => {
  test.setTimeout(180_000);
  const scene = await fetchScene();
  const corridor = pickCorridor(scene);

  // ① API 铺 3 格地面带（direction=south，首尾相接；服务端按 tick 结算）。
  for (const tile of corridor.ground) {
    const receipt = await sendBuild(request, tile, {});
    expect(receipt.accepted, `地面带 (${tile.x}, ${tile.y}) 应被受理：${JSON.stringify(receipt.results)}`).toBe(true);
  }
  await expect.poll(async () => {
    const live = await fetchScene();
    return corridor.ground.filter((tile) => Object.values(live.buildings ?? {}).some(
      (building) => building.type === BELT
        && building.position.x === tile.x && building.position.y === tile.y
        && ((building as { conveyor?: { elevation?: number } }).conveyor?.elevation ?? 0) === 0,
    )).length;
  }, { timeout: 60_000, intervals: [500, 1000] }).toBe(GROUND_SPAN);

  // ② UI：进传送带建造模式，PageUp 升到 1 层。
  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}?x=${corridor.x}&y=${corridor.path[Math.floor(SPAN / 2)].y}`);
  await waitPlanetThree(page);
  const tabs = page.locator('.planet-build-bar__category');
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
    if (await page.locator(`.planet-build-card[data-building-id="${BELT}"]`).isVisible().catch(() => false)) break;
  }
  await page.locator(`.planet-build-card[data-building-id="${BELT}"]`).click();
  await expect(page.locator('.planet-build-bar__hint')).toContainText('放置 传送带');
  await expect(page.locator('.planet-build-bar__elevation-label')).toHaveText('高度 0');
  await page.keyboard.press('PageUp');
  await expect(page.locator('.planet-build-bar__elevation-label')).toHaveText('高度 1');

  // ③ 真实鼠标沿竖直方向拖整条走廊（北 → 南）。
  //
  // 先把**走廊中点**聚焦到镜头中心并稍微拉远，让整条走廊同框；之后取投影只用
  // project()（不移动相机）——拖拽中途再 focus 会转世界，已算好的点会落在旧坐标系里，
  // 笔迹从中间断掉。
  const commands = captureCommandRequests(page);
  await page.evaluate((tile) => {
    window.__planetThree!.focus(tile);
    window.__planetThree!.zoom(0.7);
  }, corridor.path[Math.floor(SPAN / 2)]);
  await settleProjection(page, 500);
  const canvasBox = (await page.locator(THREE_CANVAS).boundingBox())!;
  const centerBefore = await page.evaluate(() => window.__planetThree!.getCenterTile());
  const pathPoints: Array<{ x: number; y: number }> = [];
  for (const tile of corridor.path) {
    // 用 project()（相对画布、**不移动相机**）：tileScreenPos 在格不可见时会先聚焦，
    // 中途聚焦会转世界，后面已算好的点全部落在旧坐标系里，笔迹会从中间断掉。
    const projected = await page.evaluate((target) => window.__planetThree!.project(target), tile);
    const point = projected?.visible
      ? { x: canvasBox.x + projected.x, y: canvasBox.y + projected.y }
      : null;
    expect(point, `走廊格 (${tile.x}, ${tile.y}) 应投在画布内`).not.toBeNull();
    expect(point!.x, `走廊格 (${tile.x}, ${tile.y}) 的投影 x 越界`).toBeGreaterThan(canvasBox.x + 4);
    expect(point!.x).toBeLessThan(canvasBox.x + canvasBox.width - 4);
    expect(point!.y, `走廊格 (${tile.x}, ${tile.y}) 的投影 y 越界`).toBeGreaterThan(canvasBox.y + 4);
    expect(point!.y).toBeLessThan(canvasBox.y + canvasBox.height - 4);
    pathPoints.push(point!);
  }
  expect(await page.evaluate(() => window.__planetThree!.getCenterTile()), '取投影期间相机不应移动').toEqual(centerBefore);
  // 按下前再确认一次投影稳定：并行 worker + 软渲染下相机可能还在补间，
  // 采样点若已过期，pointerdown 的起点格会偏移，整条笔迹随之错位。
  for (let attempt = 0; ; attempt += 1) {
    const picked = await page.evaluate(
      ([x, y]) => window.__planetThree!.pickAt(x, y),
      [pathPoints[0].x, pathPoints[0].y] as const,
    );
    if (picked && Math.round(picked.x) === corridor.path[0].x && Math.round(picked.y) === corridor.path[0].y) break;
    expect(attempt, `起点格投影不稳定（拾取到 ${JSON.stringify(picked)}，期望 ${JSON.stringify(corridor.path[0])}）`).toBeLessThan(3);
    await page.evaluate((tile) => {
      window.__planetThree!.focus(tile);
      window.__planetThree!.zoom(0.7);
    }, corridor.path[Math.floor(SPAN / 2)]);
    await settleProjection(page, 600);
    for (let index = 0; index < corridor.path.length; index += 1) {
      const projected = await page.evaluate((target) => window.__planetThree!.project(target), corridor.path[index]);
      expect(projected?.visible, `走廊格 (${corridor.path[index].x}, ${corridor.path[index].y}) 应投在画布内`).toBe(true);
      pathPoints[index] = { x: canvasBox.x + projected!.x, y: canvasBox.y + projected!.y };
    }
  }
  // 真实鼠标拖整条走廊：一次按下 → 逐格 move → 松手，松手即断言。
  // 浏览器会合并最后几次 pointermove，松手时 PlanetMapThree 会按 pointerup 坐标补齐笔迹
  // （R20-E 修复），所以这里不再逐格留拍、也不再补发缺格。
  await page.mouse.move(pathPoints[0].x, pathPoints[0].y);
  await page.mouse.down();
  await page.mouse.move(pathPoints.at(-1)!.x, pathPoints.at(-1)!.y, { steps: SPAN * 3 });
  await settleProjection(page);

  // 拖拽中：ghost 是场景内部状态（`beltDragPath` 是私有字段，测试接口不暴露），
  // 按契约「读不到就截图 + 断言命令」：截图留档，并断言**松开前不落库**
  // （预览只在松手时逐格下单——中途下发会先在旧高度上落一批带子）。
  await page.screenshot({ path: REPORT_DIR + '/belt-elevated-drag-mid.png' });
  expect(commands, '拖拽中不得下发 build 命令（ghost 只是预览）').toHaveLength(0);

  await page.mouse.up();
  await settleProjection(page, 1200);

  // ④ 命令：整条带每格一条 build，跨越地面带的格 elevation=1。
  // 契约口径：拖一条 ≥7 格的带（末格是松手点，个别环境下最后一次 move 被合并）。
  await expect.poll(
    () => buildCommandPlacements(commands, BELT).length,
    { timeout: 20_000, message: '高架带应逐格下发 build 命令（≥7 格）' },
  ).toBeGreaterThanOrEqual(SPAN - 1);
  for (const tile of corridor.ground) {
    expect(
      buildCommandPlacements(commands, BELT).some((placement) => (
        placement.position.x === tile.x && placement.position.y === tile.y
      )),
      `跨越地面带的格 (${tile.x}, ${tile.y}) 必须由拖拽下发`,
    ).toBe(true);
  }
  const placements = buildCommandPlacements(commands, BELT);
  const elevated = placements.filter((placement) => (placement.elevation ?? 0) === 1);
  expect(elevated.length, `整条高架带应逐格下发 elevation=1（实际 ${JSON.stringify(placements)}）`).toBeGreaterThanOrEqual(SPAN - 1);
  for (const tile of corridor.ground) {
    expect(
      elevated.some((placement) => placement.position.x === tile.x && placement.position.y === tile.y),
      `跨越地面带的格 (${tile.x}, ${tile.y}) 必须以 elevation=1 下发`,
    ).toBe(true);
  }

  // ⑤ 落成后：地面带与高架带都在（同一格两层）。
  await expect.poll(async () => {
    const live = await fetchScene();
    const belts = Object.values(live.buildings ?? {}).filter((building) => building.type === BELT);
    const has = (tile: { x: number; y: number }, elevation: number) => belts.some((building) => (
      building.position.x === tile.x && building.position.y === tile.y
      && ((building as { conveyor?: { elevation?: number } }).conveyor?.elevation ?? 0) === elevation
    ));
    return {
      ground: corridor.ground.every((tile) => has(tile, 0)),
      elevated: corridor.path.filter((tile) => has(tile, 1)).length,
    };
  }, { timeout: 150_000, intervals: [1000, 1500, 2000, 3000] }).toMatchObject({
    ground: true,
  });
  // 高架带是逐格施工的（执行体一次只推进有限个任务，并行规格还会排队），
  // 给足等待再断言落成数量。
  await expect.poll(async () => {
    const live = await fetchScene();
    return corridor.path.filter((tile) => Object.values(live.buildings).some((building) => (
      building.type === BELT && building.position.x === tile.x && building.position.y === tile.y
      && ((building as { conveyor?: { elevation?: number } }).conveyor?.elevation ?? 0) === 1
    ))).length;
  }, { timeout: 120_000, intervals: [1000, 1500, 2000, 3000] }).toBeGreaterThanOrEqual(SPAN - 1);
  const landed = await fetchScene();
  const elevatedLanded = corridor.path.filter((tile) => Object.values(landed.buildings).some((building) => (
    building.type === BELT && building.position.x === tile.x && building.position.y === tile.y
    && ((building as { conveyor?: { elevation?: number } }).conveyor?.elevation ?? 0) === 1
  ))).length;
  expect(elevatedLanded, '高架带应至少落成 7 格').toBeGreaterThanOrEqual(SPAN - 1);

  const finalScene = await fetchScene();
  const beltAt = (tile: { x: number; y: number }, elevation: number) => Object.values(finalScene.buildings).find((building) => (
    building.type === BELT && building.position.x === tile.x && building.position.y === tile.y
    && ((building as { conveyor?: { elevation?: number } }).conveyor?.elevation ?? 0) === elevation
  ));
  // 地面带没被替换（同一批 id 仍在，高架带是另外几条）。
  for (const tile of corridor.ground) {
    expect(beltAt(tile, 0), `地面带 (${tile.x}, ${tile.y}) 应保留`).toBeTruthy();
    expect(beltAt(tile, 1), `高架带 (${tile.x}, ${tile.y}) 应存在`).toBeTruthy();
  }
  // 画面：高架带与地面带同时可见（截图留档）。镜头对准跨越段并稍微拉远，
  // 让两层带子同框（贴地高度 < ~2.8 时相邻格会投到画布外，这里只拉远）。
  await page.evaluate((tile) => {
    window.__planetThree!.focus(tile);
    window.__planetThree!.zoom(0.6);
  }, corridor.ground[1]);
  await settleProjection(page, 800);
  await page.screenshot({ path: REPORT_DIR + '/belt-elevated-drag-after.png' });
  expect(await page.locator(THREE_CANVAS).isVisible()).toBe(true);
});
