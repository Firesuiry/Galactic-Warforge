// 新局探针：dump 指令面板各页签结构 + scene API 关键信息
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const WEB = 'http://127.0.0.1:5678';
const SERVER = 'http://127.0.0.1:5677';
const OUT = '.run/video-playtest/probe-fresh';
fs.mkdirSync(OUT, { recursive: true });

// scene API
const scene = await (await fetch(`${SERVER}/world/planets/planet-1-1/scene?x=0&y=0&width=100&height=100`, {
  headers: { authorization: 'Bearer key_player_1' },
})).json();
console.log('map:', scene.map_width, 'x', scene.map_height);
console.log('units:', JSON.stringify(Object.values(scene.units ?? {}).map(u => ({ id: u.id, type: u.type, pos: u.position }))));
console.log('buildings:', JSON.stringify(Object.values(scene.buildings ?? {}).map(b => ({ id: b.id, type: b.type, pos: b.position }))));
console.log('resources near:', JSON.stringify((scene.resources ?? []).slice(0, 20)));
const summary = await (await fetch(`${SERVER}/state/summary`, { headers: { authorization: 'Bearer key_player_1' } })).json();
console.log('summary tick:', summary.tick, 'active:', summary.active_planet_id);
console.log('p1 resources:', JSON.stringify(summary.players?.p1?.resources));
console.log('p1 inventory:', JSON.stringify(summary.players?.p1?.inventory));
console.log('completed techs:', JSON.stringify(summary.players?.p1?.tech?.completed_techs));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`${WEB}/login`);
await page.addInitScript(() => {});
const inputs = page.locator('.login-form input');
await inputs.nth(1).fill('p1');
await inputs.nth(2).fill('key_player_1');
await page.locator('.login-form button[type="submit"]').click();
await page.waitForTimeout(2500);

await page.goto(`${WEB}/planet/planet-1-1`);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/10-planet-fresh.png` });

// dump 指令面板整体 HTML（截取关键部分）
const panelHtml = await page.locator('.planet-panel-stack').first().innerHTML().catch(() => 'NO PANEL');
fs.writeFileSync(`${OUT}/panel.html`, panelHtml);
console.log('panel html length:', panelHtml.length);

// 依次点击各页签并截图 + dump select/button
for (const tab of ['基础操作', '研究与装料', '战斗与制造', '物流', '跨星球', '戴森', '取消与恢复']) {
  const tabEl = page.getByRole('tab', { name: tab, exact: true });
  if (await tabEl.count() === 0) { console.log('tab missing:', tab); continue; }
  await tabEl.click();
  await page.waitForTimeout(800);
  const file = `${OUT}/tab-${tab}.png`;
  await page.screenshot({ path: file });
  const panel = page.locator('[role="tabpanel"], .planet-panel-stack').first();
  const html = await panel.innerHTML().catch(() => '');
  fs.writeFileSync(`${OUT}/tab-${tab}.html`, html);
  const selCount = await panel.locator('select').count();
  const btnTexts = await panel.locator('button:visible').allTextContents();
  console.log(`tab ${tab}: selects=${selCount} buttons=${JSON.stringify(btnTexts.slice(0, 20))}`);
}
await browser.close();
console.log('done');
