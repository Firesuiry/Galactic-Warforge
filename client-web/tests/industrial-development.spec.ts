import { expect, test, type Page } from '@playwright/test';

const backend = process.env.SW_BACKEND_ENTRY ?? 'http://127.0.0.1:19481';
const planetId = 'planet-1-1';
type Tile = { x: number; y: number };
type Building = { id: string; type: string; owner_id: string; position: Tile; production?: { recipe_id?: string } };
type Scene = { buildings: Record<string, Building>; units: Record<string, Building>; resources: { position: Tile }[]; terrain: string[][]; visible: boolean[][] };
type DebugScene = { getQuality(): string; focus(tile: Tile, close?: boolean): void; project(tile: Tile): { x: number; y: number; visible: boolean } };

async function scene(): Promise<Scene> {
  const response = await fetch(`${backend}/world/planets/${planetId}/scene?x=0&y=0&width=48&height=48`, {
    headers: { authorization: 'Bearer key_player_1' },
  });
  expect(response.ok).toBeTruthy();
  return response.json();
}

async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
    state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
  })));
}

function buildSite(data: Scene): Tile {
  const executor = Object.values(data.units).find(unit => unit.owner_id === 'p1' && unit.type === 'executor')!;
  const occupied = [...Object.values(data.buildings), ...Object.values(data.units), ...data.resources];
  for (let radius = 1; radius <= 5; radius++) {
    for (let y = executor.position.y - radius; y <= executor.position.y + radius; y++) {
      for (let x = executor.position.x - radius; x <= executor.position.x + radius; x++) {
        if (Math.abs(x - executor.position.x) + Math.abs(y - executor.position.y) !== radius) continue;
        if (data.terrain[y]?.[x] === 'buildable' && data.visible[y]?.[x]
          && !occupied.some(entity => entity.position.x === x && entity.position.y === y)) return { x, y };
      }
    }
  }
  throw new Error('执行体附近无空闲建造位置');
}

test('真实产线配方规划可建造带配方的工厂，发展路线可进入工作流，画质可切换', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);
  await page.goto(`/planet/${planetId}?quality=low`);
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __planetThree?: DebugScene }).__planetThree?.getQuality));
  const quality = page.getByRole('combobox', { name: '画面质量' });
  for (const value of ['high', 'balanced', 'low']) {
    await quality.selectOption(value);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __planetThree: DebugScene }).__planetThree.getQuality())).toBe(value);
  }
  expect(await page.evaluate(() => localStorage.getItem('siliconworld-planet-quality'))).toBe('low');

  await page.getByRole('button', { name: '生产规划', exact: true }).click();
  const planner = page.getByRole('region', { name: '生产规划' });
  await expect(planner).toContainText('当前载入区域');
  await expect(planner.getByRole('button', { name: /定位建筑/ }).first()).toBeVisible();
  await planner.getByRole('button', { name: /定位建筑/ }).first().click();
  await expect(page.locator('#planet-detail-panel-selection')).toBeVisible();
  await page.getByRole('tab', { name: '生产', exact: true }).click();
  await planner.getByRole('combobox', { name: '规划配方' }).selectOption('electromagnetic_matrix');
  await planner.getByRole('spinbutton', { name: '生产批次' }).fill('10');
  await expect(planner.locator('.production-planner__recipe')).toContainText('投入 · 10 批');
  await expect(planner.locator('.production-planner__recipe')).toContainText('×10');
  const target = buildSite(await scene());
  await planner.getByRole('button', { name: '建造制造台 Mk.I', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消建造 · Esc' })).toBeVisible();
  // 并行规格会同服抢建同一空地：每次尝试重取场景重算建造点，直到 build 命令真正发出
  let response: import('@playwright/test').Response | null = null;
  let builtTarget = target;
  for (let attempt = 0; attempt < 5 && !response; attempt++) {
    builtTarget = buildSite(await scene());
    const point = await page.evaluate(tile => {
      const renderer = (window as unknown as { __planetThree: DebugScene }).__planetThree;
      renderer.focus(tile, true);
      return renderer.project(tile);
    }, builtTarget);
    expect(point.visible).toBe(true);
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().postDataJSON()?.commands?.[0]?.type === 'build', { timeout: 12_000 }).catch(() => null);
    await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
    response = await responsePromise;
  }
  expect(response, 'build command should be issued').toBeTruthy();
  expect(response!.ok()).toBe(true);
  expect(response!.request().postDataJSON().commands[0].payload).toMatchObject({ building_type: 'assembling_machine_mk1', recipe_id: 'electromagnetic_matrix' });
  await expect.poll(async () => Object.values((await scene()).buildings).some(building =>
    building.owner_id === 'p1' && building.position.x === builtTarget.x && building.position.y === builtTarget.y
    && building.production?.recipe_id === 'electromagnetic_matrix'), { timeout: 20_000 }).toBe(true);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '发展路线', exact: true }).click();
  const development = page.getByRole('region', { name: '工业发展导航' });
  await development.getByRole('tab', { name: /戴森能源/ }).click();
  await expect(development).toContainText('恒星能源');
  await development.locator('.colony-progression__action').click();
  await expect(page.locator('#planet-detail-panel-workbench')).toBeVisible();
  await expect(page).toHaveURL(/workflow=research/);
  await expect(page.getByRole('tab', { name: '研究与装料', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('390px 生产与发展入口可操作，配方检索和画质设置不溢出', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await page.goto(`/planet/${planetId}?quality=low`);
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '生产规划', exact: true }).click();
  const planner = page.getByRole('region', { name: '生产规划' });
  await planner.getByRole('textbox', { name: '搜索生产配方' }).fill('electromagnetic_matrix');
  await expect(planner.getByRole('combobox', { name: '规划配方' })).toHaveValue('electromagnetic_matrix');
  await page.getByRole('tab', { name: '发展', exact: true }).click();
  await expect(page.getByRole('region', { name: '工业发展导航' })).toBeVisible();
  await page.getByRole('tab', { name: /戴森能源/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: '/tmp/sw-dsp-review/development-mobile.png' });
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('combobox', { name: '画面质量' }).selectOption('balanced');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __planetThree: DebugScene }).__planetThree.getQuality())).toBe('balanced');
  await page.getByRole('button', { name: '平面战术', exact: true }).click();
  await expect(page.locator('.planet-map-canvas__surface')).toBeVisible();
  await page.getByRole('button', { name: '3D 星球', exact: true }).click();
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
