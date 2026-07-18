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
  resources: Array<{ id?: string; position: ScenePosition }>;
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

  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}`);

  // 底部建造栏就绪后点选 wind_turbine 卡片，进入建造模式（幽灵预览提示出现）。
  const buildCard = page.locator(`.planet-build-card[data-building-id="${BUILDING_ID}"]`);
  await expect(buildCard).toBeVisible({ timeout: 30_000 });
  await buildCard.click();
  await expect(page.locator('.planet-build-bar__hint')).toContainText('放置 风力涡轮机');

  // 用 canvas 上的相机参数把 tile 坐标换算成元素内点击坐标。
  const surface = page.locator('.planet-map-canvas__surface');
  const offsetX = Number(await surface.getAttribute('data-camera-offset-x'));
  const offsetY = Number(await surface.getAttribute('data-camera-offset-y'));
  const tileSize = Number(await surface.getAttribute('data-tile-size'));
  expect(tileSize).toBeGreaterThan(0);

  await surface.click({
    position: {
      x: offsetX + (tile.x + 0.5) * tileSize,
      y: offsetY + (tile.y + 0.5) * tileSize,
    },
  });

  // 工作台最近结果记录该建造命令，且 authoritative 回写为成功（受理→回写有时序，不断言瞬态 pending 文案）。
  const firstEntry = page.locator('.planet-command-history li').first();
  await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
  await expect(firstEntry).toContainText('成功', { timeout: 10_000 });
});

test('采集建筑可直接放置在资源格上（前端不再本地拦截）', async ({ page }) => {
  const scene = await fetchAuthorized<ScenePayload>(
    `/world/planets/${PLANET_ID}/scene?x=0&y=0&width=48&height=48`,
  );

  // 挑一个可见、地形可建、无建筑占用的资源格（采矿机必须压资源点）。
  const occupiedByBuilding = new Set(
    Object.values(scene.buildings ?? {}).map(
      (building) => `${building.position.x}:${building.position.y}`,
    ),
  );
  const resourceTile = scene.resources.find((resource) => {
    const { x, y } = resource.position;
    if (scene.terrain?.[y]?.[x] !== 'buildable') {
      return false;
    }
    if (scene.visible && scene.visible[y]?.[x] !== true) {
      return false;
    }
    return !occupiedByBuilding.has(`${x}:${y}`);
  });
  if (!resourceTile) {
    throw new Error('战争服场景中应存在可放置采矿机的资源格');
  }

  await installSession(page);
  await page.goto(`/planet/${PLANET_ID}`);

  const buildCard = page.locator('.planet-build-card[data-building-id="mining_machine"]');
  await expect(buildCard).toBeVisible({ timeout: 30_000 });
  await buildCard.click();
  await expect(page.locator('.planet-build-bar__hint')).toContainText('放置 采矿机');

  const surface = page.locator('.planet-map-canvas__surface');
  const offsetX = Number(await surface.getAttribute('data-camera-offset-x'));
  const offsetY = Number(await surface.getAttribute('data-camera-offset-y'));
  const tileSize = Number(await surface.getAttribute('data-tile-size'));
  expect(tileSize).toBeGreaterThan(0);

  await surface.click({
    position: {
      x: offsetX + (resourceTile.position.x + 0.5) * tileSize,
      y: offsetY + (resourceTile.position.y + 0.5) * tileSize,
    },
  });

  // 命令直达服务端并回写成功；不再是 LOCAL_PREFLIGHT 的"被资源点占用"。
  const firstEntry = page.locator('.planet-command-history li').first();
  await expect(firstEntry).toContainText('建造', { timeout: 10_000 });
  await expect(firstEntry).toContainText('成功', { timeout: 10_000 });
  await expect(firstEntry).not.toContainText('被资源点占用');
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
  await page.goto(`/planet/${PLANET_ID}`);

  const surface = page.locator('.planet-map-canvas__surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });

  // 回家视角：32px/tile，基地落在视口内且不压在左上信息片区域（约 left 16..456 / top 16..150）。
  await expect
    .poll(async () => Number(await surface.getAttribute('data-tile-size')), { timeout: 10_000 })
    .toBe(32);
  const offsetX = Number(await surface.getAttribute('data-camera-offset-x'));
  const offsetY = Number(await surface.getAttribute('data-camera-offset-y'));
  const tileSize = Number(await surface.getAttribute('data-tile-size'));
  const surfaceBox = await surface.boundingBox();
  if (!surfaceBox) {
    throw new Error('交互面不可见');
  }
  const screenX = offsetX + (homeBuilding.position.x + 0.5) * tileSize;
  const screenY = offsetY + (homeBuilding.position.y + 0.5) * tileSize;
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
