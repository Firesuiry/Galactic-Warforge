// Isolated config: environment_modification + dyson_sphere_program, operate_range >= 12.
// Map seed war-seed-001, map-war surface: water at (0,9), empty land at (1,9).
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const web = process.env.SW_FOUNDATION_WEB ?? 'http://127.0.0.1:4181';
const evidence = process.env.SW_FOUNDATION_EVIDENCE ?? '/tmp/sw-foundation-review';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const headers = { authorization: 'Bearer key_player_1' }, errors = [], requests = [];
const pos = { x: 0, y: 9 };
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function scene() { const r = await page.request.get(`${web}/world/planets/planet-1-1/scene?x=0&y=0&width=16&height=12`, { headers }); expect(r.ok()).toBe(true); return r.json(); }
const at = (s, type) => Object.values(s.buildings).find(b => b.type === type && b.position.x === pos.x && b.position.y === pos.y);
async function clickTile(tile) {
  await page.evaluate(tile => window.__planetThree.focus(tile, true), tile);
  await page.waitForTimeout(400);
  const point = await page.evaluate(tile => window.__planetThree.project(tile), tile);
  expect(point.visible).toBe(true);
  await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
}
async function uiCommand(action) {
  const response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST');
  const [r] = await Promise.all([response, action()]); expect(r.ok()).toBe(true);
  const accepted = await r.json(); expect(accepted.accepted).toBe(true);
  await expect.poll(async () => {
    const events = await (await page.request.get(`${web}/events/snapshot?event_types=command_result&limit=100`, { headers })).json();
    return events.events.find(e => e.payload.request_id === accepted.request_id)?.payload.code;
  }, { timeout: 20000 }).toBe('OK');
  requests.push(accepted.request_id);
}
try {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({ state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 })));
  await page.goto(`${web}/planet/planet-1-1?quality=balanced`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  const initial = await scene(); expect(initial.terrain[pos.y][pos.x]).toBe('water');
  const executor = Object.values(initial.units).find(u => u.type === 'executor' && u.owner_id === 'p1');
  await clickTile(executor.position);
  const selection = page.getByTestId('planet-selection-bar');
  await expect(selection).toContainText('玩家机甲');
  await selection.getByRole('button', { name: '移动', exact: true }).click();
  await uiCommand(() => clickTile({ x: 3, y: 6 }));
  await expect.poll(async () => (await scene()).units[executor.id].position.y, { timeout: 20000 }).toBe(6);
  await page.waitForTimeout(1200);
  await clickTile({ x: 3, y: 6 });
  await selection.getByRole('button', { name: '移动', exact: true }).click();
  await uiCommand(() => clickTile({ x: 1, y: 9 }));
  await expect.poll(async () => (await scene()).units[executor.id].position.y, { timeout: 20000 }).toBe(9);
  await page.keyboard.press('Escape');
  await page.locator('[data-building-id="foundation"]').click();
  await uiCommand(() => clickTile(pos));
  await expect.poll(async () => (await scene()).terrain[pos.y][pos.x], { timeout: 60000 }).toBe('buildable');
  await page.keyboard.press('Escape'); await clickTile(pos);
  await expect(selection).toContainText('地基');
  await page.screenshot({ path: `${evidence}/foundation-filled.png`, fullPage: true });
  const foundation = at(await scene(), 'foundation'); expect(foundation.foundation_terrain).toEqual(['water']);
  await page.locator('[data-building-id="wind_turbine"]').click();
  await uiCommand(() => clickTile(pos));
  await expect.poll(async () => at(await scene(), 'wind_turbine')?.runtime.state, { timeout: 60000 }).toBe('running');
  await page.keyboard.press('Escape'); await clickTile(pos);
  await expect(selection).toContainText('风力涡轮机');
  await page.screenshot({ path: `${evidence}/foundation-turbine.png`, fullPage: true });
  await uiCommand(() => selection.getByRole('button', { name: '拆除', exact: true }).click());
  await expect.poll(async () => Boolean(at(await scene(), 'wind_turbine')), { timeout: 60000 }).toBe(false);
  expect((await scene()).terrain[pos.y][pos.x]).toBe('buildable');
  await clickTile(pos); await expect(selection).toContainText('地基');
  await uiCommand(() => selection.getByRole('button', { name: '拆除', exact: true }).click());
  await expect.poll(async () => (await scene()).terrain[pos.y][pos.x], { timeout: 60000 }).toBe('water');
  await page.screenshot({ path: `${evidence}/foundation-restored.png`, fullPage: true });
  expect(at(await scene(), 'foundation')).toBeUndefined(); expect(errors).toEqual([]);
  const result = { position: pos, original: 'water', filled: 'buildable', turbine_running: true, factory_demolition_preserves_ground: true, restored: 'water', requests, errors };
  writeFileSync(`${evidence}/browser-results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  writeFileSync(`${evidence}/failure.json`, JSON.stringify({ scene: await scene(), errors, text: await page.locator('body').innerText() }, null, 2));
  throw error;
} finally { await browser.close(); }
