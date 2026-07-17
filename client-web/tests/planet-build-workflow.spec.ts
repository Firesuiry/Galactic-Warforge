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
  buildings: Record<string, { position: ScenePosition }>;
  units: Record<string, {
    id: string;
    type: string;
    owner_id: string;
    position: ScenePosition;
  }>;
  resources: Array<{ position: ScenePosition }>;
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
  const buildCard = page.locator(`.planet-build-card[title^="${BUILDING_ID}"]`);
  await expect(buildCard).toBeVisible({ timeout: 30_000 });
  await buildCard.click();
  await expect(page.locator('.planet-build-bar__hint')).toContainText(`放置 ${BUILDING_ID}`);

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

  // 工作台出现该建造命令的受理回执，且最近结果列表记录为 build。
  await expect(page.locator('.command-result').first()).toContainText('建造 已受理', { timeout: 10_000 });
  await expect(page.locator('.planet-command-history').first()).toContainText('建造');
});
