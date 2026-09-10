import { expect, test, type Page } from '@playwright/test';

type SystemDebug = { projectPlanet(id: string): { x: number; y: number; visible: boolean } | null; focusPlanet(id: string): void };
const projection = (page: Page) => page.evaluate(() => (window as unknown as { __systemThree: SystemDebug }).__systemThree.projectPlanet('planet-1-1'));

async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
    state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
  })));
}

test('真实恒星系 3D 星体点击、镜头、行星往返与战术调兵入口', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page);
  await page.goto('/system/sys-1');
  const canvas = page.locator('.system-orbit__canvas canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.system-orbit__body')).not.toHaveCount(0);
  await expect(page.locator('.system-orbit__telemetry')).toContainText('暂无轨道观测数据');
  await page.locator('.system-orbit__body').first().click();
  await expect(page.locator('.system-orbit__selection')).toContainText('行星勘测');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __systemThree?: { selection?: unknown } }).__systemThree?.selection))).toBe(true);
  await page.getByRole('button', { name: '关闭星体详情', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __systemThree?: { selection?: unknown } }).__systemThree?.selection))).toBe(false);
  await page.waitForFunction(() => Boolean((window as unknown as { __systemThree?: SystemDebug }).__systemThree?.projectPlanet('planet-1-1')));
  await page.evaluate(() => (window as unknown as { __systemThree: SystemDebug }).__systemThree.focusPlanet('planet-1-1'));
  const point = (await projection(page))!;
  expect(point.visible).toBeTruthy();
  await canvas.click({ position: { x: point.x, y: point.y } });
  await expect(page.locator('.system-orbit__selection h2')).toHaveText('Planet-1-1');
  await page.getByRole('button', { name: '关闭星体详情', exact: true }).click();
  await page.getByRole('button', { name: '全系视角', exact: true }).click();
  const before = await projection(page);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .48, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .60, bounds.y + bounds.height * .58, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => projection(page)).not.toEqual(before);
  const beforeZoom = await projection(page);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => projection(page)).not.toEqual(beforeZoom);
  await page.getByRole('button', { name: '全系视角', exact: true }).click();
  await page.screenshot({ path: '/tmp/siliconworld-system-3d.png', fullPage: true });
  await page.locator('.system-orbit__body').filter({ hasText: 'Planet-1-1' }).click();
  await page.getByRole('link', { name: '进入行星', exact: true }).click();
  await expect(page.locator('.planet-three__surface canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: '恒星系 ↗', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: '平面战术与调兵', exact: true }).click();
  await expect(page).toHaveURL(/\/system\/sys-1\?view=2d/);
  await expect(page.getByRole('link', { name: '3D 恒星系', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '3D 恒星系', exact: true }).click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('390px 恒星系显示与星体卡、战术入口可操作', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await login(page); await page.goto('/system/sys-1');
  await expect(page.locator('.system-orbit__canvas canvas')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: '/tmp/siliconworld-system-mobile.png', fullPage: true });
  await page.locator('.system-orbit__body').first().click();
  await expect(page.getByRole('link', { name: '进入行星', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭星体详情', exact: true }).click();
  await page.getByRole('link', { name: '平面战术与调兵', exact: true }).click();
  await page.getByRole('link', { name: '3D 恒星系', exact: true }).click();
  await expect(page.locator('.system-orbit__canvas canvas')).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('FIXTURE 戴森响应新增与清空会同步节点、框架、球壳', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let populated = true;
  await page.route('**/world/systems/sys-1/runtime', async route => {
    const response = await route.fetch();
    const runtime = await response.json();
    runtime.available = true; // Explicit available-runtime fixture; the real war server reports unavailable.
    runtime.dyson_sphere = { system_id: 'sys-1', player_id: 'p1', total_energy: populated ? 200 : 0, layers: populated ? [{
      layer_index: 0, orbit_radius: .2, energy_output: 200,
      nodes: [{ id: 'fixture-a', latitude: 0, longitude: 0, built: true }, { id: 'fixture-b', latitude: 25, longitude: 60, built: true }],
      frames: [{ id: 'fixture-frame', node_a_id: 'fixture-a', node_b_id: 'fixture-b', built: true }],
      shells: [{ id: 'fixture-shell', latitude_min: -20, latitude_max: 35, coverage: .4, built: true }],
    }] : [] };
    await route.fulfill({ response, json: runtime });
  });
  await login(page); await page.goto('/system/sys-1');
  await expect(page.locator('.system-orbit__canvas canvas')).toBeVisible({ timeout: 30_000 });
  const objects = () => page.evaluate(() => {
    const renderer = (window as unknown as { __systemThree?: { megastructure: { children: { name: string; count?: number }[] } } }).__systemThree;
    return renderer?.megastructure.children.map(child => ({ name: child.name, count: child.count })) ?? [];
  });
  await expect.poll(objects).toEqual(expect.arrayContaining([
    { name: 'built-dyson-nodes', count: 2 },
    { name: 'built-dyson-frames', count: undefined },
    { name: 'dyson-shell-fixture-shell', count: 1 },
  ]));
  await expect(page.locator('.system-orbit__telemetry')).toContainText('2 个节点 · 1 段框架');
  populated = false;
  await expect.poll(objects, { timeout: 15_000 }).toEqual([]);
  await expect(page.locator('.system-orbit__telemetry')).toContainText('0 个节点 · 0 段框架');
  expect(errors).toEqual([]);
});
