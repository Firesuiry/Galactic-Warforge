import { expect, test, type Page } from '@playwright/test';

const backend = process.env.SW_BACKEND_ENTRY ?? 'http://127.0.0.1:19481';
const planetId = 'planet-1-1';
type Tile = { x: number; y: number };
type Entity = { id: string; type: string; owner_id: string; position: Tile };
type Scene = {
  map_width: number; map_height: number; terrain: string[][]; visible?: boolean[][];
  buildings: Record<string, Entity>; units: Record<string, Entity>; resources: { position: Tile }[];
};
type ThreeDebug = {
  focus(tile: Tile, close?: boolean): void;
  project(tile: Tile): { x: number; y: number; visible: boolean };
  getCenterTile(): Tile;
};

async function scene(): Promise<Scene> {
  const response = await fetch(`${backend}/world/planets/${planetId}/scene?x=0&y=0&width=48&height=48`, {
    headers: { authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBeTruthy();
  return response.json();
}

function emptyTile(data: Scene, origin: Tile, exclude?: Tile): Tile {
  const occupied = [...Object.values(data.buildings), ...Object.values(data.units), ...data.resources]
    .map(entity => `${entity.position.x}:${entity.position.y}`);
  for (let distance = 1; distance <= 6; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      const dy = distance - Math.abs(dx);
      for (const offsetY of dy === 0 ? [0] : [-dy, dy]) {
        const tile = { x: origin.x + dx, y: origin.y + offsetY };
        if (exclude?.x === tile.x && exclude.y === tile.y) continue;
        if (data.terrain[tile.y]?.[tile.x] !== 'buildable') continue;
        if (data.visible && !data.visible[tile.y]?.[tile.x]) continue;
        if (!occupied.includes(`${tile.x}:${tile.y}`)) return tile;
      }
    }
  }
  throw new Error('执行体周围缺少可用空地');
}

async function project(page: Page, tile: Tile) {
  return page.evaluate(point => (window as unknown as { __planetThree: ThreeDebug }).__planetThree.project(point), tile);
}

async function clickTile(page: Page, tile: Tile) {
  await page.evaluate(point => (window as unknown as { __planetThree: ThreeDebug }).__planetThree.focus(point, true), tile);
  const position = await project(page, tile);
  expect(position.visible).toBeTruthy();
  await page.locator('.planet-three__surface canvas').click({ position: { x: position.x, y: position.y } });
}

/**
 * 3D 软渲染下单次点选偶尔被场景吞掉（pick 落空或被当成普通选中），
 * 且并行规格会同服抢建同一空地——每次尝试都重新取场景、重算目标格，
 * 直到目标类型的命令真正发出。返回 { response, tile }（实际命中的格子）。
 */
async function clickTileExpectingCommand(
  page: Page,
  pickTile: () => Promise<Tile>,
  commandType: string,
  attempts = 5,
): Promise<{ response: import('@playwright/test').Response; tile: Tile }> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tile = await pickTile();
    const responsePromise = page.waitForResponse(
      response => response.url().endsWith('/commands')
        && response.request().postDataJSON()?.commands?.[0]?.type === commandType,
      { timeout: 12_000 },
    ).catch(() => null);
    await clickTile(page, tile);
    const response = await responsePromise;
    if (response) return { response, tile };
  }
  throw new Error(`no ${commandType} command issued after ${attempts} tile click attempts`);
}

test('3D 星球可旋转缩放、查看建筑、真实建造和移动，并切换平面战术', async ({ page }) => {
  // Software WebGL needs extra time for MSAA renders and the two full-scene captures.
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') console.log('COMMAND REQUEST', request.url(), request.postData()); });
  page.on('response', async response => { if (response.request().method() === 'POST') console.log('COMMAND RESPONSE', response.status(), await response.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const initial = await scene();
  const executor = Object.values(initial.units).find(unit => unit.owner_id === 'p1' && unit.type === 'executor');
  const home = Object.values(initial.buildings).find(building => building.owner_id === 'p1');
  expect(executor).toBeDefined();
  expect(home).toBeDefined();
  await page.addInitScript(() => {
    localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
      state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
    }));
  });
  await page.goto(`/planet/${planetId}`);
  const canvas = page.locator('.planet-three__surface canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '3D 星球', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction(() => Boolean((window as unknown as { __planetThree?: ThreeDebug }).__planetThree?.project));
  await expect(page.locator('.planet-build-card[data-building-id="wind_turbine"]')).toBeVisible();

  // 真实鼠标拖动应改变星球中心地块；滚轮应改变附近地块的投影距离。
  await clickTile(page, home!.position);
  await expect(page.getByTestId('planet-selection-bar')).toBeVisible();
  await page.getByTestId('planet-selection-bar').getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.locator('#planet-detail-panel-selection')).toContainText(home!.id);
  const centerBefore = await page.evaluate(() => (window as unknown as { __planetThree: ThreeDebug }).__planetThree.getCenterTile());
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.62, { steps: 12 });
  await page.mouse.up();
  const centerAfter = await page.evaluate(() => (window as unknown as { __planetThree: ThreeDebug }).__planetThree.getCenterTile());
  expect(centerAfter).not.toEqual(centerBefore);
  await page.evaluate(point => (window as unknown as { __planetThree: ThreeDebug }).__planetThree.focus(point), home!.position);
  const neighbor = { x: home!.position.x + 1, y: home!.position.y };
  const beforeZoom = await project(page, neighbor);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -350);
  await expect.poll(async () => Math.abs((await project(page, neighbor)).x - beforeZoom.x)).toBeGreaterThan(1);

  await page.locator('.planet-build-card[data-building-id="wind_turbine"]').click();
  // 3D 软渲染下 React 状态传播慢，等建造模式真正激活再点地图，避免点选被当成普通选中
  await expect(page.getByText(/放置 风力涡轮机/)).toBeVisible();
  const { response: buildResponse, tile: buildTile } = await clickTileExpectingCommand(
    page,
    async () => emptyTile(await scene(), executor!.position),
    'build',
  );
  expect(buildResponse.ok()).toBeTruthy();
  expect(await buildResponse.json()).toMatchObject({ accepted: true, results: [{ status: 'accepted', code: 'OK' }] });
  expect(buildResponse.request().postDataJSON().commands[0]).toMatchObject({
    type: 'build', target: { position: { ...buildTile, z: 0 } }, payload: { building_type: 'wind_turbine' },
  });

  await expect.poll(async () => Object.values((await scene()).buildings).some(building =>
    building.type === 'wind_turbine' && building.position.x === buildTile.x && building.position.y === buildTile.y,
  ), { timeout: 20_000 }).toBe(true);
  await page.getByRole('tab', { name: '工作台', exact: true }).click();
  await expect(page.locator('.planet-command-history li').first()).toContainText('成功');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '取消建造 · Esc', exact: true })).toHaveCount(0);

  const afterBuild = await scene();
  const unit = afterBuild.units[executor!.id];
  await clickTile(page, unit.position);
  await expect(page.getByTestId('planet-selection-bar')).toContainText('玩家机甲', { timeout: 15_000 });
  await page.getByTestId('planet-selection-bar').getByRole('button', { name: '移动', exact: true }).click();
  // 等移动模式激活（按钮变为“取消移动”）再点目标格，避免慢渲染下的竞态
  await expect(page.getByTestId('planet-selection-bar').getByRole('button', { name: '取消移动', exact: true })).toBeVisible();
  const { response: moveResponse, tile: target } = await clickTileExpectingCommand(
    page,
    async () => {
      const fresh = await scene();
      return emptyTile(fresh, fresh.units[executor!.id]?.position ?? unit.position, buildTile);
    },
    'move',
  );
  console.log('AFTER MOVE CLICK', await page.locator('.planet-three__navigation').innerText());
  expect(moveResponse.ok()).toBeTruthy();
  expect(await moveResponse.json()).toMatchObject({ accepted: true, results: [{ status: 'accepted', code: 'OK' }] });
  expect(moveResponse.request().postDataJSON().commands[0]).toMatchObject({
    type: 'move', target: { entity_id: unit.id, position: { ...target, z: 0 } },
  });
  await expect.poll(async () => (await scene()).units[unit.id]?.position, { timeout: 20_000 }).toMatchObject(target);
  await page.getByRole('tab', { name: '工作台', exact: true }).click();
  await expect(page.locator('.planet-command-history li').first()).toContainText('成功');

  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '平面战术', exact: true }).click();
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '3D 星球', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '聚焦基地', exact: true }).click();
  await page.screenshot({ path: '/tmp/3d-quality-before.png', fullPage: true });
  await page.getByRole('button', { name: '全球视角', exact: true }).click();
  await page.screenshot({ path: '/tmp/siliconworld-3d.png', fullPage: true });
  expect(errors).toEqual([]);
});
