// run4b 产线收官（手工精确剧本，同一存档续玩）：
// 拆除闲置研究站回款 → 重建风机 → 储物仓接通分拣器 → 矿机解封复产
// → 电弧熔炉 → 高斯炮塔 → 量产单位 → 终幕巡游。全程分段录像。
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const WEB = 'http://127.0.0.1:5678';
const SERVER = 'http://127.0.0.1:5677';
const PLAYER_ID = 'p1';
const PLAYER_KEY = 'key_player_1';
const PLANET_ID = 'planet-1-1';
const OUT = '.run/video-playtest/session9';
const TOTAL_SEC = 45 * 60;
const SEG_SEC = 480;
fs.mkdirSync(`${OUT}/videos`, { recursive: true });
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, context, page, segIndex = -1, segStartAt = 0;

function logEvent(kind, label) {
  const rec = { t: Math.round(elapsed() * 10) / 10, kind, label };
  fs.appendFileSync(`${OUT}/events.jsonl`, JSON.stringify(rec) + '\n');
  console.log(`[${rec.t.toFixed(0).padStart(5)}s] ${kind}: ${label}`);
}
const shot = (name) => page?.screenshot({ path: `${OUT}/shots/${String(Math.round(elapsed())).padStart(5, '0')}-${name}.png` }).catch(() => {});

async function api(p) {
  const res = await fetch(`${SERVER}${p}`, { headers: { authorization: `Bearer ${PLAYER_KEY}` } });
  return res.json();
}
const getSummary = () => api('/state/summary');
const getScene = () => api(`/world/planets/${PLANET_ID}/scene?x=0&y=0&width=60&height=60`);
const minerals = async () => (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;

async function startSegment() {
  segIndex += 1;
  const dir = `${OUT}/videos/seg-${String(segIndex).padStart(2, '0')}`;
  fs.mkdirSync(dir, { recursive: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir, size: { width: 1600, height: 900 } }, locale: 'zh-CN' });
  await context.addInitScript((serverUrl) => {
    window.localStorage.setItem('siliconworld-client-web-session',
      JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }));
  }, WEB);
  page = await context.newPage();
  segStartAt = Date.now();
  logEvent('segment', `开始录像分段 ${segIndex}`);
  await page.goto(`${WEB}/planet/${PLANET_ID}`);
  await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
  await sleep(3000);
}
async function endSegment() {
  if (!context) return;
  const video = page ? page.video() : null;
  const vp = video ? await video.path().catch(() => null) : null;
  await context.close().catch(() => {});
  context = null; page = null;
  await sleep(1500);
  try {
    if (vp && fs.existsSync(vp)) fs.renameSync(vp, `${OUT}/videos/seg-${String(segIndex).padStart(2, '0')}.webm`);
    fs.rmSync(`${OUT}/videos/seg-${String(segIndex).padStart(2, '0')}`, { recursive: true, force: true });
  } catch {}
  logEvent('segment', `结束录像分段 ${segIndex}`);
}
async function rollIfNeeded() {
  if (browser && !browser.isConnected()) {
    logEvent('warn', '浏览器掉线，重启');
    browser = await chromium.launch({ headless: true });
    context = null; page = null; segStartAt = 0;
  }
  if (!context || (Date.now() - segStartAt) / 1000 > SEG_SEC) {
    await endSegment();
    await startSegment();
  }
}

// ---------- 相机 ----------
const wrapMod = (v, s) => ((v % s) + s) % s;
async function readCamera() {
  const surface = page.locator('.planet-map-canvas__surface');
  const [ox, oy, ts] = await Promise.all([
    surface.getAttribute('data-camera-offset-x'),
    surface.getAttribute('data-camera-offset-y'),
    surface.getAttribute('data-tile-size')]);
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
  await sleep(350);
}
async function hoverTile() {
  const text = await page.locator('.planet-map-canvas__status').textContent().catch(() => '');
  const m = /Hover\s*\((-?\d+),\s*(-?\d+)\)/.exec(text ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
async function centerTile(tile, mapW = 2000, mapH = 2000) {
  for (let i = 0; i < 8; i++) {
    const cam = await readCamera();
    if (!cam.box) throw new Error('画布不可见');
    const p = tileToScreen(cam, tile, mapW, mapH);
    const safeL = 60, safeT = 60;
    const safeR = Math.max(cam.box.width - 470, cam.box.width * 0.55);
    const safeB = Math.max(cam.box.height - 180, cam.box.height * 0.7);
    if (p.x > safeL && p.x < safeR && p.y > safeT && p.y < safeB) return { cam, p };
    const startX = Math.floor(-cam.offsetX / cam.tileSize);
    const startY = Math.floor(-cam.offsetY / cam.tileSize);
    const wantStartX = tile.x - Math.floor(((safeL + safeR) / 2) / cam.tileSize);
    const wantStartY = tile.y - Math.floor(((safeT + safeB) / 2) / cam.tileSize);
    const needX = wrapMod(wantStartX - startX + mapW / 2, mapW) - mapW / 2;
    const needY = wrapMod(wantStartY - startY + mapH / 2, mapH) - mapH / 2;
    let dragX = Math.max(-550, Math.min(550, -needX * cam.tileSize));
    let dragY = Math.max(-550, Math.min(550, -needY * cam.tileSize));
    const ax = cam.box.x + cam.box.width / 2;
    const ay = cam.box.y + cam.box.height / 2;
    await dragCamera(ax, ay, ax + dragX, ay + dragY);
  }
  const cam = await readCamera();
  const p = tileToScreen(cam, tile, mapW, mapH);
  const inView = p.x > 20 && p.x < cam.box.width - 20 && p.y > 20 && p.y < cam.box.height - 20;
  return { cam, p: inView ? p : null };
}
async function clickTile(tile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { cam, p } = await centerTile(tile);
    if (!p) { logEvent('warn', `tile (${tile.x},${tile.y}) 无法进入视野`); return false; }
    await page.mouse.move(cam.box.x + p.x, cam.box.y + p.y, { steps: 16 });
    await sleep(400);
    const h = await hoverTile();
    if (h && wrapMod(h.x - tile.x, 2000) === 0 && wrapMod(h.y - tile.y, 2000) === 0) {
      await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(400);
      return true;
    }
    logEvent('warn', `Hover 校验不符: 目标 (${tile.x},${tile.y}) 实际 ${h ? `(${h.x},${h.y})` : '无'}`);
    await sleep(400);
  }
  return false;
}

// ---------- 账本 ----------
async function showCommandLedger() {
  const drawer = page.locator('aside.planet-drawer').first();
  const isOpen = await drawer.evaluate((el) => el.className.includes('--open')).catch(() => false);
  if (!isOpen) { await page.locator('.planet-drawer__handle').first().click().catch(() => {}); await sleep(700); }
  const wb = page.locator('#planet-detail-tab-workbench');
  if ((await wb.count()) > 0) await wb.click().catch(() => {});
  await sleep(500);
}
async function lastCommandResult() {
  return (await page.locator('.planet-command-history li').first().textContent().catch(() => '')) || '';
}

// ---------- 建造 / 拆除 ----------
async function buildAt(buildingType, tile) {
  const card = page.locator(`.planet-build-card[data-building-id="${buildingType}"]`);
  if ((await card.count()) === 0) { logEvent('skip', `建造栏没有 ${buildingType}`); return false; }
  // 抽屉滑出时会遮住底部建造栏右半区，先把它收起来
  const drawer = page.locator('aside.planet-drawer').first();
  if (await drawer.evaluate((el) => el.className.includes('--open')).catch(() => false)) {
    await page.locator('.planet-drawer__handle').first().click().catch(() => {});
    await sleep(600);
  }
  await card.scrollIntoViewIfNeeded().catch(() => {});
  if (!(await card.isEnabled().catch(() => false))) {
    logEvent('warn', `${buildingType} 卡片不可用（资源不足）`);
    return false;
  }
  const before = await lastCommandResult();
  await card.click();
  await sleep(600);
  if (!(await clickTile(tile))) return false;
  await showCommandLedger();
  const start = Date.now();
  let result = before;
  while (Date.now() - start < 20000) {
    result = await lastCommandResult();
    if (result !== before && /成功|失败|超出|OUT_OF_RANGE|拒绝|错误/i.test(result)) break;
    await sleep(1000);
  }
  let ok = result !== before && /成功/.test(result) && !/失败|超出|OUT_OF_RANGE/i.test(result);
  if (!ok) {
    await sleep(4000);
    const scene = await getScene().catch(() => null);
    if (scene && Object.values(scene.buildings ?? {}).some((b) => b.type === buildingType
      && b.position.x === tile.x && b.position.y === tile.y)) ok = true;
  }
  logEvent(ok ? 'action' : 'warn', `建造 ${buildingType} @(${tile.x},${tile.y}) → ${ok ? '成功' : result.slice(0, 50)}`);
  await shot(`build-${buildingType}`);
  return ok;
}

async function demolishAt(pos, buildingType) {
  await clickTile(pos);
  await sleep(900);
  const btn = page.getByRole('button', { name: '拆除', exact: true }).first();
  if ((await btn.count()) === 0) { logEvent('warn', `(${pos.x},${pos.y}) 无拆除按钮`); return false; }
  await btn.click();
  await sleep(800);
  for (const name of ['确认拆除', '确认', '确定']) {
    const c = page.getByRole('button', { name, exact: true }).first();
    if (await c.count()) { await c.click().catch(() => {}); break; }
  }
  await sleep(1500);
  const scene = await getScene();
  const gone = !Object.values(scene.buildings ?? {}).some((b) => b.position.x === pos.x && b.position.y === pos.y);
  logEvent(gone ? 'action' : 'warn', `拆除 ${buildingType} @(${pos.x},${pos.y}) → ${gone ? '成功' : '未生效'}`);
  await shot(`demolish-${buildingType}`);
  return gone;
}

async function wander(sec, label) {
  const end = elapsed() + sec;
  let once = true;
  while (elapsed() < end) {
    if (elapsed() > TOTAL_SEC) return;
    await rollIfNeeded();
    try {
      const cam = await readCamera();
      if (!cam.box) break;
      const { box } = cam;
      const a = Math.floor(Math.random() * 4);
      if (a === 0) {
        await centerTile({ x: 3 + Math.floor(Math.random() * 4) - 2, y: 3 + Math.floor(Math.random() * 4) - 2 }).catch(() => {});
      } else if (a === 1) {
        await dragCamera(box.x + box.width / 2, box.y + box.height / 2,
          box.x + box.width / 2 + (Math.random() - 0.5) * box.width * 0.4,
          box.y + box.height / 2 + (Math.random() - 0.5) * box.height * 0.4);
      } else if (a === 2) {
        await page.mouse.move(box.x + box.width * (0.2 + Math.random() * 0.45), box.y + box.height * (0.2 + Math.random() * 0.5), { steps: 14 });
      } else {
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45);
        await page.mouse.down(); await sleep(60); await page.mouse.up();
      }
      if (once) { logEvent('beat', label); once = false; }
      await sleep(1800 + Math.random() * 2200);
    } catch { await sleep(2000); }
  }
}

async function waitMinerals(target, timeoutSec, label) {
  logEvent('wait', `${label ?? '等待矿产'} → ${target}`);
  const start = elapsed();
  while (elapsed() - start < timeoutSec) {
    if ((await minerals()) >= target) {
      logEvent('milestone', `矿产达到 ${target}`);
      await shot(`minerals-${target}`);
      return true;
    }
    await wander(12, label ?? '经济复苏中');
    if (elapsed() > TOTAL_SEC) return false;
  }
  logEvent('warn', `等待矿产 ${target} 超时`);
  return false;
}

async function produceUnit(buildingId, unitType) {
  await centerTile({ x: 3, y: 3 }).catch(() => {});
  await showCommandLedger();
  const tab = page.getByRole('tab', { name: '战斗与制造', exact: true }).first();
  await tab.click();
  await sleep(700);
  const panel = page.locator('.planet-panel-stack');
  try {
    await panel.locator('label:has-text("生产建筑") select').selectOption(buildingId, { timeout: 8000 });
    await panel.locator('label:has-text("单位类型") select').selectOption(unitType, { timeout: 8000 });
    await panel.getByRole('button', { name: '下达量产' }).click();
    await sleep(1500);
    logEvent('action', `量产 ${unitType} @ ${buildingId}`);
    await shot(`produce-${unitType}`);
    return true;
  } catch (e) { logEvent('warn', `量产失败: ${e.message.slice(0, 60)}`); return false; }
}

async function visitPage2(url, dwellSec, label) {
  await page.goto(`${WEB}${url}`);
  await sleep(2500);
  logEvent('visit', label);
  await shot(`visit-${label}`);
  const end = elapsed() + dwellSec;
  while (elapsed() < end) {
    await page.mouse.move(1600 * (0.3 + Math.random() * 0.4), 900 * (0.3 + Math.random() * 0.4), { steps: 16 });
    await sleep(2000);
  }
}

// ---------- 单位移动 ----------
async function moveUnit(unitPos, dest) {
  const dist = Math.abs(unitPos.x - dest.x) + Math.abs(unitPos.y - dest.y);
  if (dist > 4) { logEvent('warn', `移动距离 ${dist} > 4`); return false; }
  await clickTile(unitPos);
  await sleep(800);
  const moveBtn = page.getByRole('button', { name: '移动', exact: true }).first();
  if ((await moveBtn.count()) === 0) { logEvent('warn', '没有移动按钮'); return false; }
  await moveBtn.click();
  await sleep(600);
  if (!(await clickTile(dest))) return false;
  await sleep(600);
  logEvent('action', `移动单位 (${unitPos.x},${unitPos.y}) → (${dest.x},${dest.y})`);
  return true;
}
async function executorPos() {
  const s = await getScene();
  const ex = Object.values(s.units ?? {}).find((u) => u.type === 'executor');
  return ex ? { x: ex.position.x, y: ex.position.y } : null;
}
async function moveExecutorTo(target, arriveDist = 2) {
  for (let step = 0; step < 12; step++) {
    const pos = await executorPos();
    if (!pos) return false;
    if (Math.abs(pos.x - target.x) + Math.abs(pos.y - target.y) <= arriveDist) {
      logEvent('milestone', `执行体抵达 (${pos.x},${pos.y})`);
      return true;
    }
    let rem = 4, dx = 0, dy = 0;
    const dxT = target.x - pos.x, dyT = target.y - pos.y;
    if (Math.abs(dxT) >= Math.abs(dyT)) {
      dx = Math.sign(dxT) * Math.min(Math.abs(dxT), rem); rem -= Math.abs(dx);
      dy = Math.sign(dyT) * Math.min(Math.abs(dyT), rem);
    } else {
      dy = Math.sign(dyT) * Math.min(Math.abs(dyT), rem); rem -= Math.abs(dy);
      dx = Math.sign(dxT) * Math.min(Math.abs(dxT), rem);
    }
    const dest = { x: pos.x + dx, y: pos.y + dy };
    if (!(await moveUnit(pos, dest))) return false;
    // 等抵达
    const start = elapsed();
    let ok = false;
    while (elapsed() - start < 90) {
      const p2 = await executorPos();
      if (p2 && p2.x === dest.x && p2.y === dest.y) { ok = true; break; }
      await wander(8, '执行体机动中');
    }
    if (!ok) { logEvent('warn', '移动抵达超时'); return false; }
  }
  return false;
}

// ---------- 剧本 ----------
async function main() {
  browser = await chromium.launch({ headless: true });
  await startSegment();
  logEvent('milestone', '最终补拍：炮塔与巡游');

  // S1: 高斯炮塔（选一块可建空地：(4,4)，在风机旁保证供电）
  await waitMinerals(85, 300, '攒矿建炮塔');
  const ok = await buildAt('gauss_turret', { x: 4, y: 4 });
  if (!ok) await buildAt('gauss_turret', { x: 5, y: 4 });
  await wander(15, '炮塔防区观察');

  // S2: 慢节奏终幕（全景 + 细节）
  await rollIfNeeded();
  await wander(30, '基地全景');
  await visitPage2('/system/sys-1', 20, '终幕·恒星系');
  await visitPage2('/galaxy', 25, '终幕·银河');
  logEvent('milestone', '试玩收官');
  await endSegment();
  await browser.close();
  console.log('全部完成');
}


main().catch(async (e) => {
  console.error('致命错误:', e.message);
  logEvent('error', `致命错误: ${e.message}`);
  try { await endSegment(); } catch {}
  process.exit(1);
});
