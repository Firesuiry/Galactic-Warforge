// 调试：执行体移动链路（选中→移动按钮→点目标格→位置变化）
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';

const WEB = 'http://127.0.0.1:5678';
const SERVER = 'http://127.0.0.1:5677';
const PLANET_ID = 'planet-1-1';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript((serverUrl) => {
  window.localStorage.setItem(
    'siliconworld-client-web-session',
    JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
  );
}, WEB);
const page = await context.newPage();
await page.goto(`${WEB}/planet/${PLANET_ID}`);
await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
await page.waitForTimeout(4000);

const getPos = async () => {
  const scene = await (await fetch(`${SERVER}/world/planets/${PLANET_ID}/scene?x=0&y=0&width=60&height=60`, { headers: { authorization: 'Bearer key_player_1' } })).json();
  const ex = Object.values(scene.units ?? {}).find((u) => u.type === 'executor');
  return ex ? { x: ex.position.x, y: ex.position.y } : null;
};
const pos0 = await getPos();
console.log('执行体初始位置:', JSON.stringify(pos0));

// 相机换算（与测试一致）
const surface = page.locator('.planet-map-canvas__surface');
const wrapMod = (v, s) => ((v % s) + s) % s;
async function tileToScreen(tile) {
  const ox = Number(await surface.getAttribute('data-camera-offset-x'));
  const oy = Number(await surface.getAttribute('data-camera-offset-y'));
  const ts = Number(await surface.getAttribute('data-tile-size'));
  const box = await surface.boundingBox();
  const canon = (t, off, mapTiles, vp) => (mapTiles * ts > vp
    ? Math.floor(-off / ts) + wrapMod(t - Math.floor(-off / ts), mapTiles) : t);
  return {
    x: ox + (canon(tile.x, ox, 2000, box.width) + 0.5) * ts + box.x,
    y: oy + (canon(tile.y, oy, 2000, box.height) + 0.5) * ts + box.y,
  };
}
async function clickTile(tile) {
  const p = await tileToScreen(tile);
  console.log('  点击 tile', JSON.stringify(tile), '→ 屏幕', JSON.stringify(p));
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(600);
}

// 1) 点选执行体
await clickTile(pos0);
await page.screenshot({ path: '.run/video-playtest/debug-move-1-select.png' });
const moveBtn = page.getByRole('button', { name: '移动', exact: true }).first();
console.log('移动按钮 count:', await moveBtn.count());
const selText = await page.locator('.planet-map-canvas__status').textContent().catch(() => '');
console.log('状态栏:', selText?.slice(0, 120));

// 2) 进入移动模式并点目标
await moveBtn.click();
await page.waitForTimeout(600);
const dest = { x: pos0.x + 3, y: pos0.y + 2 };
await clickTile(dest);
await page.screenshot({ path: '.run/video-playtest/debug-move-2-dest.png' });

// 3) 轮询位置
for (let i = 0; i < 20; i++) {
  const p = await getPos();
  console.log('位置:', JSON.stringify(p));
  if (p.x === dest.x && p.y === dest.y) { console.log('移动成功!'); break; }
  await new Promise((r) => setTimeout(r, 3000));
}
await browser.close();
