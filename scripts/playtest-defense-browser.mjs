// Isolated map-war test with p1/p2 spawns (3,3)/(6,3), dyson_sphere_program and missile_turret unlocked, ammo_missile in p1 inventory.
// SW_DEFENSE_WEB=http://127.0.0.1:4180 node scripts/playtest-defense-browser.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const web = process.env.SW_DEFENSE_WEB ?? 'http://127.0.0.1:4180';
const server = process.env.SW_DEFENSE_SERVER ?? 'http://127.0.0.1:19490';
const evidence = process.env.SW_DEFENSE_EVIDENCE ?? '/tmp/sw-defense-fix'; mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const headers = { authorization: 'Bearer key_player_1' }; const errors = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function scene() { const r = await page.request.get(`${server}/world/planets/planet-1-1/scene?x=0&y=0&width=16&height=12`, { headers }); expect(r.ok()).toBeTruthy(); return r.json(); }
async function command(player, command) {
  const auth = { authorization: `Bearer key_player_${player}` }; const request_id = `defense-${Date.now()}-${Math.random()}`;
  const r = await page.request.post(`${server}/commands`, { headers: auth, data: { request_id, issuer_type: 'player', issuer_id: `p${player}`, commands: [command] } }); expect(r.ok()).toBeTruthy();
  let result; await expect.poll(async () => { const e = await page.request.get(`${server}/events/snapshot?event_types=command_result&limit=100`, { headers: auth }); result = (await e.json()).events.find(x => x.payload.request_id === request_id); return result?.payload.code; }, { timeout: 15000 }).toBe('OK');
}
try {
  await page.addInitScript(({server}) => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({ state: { serverUrl: server, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 })), { server: web });
  await page.goto(`${web}/planet/planet-1-1?quality=balanced`); await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  for (const [x, y, type] of [[4, 3, 'wind_turbine'], [4, 2, 'missile_turret']]) {
    await command(1, { type: 'build', target: { layer: 'planet', planet_id: 'planet-1-1', position: { x, y } }, payload: { building_type: type } });
    await expect.poll(async () => Object.values((await scene()).buildings).find(b => b.position.x === x && b.position.y === y)?.runtime.state, { timeout: 45000 }).toBe('running');
  }
  let current = await scene(); const turret = Object.values(current.buildings).find(b => b.position.x === 4 && b.position.y === 2); const enemy = Object.values(current.units).find(u => u.owner_id === 'p2' && u.type === 'executor');
  const before = (await scene()).units[enemy.id];
  await command(1, { type: 'transfer_item', target: { layer: 'planet', planet_id: 'planet-1-1', entity_id: turret.id }, payload: { building_id: turret.id, item_id: 'ammo_missile', quantity: 1 } });
  await expect.poll(async () => (await scene()).units[enemy.id]?.hp, { timeout: 50000 }).toBeLessThan(before.hp);
  current = await scene();
  await page.evaluate(tile => window.__planetThree.focus(tile, true), { x: 4, y: 2 }); await page.waitForTimeout(1000);
  await page.screenshot({ path: `${evidence}/turret-browser.png`, fullPage: true });
  const events = await (await page.request.get(`${server}/events/snapshot?event_types=damage_applied&limit=100`, { headers })).json();
  const result = { turret: turret.id, before_hp: before.hp, after_hp: current.units[enemy.id]?.hp, ammo: ['inventory', 'input_buffer', 'output_buffer'].reduce((n, key) => n + (current.buildings[turret.id]?.storage?.[key]?.ammo_missile ?? 0), 0), damage_events: events.events.filter(e => e.payload.attacker_id === turret.id), errors };
  expect(result.damage_events.length).toBeGreaterThan(0); expect(result.after_hp).toBeLessThan(result.before_hp); expect(result.ammo).toBe(0); expect(errors).toEqual([]); writeFileSync(`${evidence}/browser-results.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
