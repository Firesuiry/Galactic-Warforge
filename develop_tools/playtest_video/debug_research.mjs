// 调试：研究面板 建筑 ID 下拉为何 selectOption 超时
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';

const WEB = 'http://127.0.0.1:5678';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript((serverUrl) => {
  window.localStorage.setItem(
    'siliconworld-client-web-session',
    JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
  );
}, WEB);
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`${WEB}/planet/planet-1-1`);
await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
await page.waitForTimeout(4000);

// 展开抽屉 + 工作台
const drawer = page.locator('aside.planet-drawer').first();
console.log('drawer count:', await drawer.count());
console.log('drawer class:', await drawer.getAttribute('class').catch(() => 'N/A'));
const handle = page.locator('.planet-drawer__handle').first();
console.log('handle count:', await handle.count());
const isOpen = await drawer.evaluate((el) => el.className.includes('--open')).catch(() => 'err');
console.log('drawer open?', isOpen);
if (!isOpen) { await handle.click(); await page.waitForTimeout(800); }
const wb = page.locator('#planet-detail-tab-workbench');
console.log('workbench tab count:', await wb.count());
await wb.click().catch((e) => console.log('wb click fail:', e.message.slice(0, 120)));
await page.waitForTimeout(600);

// 点击 研究与装料
const tab = page.getByRole('tab', { name: '研究与装料', exact: true }).first();
console.log('research tab count:', await tab.count());
await tab.click();
await page.waitForTimeout(1000);

const panel = page.locator('#planet-workflow-panel-research');
console.log('panel count:', await panel.count());
const buildingSelect = panel.locator('label:has-text("建筑 ID") select');
console.log('building select count:', await buildingSelect.count());
if (await buildingSelect.count()) {
  const opts = await buildingSelect.locator('option').evaluateAll((els) => els.map((e) => e.value));
  console.log('building options:', JSON.stringify(opts));
}
// 直接 dump 所有 select
const allSelects = await page.locator('select').evaluateAll((els) =>
  els.map((el) => ({ visible: el.offsetParent !== null, options: [...el.options].map((o) => o.value).slice(0, 6) })),
);
console.log('all selects:', JSON.stringify(allSelects));
await page.screenshot({ path: '.run/video-playtest/debug-research-panel.png' });
await browser.close();
