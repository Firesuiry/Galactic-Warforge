// Requires an isolated war-map server with plasma_refining, xray_cracking and
// reformed_refinement unlocked, plus 2 crude oil, 3 refined oil, 3 hydrogen, 1 coal.
// SW_REFINERY_WEB=http://127.0.0.1:4176 node scripts/playtest-refinery.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const web = process.env.SW_REFINERY_WEB ?? 'http://127.0.0.1:4176';
const evidence = process.env.SW_REFINERY_EVIDENCE ?? '/tmp/sw-refinery-review';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const headers = { authorization: 'Bearer key_player_1' };
const quantities = building => {
  const totals = {};
  for (const inventory of [building.storage?.inventory, building.storage?.input_buffer, building.storage?.output_buffer]) {
    for (const [item, amount] of Object.entries(inventory ?? {})) totals[item] = (totals[item] ?? 0) + amount;
  }
  return totals;
};
async function scene() {
  const response = await page.request.get(`${web}/world/planets/planet-1-1/scene?x=0&y=0&width=24&height=12`, { headers });
  expect(response.ok()).toBeTruthy(); return response.json();
}
const cases = [
  { recipe: 'oil_fractionation', tile: { x: 5, y: 1 }, input: { crude_oil: 2 }, output: { refined_oil: 2, hydrogen: 1 } },
  { recipe: 'xray_cracking', tile: { x: 5, y: 0 }, input: { refined_oil: 1, hydrogen: 2 }, output: { hydrogen: 3, energetic_graphite: 1 } },
  { recipe: 'reformed_refinement', tile: { x: 6, y: 0 }, input: { refined_oil: 2, hydrogen: 1, coal: 1 }, output: { refined_oil: 3 } },
];
try {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
    state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
  })));
  await page.goto(`${web}/planet/planet-1-1?quality=balanced`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  // Add real generation to the starter grid; the base and military assembler
  // already consume all power from the two connected starter turbines.
  for (const tile of [{x:4,y:4},{x:5,y:4},{x:6,y:4}]) {
    let turbine = Object.values((await scene()).buildings).find(b=>b.position.x===tile.x && b.position.y===tile.y);
    if (!turbine) {
      const response = await page.request.post(`${web}/commands`, {headers, data:{
        request_id:`refinery-wind-${tile.x}-${Date.now()}`,issuer_type:'player',issuer_id:'p1',commands:[{
          type:'build',target:{layer:'planet',planet_id:'planet-1-1',position:tile},payload:{building_type:'wind_turbine'},
        }],
      }});
      expect(response.ok()).toBeTruthy();
    } else expect(turbine.type).toBe('wind_turbine');
    await expect.poll(async()=>Object.values((await scene()).buildings).find(b=>b.position.x===tile.x && b.position.y===tile.y)?.runtime.state,{timeout:45000}).toBe('running');
  }
  const results = [];
  for (const spec of cases) {
    const existing = Object.values((await scene()).buildings).find(b=>b.position.x===spec.tile.x && b.position.y===spec.tile.y);
    if (!existing) {
    await page.getByRole('button', { name: '生产规划', exact: true }).click();
    const planner = page.getByRole('region', { name: '生产规划' });
    await planner.getByRole('combobox', { name: '规划配方' }).selectOption(spec.recipe);
    await planner.getByRole('button', { name: '建造原油精炼厂', exact: true }).click();
    const point = await page.evaluate(tile => { window.__planetThree.focus(tile, true); return window.__planetThree.project(tile); }, spec.tile);
    expect(point.visible).toBe(true);
    await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
    } else {
      expect(existing.type).toBe('oil_refinery');
      expect(existing.production.recipe_id).toBe(spec.recipe);
    }
    let building;
    await expect.poll(async () => {
      building = Object.values((await scene()).buildings).find(b => b.position.x === spec.tile.x && b.position.y === spec.tile.y);
      return building?.runtime.state;
    }, { timeout: 45000 }).toBe('running');
    expect(building.production.recipe_id).toBe(spec.recipe);
    const alreadyProduced = Object.entries(spec.output).every(([item, quantity]) => quantities(building)[item] === quantity) && !building.production.remaining_ticks;
    for (const [item, quantity] of Object.entries(alreadyProduced ? {} : spec.input)) {
      const requestId = `refinery-${spec.recipe}-${item}-${Date.now()}`;
      const response = await page.request.post(`${web}/commands`, { headers, data: {
        request_id: requestId, issuer_type: 'player', issuer_id: 'p1', commands: [{ type: 'transfer_item',
          target: { layer: 'planet', planet_id: 'planet-1-1', entity_id: building.id },
          payload: { building_id: building.id, item_id: item, quantity },
        }],
      }});
      expect(response.ok()).toBeTruthy();
    }
    await expect.poll(async () => {
      building = (await scene()).buildings[building.id];
      const total = quantities(building);
      return Object.entries(spec.output).every(([item, quantity]) => total[item] === quantity) && !building.production.remaining_ticks;
    }, { timeout: 45000 }).toBe(true);
    results.push({ recipe: spec.recipe, id: building.id, state: building.runtime.state, quantities: quantities(building) });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '生产规划', exact: true }).click();
  await page.getByRole('region', { name: '生产规划' }).getByRole('combobox', { name: '规划配方' }).selectOption('xray_cracking');
  await page.evaluate(() => window.__planetThree.focus({ x: 5, y: 1 }, true));
  const dismiss = page.getByRole('button', { name: '全部忽略', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: `${evidence}/refinery-browser.png`, fullPage: true });
  expect(errors).toEqual([]);
  writeFileSync(`${evidence}/browser-results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
