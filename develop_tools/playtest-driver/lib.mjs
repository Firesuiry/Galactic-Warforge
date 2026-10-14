// 试玩公共库：PT_OUT=本轮输出目录（截图、actions.log），P1V_WEB/P1V_SERVER 覆盖默认端口 4196/19630。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// chromium 的解析不依赖当前 worktree 是否有 node_modules：按候选路径逐个尝试，
// 都找不到才退回裸包名（worktree 里软链到主仓库时走第一条即可）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_CANDIDATES = [
  process.env.SW_PLAYWRIGHT_ENTRY,
  path.resolve(HERE, '../../client-web/node_modules/@playwright/test/index.mjs'),
  '/home/firesuiry/develop/siliconWorld/client-web/node_modules/@playwright/test/index.mjs',
].filter(Boolean);
let chromiumMod = null;
for (const candidate of PLAYWRIGHT_CANDIDATES) {
  if (!existsSync(candidate)) continue;
  chromiumMod = await import(candidate);
  break;
}
if (!chromiumMod) {
  chromiumMod = await import('@playwright/test');
}
export const { chromium } = chromiumMod;
export const WEB = process.env.P1V_WEB ?? 'http://127.0.0.1:4196';
export const SERVER = process.env.P1V_SERVER ?? 'http://127.0.0.1:19630';
export const OUT = (process.env.PT_OUT ?? (() => { throw new Error('需要设置 PT_OUT（本轮输出目录）'); })()).replace(/\/?$/, '/');
export const PLANET = 'planet-1-1';
const H = (n = 1) => ({ authorization: `Bearer key_player_${n}` });
export async function get(path, n = 1) { const r = await fetch(`${SERVER}${path}`, { headers: H(n) }); return r.json(); }
export async function scene(x = 0, y = 0, w = 288, h = 192, n = 1) { return get(`/world/planets/${PLANET}/scene?x=${x}&y=${y}&width=${w}&height=${h}`, n); }
export async function summary(n = 1) { return get('/state/summary', n); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function cmd(command, n = 1) {
  const request_id = `pt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const r = await fetch(`${SERVER}/commands`, { method: 'POST', headers: { ...H(n), 'content-type': 'application/json' }, body: JSON.stringify({ request_id, issuer_type: 'player', issuer_id: `p${n}`, commands: [command] }) });
  const t0 = (await (await fetch(`${SERVER}/health`)).json()).tick;
  if (!r.ok) return { code: `HTTP_${r.status}`, message: await r.text() };
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const e = await get(`/events/snapshot?event_types=command_result&since_tick=${t0 - 30}&limit=500`, n);
    const hit = (e.events ?? []).find((x) => x.payload?.request_id === request_id);
    if (hit) return hit.payload;
  }
  return { code: 'TIMEOUT' };
}
export const tgt = (x, y) => ({ layer: 'planet', planet_id: PLANET, position: { x, y } });
export const ent = (id) => ({ layer: 'planet', planet_id: PLANET, entity_id: id });
export async function launch(opts = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
  process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch {} });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, reducedMotion: process.env.P1V_MOTION ? 'no-preference' : 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ server }) => localStorage.setItem('siliconworld-client-web-session', JSON.stringify({ state: { serverUrl: server, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 })), { server: WEB });
  return { browser, page, errors };
}
export async function open3d(page, q = 'low', extra = '') {
  await page.goto(`${WEB}/planet/${PLANET}?quality=${q}&e2e=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__planetThree?.focus), null, { timeout: 90000 });
}
export const shot = (page, name) => page.screenshot({ timeout: 120000, path: name.startsWith("/") ? `${name}.png` : `${OUT}${name}.png` });
export async function tileAbs(page, tile) {
  const p = await tilePos(page, tile); const box = await page.locator('.planet-three__surface canvas').boundingBox();
  return { x: box.x + p.x, y: box.y + p.y, visible: p.visible };
}
export async function tilePos(page, tile) {
  return page.evaluate((t) => window.__planetThree.project(t), tile);
}
export async function clickTile(page, tile) {
  const p = await tilePos(page, tile);
  if (!p?.visible) throw new Error(`tile ${tile.x},${tile.y} 不可见`);
  const box = await page.locator('.planet-three__surface canvas').boundingBox();
  await page.mouse.click(box.x + p.x, box.y + p.y);
}
export async function card(page, id) { await page.locator(`.planet-build-card[data-building-id="${id}"]`).click(); }
export async function focus(page, tile, close = true) { await page.evaluate(([t, c]) => window.__planetThree.focus(t, c), [tile, close]); await sleep(800); }
export async function buildingsOf(owner = 'p1', type) {
  const s = await scene();
  return Object.values(s.buildings ?? {}).filter((b) => b.owner_id === owner && (!type || b.type === type));
}
export async function waitFor(fn, ms = 60000, step = 500) {
  const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null;
}
