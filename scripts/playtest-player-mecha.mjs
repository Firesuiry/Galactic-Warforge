// Isolated war-map test: p1/p2 spawns at (3,3)/(6,3), 2 ticks/sec,
// mecha_core/mecha_engine/energy_shield unlocked, and 10 coal in p1 inventory.
// SW_MECHA_WEB=http://127.0.0.1:4177 node scripts/playtest-player-mecha.mjs
import { chromium, expect } from '../client-web/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const web = process.env.SW_MECHA_WEB ?? 'http://127.0.0.1:4177';
const evidence = process.env.SW_MECHA_EVIDENCE ?? '/tmp/sw-mecha-review';
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], results = {};
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const headers = { authorization: 'Bearer key_player_1' };
async function scene() {
  const r = await page.request.get(`${web}/world/planets/planet-1-1/scene?x=0&y=0&width=16&height=12`, { headers });
  expect(r.ok()).toBeTruthy(); return r.json();
}
async function clickTile(tile) {
  const point = await page.evaluate(tile => window.__planetThree.project(tile), tile);
  expect(point.visible).toBe(true);
  await page.locator('.planet-three__surface canvas').click({ position: { x: point.x, y: point.y } });
}
async function focus(tile) {
  await page.evaluate(tile => window.__planetThree.focus(tile, true), tile);
  await page.waitForTimeout(300);
}
async function commandResult(response) {
  expect(response.ok()).toBeTruthy();
  const accepted = await response.json(); expect(accepted.accepted).toBe(true);
  let event;
  await expect.poll(async () => {
    const r = await page.request.get(`${web}/events/snapshot?event_types=command_result&limit=100`, { headers });
    event = (await r.json()).events.find(e => e.payload.request_id === accepted.request_id);
    return event?.payload.code;
  }, { timeout: 15000 }).toBe('OK');
  return event;
}
async function uiCommand(action) {
  const response = page.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST');
  const [result] = await Promise.all([response, action()]); return commandResult(result);
}
try {
  await page.addInitScript(() => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({
    state: { serverUrl: location.origin, playerId: 'p1', playerKey: 'key_player_1' }, version: 0,
  })));
  await page.goto(`${web}/planet/planet-1-1?quality=balanced`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 60000 });
  let snapshot = await scene();
  const ownId = Object.values(snapshot.units).find(u => u.owner_id === 'p1' && u.type === 'executor').id;
  const enemyId = Object.values(snapshot.units).find(u => u.owner_id === 'p2' && u.type === 'executor').id;
  await expect.poll(async () => (await scene()).units[ownId].mecha.shield, { timeout: 20000 }).toBe(20);
  snapshot = await scene(); results.before = snapshot.units[ownId];
  expect(results.before.attack).toBe(20); expect(results.before.move_range).toBe(14);
  expect(results.before.mecha.max_energy).toBe(110);
  await focus(snapshot.units[ownId].position);
  await clickTile(snapshot.units[ownId].position);
  const bar = page.getByTestId('planet-selection-bar');
  await expect(bar).toContainText('玩家机甲');
  await bar.getByRole('button', { name: '攻击', exact: true }).click();
  await focus(snapshot.units[enemyId].position);
  results.attackCommand = await uiCommand(() => clickTile(snapshot.units[enemyId].position));
  const attacked = await scene();
  console.log('browser attack executed');
  results.afterAttack = attacked.units[ownId]; results.enemyAfterAttack = attacked.units[enemyId];
  expect(results.afterAttack.mecha.energy).toBe(results.before.mecha.energy - 8);
  expect(results.enemyAfterAttack.hp).toBe(snapshot.units[enemyId].hp);
  expect(results.enemyAfterAttack.mecha.shield).toBeLessThan(snapshot.units[enemyId].mecha.shield);
  await page.keyboard.press('Escape');
  await focus(attacked.units[ownId].position);
  await clickTile(attacked.units[ownId].position);
  await bar.getByRole('button', { name: '机甲详情', exact: true }).click();
  const core = page.getByRole('region', { name: '机甲核心', exact: true });
  await expect(core.getByRole('meter', { name: '核心能量', exact: true })).toHaveAttribute('value', String(results.afterAttack.mecha.energy));
  await core.getByRole('combobox', { name: '机甲燃料', exact: true }).selectOption('coal');
  results.refuelCommand = await uiCommand(() => core.getByRole('button', { name: '消耗 1 个燃料补能', exact: true }).click());
  console.log('browser refuel executed');
  results.afterRefuel = (await scene()).units[ownId];
  expect(results.afterRefuel.mecha.energy).toBeGreaterThan(results.afterAttack.mecha.energy);
  await expect(core.getByRole('meter', { name: '核心能量', exact: true })).toHaveAttribute('value', String(results.afterRefuel.mecha.energy));
  await page.screenshot({ path: `${evidence}/mecha-core.png`, fullPage: true });
  // Enemy retaliation enters through the same public API, never by editing HP.
  const retaliation = await page.request.post(`${web}/commands`, { headers: { authorization: 'Bearer key_player_2' }, data: {
    request_id: `mecha-retaliate-${Date.now()}`, issuer_type: 'player', issuer_id: 'p2', commands: [{ type: 'attack',
      target: { layer: 'planet', planet_id: 'planet-1-1', entity_id: enemyId }, payload: { target_entity_id: ownId },
    }],
  }});
  expect(retaliation.ok()).toBe(true);
  await expect.poll(async () => (await scene()).units[ownId].mecha.shield, { timeout: 10000 }).toBeLessThan(20);
  results.afterRetaliation = (await scene()).units[ownId];
  expect(results.afterRetaliation.hp).toBe(results.before.hp);
  await expect.poll(async () => Number(await core.getByRole('meter', { name: '能量护盾', exact: true }).getAttribute('value')), { timeout: 15000 }).toBeLessThan(20);
  await page.screenshot({ path: `${evidence}/mecha-shield-hit.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await bar.getByRole('button', { name: '移动', exact: true }).click();
  const destination = { x: 4, y: 2 };
  results.moveCommand = await uiCommand(() => clickTile(destination));
  console.log('browser move executed');
  results.afterMove = (await scene()).units[ownId];
  expect(results.afterMove.position.x).toBe(destination.x); expect(results.afterMove.position.y).toBe(destination.y);
  // Verify construction remains reachable with the player's powered core.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /风力涡轮机/ }).first().click();
  const buildTile = { x: 4, y: 4 };
  await focus(buildTile);
  results.buildCommand = await uiCommand(() => clickTile(buildTile));
  await expect.poll(async () => Object.values((await scene()).buildings).find(b => b.position.x === 4 && b.position.y === 4)?.runtime.state, { timeout: 60000 }).toBe('running');
  results.after = await scene();
  const events = await page.request.get(`${web}/events/snapshot?event_types=mecha_state_changed,damage_applied&limit=100`, { headers });
  results.events = (await events.json()).events;
  expect(results.events.some(e => e.event_type === 'mecha_state_changed' && e.payload.fuel_used === 1)).toBe(true);
  expect(results.events.some(e => e.event_type === 'damage_applied' && e.payload.shield_absorbed > 0)).toBe(true);
  expect(errors).toEqual([]);
  writeFileSync(`${evidence}/browser-results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ energyBefore: results.before.mecha.energy, energyAfterAttack: results.afterAttack.mecha.energy,
    energyAfterRefuel: results.afterRefuel.mecha.energy, shieldAfterHit: results.afterRetaliation.mecha.shield, destination, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
