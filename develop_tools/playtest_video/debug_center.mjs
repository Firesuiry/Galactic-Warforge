// 验证 centerTile 环绕修复：先把相机拖到远方，再点回基地附近的 tile
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
await page.goto(`${WEB}/planet/planet-1-1`);
await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
await page.waitForTimeout(4000);

const surface = page.locator('.planet-map-canvas__surface');
const wrapMod = (v, s) => ((v % s) + s) % s;
async function readCamera() {
  const [ox, oy, ts] = await Promise.all([
    surface.getAttribute('data-camera-offset-x'),
    surface.getAttribute('data-camera-offset-y'),
    surface.getAttribute('data-tile-size'),
  ]);
  const box = await surface.boundingBox();
  return { offsetX: Number(ox), offsetY: Number(oy), tileSize: Number(ts), box };
}
function tileToScreen(cam, tile, mapW, mapH) {
  const canon = (t, off, mapTiles, vp) => (mapTiles * cam.tileSize > vp
    ? Math.floor(-off / cam.tileSize) + wrapMod(t - Math.floor(-off / cam.tileSize), mapTiles) : t);
  return {
    x: cam.offsetX + (canon(tile.x, cam.offsetX, mapW, cam.box.width) + 0.5) * cam.tileSize,
    y: cam.offsetY + (canon(tile.y, cam.offsetY, mapH, cam.box.height) + 0.5) * cam.tileSize,
  };
}
async function dragCamera(ax, ay, bx, by) {
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}
async function hoverTile() {
  const text = await page.locator('.planet-map-canvas__status').textContent().catch(() => '');
  const m = /Hover\s*\((-?\d+),\s*(-?\d+)\)/.exec(text ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
async function centerTile(tile, mapW = 2000, mapH = 2000) {
  for (let i = 0; i < 8; i++) {
    const cam = await readCamera();
    const p = tileToScreen(cam, tile, mapW, mapH);
    const safeL = 60, safeT = 60;
    const safeR = Math.max(cam.box.width - 470, cam.box.width * 0.55);
    const safeB = Math.max(cam.box.height - 180, cam.box.height * 0.7);
    if (p.x > safeL && p.x < safeR && p.y > safeT && p.y < safeB) return { cam, p };
    const startX = Math.floor(-cam.offsetX / cam.tileSize);
    const startY = Math.floor(-cam.offsetY / cam.tileSize);
    const safeCx = (safeL + safeR) / 2;
    const safeCy = (safeT + safeB) / 2;
    const wantStartX = tile.x - Math.floor(safeCx / cam.tileSize);
    const wantStartY = tile.y - Math.floor(safeCy / cam.tileSize);
    const needX = wrapMod(wantStartX - startX + mapW / 2, mapW) - mapW / 2;
    const needY = wrapMod(wantStartY - startY + mapH / 2, mapH) - mapH / 2;
    let dragX = Math.max(-550, Math.min(550, -needX * cam.tileSize));
    let dragY = Math.max(-550, Math.min(550, -needY * cam.tileSize));
    const ax = cam.box.x + cam.box.width / 2;
    const ay = cam.box.y + cam.box.height / 2;
    await dragCamera(ax, ay, ax + dragX, ay + dragY);
    console.log(`  iter${i}: start=(${startX},${startY}) need=(${needX},${needY})`);
  }
  const cam = await readCamera();
  const p = tileToScreen(cam, tile, mapW, mapH);
  return { cam, p: (p.x > 20 && p.x < cam.box.width - 20 && p.y > 20 && p.y < cam.box.height - 20) ? p : null };
}

// 1) 疯狂向右拖 5 次（模拟 wander 漂移）
const cam0 = await readCamera();
for (let i = 0; i < 5; i++) {
  await dragCamera(cam0.box.x + 500, cam0.box.y + 400, cam0.box.x + 100, cam0.box.y + 400);
}
const cam1 = await readCamera();
console.log('漂移后 offset:', cam1.offsetX, cam1.offsetY, 'start tile:', Math.floor(-cam1.offsetX / cam1.tileSize), Math.floor(-cam1.offsetY / cam1.tileSize));

// 2) centerTile 回基地 (3,3)
const { cam, p } = await centerTile({ x: 3, y: 3 });
console.log('centerTile 结果 p =', JSON.stringify(p));
if (p) {
  await page.mouse.move(cam.box.x + p.x, cam.box.y + p.y);
  await page.waitForTimeout(500);
  const h = await hoverTile();
  console.log('Hover =', JSON.stringify(h), h && h.x === 3 && h.y === 3 ? '✓ 命中' : '✗ 偏离');
}
await page.screenshot({ path: '.run/video-playtest/debug-center.png' });
await browser.close();
