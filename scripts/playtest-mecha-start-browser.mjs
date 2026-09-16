// Runs on a fresh normal game: no inventory, technology or terrain injection.
// VITE_SW_PROXY_TARGET=http://127.0.0.1:19493 vite --port 4183
// node scripts/playtest-mecha-start-browser.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const web = process.env.SW_MECHA_START_WEB ?? 'http://127.0.0.1:4183';
const evidence = process.env.SW_MECHA_START_EVIDENCE ?? '/tmp/sw-mecha-start-review';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
page.setDefaultTimeout(60000);
const resume = process.env.SW_MECHA_START_RESUME === 'after-cancel';
const headers = { authorization: 'Bearer key_player_1' }, errors = [], results = resume ? JSON.parse(readFileSync(`${evidence}/browser-partial.json`, 'utf8')).results : {};
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function read(path) { const r = await page.request.get(`${web}${path}`, { headers }); expect(r.ok()).toBeTruthy(); return r.json(); }
const summary = () => read('/state/summary');
let ownId, home;
const unit = async () => (await read(`/world/planets/planet-1-1/inspect?entity_kind=unit&entity_id=${ownId}`)).unit;
const scene = () => read(`/world/planets/planet-1-1/scene?x=${home.x-18}&y=${home.y-18}&width=40&height=40`);
const stock = async id => (await summary()).players.p1.inventory?.[id] ?? 0;
async function commandResult(response) {
  expect(response.ok()).toBeTruthy(); const accepted = await response.json(); expect(accepted.accepted).toBe(true);
  let event; await expect.poll(async () => { event = (await read('/events/snapshot?event_types=command_result&limit=100')).events.find(e => e.payload.request_id === accepted.request_id); return event?.payload.code; }, { timeout: 15000 }).toBe('OK');
  return event;
}
async function uiCommand(action) { const response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST'); const [r] = await Promise.all([response, action()]); return commandResult(r); }
async function focus(tile) { await page.evaluate(tile => window.__planetThree.focus(tile, true), tile); await page.waitForTimeout(400); }
async function clickTile(tile) { await focus(tile); const point = await page.evaluate(tile => window.__planetThree.project(tile), tile); expect(point.visible).toBe(true); await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } }); }
const bar = page.getByTestId('planet-selection-bar');
const core = page.getByRole('region', { name: '机甲核心', exact: true });
async function details() { await page.keyboard.press('Escape'); await clickTile((await unit()).position); await bar.getByRole('button', { name: '机甲详情', exact: true }).click(); await expect(core).toBeVisible(); }
async function mine(resource, quantity) {
  await page.keyboard.press('Escape'); await clickTile(resource.position);
  await bar.getByLabel('采集数量').fill(String(quantity));
  const before = await stock(resource.kind);
  const event = await uiCommand(() => bar.getByRole('button', { name: '手动采集', exact: true }).click());
  await expect.poll(() => stock(resource.kind), { timeout: 30000 }).toBe(before + quantity);
  return event;
}
async function moveTo(destination, stopRange = 0) {
  let plan = await read(`/world/planets/planet-1-1/path?unit_id=${ownId}&target_x=${destination.x}&target_y=${destination.y}&stop_range=${stopRange}`);
  if (!plan.reachable) {
    const current = (await unit()).position, local = await scene();
    const distance = p => Math.abs(p.x-destination.x)+Math.abs(p.y-destination.y);
    const candidates = [];
    for(let y=current.y-5;y<=current.y+5;y++) for(let x=current.x-5;x<=current.x+5;x++) {
      const p={x,y};
      if(Math.abs(x-current.x)+Math.abs(y-current.y)<=5 && distance(p)<distance(current) && local.terrain[y-local.bounds.y]?.[x-local.bounds.x]==='buildable') candidates.push(p);
    }
    candidates.sort((a,b)=>distance(a)-distance(b));
    let reachable;
    for(const p of candidates) {
      const route=await read(`/world/planets/planet-1-1/path?unit_id=${ownId}&target_x=${p.x}&target_y=${p.y}`);
      if(route.reachable) {reachable=p;break;}
    }
    expect(reachable, 'a visible exploration step toward the resource').toBeTruthy();
    await moveTo(reachable);
    return moveTo(destination, stopRange);
  }
  for (const tile of plan.waypoints ?? []) {
    await page.keyboard.press('Escape'); await clickTile((await unit()).position);
    await bar.getByRole('button', { name: '移动', exact: true }).click();
    await uiCommand(() => clickTile(tile));
  }
  return plan;
}
async function build(type, label, tile) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: label }).first().click();
  const event = await uiCommand(() => clickTile(tile));
  await expect.poll(async () => Object.values((await scene()).buildings ?? {}).find(b => b.type === type && b.position.x === tile.x && b.position.y === tile.y)?.runtime.state, { timeout: 60000 }).toBe('running');
  return event;
}
try {
  if (!resume) results.initial = await summary(); ownId = results.initial.players.p1.executor.unit_id; home = (await unit()).position;
  expect(results.initial.players.p1.inventory ?? {}).toEqual({});
  expect(Object.keys(results.initial.players.p1.tech.completed_techs)).toEqual(['dyson_sphere_program']);
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({ state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 })));
  await page.goto(`${web}/planet/planet-1-1?quality=low`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  console.log('page loaded');
  if (!resume) {
  await details(); console.log('mecha details shown'); await expect(core).toContainText('背包原料不足');
  const local = await scene();
  const iron = local.resources.find(r => r.kind === 'iron_ore' && Math.abs(r.position.x-home.x)+Math.abs(r.position.y-home.y) <= 2);
  expect(iron).toBeTruthy();
  results.mineIron = await mine(iron, 3); console.log('mined 3 iron');
  results.afterIron = { unit: await unit(), inventory: (await summary()).players.p1.inventory };
  const coal = local.resources.filter(r => r.kind === 'coal').sort((a,b) => Math.abs(a.position.x-home.x)+Math.abs(a.position.y-home.y)-Math.abs(b.position.x-home.x)-Math.abs(b.position.y-home.y))[0];
  expect(coal).toBeTruthy(); results.coalPath = await moveTo(coal.position, 2);
  results.mineCoal = await mine(coal, 1); console.log('mined coal');
  await details(); results.beforeRefuel = await unit();
  await core.getByLabel('机甲燃料').selectOption('coal');
  results.refuel = await uiCommand(() => core.getByRole('button', { name: '消耗 1 个燃料补能', exact: true }).click());
  results.afterRefuel = await unit(); expect(results.afterRefuel.mecha.energy).toBeGreaterThan(results.beforeRefuel.mecha.energy); expect(await stock('coal')).toBe(0);
  results.returnPath = await moveTo(home); await details();
  // Start a two-batch job, then cancel while the first batch is unfinished.
  await core.getByLabel('个人制造配方').selectOption('smelt_iron'); await core.getByLabel('制造批数').fill('2');
  results.craftCancelled = await uiCommand(() => core.getByRole('button', { name: '开始制造', exact: true }).click());
  await expect.poll(async () => (await unit()).mecha.job?.kind).toBe('craft');
  expect(await stock('iron_ore')).toBe(1);
  results.cancel = await uiCommand(() => core.getByRole('button', { name: '取消机甲任务', exact: true }).click());
  }
  await expect.poll(async () => (await unit()).mecha.job).toBeUndefined();
  results.afterCancel = { unit: await unit(), inventory: (await summary()).players.p1.inventory };
  expect(await stock('iron_ore')).toBeGreaterThan(1);
  expect((await stock('iron_ore')) + (await stock('iron_ingot'))).toBe(3);
  console.log('craft cancellation refunded unfinished batches; completed outputs conserved');
  // Build real power generation and a tower on empty starting tiles.
  const tiles = (await scene()); const occupied = new Set([...Object.values(tiles.buildings ?? {}), ...Object.values(tiles.units ?? {}), ...(tiles.resources ?? [])].map(e => `${e.position.x},${e.position.y}`));
  const candidates = [];
  for(let y=home.y-2;y<=home.y+2;y++) for(let x=home.x-2;x<=home.x+2;x++) if(Math.abs(x-home.x)+Math.abs(y-home.y)<=3 && tiles.terrain[y-tiles.bounds.y]?.[x-tiles.bounds.x] === 'buildable' && !occupied.has(`${x},${y}`)) candidates.push({x,y});
  expect(candidates.length).toBeGreaterThan(1);
  results.wind = await build('wind_turbine', /风力涡轮机/, candidates[0]);
  results.beforeCharging = await unit();
  results.tower = await build('tesla_tower', /电力感应塔/, candidates[1]);
  await expect.poll(async () => (await unit()).mecha.energy, { timeout: 15000 }).toBeGreaterThan(results.beforeCharging.mecha.energy);
  results.chargingEvents = (await read('/events/snapshot?event_types=mecha_state_changed&limit=200')).events.filter(e => e.payload.grid_charge > 0);
  expect(results.chargingEvents.length).toBeGreaterThan(0); console.log('real network charged mecha');
  await details(); await core.getByLabel('个人制造配方').selectOption('smelt_iron'); await core.getByLabel('制造批数').fill('1');
  const ingotsBefore = await stock('iron_ingot'), oreBefore = await stock('iron_ore');
  results.craft = await uiCommand(() => core.getByRole('button', { name: '开始制造', exact: true }).click());
  await expect.poll(async () => Boolean((await unit()).mecha.job) || (await stock('iron_ingot')) > ingotsBefore).toBe(true);
  await page.screenshot({ path: `${evidence}/mecha-crafting.png`, fullPage: true });
  await expect.poll(() => stock('iron_ingot'), { timeout: 30000 }).toBe(ingotsBefore + 1); expect(await stock('iron_ore')).toBe(oreBefore - 1);
  await expect.poll(async () => (await unit()).mecha.job).toBeUndefined();
  results.final = { unit: await unit(), player: (await summary()).players.p1 };
  await expect(core).toContainText(`背包 ${oreBefore - 1}`, { timeout: 30000 });
  await page.screenshot({ path: `${evidence}/mecha-start-complete.png`, fullPage: true });
  expect(errors).toEqual([]);
  writeFileSync(`${evidence}/browser-results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ ironMined: 3, coalMined: 1, energyBeforeRefuel: results.beforeRefuel.mecha.energy, energyAfterRefuel: results.afterRefuel.mecha.energy, inventory: results.final.player.inventory, chargingEvents: results.chargingEvents.length, errors }, null, 2));
} catch(error) {
  writeFileSync(`${evidence}/browser-partial.json`, JSON.stringify({results,errors,error:String(error)},null,2));
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true }); throw error;
} finally { await browser.close(); }
