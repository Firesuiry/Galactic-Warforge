// Run against an isolated config-war/map-war server (ports 19492 / 4182).
// Unlock highspeed_assembling, quantum_printing and basic_components in config.
// Builds all three tiers through public commands; never patches server state.
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const web = process.env.SW_ASSEMBLERS_WEB ?? 'http://127.0.0.1:4182';
const server = process.env.SW_ASSEMBLERS_SERVER ?? 'http://127.0.0.1:19492';
const evidence = process.env.SW_ASSEMBLERS_EVIDENCE ?? '/tmp/sw-assemblers-review';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], commands = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const headers = { authorization: 'Bearer key_player_1' };
const quantities = building => {
  const total = {};
  for (const inventory of [building.storage?.inventory, building.storage?.input_buffer, building.storage?.output_buffer]) {
    for (const [item, count] of Object.entries(inventory ?? {})) total[item] = (total[item] ?? 0) + count;
  }
  return total;
};
async function scene() {
  const response = await page.request.get(`${server}/world/planets/planet-1-1/scene?x=0&y=0&width=16&height=12`, { headers });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function command(command) {
  const request_id = `assemblers-${Date.now()}-${Math.random()}`;
  const response = await page.request.post(`${server}/commands`, { headers, data: { request_id, issuer_type: 'player', issuer_id: 'p1', commands: [command] } });
  expect(response.ok()).toBeTruthy();
  let result;
  await expect.poll(async () => {
    const snapshot = await page.request.get(`${server}/events/snapshot?event_types=command_result&limit=100`, { headers });
    result = (await snapshot.json()).events.find(event => event.payload.request_id === request_id);
    if (result && result.payload.code !== 'OK') throw new Error(JSON.stringify(result));
    return result?.payload.code;
  }, { timeout: 20000 }).toBe('OK');
  commands.push({ command, result });
}
try {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({ state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 })));
  await page.goto(`${web}/planet/planet-1-1?quality=balanced`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  for (let tier = 1; tier <= 3; tier++) {
    const tile = { x: tier + 3, y: 2 };
    const type = `assembling_machine_mk${tier}`;
    let building = Object.values((await scene()).buildings).find(b => b.position.x === tile.x && b.position.y === tile.y);
    if (!building) await command({ type: 'build', target: { layer: 'planet', planet_id: 'planet-1-1', position: tile }, payload: { building_type: type, recipe_id: 'gear' } });
    await expect.poll(async () => {
      building = Object.values((await scene()).buildings).find(b => b.position.x === tile.x && b.position.y === tile.y);
      return building?.runtime.state;
    }, { timeout: 60000 }).toBe('running');
    expect(building.type).toBe(type);
    expect(building.production.recipe_id).toBe('gear');
    const before = quantities(building).gear ?? 0;
    await command({ type: 'transfer_item', target: { layer: 'planet', planet_id: 'planet-1-1', entity_id: building.id }, payload: { building_id: building.id, item_id: 'iron_ingot', quantity: 2 } });
    await expect.poll(async () => {
      building = (await scene()).buildings[building.id];
      return quantities(building).gear ?? 0;
    }, { timeout: 30000 }).toBe(before + 2);
    expect(quantities(building).iron_ingot ?? 0).toBe(0);
    const point = await page.evaluate(tile => { window.__planetThree.focus(tile, true); return window.__planetThree.project(tile); }, tile);
    expect(point.visible).toBe(true);
    await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
    await page.waitForTimeout(1500);
    const dismiss = page.getByRole('button', { name: '全部忽略', exact: true });
    if (await dismiss.isVisible()) await dismiss.evaluate(button => button.click());
    await page.screenshot({ path: `${evidence}/assembler-mk${tier}.png`, fullPage: true });
    results.push({ tier, id: building.id, recipe: building.production.recipe_id, state: building.runtime.state, quantities: quantities(building), throughput: building.runtime.functions.production.throughput, energy_per_tick: building.runtime.params.energy_consume });
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__planetThree.focus({ x: 5, y: 2 }, true));
  await page.screenshot({ path: `${evidence}/assemblers-browser.png`, fullPage: true });
  expect(errors).toEqual([]);
  writeFileSync(`${evidence}/browser-results.json`, JSON.stringify({ results, commands, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
