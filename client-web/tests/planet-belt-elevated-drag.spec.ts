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
  // 由近及远扫：优先基地附近（施工快、镜头默认就在附近）。
  for (let radius = 2; radius <= 24; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = executor.position.x + dx;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const y0 = executor.position.y + dy;
        const path = Array.from({ length: SPAN }, (_, index) => ({ x, y: y0 + index }));
        if (!path.every((tile) => free(tile.x, tile.y))) continue;
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
  const commands = captureCommandRequests(page);
  const start = await focusTile(page, corridor.path[0]);
  await settleProjection(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const tile of corridor.path.slice(1)) {
    const point = await page.evaluate((target) => window.__planetThree!.tileScreenPos(target), tile);
    if (!point) continue;
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await settleProjection(page);

  // 拖拽中：ghost 是场景内部状态（`beltDragPath` 是私有字段，测试接口不暴露），
  // 按契约「读不到就截图 + 断言命令」：截图留档，并断言**松开前不落库**
  // （预览只在松手时逐格下单——中途下发会先在旧高度上落一批带子）。
  await page.screenshot({ path: '/tmp/playtest-1020-c1/belt-elevated-drag-mid.png' });
  expect(commands, '拖拽中不得下发 build 命令（ghost 只是预览）').toHaveLength(0);

  await page.mouse.up();
  await settleProjection(page, 800);

  // ④ 命令：整条带每格一条 build，跨越地面带的格 elevation=1。
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
  }, { timeout: 90_000, intervals: [1000, 1500, 2000] }).toEqual({
    ground: true,
    elevated: SPAN,
  });

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
  await page.screenshot({ path: '/tmp/playtest-1020-c1/belt-elevated-drag-after.png' });
  expect(await page.locator(THREE_CANVAS).isVisible()).toBe(true);
});
