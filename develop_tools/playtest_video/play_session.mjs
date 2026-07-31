// SiliconWorld 真实试玩录像导演脚本
// 通过 Playwright 驱动真实 Web UI 玩游戏，全程分段录像 + 事件时间戳日志 + 里程碑截图。
// 用法: node play_session.mjs [--minutes 75] [--seg-sec 480] [--out .run/video-playtest/session]
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
}
const TOTAL_SEC = argVal('minutes', 75) * 60;
const SEG_SEC = argVal('seg-sec', 480);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '.run/video-playtest/session';
const START_OFFSET_SEC = argVal('start-offset', 0); // 续跑时的事件日志时间偏移

const WEB = 'http://127.0.0.1:5678';
const SERVER = 'http://127.0.0.1:5677';
const PLAYER_ID = 'p1';
const PLAYER_KEY = 'key_player_1';
const PLANET_ID = 'planet-1-1';
const VIEWPORT = { width: 1600, height: 900 };

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(`${OUT}/videos`, { recursive: true });
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

// ---------------- 基础状态 ----------------
const t0 = Date.now() - START_OFFSET_SEC * 1000;
let browser = null;
let context = null;
let page = null;
let segIndex = -1;
let segStartAt = 0;
let heartbeatTimer = null;
let currentPhase = 'init';

const elapsed = () => (Date.now() - t0) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logEvent(kind, label, extra = {}) {
  const rec = { t: Math.round(elapsed() * 10) / 10, kind, label, ...extra };
  fs.appendFileSync(`${OUT}/events.jsonl`, JSON.stringify(rec) + '\n');
  console.log(`[${rec.t.toFixed(0).padStart(5)}s] ${kind}: ${label}`);
}

function shot(name) {
  if (!page) return;
  const file = `${OUT}/shots/${String(Math.round(elapsed())).padStart(5, '0')}-${name}.png`;
  return page.screenshot({ path: file }).catch(() => {});
}

// ---------------- 服务端 API（仅用于决策与等待，不代替操作） ----------------
async function api(p) {
  const res = await fetch(`${SERVER}${p}`, { headers: { authorization: `Bearer ${PLAYER_KEY}` } });
  if (!res.ok) throw new Error(`API ${p} -> ${res.status}`);
  return res.json();
}
const getSummary = () => api('/state/summary');
const getScene = () => api(`/world/planets/${PLANET_ID}/scene?x=0&y=0&width=60&height=60`);
const getCatalog = () => api('/catalog');

// ---------------- 录像分段 ----------------
async function startSegment({ injectSession = true } = {}) {
  segIndex += 1;
  const dir = `${OUT}/videos/seg-${String(segIndex).padStart(2, '0')}`;
  fs.mkdirSync(dir, { recursive: true });
  context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir, size: VIEWPORT },
    locale: 'zh-CN',
  });
  if (injectSession) {
    await context.addInitScript((serverUrl) => {
      window.localStorage.setItem(
        'siliconworld-client-web-session',
        JSON.stringify({ state: { serverUrl, playerId: 'p1', playerKey: 'key_player_1' }, version: 0 }),
      );
    }, WEB);
  }
  page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  segStartAt = Date.now();
  logEvent('segment', `开始录像分段 ${segIndex}`);
}

async function endSegment() {
  if (!context) return;
  const dir = `${OUT}/videos/seg-${String(segIndex).padStart(2, '0')}`;
  const video = page ? page.video() : null;
  const videoPath = video ? await video.path().catch(() => null) : null;
  await context.close().catch(() => {});
  context = null;
  page = null;
  // 关闭后 webm 才写完；重命名为固定文件名
  await sleep(1500);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'));
    if (videoPath && files.length > 0) {
      const src = path.join(dir, path.basename(videoPath));
      if (fs.existsSync(src)) fs.renameSync(src, `${OUT}/videos/seg-${String(segIndex).padStart(2, '0')}.webm`);
    }
    fs.rmdirSync(dir, { recursive: true });
  } catch (e) { console.log('rename video failed:', e.message); }
  logEvent('segment', `结束录像分段 ${segIndex}`);
}

async function rollSegmentIfNeeded(force = false) {
  // 浏览器崩溃自愈：掉线就重启浏览器并强制滚段
  if (browser && !browser.isConnected()) {
    logEvent('warn', '浏览器掉线，正在重启');
    try { await browser.close().catch(() => {}); } catch {}
    browser = await chromium.launch({ headless: true });
    context = null;
    page = null;
    force = true;
  }
  if (!context || force || (Date.now() - segStartAt) / 1000 > SEG_SEC) {
    await endSegment();
    await startSegment({ injectSession: true });
    return true;
  }
  return false;
}

// 分段切换后恢复页面到行星页，并把相机拉回基地（页面按相机视野拉取 scene，
// 相机飘走会导致建筑下拉选项等数据过期）
async function ensureOnPlanet() {
  if (!page.url().includes(`/planet/${PLANET_ID}`)) {
    await page.goto(`${WEB}/planet/${PLANET_ID}`);
    await page.waitForTimeout(3500);
  }
  await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
  await centerTile(BASE_POS).catch(() => {});
  await sleep(2000);
}

// ---------------- 相机控制 ----------------
async function readCamera() {
  const surface = page.locator('.planet-map-canvas__surface');
  const [ox, oy, ts] = await Promise.all([
    surface.getAttribute('data-camera-offset-x'),
    surface.getAttribute('data-camera-offset-y'),
    surface.getAttribute('data-tile-size'),
  ]);
  const box = await surface.boundingBox();
  return { offsetX: Number(ox), offsetY: Number(oy), tileSize: Number(ts), box };
}

const wrapMod = (v, s) => ((v % s) + s) % s;
function canonAxis(t, offset, mapTiles, viewportPx, tileSize) {
  return mapTiles * tileSize > viewportPx
    ? Math.floor(-offset / tileSize) + wrapMod(t - Math.floor(-offset / tileSize), mapTiles)
    : t;
}
function tileToScreen(cam, tile, mapW, mapH) {
  const cx = canonAxis(tile.x, cam.offsetX, mapW, cam.box.width, cam.tileSize);
  const cy = canonAxis(tile.y, cam.offsetY, mapH, cam.box.height, cam.tileSize);
  return {
    x: cam.offsetX + (cx + 0.5) * cam.tileSize,
    y: cam.offsetY + (cy + 0.5) * cam.tileSize,
  };
}

async function smoothMouseMove(x, y, steps = 18) {
  await page.mouse.move(x, y, { steps });
}

// 平滑拖拽相机：从 (ax,ay) 拖到 (bx,by)
async function dragCamera(ax, ay, bx, by) {
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 24 });
  await page.mouse.up();
  await sleep(350);
}

// 把目标 tile 挪进视口安全区（避开左侧信息片、底部建造栏与右侧抽屉）。
// 关键：环绕地图上目标可能在“镜头后方”，必须按最短环绕方向拖相机，
// 否则正反馈漂移后点击会被钳到错误格子。
async function centerTile(tile, mapW = 2000, mapH = 2000) {
  for (let i = 0; i < 8; i++) {
    const cam = await readCamera();
    if (!cam.box) throw new Error('画布不可见');
    const p = tileToScreen(cam, tile, mapW, mapH);
    const safeL = 60;
    const safeT = 60;
    const safeR = Math.max(cam.box.width - 470, cam.box.width * 0.55);
    const safeB = Math.max(cam.box.height - 180, cam.box.height * 0.7);
    if (p.x > safeL && p.x < safeR && p.y > safeT && p.y < safeB) {
      return { cam, p };
    }
    // 相机起点 tile 与“目标落在安全区中心”所需起点的最短环绕差
    const startX = Math.floor(-cam.offsetX / cam.tileSize);
    const startY = Math.floor(-cam.offsetY / cam.tileSize);
    const safeCx = (safeL + safeR) / 2;
    const safeCy = (safeT + safeB) / 2;
    const wantStartX = tile.x - Math.floor(safeCx / cam.tileSize);
    const wantStartY = tile.y - Math.floor(safeCy / cam.tileSize);
    const needX = wrapMod(wantStartX - startX + mapW / 2, mapW) - mapW / 2;
    const needY = wrapMod(wantStartY - startY + mapH / 2, mapH) - mapH / 2;
    // 相机起点增加 need 格 = offset 减少 need*ts px = 拖拽 delta 为 -need*ts
    let dragX = -needX * cam.tileSize;
    let dragY = -needY * cam.tileSize;
    const maxDrag = Math.min(cam.box.width, cam.box.height) * 0.55;
    dragX = Math.max(-maxDrag, Math.min(maxDrag, dragX));
    dragY = Math.max(-maxDrag, Math.min(maxDrag, dragY));
    const ax = cam.box.x + cam.box.width / 2;
    const ay = cam.box.y + cam.box.height / 2;
    await dragCamera(ax, ay, ax + dragX, ay + dragY);
  }
  // 最后检查一次；仍不在视野内则返回 p=null，调用方不得硬点
  const cam = await readCamera();
  const p = tileToScreen(cam, tile, mapW, mapH);
  const inView = p.x > 20 && p.x < cam.box.width - 20 && p.y > 20 && p.y < cam.box.height - 20;
  return { cam, p: inView ? p : null };
}

// 读取状态栏 Hover 坐标（应用自己的 pointToTile 结果，作为地面真值）
async function hoverTile() {
  const text = await page.locator('.planet-map-canvas__status').textContent().catch(() => '');
  const m = /Hover\s*\((-?\d+),\s*(-?\d+)\)/.exec(text ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

async function clickTile(tile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { cam, p } = await centerTile(tile);
    if (!p) {
      logEvent('warn', `tile (${tile.x},${tile.y}) 无法进入视野，放弃点击`);
      return false;
    }
    await smoothMouseMove(cam.box.x + p.x, cam.box.y + p.y);
    await sleep(400);
    // 校验 Hover 坐标与目标一致（环绕等价），不一致说明换算仍有偏差，重对相机
    const h = await hoverTile();
    const match = h && wrapMod(h.x - tile.x, 2000) === 0 && wrapMod(h.y - tile.y, 2000) === 0;
    if (match) {
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();
      await sleep(400);
      return true;
    }
    logEvent('warn', `Hover 校验不符: 目标 (${tile.x},${tile.y}) 实际 ${h ? `(${h.x},${h.y})` : '无'}，重对相机 (第${attempt + 1}次)`);
    await sleep(500);
  }
  logEvent('warn', `tile (${tile.x},${tile.y}) Hover 校验连续失败，放弃点击`);
  return false;
}

async function zoom(delta, times = 1) {
  const cam = await readCamera();
  const cx = cam.box.x + cam.box.width / 2;
  const cy = cam.box.y + cam.box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, delta > 0 ? 240 : -240);
    await sleep(600);
  }
}
// 注意滚轮方向：deltaY>0 = 缩小，deltaY<0 = 放大
const zoomIn = (times = 1) => zoom(-1, times);
const zoomOut = (times = 1) => zoom(1, times);

// ---------------- 电网与资源保障 ----------------
async function powerStatus() {
  const nets = await api(`/world/planets/${PLANET_ID}/networks`);
  let supply = 0, demand = 0;
  for (const n of nets.power_networks ?? []) {
    if (n.owner_id !== PLAYER_ID) continue;
    supply += n.supply ?? 0;
    demand += n.demand ?? 0;
  }
  return { supply, demand, ok: supply >= demand };
}

// 在任意己方建筑的正交相邻格补风机（风机 line range=1，贴任意电网节点即可并网）
async function powerBoost(target = 1) {
  for (let i = 0; i < target; i++) {
    const scene = await getScene();
    const { executor, occupied } = analyzeScene(scene);
    if (!executor) return false;
    const ep = executor.position;
    let tile = null;
    outer: for (const b of Object.values(scene.buildings ?? {})) {
      if (b.owner_id !== PLAYER_ID) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = b.position.x + dx, y = b.position.y + dy;
        if (Math.abs(x - ep.x) + Math.abs(y - ep.y) > 6) continue;
        if (!isTileFree(scene, occupied, x, y)) continue;
        tile = { x, y };
        break outer;
      }
    }
    if (!tile) { logEvent('warn', '补电: 电网周边无空地'); return false; }
    if (!(await buildAt('wind_turbine', tile))) return false;
    await sleep(1000);
  }
  return true;
}

async function waitResources(minerals, timeoutSec = 300) {
  return waitFor(`矿产积累到 ${minerals}`, async () => {
    const s = await getSummary();
    return (s.players?.[PLAYER_ID]?.resources?.minerals ?? 0) >= minerals;
  }, { timeoutSec, beatSec: 15 });
}

// ---------------- 观察节拍（填时间 + 让画面有看头） ----------------
let BASE_POS = { x: 3, y: 3 }; // 主流程启动时从 scene 刷新

async function wander(sec, label = '观察基地') {
  const end = elapsed() + sec;
  let once = true;
  while (elapsed() < end) {
    if (elapsed() > TOTAL_SEC) return;
    if (await rollSegmentIfNeeded()) await ensureOnPlanet().catch(() => {});
    try {
      const cam = await readCamera();
      if (!cam.box) break;
      const { box } = cam;
      const action = Math.floor(Math.random() * 5);
      if (action === 0) {
        // 回家：把基地附近拉回视野，防止漫游丢目标
        await centerTile({ x: BASE_POS.x + Math.floor(Math.random() * 5) - 2,
                           y: BASE_POS.y + Math.floor(Math.random() * 5) - 2 }).catch(() => {});
      } else if (action === 1) {
        // 平滑平移一小段
        const dx = (Math.random() - 0.5) * box.width * 0.4;
        const dy = (Math.random() - 0.5) * box.height * 0.4;
        await dragCamera(
          box.x + box.width / 2, box.y + box.height / 2,
          box.x + box.width / 2 + dx, box.y + box.height / 2 + dy,
        );
      } else if (action === 2) {
        // 悬停到视口内随机位置（触发 tile 信息）
        await smoothMouseMove(
          box.x + box.width * (0.2 + Math.random() * 0.45),
          box.y + box.height * (0.2 + Math.random() * 0.5),
        );
      } else if (action === 3) {
        // 缩放保持在可读区间（16..48px/tile），防止漫游把相机拉丢
        const ts = cam.tileSize;
        if (ts <= 16) await zoomIn();
        else if (ts >= 48) await zoomOut();
        else if (Math.random() > 0.5) await zoomIn();
        else await zoomOut();
      } else {
        // 点选视口安全区中部，展示详情面板
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45);
        await page.mouse.down(); await sleep(60); await page.mouse.up();
        await sleep(600);
      }
      if (once) { logEvent('beat', label); once = false; }
      await sleep(1800 + Math.random() * 2200);
    } catch (e) {
      console.log('wander error:', e.message);
      await sleep(2000);
    }
  }
}

// ---------------- 游戏操作 ----------------
async function openWorkflowTab(name) {
  // 确保右侧工作台抽屉已滑出
  const drawer = page.locator('aside.planet-drawer').first();
  const isOpen = await drawer.evaluate((el) => el.className.includes('--open')).catch(() => false);
  if (!isOpen) {
    await page.locator('.planet-drawer__handle').first().click().catch(() => {});
    await sleep(700);
  }
  // 点选实体会把详情页签切到“选中对象”，先切回“工作台”
  const workbenchTab = page.locator('#planet-detail-tab-workbench');
  if ((await workbenchTab.count()) > 0) await workbenchTab.click().catch(() => {});
  await sleep(500);
  const tab = page.getByRole('tab', { name, exact: true }).first();
  await tab.click();
  await sleep(700);
}

// 展开右侧抽屉并切到“工作台”页签，使命令账本可见
async function showCommandLedger() {
  const drawer = page.locator('aside.planet-drawer').first();
  const isOpen = await drawer.evaluate((el) => el.className.includes('--open')).catch(() => false);
  if (!isOpen) {
    await page.locator('.planet-drawer__handle').first().click().catch(() => {});
    await sleep(700);
  }
  const workbenchTab = page.locator('#planet-detail-tab-workbench');
  if ((await workbenchTab.count()) > 0) await workbenchTab.click().catch(() => {});
  await sleep(500);
}

async function lastCommandResult() {
  const first = page.locator('.planet-command-history li').first();
  const text = await first.textContent().catch(() => '');
  return text || '';
}

async function waitCommandSettled(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await lastCommandResult();
    if (/成功|失败|超出|out of range|拒绝|错误|OK/i.test(text)) return text;
    await sleep(1000);
  }
  return lastCommandResult();
}

// 从 scene 找执行体与占用信息
function analyzeScene(scene) {
  const executor = Object.values(scene.units ?? {}).find((u) => u.owner_id === PLAYER_ID && u.type === 'executor');
  const occupied = new Set();
  for (const b of Object.values(scene.buildings ?? {})) occupied.add(`${b.position.x}:${b.position.y}`);
  for (const u of Object.values(scene.units ?? {})) occupied.add(`${u.position.x}:${u.position.y}`);
  const resourceAt = new Map();
  for (const r of scene.resources ?? []) resourceAt.set(`${r.position.x}:${r.position.y}`, r);
  return { executor, occupied, resourceAt };
}

function isTileFree(scene, occupied, x, y) {
  if (x < 0 || y < 0 || x >= scene.map_width || y >= scene.map_height) return false;
  if (scene.terrain?.[y]?.[x] !== 'buildable') return false;
  if (scene.visible && scene.visible[y]?.[x] !== true) return false;
  return !occupied.has(`${x}:${y}`);
}

// 在执行体操作范围内找空地。
// adjacentTo: 只取与该位置正交相邻的格子（电网 line range=1 需要）；
// near: 候选按到该位置的曼哈顿距离排序（默认按到执行体距离）。
function findBuildTile(scene, { range = 6, avoidResources = true, near = null, adjacentTo = null } = {}) {
  const { executor, occupied, resourceAt } = analyzeScene(scene);
  if (!executor) throw new Error('找不到执行体');
  const ep = executor.position;
  const candidates = [];
  for (let d = 0; d <= range; d++) {
    for (let dx = -d; dx <= d; dx++) {
      const dy = d - Math.abs(dx);
      for (const sy of dy === 0 ? [0] : [-dy, dy]) {
        const x = ep.x + dx;
        const y = ep.y + sy;
        if (!isTileFree(scene, occupied, x, y)) continue;
        if (avoidResources && resourceAt.has(`${x}:${y}`)) continue;
        if (adjacentTo && Math.abs(x - adjacentTo.x) + Math.abs(y - adjacentTo.y) !== 1) continue;
        candidates.push({ x, y, dist: near ? Math.abs(x - near.x) + Math.abs(y - near.y) : d });
      }
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0] ?? null;
}

// 找操作范围内的资源格
function findResourceTile(scene, kinds = null, range = 6) {
  const { executor, occupied } = analyzeScene(scene);
  if (!executor) return null;
  const list = (scene.resources ?? [])
    .filter((r) => {
      const { x, y } = r.position;
      const d = Math.abs(x - executor.position.x) + Math.abs(y - executor.position.y);
      if (d > range) return false;
      if (kinds && !kinds.includes(r.kind)) return false;
      if (scene.visible && scene.visible[y]?.[x] !== true) return false;
      if (scene.terrain?.[y]?.[x] !== 'buildable') return false;
      return !occupied.has(`${x}:${y}`);
    })
    .sort((a, b) => {
      const da = Math.abs(a.position.x - executor.position.x) + Math.abs(a.position.y - executor.position.y);
      const db = Math.abs(b.position.x - executor.position.x) + Math.abs(b.position.y - executor.position.y);
      return da - db;
    });
  return list[0]?.position ?? null;
}

async function buildAt(buildingType, tile, { verify = true } = {}) {
  const card = page.locator(`.planet-build-card[data-building-id="${buildingType}"]`);
  if ((await card.count()) === 0) {
    logEvent('skip', `建造栏没有 ${buildingType}（未解锁），跳过`);
    return false;
  }
  await card.scrollIntoViewIfNeeded().catch(() => {});
  // 卡片可能因资源不足被禁用：快速失败，不干等 30s
  if (!(await card.isEnabled().catch(() => false))) {
    logEvent('warn', `${buildingType} 建造卡片不可用（资源不足或被禁用），跳过`);
    await shot(`build-${buildingType}-disabled`);
    return false;
  }
  const before = await lastCommandResult();
  await card.click();
  await sleep(600);
  await clickTile(tile);
  if (!verify) return true;
  // 展开工作台账本，等新的命令回执（文本变化后再判定成功/失败）
  await showCommandLedger();
  const start = Date.now();
  let result = before;
  while (Date.now() - start < 25000) {
    result = await lastCommandResult();
    if (result !== before && /成功|失败|超出|out of range|拒绝|错误/i.test(result)) break;
    await sleep(1000);
  }
  const ok = result !== before && /成功/.test(result) && !/失败|超出|out of range/i.test(result);
  // 账本读不到时，用服务端 scene 兜底验证（回执 UI 异常不代表命令失败）
  let finalOk = ok;
  if (!finalOk) {
    await sleep(3000);
    const scene = await getScene().catch(() => null);
    if (scene && Object.values(scene.buildings ?? {}).some((b) => b.type === buildingType)) finalOk = true;
  }
  logEvent(finalOk ? 'action' : 'warn', `建造 ${buildingType} @(${tile.x},${tile.y}) → ${finalOk ? '成功' : result.slice(0, 60)}`);
  await shot(`build-${buildingType}`);
  return finalOk;
}

// 带重试的建造：自动在执行体范围内找空地；unlessExists 指定时已存在同型建筑则跳过
async function buildNear(buildingType, { near = null, adjacentTo = null, retries = 3, unlessExists = null } = {}) {
  if (unlessExists) {
    const scene = await getScene();
    if (Object.values(scene.buildings ?? {}).some((b) => b.type === unlessExists)) {
      logEvent('info', `${unlessExists} 已存在，跳过建造`);
      return true;
    }
  }
  for (let i = 0; i < retries; i++) {
    const scene = await getScene();
    let tile = findBuildTile(scene, { near, adjacentTo });
    if (!tile && adjacentTo) {
      // 正交相邻格占满时退而求其次：找靠近电网节点的空地
      tile = findBuildTile(scene, { near: adjacentTo });
    }
    if (!tile) { logEvent('warn', `${buildingType}: 范围内没有合适空地`); return false; }
    if (await buildAt(buildingType, tile)) return true;
    await sleep(15000);
  }
  return false;
}

async function transferTo(buildingId, itemId, qty) {
  await centerTile(BASE_POS).catch(() => {});
  await sleep(1500);
  await openWorkflowTab('研究与装料');
  // 装料表单在“研究与装料”独立 section（不在研究 tabpanel 内），按整个面板栈定位
  const panel = page.locator('.planet-panel-stack');
  const buildingSelect = panel.locator('label:has-text("建筑 ID") select');
  const itemSelect = panel.locator('label:has-text("装料物品") select');
  try {
    await buildingSelect.selectOption(buildingId, { timeout: 8000 });
    await sleep(300);
    await itemSelect.selectOption(itemId, { timeout: 8000 });
  } catch (e) {
    const bOpts = await buildingSelect.locator('option').evaluateAll((els) => els.map((x) => x.value)).catch(() => []);
    const iOpts = await itemSelect.locator('option').evaluateAll((els) => els.slice(0, 12).map((x) => x.value)).catch(() => []);
    logEvent('warn', `装料失败: 建筑选项=${JSON.stringify(bOpts)} 物品前12=${JSON.stringify(iOpts)}`);
    return false;
  }
  await sleep(300);
  const qtyInput = panel.locator('input[type="number"]').first();
  await qtyInput.fill(String(qty));
  await panel.getByRole('button', { name: '装入建筑' }).click();
  await sleep(1200);
  logEvent('action', `装料 ${itemId} x${qty} → ${buildingId}`);
  await shot('transfer');
  return true;
}

async function startResearch(techNameRe) {
  await openWorkflowTab('研究与装料');
  // 科技列表在 tabpanel 内，“开始研究”按钮在相邻的“研究执行区” section
  const panel = page.locator('#planet-workflow-panel-research');
  const techBtn = panel.getByRole('button', { name: techNameRe }).first();
  if ((await techBtn.count()) === 0) {
    logEvent('skip', `研究列表中没有 ${techNameRe}`);
    return false;
  }
  await techBtn.scrollIntoViewIfNeeded().catch(() => {});
  await techBtn.click();
  await sleep(600);
  await page.locator('.planet-panel-stack').getByRole('button', { name: '开始研究' }).click();
  await sleep(1500);
  logEvent('action', `开始研究 ${techNameRe}`);
  await shot('research-start');
  return true;
}

async function techCompleted(techId) {
  const summary = await getSummary();
  const done = summary.players?.[PLAYER_ID]?.tech?.completed_techs ?? {};
  return techId in done;
}

async function inventoryOf(itemId) {
  const summary = await getSummary();
  return summary.players?.[PLAYER_ID]?.inventory?.[itemId] ?? 0;
}

async function findLabId() {
  const scene = await getScene();
  const lab = Object.values(scene.buildings ?? {}).find((b) => b.type === 'matrix_lab' && b.owner_id === PLAYER_ID);
  return lab?.id ?? null;
}

// 等待条件达成；等待期间做观察节拍
async function waitFor(desc, condFn, { timeoutSec = 600, beatSec = 12 } = {}) {
  logEvent('wait', `等待: ${desc}`);
  const start = elapsed();
  while (elapsed() - start < timeoutSec) {
    if (await condFn().catch(() => false)) {
      logEvent('milestone', `${desc} ✓`);
      await shot(`milestone-${desc.replace(/[^a-zA-Z0-9一-龥]/g, '_').slice(0, 40)}`);
      return true;
    }
    await wander(beatSec, `等待中·${desc}`);
    if (elapsed() > TOTAL_SEC) return false;
  }
  logEvent('warn', `等待超时: ${desc}`);
  return false;
}

async function scanAll() {
  await openWorkflowTab('基础操作');
  for (const name of ['扫描银河', '扫描星系', '扫描当前行星']) {
    const btn = page.getByRole('button', { name, exact: true }).first();
    if (await btn.count()) {
      await btn.click();
      await sleep(1200);
      logEvent('action', name);
    }
  }
  await shot('scan');
}

async function produceUnit(buildingId, unitType) {
  await centerTile(BASE_POS).catch(() => {});
  await sleep(1500);
  await openWorkflowTab('战斗与制造');
  const panel = page.locator('#planet-workflow-panel-combat');
  await panel.locator('label:has-text("生产建筑") select').selectOption(buildingId);
  await sleep(300);
  const unitSelect = panel.locator('label:has-text("单位类型") select');
  const has = await unitSelect.locator(`option[value="${unitType}"]`).count();
  if (!has) { logEvent('skip', `单位类型 ${unitType} 不可量产`); return false; }
  await unitSelect.selectOption(unitType);
  await sleep(300);
  await panel.getByRole('button', { name: '下达量产' }).click();
  await sleep(1500);
  logEvent('action', `量产 ${unitType} @ ${buildingId}`);
  await shot(`produce-${unitType}`);
  return true;
}

// 点选地图上的单位并移动（单次移动命令曼哈顿距离 ≤4，超出会被 OUT_OF_RANGE 拒绝）
async function moveUnit(unitPos, dest) {
  const dist = Math.abs(unitPos.x - dest.x) + Math.abs(unitPos.y - dest.y);
  if (dist > 4) {
    logEvent('warn', `移动距离 ${dist} > 4，命令会被拒绝，缩短步长`);
    return false;
  }
  const before = await lastCommandResult();
  await clickTile(unitPos);
  await sleep(800);
  const moveBtn = page.getByRole('button', { name: '移动', exact: true }).first();
  if ((await moveBtn.count()) === 0) { logEvent('warn', '选中单位后没有移动按钮'); return false; }
  await moveBtn.click();
  await sleep(600);
  await clickTile(dest);
  await sleep(800);
  // 校验回执
  await showCommandLedger();
  const result = await lastCommandResult();
  if (result !== before && /OUT_OF_RANGE|失败|拒绝/i.test(result)) {
    logEvent('warn', `移动被拒: ${result.slice(0, 60)}`);
    return false;
  }
  logEvent('action', `移动单位 (${unitPos.x},${unitPos.y}) → (${dest.x},${dest.y})`);
  return true;
}

async function executorPos() {
  const scene = await getScene();
  const ex = analyzeScene(scene).executor;
  return ex ? { x: ex.position.x, y: ex.position.y } : null;
}

// 分步把执行体开到目标附近（每步曼哈顿 ≤4）
async function moveExecutorTo(target, { arriveDist = 2, maxSteps = 12 } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    const pos = await executorPos();
    if (!pos) return false;
    const dist = Math.abs(pos.x - target.x) + Math.abs(pos.y - target.y);
    if (dist <= arriveDist) {
      logEvent('milestone', `执行体抵达 (${pos.x},${pos.y})`);
      return true;
    }
    // 优先走距离大的轴，单步总量 ≤4
    let rem = 4;
    const dxTotal = target.x - pos.x;
    const dyTotal = target.y - pos.y;
    let dx = 0, dy = 0;
    if (Math.abs(dxTotal) >= Math.abs(dyTotal)) {
      dx = Math.sign(dxTotal) * Math.min(Math.abs(dxTotal), rem);
      rem -= Math.abs(dx);
      dy = Math.sign(dyTotal) * Math.min(Math.abs(dyTotal), rem);
    } else {
      dy = Math.sign(dyTotal) * Math.min(Math.abs(dyTotal), rem);
      rem -= Math.abs(dy);
      dx = Math.sign(dxTotal) * Math.min(Math.abs(dxTotal), rem);
    }
    const dest = { x: pos.x + dx, y: pos.y + dy };
    const moved = await moveUnit(pos, dest);
    if (!moved) return false;
    const arrived = await waitFor(`执行体移动到 (${dest.x},${dest.y})`, async () => {
      const p2 = await executorPos();
      return p2 && p2.x === dest.x && p2.y === dest.y;
    }, { timeoutSec: 90, beatSec: 8 });
    if (!arrived) return false;
  }
  logEvent('warn', '执行体移动步数用尽');
  return false;
}

// 找储量最富的资源集群（用于外扩选址）
async function pickRichCluster(maxDist = 45) {
  const scene = await api(`/world/planets/${PLANET_ID}/scene?x=0&y=0&width=120&height=120`);
  const pos = analyzeScene(scene).executor?.position ?? BASE_POS;
  const clusters = {};
  for (const r of scene.resources ?? []) {
    const d = Math.abs(r.position.x - pos.x) + Math.abs(r.position.y - pos.y);
    if (d > maxDist) continue;
    if ((r.remaining ?? 0) <= 0) continue;
    if (!['silicon_ore', 'stone_ore', 'coal', 'titanium_ore', 'copper_ore', 'iron_ore', 'fractal_silicon'].includes(r.kind)) continue;
    const c = clusters[r.cluster_id] ??= { total: 0, tiles: [], kind: r.kind };
    c.total += r.remaining ?? 0;
    c.tiles.push(r.position);
  }
  const best = Object.values(clusters).sort((a, b) => b.total - a.total)[0];
  if (!best) return null;
  best.tiles.sort((a, b) => (Math.abs(a.x - pos.x) + Math.abs(a.y - pos.y)) - (Math.abs(b.x - pos.x) + Math.abs(b.y - pos.y)));
  return { total: best.total, tile: best.tiles[0], kind: best.kind };
}

// 拆除指定位置的建筑（选中 → 拆除按钮 → 确认），返回是否成功
async function demolishAt(pos, buildingType) {
  await clickTile(pos);
  await sleep(900);
  const demolishBtn = page.getByRole('button', { name: '拆除', exact: true }).first();
  if ((await demolishBtn.count()) === 0) { logEvent('warn', `(${pos.x},${pos.y}) 没有拆除按钮`); return false; }
  await demolishBtn.click();
  await sleep(800);
  // 可能的确认弹窗
  for (const name of ['确认拆除', '确认', '确定']) {
    const confirmBtn = page.getByRole('button', { name, exact: true }).first();
    if (await confirmBtn.count()) { await confirmBtn.click().catch(() => {}); break; }
  }
  await sleep(1500);
  const scene = await getScene();
  const gone = !Object.values(scene.buildings ?? {}).some(
    (b) => b.position.x === pos.x && b.position.y === pos.y);
  logEvent(gone ? 'action' : 'warn', `拆除 ${buildingType} @(${pos.x},${pos.y}) → ${gone ? '成功' : '未生效'}`);
  await shot(`demolish-${buildingType}`);
  return gone;
}

// ---------------- 终局预设（第四轮：武器→拆站→产线→熔炉→炮塔→二矿→终幕） ----------------
const finalePhases = [
  {
    name: 'F0-回到指挥位', minEnd: 120,
    async run() {
      await page.goto(`${WEB}/planet/${PLANET_ID}`);
      await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
      await sleep(3000);
      logEvent('milestone', '回到行星指挥位');
      await ensureOnPlanet();
    },
  },
  {
    name: 'F1-武器系统研究', minEnd: 600,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('weapon_system'))) {
        await ensureResearch('weapon_system', /武器系统/);
      }
    },
  },
  {
    name: 'F2-拆站转产打通产线', minEnd: 1300,
    async run() {
      await ensureOnPlanet();
      // 科研完毕，拆研究站回款
      const lab = Object.values((await getScene()).buildings ?? {}).find((b) => b.type === 'matrix_lab');
      if (lab) {
        logEvent('action', '科研完成，拆除研究站回收材料');
        await demolishAt({ x: lab.position.x, y: lab.position.y }, 'matrix_lab');
      }
      // 储物仓贴分拣器，矿机库存外流
      const scene = await getScene();
      const sorter = Object.values(scene.buildings ?? {}).find((b) => b.type === 'sorter_mk1'
        && Math.abs(b.position.x - 5) + Math.abs(b.position.y - 1) === 1);
      if (sorter) {
        await buildNear('depot_mk1', { adjacentTo: { x: sorter.position.x, y: sorter.position.y } });
      } else {
        const miner = Object.values(scene.buildings ?? {}).find((b) => b.type === 'mining_machine');
        if (miner) {
          const mp = { x: miner.position.x, y: miner.position.y };
          await buildNear('sorter_mk1', { adjacentTo: mp });
          const s2 = Object.values((await getScene()).buildings ?? {})
            .find((b) => b.type === 'sorter_mk1'
              && Math.abs(b.position.x - mp.x) + Math.abs(b.position.y - mp.y) === 1);
          if (s2) await buildNear('depot_mk1', { adjacentTo: { x: s2.position.x, y: s2.position.y } });
        }
      }
      // 验证经济解封
      const m0 = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
      await waitFor('产线打通矿产回升', async () => {
        const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
        return m > m0 + 10;
      }, { timeoutSec: 300, beatSec: 15 });
      await shot('production-line-flowing');
    },
  },
  {
    name: 'F3-电弧熔炉', minEnd: 2000,
    async run() {
      await ensureOnPlanet();
      await waitResources(135, 480);
      await buildNear('arc_smelter', { near: BASE_POS });
      await wander(15, '熔炉观察');
    },
  },
  {
    name: 'F4-高斯炮塔', minEnd: 2500,
    async run() {
      await ensureOnPlanet();
      await waitResources(85, 420);
      await buildNear('gauss_turret', { near: BASE_POS });
      await wander(15, '炮塔防区观察');
    },
  },
  {
    name: 'F5-外扩二矿', minEnd: 3100,
    async run() {
      await ensureOnPlanet();
      const cluster = await pickRichCluster(45);
      if (!cluster) { logEvent('warn', '附近没有富矿集群'); return; }
      logEvent('milestone', `锁定富矿带 ${cluster.kind} (${cluster.tile.x},${cluster.tile.y})`);
      await shot('rich-cluster');
      const arrived = await moveExecutorTo({ x: cluster.tile.x - 2, y: cluster.tile.y - 2 }, { arriveDist: 2 });
      if (!arrived) return;
      const resTile = findResourceTile(await getScene(), null, 6) ?? cluster.tile;
      const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
      if (m >= 100) {
        await buildNear('tesla_tower', { near: resTile });
        const scene2 = await getScene();
        const teslas = Object.values(scene2.buildings ?? {})
          .filter((b) => b.type === 'tesla_tower')
          .sort((a, b) => (Math.abs(a.position.x - resTile.x) + Math.abs(a.position.y - resTile.y))
            - (Math.abs(b.position.x - resTile.x) + Math.abs(b.position.y - resTile.y)));
        if (teslas[0]) {
          const t = findBuildTile(await getScene(), { adjacentTo: teslas[0].position });
          if (t) await buildAt('wind_turbine', t);
        }
        await buildAt('mining_machine', resTile);
        await waitFor('前哨矿机投产', async () => {
          return Object.values((await getScene()).buildings ?? {}).some(
            (b) => b.type === 'mining_machine' && b.runtime?.state === 'running'
              && b.position.x === resTile.x && b.position.y === resTile.y);
        }, { timeoutSec: 150 });
      } else {
        logEvent('info', `矿产 ${m} 不足以建二矿，仅侦察`);
        await wander(20, '富矿带侦察');
      }
    },
  },
  {
    name: 'F6-部队与终幕', minEnd: 99999,
    async run() {
      await ensureOnPlanet();
      const scene = await getScene();
      const base = Object.values(scene.buildings ?? {}).find((b) => b.type === 'battlefield_analysis_base');
      if (base) {
        await produceUnit(base.id, 'worker');
        await produceUnit(base.id, 'soldier');
      }
      await zoomOut(2);
      await wander(20, '基地全景');
      await visitPage('/system/sys-1', 18, '终幕·恒星系');
      await visitPage('/galaxy', 22, '终幕·银河');
      logEvent('milestone', '试玩收官');
    },
  },
];

const industryPhases = [
  {
    name: 'I0-回师基地', minEnd: 240,
    async run() {
      await page.goto(`${WEB}/planet/${PLANET_ID}`);
      await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      logEvent('milestone', '回到行星指挥位');
      await moveExecutorTo(BASE_POS, { arriveDist: 2 });
      await ensureOnPlanet();
    },
  },
  {
    name: 'I1-打通采矿产线', minEnd: 900,
    async run() {
      await ensureOnPlanet();
      // 分拣/仓储科技是产线前提（若未研究，用剩余矩阵补上）
      if (!(await techCompleted('basic_logistics_system'))) {
        await ensureResearch('basic_logistics_system', /基础物流/);
      }
      // 找主力矿机（starter 矿点）
      const scene = await getScene();
      const miner = Object.values(scene.buildings ?? {}).find((b) => b.type === 'mining_machine');
      if (!miner) { logEvent('warn', '没有矿机，无法拍产线'); return; }
      const mp = { x: miner.position.x, y: miner.position.y };
      // 矿机库存堵满的证据镜头
      await clickTile(mp);
      await shot('miner-storage-full');
      await sleep(1500);
      // 矿产为 0 时拆旧筹款：拆基地两台冗余风机（在执行体操作范围内）
      let minerals = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
      if (minerals < 70) {
        logEvent('action', '矿产见底，拆除冗余风机回收材料');
        const demos = Object.values((await getScene()).buildings ?? {})
          .filter((b) => b.type === 'wind_turbine')
          .sort((a, b) => (Math.abs(a.position.x - BASE_POS.x) + Math.abs(a.position.y - BASE_POS.y))
            - (Math.abs(b.position.x - BASE_POS.x) + Math.abs(b.position.y - BASE_POS.y)))
          .slice(0, 2);
        for (const b of demos) {
          await demolishAt({ x: b.position.x, y: b.position.y }, b.type);
        }
      }
      // 分拣器贴矿机，储物仓贴分拣器：矿物外流，矿工复产
      await buildNear('sorter_mk1', { adjacentTo: mp });
      const sorter = Object.values((await getScene()).buildings ?? {})
        .find((b) => b.type === 'sorter_mk1'
          && Math.abs(b.position.x - mp.x) + Math.abs(b.position.y - mp.y) === 1);
      if (sorter) {
        await buildNear('depot_mk1', { adjacentTo: { x: sorter.position.x, y: sorter.position.y } });
      } else {
        await buildNear('depot_mk1', { near: mp });
      }
      // 验证经济解封：矿产开始回升
      const m0 = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
      await waitFor('矿产恢复增长', async () => {
        const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
        return m > m0 + 5;
      }, { timeoutSec: 240, beatSec: 15 });
      // 经济解封后重建供电
      await powerBoost(2);
      await shot('production-line-flowing');
    },
  },
  {
    name: 'I2-冶金与熔炉', minEnd: 1700,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('automatic_metallurgy'))) {
        await ensureResearch('automatic_metallurgy', /自动化冶金/);
      }
      await waitResources(130, 480);
      await buildNear('arc_smelter', { near: BASE_POS });
      await wander(15, '熔炉观察');
    },
  },
  {
    name: 'I3-武器与炮塔', minEnd: 2400,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('weapon_system'))) {
        await ensureResearch('weapon_system', /武器系统/);
      }
      await waitResources(90, 360);
      await buildNear('gauss_turret', { near: BASE_POS });
      await waitResources(90, 300);
      await buildNear('gauss_turret', { near: BASE_POS });
      await wander(15, '炮塔防区观察');
    },
  },
  {
    name: 'I4-部队与终幕', minEnd: 99999,
    async run() {
      await ensureOnPlanet();
      const scene = await getScene();
      const base = Object.values(scene.buildings ?? {}).find((b) => b.type === 'battlefield_analysis_base');
      if (base) {
        await produceUnit(base.id, 'worker');
        await produceUnit(base.id, 'soldier');
      }
      await zoomOut(2);
      await wander(20, '基地全景');
      await visitPage('/system/sys-1', 18, '终幕·恒星系');
      await visitPage('/galaxy', 22, '终幕·银河');
      logEvent('milestone', '试玩收官');
    },
  },
];

let RICH_TILE = null;
const expansionPhases = [
  {
    name: 'R0-登录归队', minEnd: 150,
    async run() {
      // 扩张预设使用会话注入（不再拍登录），直接进行星页
      await page.goto(`${WEB}/planet/${PLANET_ID}`);
      await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      logEvent('milestone', '回到行星指挥位');
      await shot('back-to-planet');
      await visitPage('/galaxy', 20, '银河星图');
      await page.goto(`${WEB}/planet/${PLANET_ID}`);
      await page.waitForTimeout(3500);
    },
  },
  { name: 'R1-勘察与扫描', minEnd: 420, run: async () => { await phases[1].run(); } },
  { name: 'R2-电力与研究站', minEnd: 720, run: async () => { await phases[2].run(); } },
  { name: 'R3-电磁学', minEnd: 960, run: async () => { await phases[3].run(); } },
  { name: 'R4-首矿与电网', minEnd: 1320, run: async () => { await phases[4].run(); } },
  {
    name: 'R5-挺进富矿带', minEnd: 2100,
    async run() {
      await ensureOnPlanet();
      const cluster = await pickRichCluster(45);
      if (!cluster) { logEvent('warn', '附近没有富矿集群'); return; }
      RICH_TILE = cluster.tile;
      logEvent('milestone', `锁定富矿带 ${cluster.kind} (${cluster.tile.x},${cluster.tile.y}) 储量 ${cluster.total}`);
      await shot('rich-cluster');
      await moveExecutorTo({ x: cluster.tile.x - 2, y: cluster.tile.y - 2 }, { arriveDist: 2 });
    },
  },
  {
    name: 'R6-矿区前哨站', minEnd: 2800,
    async run() {
      await ensureOnPlanet();
      const resTile = findResourceTile(await getScene(), null, 6) ?? RICH_TILE;
      if (!resTile) { logEvent('warn', '前哨范围内没有资源格'); return; }
      logEvent('action', `前哨选址: 矿脉 (${resTile.x},${resTile.y})`);
      await buildNear('tesla_tower', { near: resTile });
      // 前哨局部供电：风机贴特斯拉塔并网
      const scene = await getScene();
      const teslas = Object.values(scene.buildings ?? {})
        .filter((b) => b.type === 'tesla_tower')
        .sort((a, b) => (Math.abs(a.position.x - resTile.x) + Math.abs(a.position.y - resTile.y))
          - (Math.abs(b.position.x - resTile.x) + Math.abs(b.position.y - resTile.y)));
      if (teslas[0]) {
        const t = findBuildTile(await getScene(), { adjacentTo: teslas[0].position });
        if (t) await buildAt('wind_turbine', t);
      }
      await waitResources(55, 240);
      await buildAt('mining_machine', resTile);
      await waitFor('前哨矿机投产', async () => {
        return Object.values((await getScene()).buildings ?? {}).some(
          (b) => b.type === 'mining_machine' && b.runtime?.state === 'running'
            && b.position.x === resTile.x && b.position.y === resTile.y);
      }, { timeoutSec: 180 });
      // 前哨再多补一台矿机
      const res2 = findResourceTile(await getScene(), null, 6);
      if (res2 && (res2.x !== resTile.x || res2.y !== resTile.y)) {
        await waitResources(55, 180);
        await buildAt('mining_machine', res2);
      }
    },
  },
  {
    name: 'R7-冶金与熔炉', minEnd: 3400,
    async run() {
      // 回师基地（建造受执行体操作范围限制）
      await moveExecutorTo(BASE_POS, { arriveDist: 2 });
      await ensureOnPlanet();
      if (!(await techCompleted('automatic_metallurgy'))) {
        await ensureResearch('automatic_metallurgy', /自动化冶金/);
      }
      await waitResources(130, 420);
      await buildNear('arc_smelter', { near: BASE_POS });
      await wander(20, '冶炼产线观察');
    },
  },
  {
    name: 'R8-武器与炮塔', minEnd: 3900,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('weapon_system'))) {
        await ensureResearch('weapon_system', /武器系统/);
      }
      await waitResources(90, 300);
      await buildNear('gauss_turret', { near: BASE_POS });
      await waitResources(90, 240);
      await buildNear('gauss_turret', { near: BASE_POS });
      await wander(15, '炮塔防区观察');
    },
  },
  {
    name: 'R9-部队与终幕', minEnd: 99999,
    async run() {
      await ensureOnPlanet();
      const scene = await getScene();
      const base = Object.values(scene.buildings ?? {}).find((b) => b.type === 'battlefield_analysis_base');
      if (base) {
        await produceUnit(base.id, 'worker');
        await produceUnit(base.id, 'soldier');
      }
      await moveExecutorTo({ x: BASE_POS.x + 6, y: BASE_POS.y + 4 }, { arriveDist: 2 });
      await wander(15, '迷雾探索');
      await zoomOut(3);
      await wander(20, '基地全景');
      await visitPage('/system/sys-1', 18, '终幕·恒星系');
      await visitPage('/galaxy', 22, '终幕·银河');
      logEvent('milestone', '试玩收官');
    },
  },
];
async function visitPage(url, dwellSec, label) {
  await page.goto(`${WEB}${url}`);
  await page.waitForTimeout(2500);
  logEvent('visit', label);
  await shot(`visit-${label}`);
  // 在星图/星系页缓慢移动视角
  const end = elapsed() + dwellSec;
  while (elapsed() < end) {
    await smoothMouseMove(
      VIEWPORT.width * (0.3 + Math.random() * 0.4),
      VIEWPORT.height * (0.3 + Math.random() * 0.4),
    );
    await sleep(2000);
  }
}

// ---------------- 心跳 ----------------
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    fs.writeFileSync(`${OUT}/heartbeat.json`, JSON.stringify({
      elapsed: Math.round(elapsed()), phase: currentPhase, segment: segIndex, at: new Date().toISOString(),
    }));
  }, 15000);
}

// ---------------- 阶段定义 ----------------
const phases = [
  {
    name: 'P0-登录与星图巡游', minEnd: 210,
    async run() {
      // 手动登录（分段 0 不注入会话，真实走登录页）
      await page.goto(`${WEB}/login`);
      await page.waitForTimeout(2000);
      await shot('login');
      // 表单已预填默认值，需先全选清空再输入（模拟真人修改）
      const inputs = page.locator('.login-form input');
      let loggedIn = false;
      for (let attempt = 0; attempt < 2 && !loggedIn; attempt++) {
        await inputs.nth(1).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('p1', { delay: 180 });
        await inputs.nth(2).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('key_player_1', { delay: 90 });
        await sleep(600);
        logEvent('action', '登录 p1');
        await page.locator('.login-form button[type="submit"]').click();
        // 验证真的跳出了登录页
        try {
          await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 12000 });
          loggedIn = true;
        } catch {
          logEvent('warn', `登录第 ${attempt + 1} 次未跳转，重试`);
        }
      }
      if (!loggedIn) throw new Error('登录失败，无法进入游戏');
      await page.waitForTimeout(2500);
      await shot('after-login');
      logEvent('milestone', '登录成功，进入指挥台');
      // 星图巡游
      await visitPage('/galaxy', 40, '银河星图');
      await visitPage('/system/sys-1', 30, '恒星系视图');
      await page.goto(`${WEB}/planet/${PLANET_ID}`);
      await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      logEvent('milestone', '进入出生行星');
      await shot('first-planet-view');
    },
  },
  {
    name: 'P1-勘察与扫描', minEnd: 480,
    async run() {
      await ensureOnPlanet();
      await openWorkflowTab('基础操作');
      await sleep(1000);
      await wander(30, '勘察基地周边');
      await scanAll();
      // 浏览各工作流页签
      for (const tab of ['研究与装料', '战斗与制造', '物流', '跨星球', '戴森', '取消与恢复']) {
        await openWorkflowTab(tab);
        await shot(`tab-${tab}`);
        await sleep(2500);
      }
      await openWorkflowTab('基础操作');
      await wander(20, '查看地图细节');
    },
  },
  {
    name: 'P2-首台风机与研究站', minEnd: 780,
    async run() {
      await ensureOnPlanet();
      // 两台风机贴基地（供电要留余量），研究站贴基地正交相邻格（电网 line range=1）
      const hasTurbine = Object.values((await getScene()).buildings ?? {}).some((b) => b.type === 'wind_turbine');
      if (!hasTurbine) {
        await buildNear('wind_turbine', { adjacentTo: BASE_POS });
        await buildNear('wind_turbine', { adjacentTo: BASE_POS });
        await wander(10, '风机施工中');
      } else {
        logEvent('info', 'wind_turbine 已存在，跳过建造');
      }
      const okLab = await buildNear('matrix_lab', { unlessExists: 'matrix_lab', adjacentTo: BASE_POS });
      if (okLab) await wander(10, '研究站施工中');
      // 等研究站通电 running
      const labPowered = await waitFor('研究站通电运行', async () => {
        const scene = await getScene();
        return Object.values(scene.buildings ?? {}).some(
          (b) => b.type === 'matrix_lab' && b.runtime?.state === 'running');
      }, { timeoutSec: 120 });
      if (!labPowered) {
        logEvent('warn', '研究站未通电，在电网节点旁补风机');
        await powerBoost(2);
        await waitFor('研究站通电运行(补电后)', async () => {
          const scene = await getScene();
          return Object.values(scene.buildings ?? {}).some(
            (b) => b.type === 'matrix_lab' && b.runtime?.state === 'running');
        }, { timeoutSec: 90 });
      }
    },
  },
  {
    name: 'P3-装料与电磁学研究', minEnd: 1080,
    async run() {
      await ensureOnPlanet();
      const labId = await findLabId();
      if (labId && !(await techCompleted('electromagnetism'))) {
        await transferTo(labId, 'electromagnetic_matrix', 10);
        await startResearch(/^电磁学/);
        await waitFor('电磁学研究完成', () => techCompleted('electromagnetism'), { timeoutSec: 300 });
      }
    },
  },
  {
    name: 'P4-电网延伸与首台矿机', minEnd: 1440,
    async run() {
      await ensureOnPlanet();
      // 特斯拉塔朝着矿点方向铺，再把矿机压上资源点
      const scene = await getScene();
      const hasMiner = Object.values(scene.buildings ?? {}).some((b) => b.type === 'mining_machine');
      if (!hasMiner) {
        const resTile = findResourceTile(scene, null, 6);
        if (resTile) {
          await buildNear('tesla_tower', { near: resTile });
          await buildAt('mining_machine', resTile);
        } else {
          logEvent('warn', '操作范围内没有资源格');
        }
      }
      const minerOk = await waitFor('矿机开始产出', async () => {
        const s = await getSummary();
        return (s.players?.[PLAYER_ID]?.resources?.minerals ?? 0) > 20
          && Object.values((await getScene()).buildings ?? {}).some(
            (b) => b.type === 'mining_machine' && b.runtime?.state === 'running');
      }, { timeoutSec: 180 });
      if (!minerOk) {
        logEvent('warn', '矿机未运行，补一座特斯拉塔接电并补风机');
        const resTile2 = findResourceTile(await getScene(), null, 6);
        await buildNear('tesla_tower', { near: resTile2 ?? BASE_POS });
        await powerBoost(1);
        await waitFor('矿机开始产出(补电后)', async () => {
          return Object.values((await getScene()).buildings ?? {}).some(
            (b) => b.type === 'mining_machine' && b.runtime?.state === 'running');
        }, { timeoutSec: 90 });
      }
      // 检查全网供电余量，缺电就补风机
      const pw = await powerStatus();
      logEvent('info', `电网状态: 供给 ${pw.supply} / 需求 ${pw.demand}`);
      if (!pw.ok) {
        logEvent('warn', '电网供不应求，补风机');
        await powerBoost(2);
      }
    },
  },
  {
    name: 'P5-物流产线', minEnd: 1750,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('basic_logistics_system'))) {
        await ensureResearch('basic_logistics_system', /^基础物流/);
      }
      // 产线关键一步：分拣器贴矿机、储物仓贴分拣器，矿机库存外流、经济滚起来
      const scene = await getScene();
      const miner = Object.values(scene.buildings ?? {}).find((b) => b.type === 'mining_machine');
      if (miner) {
        const mp = { x: miner.position.x, y: miner.position.y };
        await clickTile(mp);
        await shot('miner-before-line');
        await buildNear('sorter_mk1', { adjacentTo: mp });
        const sorter = Object.values((await getScene()).buildings ?? {})
          .find((b) => b.type === 'sorter_mk1'
            && Math.abs(b.position.x - mp.x) + Math.abs(b.position.y - mp.y) === 1);
        if (sorter) {
          await buildNear('depot_mk1', { adjacentTo: { x: sorter.position.x, y: sorter.position.y } });
        }
        // 验证经济解封
        const m0 = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
        await waitFor('产线打通矿产回升', async () => {
          const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
          return m > m0 + 10;
        }, { timeoutSec: 240, beatSec: 15 });
      }
      await wander(15, '物流线观察');
    },
  },
  {
    name: 'P6-自动冶金', minEnd: 2520,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('automatic_metallurgy'))) {
        await ensureResearch('automatic_metallurgy', /自动化冶金/);
      }
      // 电弧熔炉造价高：先等经济积累（等待画面正好拍基地运转）
      await waitResources(130, 300);
      await buildNear('arc_smelter', { near: BASE_POS });
      await wander(20, '冶炼产线观察');
    },
  },
  {
    name: 'P7-武器系统与炮塔', minEnd: 3150,
    async run() {
      await ensureOnPlanet();
      if (!(await techCompleted('weapon_system'))) {
        await ensureResearch('weapon_system', /武器系统/);
      }
      await waitResources(85, 300);
      await buildNear('gauss_turret', { near: BASE_POS });
      await wander(20, '炮塔防区观察');
    },
  },
  {
    name: 'P8-拆站转产与外扩二矿', minEnd: 3800,
    async run() {
      await ensureOnPlanet();
      // 科研全部完成后拆除研究站回款（+120 矿产、-4 电网需求），为二矿筹资
      if ((await techCompleted('weapon_system')) || (await techCompleted('automatic_metallurgy'))) {
        const lab = Object.values((await getScene()).buildings ?? {}).find((b) => b.type === 'matrix_lab');
        if (lab) {
          logEvent('action', '科研完成，拆除研究站回收材料转产');
          await demolishAt({ x: lab.position.x, y: lab.position.y }, 'matrix_lab');
        }
      }
      // 开赴富矿带建第二矿区
      const cluster = await pickRichCluster(45);
      if (cluster) {
        logEvent('milestone', `锁定富矿带 ${cluster.kind} (${cluster.tile.x},${cluster.tile.y})`);
        await shot('rich-cluster');
        const arrived = await moveExecutorTo({ x: cluster.tile.x - 2, y: cluster.tile.y - 2 }, { arriveDist: 2 });
        if (arrived) {
          const resTile = findResourceTile(await getScene(), null, 6) ?? cluster.tile;
          const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
          if (m >= 100) {
            await buildNear('tesla_tower', { near: resTile });
            const scene2 = await getScene();
            const teslas = Object.values(scene2.buildings ?? {})
              .filter((b) => b.type === 'tesla_tower')
              .sort((a, b) => (Math.abs(a.position.x - resTile.x) + Math.abs(a.position.y - resTile.y))
                - (Math.abs(b.position.x - resTile.x) + Math.abs(b.position.y - resTile.y)));
            if (teslas[0]) {
              const t = findBuildTile(await getScene(), { adjacentTo: teslas[0].position });
              if (t) await buildAt('wind_turbine', t);
            }
            await buildAt('mining_machine', resTile);
            await waitFor('前哨矿机投产', async () => {
              return Object.values((await getScene()).buildings ?? {}).some(
                (b) => b.type === 'mining_machine' && b.runtime?.state === 'running'
                  && b.position.x === resTile.x && b.position.y === resTile.y);
            }, { timeoutSec: 150 });
          } else {
            logEvent('info', `矿产 ${m} 不足以建二矿，仅侦察`);
            await wander(20, '富矿带侦察');
          }
        }
      }
    },
  },
  {
    name: 'P9-单位生产与侦察', minEnd: 4080,
    async run() {
      await ensureOnPlanet();
      const scene = await getScene();
      const base = Object.values(scene.buildings ?? {}).find((b) => b.type === 'battlefield_analysis_base');
      if (base) {
        await produceUnit(base.id, 'worker');
        await produceUnit(base.id, 'soldier');
      }
      // 移动执行体向外侦察（分步走，每步 ≤4）
      const s2 = await getScene();
      const { executor } = analyzeScene(s2);
      if (executor) {
        await moveExecutorTo({ x: executor.position.x + 8, y: executor.position.y + 4 }, { arriveDist: 2 });
        await wander(15, '迷雾探索');
      }
    },
  },
  {
    name: 'P10-终幕巡游', minEnd: 99999,
    async run() {
      await ensureOnPlanet();
      await zoomOut(3); // 拉远看全景
      await wander(25, '基地全景');
      await visitPage('/system/sys-1', 20, '终幕·恒星系');
      await visitPage('/galaxy', 25, '终幕·银河');
      logEvent('milestone', '试玩收官');
    },
  },
];

// 研究保障：矩阵不够就装，装了再启动；背包明显不够就直接跳过，不干等
async function ensureResearch(techId, nameRe) {
  const catalog = await getCatalog();
  const tech = (catalog.techs ?? []).find((t) => t.id === techId);
  const labId = await findLabId();
  if (!labId) { logEvent('warn', '没有研究站，无法研究'); return false; }
  if (tech?.cost?.length) {
    for (const c of tech.cost) {
      const inv = await inventoryOf(c.item_id);
      if (inv <= 0) {
        logEvent('skip', `背包没有 ${c.item_id}，跳过研究 ${techId}`);
        return false;
      }
      const ok = await transferTo(labId, c.item_id, Math.min(c.quantity, inv));
      if (!ok) { logEvent('warn', `装料失败，放弃研究 ${techId}`); return false; }
    }
  }
  const started = await startResearch(nameRe);
  if (!started) return false;
  // 等待完成；期间若卡在 waiting_matrix 且背包还有货，自动补装
  logEvent('wait', `等待: ${techId} 研究完成`);
  const start = elapsed();
  while (elapsed() - start < 420) {
    const summary = await getSummary().catch(() => null);
    const techState = summary?.players?.[PLAYER_ID]?.tech ?? {};
    if (techId in (techState.completed_techs ?? {})) {
      logEvent('milestone', `${techId} 研究完成 ✓`);
      await shot(`milestone-${techId}`);
      return true;
    }
    const cur = techState.current_research;
    if (cur?.blocked_reason === 'waiting_matrix' && cur?.tech_id === techId) {
      for (const c of tech?.cost ?? []) {
        const inv = await inventoryOf(c.item_id);
        if (inv > 0) {
          logEvent('info', `研究卡在缺矩阵，补装 ${c.item_id} x${inv}`);
          await transferTo(labId, c.item_id, inv).catch(() => {});
        }
      }
    }
    await wander(12, `等待中·${techId} 研究`);
    if (elapsed() > TOTAL_SEC) return false;
  }
  logEvent('warn', `等待超时: ${techId} 研究完成`);
  return false;
}

// ---------------- 主流程 ----------------
async function main() {
  const presetIdx = args.indexOf('--preset');
  const preset = presetIdx >= 0 ? args[presetIdx + 1] : 'full';
  const phaseList = preset === 'expansion' ? expansionPhases
    : preset === 'industry' ? industryPhases
    : preset === 'finale' ? finalePhases
    : phases;
  console.log(`试玩录像开始: 预设=${preset} 总时长 ${TOTAL_SEC / 60} 分钟, 分段 ${SEG_SEC}s, 输出 ${OUT}`);
  browser = await chromium.launch({ headless: true });
  startHeartbeat();
  // 刷新基地坐标作为相机锚点
  try {
    const scene = await getScene();
    const base = Object.values(scene.buildings ?? {}).find((b) => b.type === 'battlefield_analysis_base');
    if (base) BASE_POS = { x: base.position.x, y: base.position.y };
  } catch {}
  await startSegment({ injectSession: preset !== 'full' });

  for (const phase of phaseList) {
    if (elapsed() > TOTAL_SEC) { logEvent('info', '到达总时长，停止后续阶段'); break; }
    currentPhase = phase.name;
    await rollSegmentIfNeeded();
    logEvent('phase', `进入阶段 ${phase.name}`);
    try {
      await phase.run();
    } catch (e) {
      logEvent('error', `阶段 ${phase.name} 异常: ${e.message}`);
      await shot('error').catch(() => {});
      // 出错后尝试恢复页面
      try { await ensureOnPlanet(); } catch {}
    }
    // 填充到阶段窗口结束
    const remain = phase.minEnd - elapsed();
    if (remain > 5 && elapsed() < TOTAL_SEC) {
      await wander(remain, `${phase.name}·收尾观察`);
    }
  }

  currentPhase = 'done';
  logEvent('info', `试玩结束，总时长 ${(elapsed() / 60).toFixed(1)} 分钟`);
  await endSegment();
  clearInterval(heartbeatTimer);
  await browser.close();
  console.log('全部完成');
}

main().catch(async (e) => {
  console.error('致命错误:', e);
  logEvent('error', `致命错误: ${e.message}`);
  try { await endSegment(); } catch {}
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  process.exit(1);
});
