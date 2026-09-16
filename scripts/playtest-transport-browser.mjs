// First run scripts/playtest-transport.ts against an isolated config-war/map-war server.
// SW_TRANSPORT_WEB=http://127.0.0.1:4179 node scripts/playtest-transport-browser.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const web = process.env.SW_TRANSPORT_WEB ?? 'http://127.0.0.1:4179';
const evidence = process.env.SW_TRANSPORT_EVIDENCE ?? '/tmp/sw-transport-fix';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const headers = { authorization: 'Bearer key_player_1' };
async function scene() {
  const response = await page.request.get(`${web}/world/planets/planet-1-1/scene?x=0&y=0&width=24&height=12`, { headers });
  expect(response.ok()).toBe(true); return response.json();
}
const at = (s, x, y) => Object.values(s.buildings).find(b => b.position.x === x && b.position.y === y);
function measure(s) {
  const depot = at(s, 13, 3);
  return { tick: s.tick, sequence: at(s, 9, 0).sorter.last_transfer?.sequence ?? 0,
    ironIngots: ['inventory', 'input_buffer', 'output_buffer'].reduce((n, k) => n + (depot.storage?.[k]?.iron_ingot ?? 0), 0) };
}
try {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({ state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 })));
  await page.goto(`${web}/planet/planet-1-1?quality=balanced`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  await page.evaluate(() => { window.__planetThree.focus({ x: 8, y: 1 }, false); window.__planetThree.zoom(.85); window.__planetThree.setTilt(.35); });
  await page.waitForTimeout(1000);
  const initial = await scene(), before = measure(initial), sorterId = at(initial, 9, 0).id;
  await page.evaluate(id => {
    const renderer = window.__planetThree;
    window.transportFrames = [];
    window.transportSample = setInterval(() => {
      const model = renderer.staticEntities.get(`building:${id}`)?.group;
      const arm = model?.getObjectByName('sorter-arm');
      if (!arm) return;
      window.transportFrames.push({ sequence: arm.userData.transfer?.sequence ?? 0,
        shoulder: model.getObjectByName('sorter-shoulder').rotation.z,
        yaw: arm.rotation.y, carrying: model.getObjectByName('sorter-payload').visible });
    }, 30);
  }, sorterId);
  await expect.poll(async () => measure(await scene()).ironIngots, { timeout: 60000 }).toBeGreaterThan(before.ironIngots);
  await page.waitForFunction(() => window.transportFrames.some(f => f.carrying), null, { timeout: 60000 });
  const after = measure(await scene()); expect(after.sequence).toBeGreaterThan(before.sequence);
  await page.screenshot({ path: `${evidence}/transport-line.png`, fullPage: true });
  // The same scene, closer to the sorter; record real animation frames without posing the arm.
  await page.evaluate(() => { window.__planetThree.focus({ x: 9, y: 0 }, true); window.__planetThree.zoom(1.5); window.__planetThree.setTilt(.55); });
  await page.waitForTimeout(500);
  for (const [name, carrying] of [['sorter-carrying', true], ['sorter-return', false]]) {
    await page.waitForFunction(({ id, carrying }) => {
      const model = window.__planetThree.staticEntities.get(`building:${id}`)?.group;
      return model?.getObjectByName('sorter-payload')?.visible === carrying;
    }, { id: sorterId, carrying }, { timeout: 60000, polling: 'raf' });
    await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  }
  const rendering = await page.evaluate(() => {
    clearInterval(window.transportSample);
    const renderer = window.__planetThree;
    return { frames: window.transportFrames, conveyorDraws: renderer.conveyors.group.children.length,
      resourceScales: [...renderer.staticEntities.entries()].filter(([key]) => key.startsWith('resource:')).map(([key, entry]) => ({ key, scale: entry.group.scale.toArray() })) };
  });
  expect(rendering.conveyorDraws).toBe(3);
  expect(new Set(rendering.frames.map(f => `${f.shoulder.toFixed(3)}:${f.yaw.toFixed(3)}`)).size).toBeGreaterThan(2);
  expect(rendering.frames.some(f => f.carrying)).toBe(true);
  expect(rendering.frames.some(f => !f.carrying)).toBe(true);
  // Ore on the sorter tile must be a ground deposit, not a full-height obstruction.
  const deposit = rendering.resourceScales.find(r => r.key.endsWith(':9:0'));
  expect(deposit).toBeDefined(); expect(deposit.scale[1] / deposit.scale[0]).toBeCloseTo(.1);
  async function clickTile(tile) {
    await page.evaluate(tile => window.__planetThree.focus(tile, true), tile);
    await page.waitForTimeout(300);
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
    }, { timeout: 15000 }).toBe('OK');
    return accepted.request_id;
  }
  const executor = Object.values((await scene()).units).find(u => u.owner_id === 'p1' && u.type === 'executor');
  await clickTile(executor.position);
  const selection = page.getByTestId('planet-selection-bar');
  await expect(selection).toContainText('玩家机甲');
  await selection.getByRole('button', { name: '移动', exact: true }).click();
  const moveRequest = await uiCommand(() => clickTile({ x: 14, y: 4 }));
  await expect.poll(async () => (await scene()).units[executor.id].position.x, { timeout: 15000 }).toBe(14);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /风力涡轮机/ }).first().click();
  const buildRequest = await uiCommand(() => clickTile({ x: 14, y: 3 }));
  await expect.poll(async () => at(await scene(), 14, 3)?.runtime.state, { timeout: 60000 }).toBe('running');
  await page.keyboard.press('Escape');
  await clickTile({ x: 8, y: 0 });
  await expect(selection).toContainText('传送带');
  expect(errors).toEqual([]);
  const result = { before, after, rendering, moveRequest, buildRequest, errors };
  writeFileSync(`${evidence}/browser-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ before, after, frames: rendering.frames.length, conveyorDraws: rendering.conveyorDraws, errors }, null, 2));
} catch (error) {
  const diagnostic = await page.evaluate(() => {
    const r = window.__planetThree;
    return { frames: window.transportFrames, tick: r?.data?.planet?.tick, runtimeTick: r?.data?.runtime?.tick,
      sorters: Object.values(r?.data?.planet?.buildings ?? {}).filter(b => b.sorter),
      models: [...(r?.staticEntities?.keys() ?? [])], hidden: document.hidden, frozen: r?.frozen };
  });
  writeFileSync(`${evidence}/failure.json`, JSON.stringify({ diagnostic, errors }, null, 2));
  await page.screenshot({ path: `${evidence}/failure.png` });
  throw error;
} finally { await browser.close(); }
