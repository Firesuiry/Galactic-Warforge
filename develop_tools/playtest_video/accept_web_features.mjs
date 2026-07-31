// 验收 client-web 新控件：传送带方向按钮 + 配方下拉
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';

const WEB = 'http://127.0.0.1:5678';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript((serverUrl) => {
  window.localStorage.setItem('siliconworld-client-web-session',
    JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }));
}, WEB);
const page = await context.newPage();
await page.goto(`${WEB}/planet/planet-1-1`);
await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
await page.waitForTimeout(4000);
// 抽屉滑出会遮住建造栏右半区，先收起
const drawer = page.locator('aside.planet-drawer').first();
if (await drawer.evaluate((el) => el.className.includes('--open')).catch(() => false)) {
  await page.locator('.planet-drawer__handle').first().click().catch(() => {});
  await page.waitForTimeout(700);
}

// 1) 传送带卡片 → 方向按钮出现，点击循环
const beltCard = page.locator('.planet-build-card[data-building-id="conveyor_belt_mk1"]');
console.log('belt card count:', await beltCard.count());
await beltCard.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await beltCard.click();
await page.waitForTimeout(800);
const dirBtn = page.locator('.planet-build-bar__control');
console.log('方向按钮 count:', await dirBtn.count(), 'text:', await dirBtn.textContent().catch(() => ''));
await page.screenshot({ path: '.run/video-playtest/accept-belt-dir-1.png' });
await dirBtn.click();
await page.waitForTimeout(400);
console.log('切换后 text:', await dirBtn.textContent().catch(() => ''));
await page.keyboard.press('r');
await page.waitForTimeout(400);
console.log('按 R 后 text:', await dirBtn.textContent().catch(() => ''));
await page.screenshot({ path: '.run/video-playtest/accept-belt-dir-2.png' });
// 幽灵预览箭头（把鼠标移到画布中心）
const surface = page.locator('.planet-map-canvas__surface');
const box = await surface.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
await page.waitForTimeout(600);
await page.screenshot({ path: '.run/video-playtest/accept-belt-ghost.png' });
await page.keyboard.press('Escape');

// 2) matrix_lab 卡片 → 配方下拉
const labCard = page.locator('.planet-build-card[data-building-id="matrix_lab"]');
await labCard.click();
await page.waitForTimeout(800);
const recipeSel = page.locator('.planet-build-bar__select');
console.log('配方下拉 count:', await recipeSel.count());
if (await recipeSel.count()) {
  const opts = await recipeSel.locator('option').evaluateAll((els) => els.map((e) => `${e.value}:${e.textContent}`));
  console.log('配方选项:', JSON.stringify(opts));
  await page.screenshot({ path: '.run/video-playtest/accept-recipe.png' });
}
await browser.close();
console.log('DONE');
