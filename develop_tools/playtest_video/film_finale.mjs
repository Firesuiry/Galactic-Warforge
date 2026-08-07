// 补镜录制：工厂运转特写 + 炮塔 + 终幕（复用录像环境的真实世界）
// 用法: PLAY_WEB=.. PLAY_SERVER=.. node film_finale.mjs --minutes 8 --out .run/video-playtest/final-closeup
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const TOTAL_SEC = argVal('minutes', 8) * 60;
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '.run/video-playtest/final-closeup';
const WEB = process.env.PLAY_WEB ?? 'http://127.0.0.1:5698';
const SERVER = process.env.PLAY_SERVER ?? 'http://127.0.0.1:5697';
const PLAYER_KEY = 'key_player_1';
const VIEWPORT = { width: 1600, height: 900 };

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(`${OUT}/videos`, { recursive: true });
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;
const logEvent = (kind, label) => {
  fs.appendFileSync(`${OUT}/events.jsonl`, JSON.stringify({ t: Math.round(elapsed() * 10) / 10, kind, label }) + '\n');
  console.log(`[ ${elapsed().toFixed(0)}s] ${kind}: ${label}`);
};
const api = async (p) => (await fetch(`${SERVER}${p}`, { headers: { authorization: `Bearer ${PLAYER_KEY}` } })).json();
const cmd = (commands) => fetch(`${SERVER}/commands`, {
  method: 'POST',
  headers: { authorization: `Bearer ${PLAYER_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ request_id: `closeup-${Date.now()}`, issuer_type: 'player', issuer_id: 'p1', commands }),
}).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: `${OUT}/videos/seg-00`, size: VIEWPORT },
  locale: 'zh-CN',
});
await context.addInitScript((serverUrl) => {
  window.localStorage.setItem('siliconworld-client-web-session',
    JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }));
}, WEB);
const page = await context.newPage();
logEvent('segment', '开始录像分段 0');

await page.goto(`${WEB}/planet/planet-1-1`);
await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
await sleep(4000);

// 缓慢平移+缩放镜头扫过枢纽产线（货流圆点/产出动画入镜）
const canvas = page.locator('.planet-map-canvas__surface');
const box = await canvas.boundingBox();
logEvent('action', '枢纽产线特写开始');
// 先放大两档（滚轮向上），再缓慢扫动
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -400); await sleep(900); }
const sweep = [
  [0.45, 0.45, 0.40, 0.42], [0.40, 0.42, 0.48, 0.38], [0.48, 0.38, 0.42, 0.50],
  [0.42, 0.50, 0.52, 0.44], [0.52, 0.44, 0.45, 0.45],
];
for (let i = 0; i < sweep.length && elapsed() < TOTAL_SEC * 0.5; i++) {
  const [x1, y1, x2, y2] = sweep[i];
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
  await page.mouse.down();
  for (let s = 0; s <= 10; s++) {
    await page.mouse.move(box.x + box.width * (x1 + (x2 - x1) * s / 10), box.y + box.height * (y1 + (y2 - y1) * s / 10));
    await sleep(120);
  }
  await page.mouse.up();
  await sleep(2200);
}
logEvent('milestone', '产线运转特写（货流圆点/装配产出）');

// API 补建高斯炮塔（科技已解锁），镜头给防区
const scene = await api('/world/planets/planet-1-1/scene?x=0&y=0&width=40&height=40');
const occupied = new Set(Object.values(scene.buildings ?? {}).map((b) => `${b.position.x}:${b.position.y}`));
let turretPos = null;
for (const [tx, ty] of [[13, 8], [13, 9], [12, 6], [13, 7], [14, 8], [12, 5]]) {
  if (!occupied.has(`${tx}:${ty}`) && scene.terrain?.[ty]?.[tx] === 'buildable') { turretPos = { x: tx, y: ty }; break; }
}
if (turretPos) {
  const r = await cmd([{ type: 'build', target: { position: { x: turretPos.x, y: turretPos.y, z: 0 } }, payload: { building_type: 'gauss_turret' } }]);
  logEvent('action', `建造 gauss_turret @(${turretPos.x},${turretPos.y}) → ${r?.results?.[0]?.status === 'accepted' ? '成功' : '受理'}`);
  await sleep(14000);
  logEvent('milestone', '高斯炮塔守卫基地');
} else {
  logEvent('warn', '炮塔选址无空格');
}
await sleep(3000);
logEvent('milestone', '基地全景');
// 终幕
await page.goto(`${WEB}/system/sys-1`);
await sleep(6000);
logEvent('visit', '终幕·恒星系');
await page.goto(`${WEB}/galaxy`);
await sleep(7000);
logEvent('visit', '终幕·银河');
logEvent('milestone', '试玩收官');
logEvent('segment', '结束录像分段 0');
await context.close();
await browser.close();
console.log('补镜完成');
