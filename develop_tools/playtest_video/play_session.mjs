// SiliconWorld 真实试玩录像导演脚本
// 通过 Playwright 驱动真实 Web UI 玩游戏，全程分段录像 + 事件时间戳日志 + 里程碑截图。
// 用法: node play_session.mjs [--minutes 120] [--seg-sec 480] [--out .run/video-playtest/session] [--preset full|expansion|industry|finale]
// 环境变量覆盖: PLAY_WEB / PLAY_SERVER / PLAY_PLAYER_ID / PLAY_PLAYER_KEY / PLAY_PLANET_ID
//   例: PLAY_WEB=http://127.0.0.1:5698 PLAY_SERVER=http://127.0.0.1:5697 node play_session.mjs --minutes 12 --preset full
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
}
const TOTAL_SEC = argVal('minutes', 120) * 60; // 新开局链路（远征+自产矩阵）显著更长，默认 120 分钟
const SEG_SEC = argVal('seg-sec', 480);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '.run/video-playtest/session';
const START_OFFSET_SEC = argVal('start-offset', 0); // 续跑时的事件日志时间偏移

const WEB = process.env.PLAY_WEB ?? 'http://127.0.0.1:5678';
const SERVER = process.env.PLAY_SERVER ?? 'http://127.0.0.1:5677';
const PLAYER_ID = process.env.PLAY_PLAYER_ID ?? 'p1';
const PLAYER_KEY = process.env.PLAY_PLAYER_KEY ?? 'key_player_1';
const PLANET_ID = process.env.PLAY_PLANET_ID ?? 'planet-1-1';
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
// 主 scene 窗口覆盖基地+矿区作业面（原点在左上，terrain/visible 按绝对坐标索引）
const getScene = () => api(`/world/planets/${PLANET_ID}/scene?x=0&y=0&width=140&height=140`);
const getSceneAt = (x, y, w = 80, h = 80) => api(`/world/planets/${PLANET_ID}/scene?x=${x}&y=${y}&width=${w}&height=${h}`);
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
    await context.addInitScript(({ serverUrl, playerId, playerKey }) => {
      window.localStorage.setItem(
        'siliconworld-client-web-session',
        JSON.stringify({ state: { serverUrl, playerId, playerKey }, version: 0 }),
      );
    }, { serverUrl: WEB, playerId: PLAYER_ID, playerKey: PLAYER_KEY });
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

// 等待建造预算到位：矿产来自矿机开采回扣，能量来自电网盈余（风机越多回得越快）
async function waitResources(minerals, energy = 0, timeoutSec = 300) {
  const desc = energy > 0 ? `矿产≥${minerals} 且 能量≥${energy}` : `矿产积累到 ${minerals}`;
  return waitFor(desc, async () => {
    const s = await getSummary();
    const r = s.players?.[PLAYER_ID]?.resources ?? {};
    return (r.minerals ?? 0) >= minerals && (r.energy ?? 0) >= energy;
  }, { timeoutSec, beatSec: 15 });
}

// ---------------- 观察节拍（填时间 + 让画面有看头） ----------------
let BASE_POS = { x: 3, y: 3 }; // 主流程启动时从 scene 刷新

async function wander(sec, label = '观察基地', { allowClick = true } = {}) {
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
        // 点选视口安全区中部，展示详情面板（quiet 模式下退化为悬停，不碰地图）
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45);
        if (allowClick) {
          await page.mouse.down(); await sleep(60); await page.mouse.up();
        }
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

// 退出建造模式（建造模式放置后保持不退出，防止后续观察点击误放建筑）
async function exitBuildMode() {
  const modeBar = page.locator('.planet-map-canvas__mode');
  if ((await modeBar.count()) === 0) return;
  await page.keyboard.press('Escape');
  await sleep(500);
  if ((await modeBar.count()) > 0) {
    const cam = await readCamera().catch(() => null);
    if (cam?.box) {
      await page.mouse.click(cam.box.x + cam.box.width / 2, cam.box.y + cam.box.height / 2, { button: 'right' });
      await sleep(400);
    }
  }
}

// 建造模式下在建造栏选择配方（熔炉/装配机/研究站必须选对配方，否则建成后空转）
async function selectBuildRecipe(recipeId) {
  const select = page.locator('select.planet-build-bar__select');
  if ((await select.count()) === 0) {
    logEvent('warn', `配方下拉框未出现，无法选择 ${recipeId}`);
    return false;
  }
  const has = await select.locator(`option[value="${recipeId}"]`).count();
  if (!has) {
    const opts = await select.locator('option').evaluateAll((els) => els.map((x) => x.value)).catch(() => []);
    logEvent('warn', `配方 ${recipeId} 不在可选项中: ${JSON.stringify(opts)}`);
    return false;
  }
  await select.selectOption(recipeId);
  await sleep(300);
  logEvent('info', `建造配方选定: ${recipeId}`);
  return true;
}

async function buildAt(buildingType, tile, { verify = true, recipe = null, stayInMode = false } = {}) {
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
  if (recipe) {
    if (!(await selectBuildRecipe(recipe))) {
      await exitBuildMode();
      return false;
    }
  }
  await clickTile(tile);
  if (!stayInMode) await exitBuildMode();
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
    const scene = await getSceneAt(Math.max(0, tile.x - 30), Math.max(0, tile.y - 30), 60, 60).catch(() => null);
    if (scene && Object.values(scene.buildings ?? {}).some(
      (b) => b.type === buildingType && b.position.x === tile.x && b.position.y === tile.y)) finalOk = true;
  }
  logEvent(finalOk ? 'action' : 'warn', `建造 ${buildingType}${recipe ? `[${recipe}]` : ''} @(${tile.x},${tile.y}) → ${finalOk ? '成功' : result.slice(0, 60)}`);
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

// ---------------- 传送带铺设与产业链布局 ----------------
const BELT_TYPE = 'conveyor_belt_mk1';
const BELT_DIR_LABEL = { auto: '自动', north: '北', east: '东', south: '南', west: '西' };
const DIR_VECTORS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const DIR_OF_VECTOR = (dx, dy) => (dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north');
const DIR_OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// 传送带建造模式下用建造栏按钮循环切换方向（比 R 键更不受焦点影响）
async function setBeltDirection(dir) {
  const btn = page.locator('.planet-build-bar__control', { hasText: '方向' }).first();
  if ((await btn.count()) === 0) { logEvent('warn', '传送带方向按钮不存在（不在传送带建造模式？）'); return false; }
  for (let i = 0; i < 7; i++) {
    const text = (await btn.textContent().catch(() => '')) ?? '';
    if (text.includes(`方向：${BELT_DIR_LABEL[dir]}`)) return true;
    await btn.click().catch(() => {});
    await sleep(250);
  }
  const text = (await btn.textContent().catch(() => '')) ?? '';
  logEvent(text.includes(`方向：${BELT_DIR_LABEL[dir]}`) ? 'info' : 'warn', `传送带方向切换 → ${text.trim()}`);
  return text.includes(`方向：${BELT_DIR_LABEL[dir]}`);
}

// 沿路径逐格铺传送带。tiles[i] 的输出方向为 dirs[i]；建造模式全程保持，最后统一退出
async function layBelts(tiles, dirs, { label = '传送带' } = {}) {
  if (!tiles.length) return true;
  const card = page.locator(`.planet-build-card[data-building-id="${BELT_TYPE}"]`);
  if ((await card.count()) === 0) { logEvent('skip', '传送带未解锁'); return false; }
  await card.scrollIntoViewIfNeeded().catch(() => {});
  if (!(await card.isEnabled().catch(() => false))) {
    logEvent('warn', `${label}: 传送带卡片不可用（矿产不足），放弃铺设`);
    return false;
  }
  await card.click();
  await sleep(600);
  let placed = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (elapsed() > TOTAL_SEC) break;
    await setBeltDirection(dirs[i]);
    if (await clickTile(tiles[i])) placed++;
    await sleep(250);
  }
  await exitBuildMode();
  logEvent('action', `${label}: 铺设传送带 ${placed}/${tiles.length} 格`);
  // 服务端核验：点击成功≠命令被受理（超距/占用会被拒），漏放的路段要打 warn 便于事后定位
  await sleep(1500);
  const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
  const scene = await getSceneAt(Math.max(0, Math.min(...xs) - 4), Math.max(0, Math.min(...ys) - 4),
    Math.max(...xs) - Math.min(...xs) + 9, Math.max(...ys) - Math.min(...ys) + 9).catch(() => null);
  if (scene) {
    const at = new Set(Object.values(scene.buildings ?? {})
      .filter((b) => b.type === BELT_TYPE && b.owner_id === PLAYER_ID)
      .map((b) => `${b.position.x}:${b.position.y}`));
    const missing = tiles.filter((t) => !at.has(`${t.x}:${t.y}`));
    if (missing.length > 0) {
      logEvent('warn', `${label}: ${missing.length} 格传送带未落地，首漏 (${missing[0].x},${missing[0].y})，货流可能断档`);
    }
  }
  await shot('belts-laid');
  return placed;
}

// BFS 找一条传送带路径：从 start 格到 end 格，end 格的输出方向固定为 finalDir（指向目标建筑）。
// isBeltAble(x,y) 判断空格可放带；start/end 格视为可用。路径不允许 U 型掉头（末端反向则判失败）。
function beltRoute(isBeltAble, start, end, finalDir, bounds) {
  const key = (x, y) => `${x}:${y}`;
  const prev = new Map([[key(start.x, start.y), null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === end.x && cur.y === end.y) {
      const path = [];
      let ck = key(cur.x, cur.y);
      while (ck) {
        const [x, y] = ck.split(':').map(Number);
        path.push({ x, y });
        ck = prev.get(ck);
      }
      path.reverse();
      const dirs = [];
      for (let i = 0; i < path.length - 1; i++) {
        dirs.push(DIR_OF_VECTOR(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y));
      }
      if (dirs.length && DIR_OPPOSITE[finalDir] === dirs[dirs.length - 1]) return null; // 末端掉头，皮带无法回灌
      dirs.push(finalDir);
      return { tiles: path, dirs };
    }
    for (const [dx, dy] of Object.values(DIR_VECTORS)) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const nk = key(nx, ny);
      if (prev.has(nk)) continue;
      if (nx < bounds.x0 || nx > bounds.x1 || ny < bounds.y0 || ny > bounds.y1) continue;
      const isEnd = nx === end.x && ny === end.y;
      if (!isEnd && !isBeltAble(nx, ny)) continue;
      prev.set(nk, key(cur.x, cur.y));
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// 建筑库存读取（scene 里 output_buffer + inventory 即“可取出/可被研究消耗”的量）
function storageQty(building, itemId) {
  const s = building?.storage;
  return (s?.output_buffer?.[itemId] ?? 0) + (s?.inventory?.[itemId] ?? 0);
}

async function findOwnedBuilding(type, pred = null) {
  const scene = await getScene();
  return Object.values(scene.buildings ?? {}).find(
    (b) => b.type === type && b.owner_id === PLAYER_ID && (!pred || pred(b))) ?? null;
}

// 以任意点为中心取 scene 并构造“空格可放带/可建造”判断（把规划占用也算进去）
function makeSiteGrid(scene, reservedTiles = []) {
  const occupied = new Set();
  for (const b of Object.values(scene.buildings ?? {})) occupied.add(`${b.position.x}:${b.position.y}`);
  for (const u of Object.values(scene.units ?? {})) occupied.add(`${u.position.x}:${u.position.y}`);
  const resourceAt = new Set((scene.resources ?? []).map((r) => `${r.position.x}:${r.position.y}`));
  for (const t of reservedTiles) occupied.add(`${t.x}:${t.y}`);
  const free = (x, y) => {
    if (x < 0 || y < 0 || x >= scene.map_width || y >= scene.map_height) return false;
    if (scene.terrain?.[y]?.[x] !== 'buildable') return false;
    return !occupied.has(`${x}:${y}`) && !resourceAt.has(`${x}:${y}`);
  };
  return { free, occupied, resourceAt };
}

// 全图分块扫描目标矿种集群（资源数据不受迷雾影响，只需一次）
async function scanClusters(kinds) {
  const clusters = new Map();
  const W = 200;
  for (let gx = 0; gx < 2000; gx += W) {
    for (let gy = 0; gy < 2000; gy += W) {
      const s = await getSceneAt(gx, gy, W, W).catch(() => null);
      if (!s) continue;
      for (const r of s.resources ?? []) {
        if (!kinds.includes(r.kind) || (r.remaining ?? 0) <= 0) continue;
        const key = `${r.kind}|${r.cluster_id}`;
        if (!clusters.has(key)) clusters.set(key, { kind: r.kind, id: r.cluster_id, tiles: [], total: 0 });
        const c = clusters.get(key);
        c.tiles.push({ x: r.position.x, y: r.position.y });
        c.total += r.remaining ?? 0;
      }
    }
  }
  return [...clusters.values()];
}

function nearestCluster(clusters, kind, from) {
  const cands = clusters.filter((c) => c.kind === kind);
  let best = null;
  for (const c of cands) {
    c.tiles.sort((a, b) => (Math.abs(a.x - from.x) + Math.abs(a.y - from.y)) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));
    c.dist = Math.abs(c.tiles[0].x - from.x) + Math.abs(c.tiles[0].y - from.y);
    if (!best || c.dist < best.dist) best = c;
  }
  return best;
}

// 矿机→短带→熔炉 三联格：矿机压矿脉，皮带一格、熔炉紧随其后，方向朝 preferToward 优先
function planMinerSmelter(grid, minerTile, preferToward) {
  const dirs = Object.keys(DIR_VECTORS).sort((a, b) => {
    const score = (d) => {
      const [dx, dy] = DIR_VECTORS[d];
      const tx = minerTile.x + 2 * dx, ty = minerTile.y + 2 * dy;
      return Math.abs(tx - preferToward.x) + Math.abs(ty - preferToward.y);
    };
    return score(a) - score(b);
  });
  for (const dir of dirs) {
    const [dx, dy] = DIR_VECTORS[dir];
    const belt = { x: minerTile.x + dx, y: minerTile.y + dy };
    const smelter = { x: minerTile.x + 2 * dx, y: minerTile.y + 2 * dy };
    if (grid.free(belt.x, belt.y) && grid.free(smelter.x, smelter.y)) {
      return { minerTile, beltTile: belt, beltDir: dir, smelterTile: smelter, dir };
    }
  }
  return null;
}

// 装配枢纽相对布局（A=锚点，x 向东 y 向南）：
//   铜带1入口(0,-1)s → 线圈装配(0,0) -e→ (1,0)e → 矩阵装配(2,0) -e→ (3,0)e → 研究站(4,0)
//   磁铁入口(-1,0)e   电路板装配(0,1) -e→ (1,1)e → (2,1)n ↗
//   铁块入口(-1,1)e   铜带2入口(0,2)n
function planHubLayout(grid, anchor) {
  const t = (dx, dy) => ({ x: anchor.x + dx, y: anchor.y + dy });
  const hub = {
    anchor,
    coilAsm: t(0, 0),
    boardAsm: t(0, 1),
    matrixAsm: t(2, 0),
    lab: t(4, 0),
    belts: [
      { tile: t(-1, 0), dir: 'east', name: '磁铁入口' },
      { tile: t(1, 0), dir: 'east', name: '线圈出线' },
      { tile: t(3, 0), dir: 'east', name: '矩阵出线' },
      { tile: t(-1, 1), dir: 'east', name: '铁块入口' },
      { tile: t(1, 1), dir: 'east', name: '电路板出线1' },
      { tile: t(2, 1), dir: 'north', name: '电路板出线2' },
      { tile: t(0, -1), dir: 'south', name: '铜带入线1' },
      { tile: t(0, 2), dir: 'north', name: '铜带入线2' },
    ],
    // 外部产线接入点（长途带终点）
    entries: {
      magnet: { tile: t(-1, 0), finalDir: 'east' },
      iron: { tile: t(-1, 1), finalDir: 'east' },
      copper1: { tile: t(0, -1), finalDir: 'south' },
      copper2: { tile: t(0, 2), finalDir: 'north' },
    },
  };
  const all = [hub.coilAsm, hub.boardAsm, hub.matrixAsm, hub.lab, ...hub.belts.map((b) => b.tile)];
  for (const tile of all) {
    if (!grid.free(tile.x, tile.y)) return null;
  }
  return hub;
}

// ---------------- 产业链建造编排 ----------------
// 精确落格建造；失败时把执行体挪近目标格（操作范围 6）重试
async function buildAtExact(buildingType, tile, { recipe = null, retries = 2 } = {}) {
  for (let i = 0; i <= retries; i++) {
    if (await buildAt(buildingType, tile, { recipe })) return true;
    if (i < retries) {
      logEvent('info', `建造 ${buildingType} @(${tile.x},${tile.y}) 未果，执行体挪近后重试`);
      await moveExecutorTo({ x: tile.x, y: tile.y }, { arriveDist: 3, maxSteps: 6 }).catch(() => false);
      await ensureOnPlanet().catch(() => {});
    }
  }
  return false;
}

// 规划一片矿区：N 组「矿机→短带→熔炉(指定配方)」，返回站位与预留格
async function planMiningSite(cluster, recipes, toward) {
  const scene = await getScene();
  const reserved = [];
  const spots = [];
  for (const tile of cluster.tiles) {
    if (spots.length >= recipes.length) break;
    if (scene.terrain?.[tile.y]?.[tile.x] !== 'buildable') continue;
    const grid = makeSiteGrid(scene, reserved);
    const plan = planMinerSmelter(grid, tile, toward);
    if (!plan) continue;
    reserved.push(plan.beltTile, plan.smelterTile);
    spots.push({ ...plan, recipe: recipes[spots.length], kind: cluster.kind });
  }
  if (spots.length < recipes.length) {
    logEvent('warn', `矿区 (${cluster.tiles[0].x},${cluster.tiles[0].y}) 规划失败：矿脉周边空地不足`);
    return null;
  }
  const stand = {
    x: Math.round((spots[0].smelterTile.x + spots[1].smelterTile.x) / 2),
    y: Math.round((spots[0].smelterTile.y + spots[1].smelterTile.y) / 2),
  };
  return { spots, stand, reserved, kind: cluster.kind };
}

// 熔炉出线起点：熔炉周边空格（排除进料带所在格），朝向目标优先
function smelterOutputStart(grid, smelterTile, inputBeltTile, toward) {
  const dirs = Object.keys(DIR_VECTORS).sort((a, b) => {
    const score = (d) => {
      const [dx, dy] = DIR_VECTORS[d];
      return Math.abs(smelterTile.x + dx - toward.x) + Math.abs(smelterTile.y + dy - toward.y);
    };
    return score(a) - score(b);
  });
  for (const dir of dirs) {
    const [dx, dy] = DIR_VECTORS[dir];
    const t = { x: smelterTile.x + dx, y: smelterTile.y + dy };
    if (t.x === inputBeltTile.x && t.y === inputBeltTile.y) continue;
    if (grid.free(t.x, t.y)) return t;
  }
  return null;
}

// 在铁区周边搜索枢纽锚点，并试算 4 条长途传送带路径（磁铁/铁块自铁区，铜块×2 自铜区）
async function planHubAndRoutes(feSite, cuSite) {
  const scene = await getScene();
  const feC = feSite.stand;
  const candidates = [];
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -7; dx <= 7; dx++) candidates.push({ x: feC.x + dx, y: feC.y + dy });
  }
  const score = (a) => Math.abs(a.x - cuSite.stand.x) + Math.abs(a.y - cuSite.stand.y)
    + 2 * (Math.abs(a.x - feC.x) + Math.abs(a.y - feC.y));
  candidates.sort((a, b) => score(a) - score(b));
  const allX = [...feSite.reserved, ...cuSite.reserved].map((t) => t.x);
  const allY = [...feSite.reserved, ...cuSite.reserved].map((t) => t.y);
  for (const anchor of candidates.slice(0, 24)) {
    const reserved = [...feSite.reserved, ...cuSite.reserved];
    const grid = makeSiteGrid(scene, reserved);
    const hub = planHubLayout(grid, anchor);
    if (!hub) continue;
    const xs = [...allX, anchor.x - 2, anchor.x + 5];
    const ys = [...allY, anchor.y - 3, anchor.y + 4];
    const bounds = {
      x0: Math.max(0, Math.min(...xs) - 12), x1: Math.max(...xs) + 12,
      y0: Math.max(0, Math.min(...ys) - 12), y1: Math.max(...ys) + 12,
    };
    const hubTiles = [hub.coilAsm, hub.boardAsm, hub.matrixAsm, hub.lab, ...hub.belts.map((b) => b.tile)];
    const routeReserved = [...reserved, ...hubTiles];
    const routes = {};
    let ok = true;
    for (const [name, spot, entry] of [
      ['magnet', feSite.spots[0], hub.entries.magnet],
      ['iron', feSite.spots[1], hub.entries.iron],
      ['copper1', cuSite.spots[0], hub.entries.copper1],
      ['copper2', cuSite.spots[1], hub.entries.copper2],
    ]) {
      const g2 = makeSiteGrid(scene, routeReserved);
      const start = smelterOutputStart(g2, spot.smelterTile, spot.beltTile, entry.tile);
      if (!start) { ok = false; break; }
      routeReserved.push(start);
      const g3 = makeSiteGrid(scene, routeReserved);
      const route = beltRoute(g3.free, start, entry.tile, entry.finalDir, bounds);
      if (!route) { ok = false; break; }
      routes[name] = route;
      routeReserved.push(...route.tiles);
    }
    if (ok) return { hub, routes, anchor };
  }
  return null;
}

// 站点电力预建：特斯拉塔贴中心 + 两台风机贴塔（消费建筑落地前先把电网铺好）
async function seedSitePower(center, { label = '站点', windCount = 2 } = {}) {
  const hasTesla = await findBuildingNear('tesla_tower', center, 8);
  if (!hasTesla) await buildNear('tesla_tower', { near: center });
  const tesla = await findBuildingNear('tesla_tower', center, 10);
  for (let i = 0; i < windCount; i++) {
    if (tesla) await buildNear('wind_turbine', { adjacentTo: tesla.position });
    else await powerBoost(1);
  }
  logEvent('action', `${label}电网预建完成（特斯拉塔+风机×${windCount}）`);
}

// 站点电力保障：多轮验证直到全部通电，缺电就补塔补风机
async function ensureSitePower(center, types, { rounds = 4, label = '站点' } = {}) {
  const online = async () => {
    const scene = await getScene().catch(() => null);
    const bs = Object.values(scene?.buildings ?? {}).filter(
      (b) => types.includes(b.type) && b.owner_id === PLAYER_ID
        && Math.abs(b.position.x - center.x) + Math.abs(b.position.y - center.y) <= 22);
    if (!bs.length) return { count: 0, ok: false };
    return { count: bs.length, ok: bs.every((b) => ['running', 'idle'].includes(b.runtime?.state)) };
  };
  for (let r = 0; r < rounds; r++) {
    const st = await online();
    if (st.count && st.ok) {
      logEvent('milestone', `${label}电力就绪（${st.count} 台在线）`);
      return true;
    }
    logEvent('info', `${label}存在未通电建筑，第 ${r + 1} 轮补电（特斯拉塔+风机）`);
    await buildNear('tesla_tower', { near: center });
    const scene = await getScene().catch(() => null);
    const tesla = Object.values(scene?.buildings ?? {})
      .filter((b) => b.type === 'tesla_tower' && b.owner_id === PLAYER_ID)
      .sort((a, b) => (Math.abs(a.position.x - center.x) + Math.abs(a.position.y - center.y))
        - (Math.abs(b.position.x - center.x) + Math.abs(b.position.y - center.y)))[0];
    if (tesla) {
      await buildNear('wind_turbine', { adjacentTo: tesla.position });
      await buildNear('wind_turbine', { adjacentTo: tesla.position });
    } else {
      await powerBoost(2);
    }
    await wander(10, `${label}补电观察`);
  }
  const st = await online();
  if (!st.ok) logEvent('warn', `${label}补电 ${rounds} 轮后仍有建筑未通电`);
  return st.count > 0 && st.ok;
}

// 生产里程碑等待：某建筑库存达到数量
async function waitStorageQty(desc, buildingId, itemId, qty, { timeoutSec = 600 } = {}) {
  return waitFor(desc, async () => {
    const scene = await getScene();
    const b = Object.values(scene.buildings ?? {}).find((x) => x.id === buildingId);
    return b && storageQty(b, itemId) >= qty;
  }, { timeoutSec, beatSec: 12 });
}

async function findBuildingNear(type, pos, maxDist = 22) {
  const scene = await getScene();
  return Object.values(scene.buildings ?? {})
    .filter((b) => b.type === type && b.owner_id === PLAYER_ID
      && Math.abs(b.position.x - pos.x) + Math.abs(b.position.y - pos.y) <= maxDist)
    .sort((a, b) => (Math.abs(a.position.x - pos.x) + Math.abs(a.position.y - pos.y))
      - (Math.abs(b.position.x - pos.x) + Math.abs(b.position.y - pos.y)))[0] ?? null;
}

// 建设一片矿区：电力 → 矿机/短带/熔炉 ×N → 验证通电与产出
// 先进场再开工：执行体操作范围只有 6 格，远离厂址的一切建造都会被服务端拒绝
async function buildMiningSite(site, { label, milestones = [] } = {}) {
  const arrived = await moveExecutorTo(site.stand, { arriveDist: 2, maxSteps: 40 });
  if (!arrived) logEvent('warn', `${label}: 执行体未能抵达厂址 (${site.stand.x},${site.stand.y})，建造可能超距失败`);
  await seedSitePower(site.stand, { label });
  for (const spot of site.spots) {
    await waitResources(50, 20, 420);
    const minerOk = await buildAtExact('mining_machine', spot.minerTile);
    if (!minerOk) {
      logEvent('warn', `${label}: 矿机落地失败 @(${spot.minerTile.x},${spot.minerTile.y})，该坑位熔炉一并跳过`);
      continue;
    }
    await layBelts([spot.beltTile], [spot.beltDir], { label: `${label}矿机短带` });
    // 矿产回扣与下游消耗挂钩，第二台熔炉的 120 矿产要等第一条产线跑一会儿
    await waitResources(120, 60, 720);
    const smelterOk = await buildAtExact('arc_smelter', spot.smelterTile, { recipe: spot.recipe });
    if (!smelterOk) logEvent('warn', `${label}: 熔炉落地失败 @(${spot.smelterTile.x},${spot.smelterTile.y})，该坑位停产`);
  }
  await ensureSitePower(site.stand, ['mining_machine', 'arc_smelter'], { label });
  for (const m of milestones) {
    const b = await findBuildingNear(m.buildingType, m.near ?? site.stand);
    if (!b) { logEvent('warn', `${label}: 找不到 ${m.buildingType}，跳过里程碑 ${m.desc}`); continue; }
    await waitStorageQty(m.desc, b.id, m.itemId, m.qty, { timeoutSec: m.timeoutSec ?? 420 });
  }
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

// 等待条件达成；等待期间做观察节拍。quiet=true 时节拍不做地图点击（行军等敏感等待用）
async function waitFor(desc, condFn, { timeoutSec = 600, beatSec = 12, quiet = false } = {}) {
  logEvent('wait', `等待: ${desc}`);
  const start = elapsed();
  while (elapsed() - start < timeoutSec) {
    if (await condFn().catch(() => false)) {
      logEvent('milestone', `${desc} ✓`);
      await shot(`milestone-${desc.replace(/[^a-zA-Z0-9一-龥]/g, '_').slice(0, 40)}`);
      return true;
    }
    await wander(beatSec, `等待中·${desc}`, { allowClick: !quiet });
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

// 分步把执行体开到目标附近（每步曼哈顿 ≤4）。
// 单步失败/超时不再整段放弃：重新读取实际位置后重试，连续失败 4 次才认输。
async function moveExecutorTo(target, { arriveDist = 2, maxSteps = 12 } = {}) {
  let consecutiveFails = 0;
  for (let step = 0; step < maxSteps; step++) {
    const pos = await executorPos();
    if (!pos) return false;
    const dist = Math.abs(pos.x - target.x) + Math.abs(pos.y - target.y);
    if (dist <= arriveDist) {
      logEvent('milestone', `执行体抵达 (${pos.x},${pos.y})`);
      return true;
    }
    // 优先走距离大的轴，单步总量 ≤4；被拒/未抵达后换先走副轴，绕过直线上的障碍
    let rem = 4;
    const dxTotal = target.x - pos.x;
    const dyTotal = target.y - pos.y;
    let dx = 0, dy = 0;
    const majorFirst = (Math.abs(dxTotal) >= Math.abs(dyTotal)) === (consecutiveFails % 2 === 0);
    if (majorFirst) {
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
    if (!moved) {
      consecutiveFails++;
      logEvent('warn', `移动命令未下达（连续第 ${consecutiveFails} 次），重新定位后重试`);
      if (consecutiveFails >= 4) { logEvent('warn', '移动命令连续失败，放弃行军'); return false; }
      step--; // 重试本步，不消耗步数预算
      await sleep(2500);
      continue;
    }
    // 行军等待期间不做地图点击（quiet），避免误触把部队带偏
    const arrived = await waitFor(`执行体移动到 (${dest.x},${dest.y})`, async () => {
      const p2 = await executorPos();
      return p2 && p2.x === dest.x && p2.y === dest.y;
    }, { timeoutSec: 90, beatSec: 8, quiet: true });
    if (!arrived) {
      consecutiveFails++;
      logEvent('warn', `本步未抵达（连续第 ${consecutiveFails} 次），重新定位后继续`);
      if (consecutiveFails >= 4) { logEvent('warn', '执行体屡次未抵达，放弃行军'); return false; }
      step--; // 从实际位置重算下一步
      continue;
    }
    consecutiveFails = 0;
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
    name: 'F2-产线核查与仓储', minEnd: 1300,
    async run() {
      await ensureOnPlanet();
      // 新经济下研究站保留（矩阵持续自产喂研究），不再拆站回款
      // 若电磁学已完成则补一座储物仓展示仓储，随后核查产线矿产流转
      if (await techCompleted('electromagnetism')) {
        await waitResources(60, 20, 300);
        await buildNear('depot_mk1', { near: BASE_POS });
      } else {
        logEvent('warn', '电磁学未完成，储物仓未解锁，跳过仓储建设');
      }
      // 验证经济流转：矿产随开采回升（不回升说明产线中断，打 warn 降级）
      const m0 = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
      const flowing = await waitFor('产线打通矿产回升', async () => {
        const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
        return m > m0 + 10;
      }, { timeoutSec: 300, beatSec: 15 });
      if (!flowing) logEvent('warn', '矿产未见回升，产线可能中断，后续阶段降级观察');
      await shot('production-line-flowing');
    },
  },
  {
    name: 'F3-电弧熔炉', minEnd: 2000,
    async run() {
      await ensureOnPlanet();
      await waitResources(120, 60, 480);
      await buildNear('arc_smelter', { near: BASE_POS });
      await wander(15, '熔炉观察');
    },
  },
  {
    name: 'F4-高斯炮塔', minEnd: 2500,
    async run() {
      await ensureOnPlanet();
      await waitResources(80, 30, 420);
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
      // 新产业链：矿机经传送带直供熔炉即不会堵库存；此处核查矿机引流与供电
      if (!(await techCompleted('basic_logistics_system'))) {
        await ensureResearch('basic_logistics_system', /基础物流/);
      }
      const scene = await getScene();
      const miner = Object.values(scene.buildings ?? {}).find((b) => b.type === 'mining_machine');
      if (!miner) { logEvent('warn', '没有矿机，无法拍产线'); return; }
      const mp = { x: miner.position.x, y: miner.position.y };
      await clickTile(mp);
      await shot('miner-check');
      await sleep(1500);
      // 矿机库存堆积说明下游带/炉不通：打 warn 并补电，不再拆机筹款（新经济由产线消耗驱动）
      const stock = storageQty(miner, miner.collect?.resource_kind ?? '') || Object.values(miner.storage?.inventory ?? {}).reduce((a, b) => a + b, 0);
      if (stock >= 40) {
        logEvent('warn', `矿机库存积压 ${stock}，下游传送带/熔炉可能中断，尝试补电复苏`);
        await powerBoost(2);
      }
      // 验证经济运转：矿产随开采回升
      const m0 = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
      await waitFor('矿产恢复增长', async () => {
        const m = (await getSummary()).players?.[PLAYER_ID]?.resources?.minerals ?? 0;
        return m > m0 + 5;
      }, { timeoutSec: 240, beatSec: 15 });
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
      await waitResources(120, 60, 480);
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
      await waitResources(80, 30, 360);
      await buildNear('gauss_turret', { near: BASE_POS });
      await waitResources(80, 30, 300);
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
  { name: 'R1-勘察与扫描', minEnd: 300, run: async () => { await phases[1].run(); } },
  { name: 'R2-远征铁矿区', minEnd: 560, run: async () => { await phases[2].run(); } },
  { name: 'R3-铁矿区开工', minEnd: 1300, run: async () => { await phases[3].run(); } },
  { name: 'R4-铜矿区开工', minEnd: 1900, run: async () => { await phases[4].run(); } },
  { name: 'R4b-装配枢纽', minEnd: 2500, run: async () => { await phases[5].run(); } },
  { name: 'R4c-传送带联网', minEnd: 3400, run: async () => { await phases[6].run(); } },
  { name: 'R4d-电磁学', minEnd: 4400, run: async () => { await phases[7].run(); } },
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
      await waitResources(50, 20, 240);
      await buildAt('mining_machine', resTile);
      await waitFor('前哨矿机投产', async () => {
        return Object.values((await getScene()).buildings ?? {}).some(
          (b) => b.type === 'mining_machine' && b.runtime?.state === 'running'
            && b.position.x === resTile.x && b.position.y === resTile.y);
      }, { timeoutSec: 180 });
      // 前哨再多补一台矿机
      const res2 = findResourceTile(await getScene(), null, 6);
      if (res2 && (res2.x !== resTile.x || res2.y !== resTile.y)) {
        await waitResources(50, 20, 180);
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
      await waitResources(120, 60, 420);
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
      await waitResources(80, 30, 300);
      await buildNear('gauss_turret', { near: BASE_POS });
      await waitResources(80, 30, 240);
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
// 产业链全局状态：P1 勘察后填充矿带，P2-P6 逐级填充厂址规划与带线路径
let CHAIN = null;

const phases = [
  {
    name: 'P0-登录与星图巡游', minEnd: 150,
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
        await page.keyboard.type(PLAYER_ID, { delay: 180 });
        await inputs.nth(2).click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type(PLAYER_KEY, { delay: 90 });
        await sleep(600);
        logEvent('action', `登录 ${PLAYER_ID}`);
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
    name: 'P1-勘察与扫描', minEnd: 300,
    async run() {
      await ensureOnPlanet();
      await openWorkflowTab('基础操作');
      await sleep(1000);
      await wander(25, '勘察基地周边');
      await scanAll();
      // 浏览各工作流页签
      for (const tab of ['研究与装料', '战斗与制造', '物流', '跨星球', '戴森', '取消与恢复']) {
        await openWorkflowTab(tab);
        await shot(`tab-${tab}`);
        await sleep(2200);
      }
      await openWorkflowTab('基础操作');
      // 全图勘察铁/铜矿带，选定产业链厂址（新开局：矩阵必须自产，铁铜缺一不可）
      const clusters = await scanClusters(['iron_ore', 'copper_ore']);
      CHAIN = CHAIN ?? {};
      CHAIN.feCluster = nearestCluster(clusters, 'iron_ore', BASE_POS);
      CHAIN.cuCluster = nearestCluster(clusters, 'copper_ore', BASE_POS);
      if (!CHAIN.feCluster || !CHAIN.cuCluster) {
        logEvent('warn', '全图扫描未找到铁/铜矿带，后续产业链阶段将降级跳过');
      } else {
        logEvent('milestone', `勘察锁定铁矿带 (${CHAIN.feCluster.tiles[0].x},${CHAIN.feCluster.tiles[0].y}) 储量 ${CHAIN.feCluster.total}`);
        logEvent('milestone', `勘察锁定铜矿带 (${CHAIN.cuCluster.tiles[0].x},${CHAIN.cuCluster.tiles[0].y}) 储量 ${CHAIN.cuCluster.total}`);
        await shot('survey-clusters');
      }
      await wander(15, '查看地图细节');
    },
  },
  {
    name: 'P2-远征铁矿区', minEnd: 560,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.feCluster || !CHAIN?.cuCluster) { logEvent('skip', '没有矿带勘察结果，跳过远征'); return; }
      const mid = {
        x: Math.round((CHAIN.feCluster.tiles[0].x + CHAIN.cuCluster.tiles[0].x) / 2),
        y: Math.round((CHAIN.feCluster.tiles[0].y + CHAIN.cuCluster.tiles[0].y) / 2),
      };
      // 铁区规划：磁铁矿机+磁铁熔炉、铁块矿机+铁块熔炉，朝向未来枢纽（两矿带中点）
      CHAIN.feSite = await planMiningSite(CHAIN.feCluster, ['smelt_magnet', 'smelt_iron'], mid);
      if (!CHAIN.feSite) { logEvent('warn', '铁区规划失败'); return; }
      logEvent('action', `铁区厂址规划完成：矿机×2+熔炉×2，站位 (${CHAIN.feSite.stand.x},${CHAIN.feSite.stand.y})`);
      const arrived = await moveExecutorTo(CHAIN.feSite.stand, { arriveDist: 3, maxSteps: 40 });
      if (arrived) logEvent('milestone', '执行体远征抵达铁矿带');
      await shot('arrive-iron-site');
      await wander(10, '矿区地貌观察');
    },
  },
  {
    name: 'P3-铁矿区开工', minEnd: 1300,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.feSite) { logEvent('skip', '铁区未规划，跳过'); return; }
      await buildMiningSite(CHAIN.feSite, {
        label: '铁矿区',
        milestones: [
          { buildingType: 'arc_smelter', near: CHAIN.feSite.spots[0].smelterTile, itemId: 'magnet', qty: 2, desc: '磁铁×2产出（电弧熔炉点火）' },
          { buildingType: 'arc_smelter', near: CHAIN.feSite.spots[1].smelterTile, itemId: 'iron_ingot', qty: 2, desc: '铁块×2产出' },
        ],
      });
      // 镜头给到矿机：矿粒上抛动画入镜
      const miner = await findBuildingNear('mining_machine', CHAIN.feSite.stand);
      if (miner) {
        await centerTile(miner.position).catch(() => {});
        await sleep(1500);
        await shot('iron-miner-working');
        await wander(12, '矿机采集特写');
      }
    },
  },
  {
    name: 'P4-铜矿区开工', minEnd: 1900,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.cuCluster || !CHAIN?.feSite) { logEvent('skip', '铜区未勘察，跳过'); return; }
      CHAIN.cuSite = await planMiningSite(CHAIN.cuCluster, ['smelt_copper', 'smelt_copper'], CHAIN.feSite.stand);
      if (!CHAIN.cuSite) { logEvent('warn', '铜区规划失败'); return; }
      await moveExecutorTo(CHAIN.cuSite.stand, { arriveDist: 3, maxSteps: 20 });
      logEvent('milestone', '执行体转进铜矿带');
      await buildMiningSite(CHAIN.cuSite, {
        label: '铜矿区',
        milestones: [
          { buildingType: 'arc_smelter', near: CHAIN.cuSite.spots[0].smelterTile, itemId: 'copper_ingot', qty: 2, desc: '铜块×2产出' },
        ],
      });
      const miner = await findBuildingNear('mining_machine', CHAIN.cuSite.stand);
      if (miner) {
        await centerTile(miner.position).catch(() => {});
        await sleep(1500);
        await wander(10, '铜矿采集特写');
      }
    },
  },
  {
    name: 'P5-装配枢纽', minEnd: 2500,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.feSite || !CHAIN?.cuSite) { logEvent('skip', '矿区未就绪，跳过枢纽'); return; }
      CHAIN.hubPlan = await planHubAndRoutes(CHAIN.feSite, CHAIN.cuSite);
      if (!CHAIN.hubPlan) { logEvent('warn', '枢纽选址失败：周边空地或传送带路径不足'); return; }
      const { hub } = CHAIN.hubPlan;
      logEvent('action', `枢纽选址 (${hub.anchor.x},${hub.anchor.y})：线圈/电路板/矩阵三台装配机+研究站，4 条长途带路径就绪`);
      await moveExecutorTo({ x: hub.anchor.x + 2, y: hub.anchor.y + 1 }, { arriveDist: 3, maxSteps: 20 });
      const hubCenter = { x: hub.anchor.x + 2, y: hub.anchor.y };
      await seedSitePower(hubCenter, { label: '装配枢纽', windCount: 3 });
      await waitResources(100, 50, 720);
      await buildAtExact('assembling_machine_mk1', hub.coilAsm, { recipe: 'magnetic_coil' });
      await waitResources(100, 50, 720);
      await buildAtExact('assembling_machine_mk1', hub.boardAsm, { recipe: 'circuit_board' });
      await waitResources(100, 50, 720);
      await buildAtExact('assembling_machine_mk1', hub.matrixAsm, { recipe: 'electromagnetic_matrix' });
      await waitResources(120, 60, 720);
      await buildAtExact('matrix_lab', hub.lab); // 不选配方 = 研究模式
      await ensureSitePower(hubCenter, ['assembling_machine_mk1', 'matrix_lab'], { label: '装配枢纽' });
    },
  },
  {
    name: 'P6-传送带联网', minEnd: 3400,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.hubPlan) { logEvent('skip', '枢纽未规划，跳过联网'); return; }
      const { hub, routes } = CHAIN.hubPlan;
      // 枢纽内部短带（装配机之间、装配机到研究站）
      await waitResources(hub.belts.length * 4 + 40, 0, 480);
      await layBelts(hub.belts.map((b) => b.tile), hub.belts.map((b) => b.dir), { label: '枢纽内部带' });
      // 4 条长途带：磁铁/铁块自铁区，铜块×2 自铜区
      for (const [name, label] of [['magnet', '磁铁长途带'], ['iron', '铁块长途带'], ['copper1', '铜块长途带①'], ['copper2', '铜块长途带②']]) {
        const route = routes[name];
        if (!route) { logEvent('warn', `${label}无路径，跳过`); continue; }
        await waitResources(route.tiles.length * 4 + 20, 0, 600);
        await layBelts(route.tiles, route.dirs, { label });
        await wander(6, `${label}货流观察`);
      }
      await shot('factory-linked');
      logEvent('milestone', '产业链传送带全线贯通，货流圆点上线');
      // 生产里程碑：线圈 → 电路板 → 电磁矩阵
      const coil = await findBuildingNear('assembling_machine_mk1', hub.coilAsm, 2);
      if (coil) await waitStorageQty('磁线圈×2产出', coil.id, 'magnetic_coil', 2, { timeoutSec: 600 });
      const board = await findBuildingNear('assembling_machine_mk1', hub.boardAsm, 2);
      if (board) await waitStorageQty('电路板×2产出', board.id, 'circuit_board', 2, { timeoutSec: 600 });
      const matrix = await findBuildingNear('assembling_machine_mk1', hub.matrixAsm, 2);
      if (matrix) await waitStorageQty('电磁矩阵×1下线', matrix.id, 'electromagnetic_matrix', 1, { timeoutSec: 600 });
    },
  },
  {
    name: 'P7-首门科技·电磁学', minEnd: 4400,
    async run() {
      await ensureOnPlanet();
      const labId = await findLabId();
      if (labId) await waitStorageQty('电磁矩阵×5送入研究站', labId, 'electromagnetic_matrix', 5, { timeoutSec: 600 });
      await ensureResearch('electromagnetism', /^电磁学/, { timeoutSec: 900 });
      await wander(10, '研究站运转特写');
    },
  },
  {
    name: 'P8-物流系统拓展', minEnd: 5200,
    async run() {
      await ensureOnPlanet();
      await ensureResearch('basic_logistics_system', /^基础物流/, { timeoutSec: 900 });
      // 电磁学解锁储物仓：造一座展示仓储落地
      if (await techCompleted('electromagnetism')) {
        await waitResources(60, 20, 300);
        await buildNear('depot_mk1', { near: CHAIN?.hubPlan?.hub?.anchor ?? BASE_POS });
      }
      await wander(15, '物流线观察');
    },
  },
  {
    name: 'P9-冶金与武器', minEnd: 6600,
    async run() {
      await ensureOnPlanet();
      await ensureResearch('automatic_metallurgy', /自动化冶金/, { timeoutSec: 700 });
      await ensureResearch('weapon_system', /武器系统/, { timeoutSec: 1200 });
      if (await techCompleted('weapon_system')) {
        await waitResources(80, 30, 300);
        await buildNear('gauss_turret', { near: CHAIN?.hubPlan?.hub?.anchor ?? BASE_POS });
        await wander(15, '炮塔防区观察');
      } else {
        logEvent('warn', '武器系统未完成（矩阵产能不足），炮塔阶段降级');
      }
    },
  },
  {
    name: 'P10-外扩侦察与终幕', minEnd: 99999,
    async run() {
      await ensureOnPlanet();
      // 侦察一处富矿带（镜头素材），有余粮就建前哨
      const cluster = await pickRichCluster(45);
      if (cluster) {
        logEvent('milestone', `锁定富矿带 ${cluster.kind} (${cluster.tile.x},${cluster.tile.y})`);
        await shot('rich-cluster');
        await moveExecutorTo({ x: cluster.tile.x - 2, y: cluster.tile.y - 2 }, { arriveDist: 2, maxSteps: 30 });
        await wander(10, '富矿带侦察');
      }
      const scene = await getScene();
      const base = Object.values(scene.buildings ?? {}).find((b) => b.type === 'battlefield_analysis_base');
      if (base) {
        await produceUnit(base.id, 'worker');
        await produceUnit(base.id, 'soldier');
      }
      await zoomOut(3);
      await wander(20, '基地全景');
      await visitPage('/system/sys-1', 20, '终幕·恒星系');
      await visitPage('/galaxy', 25, '终幕·银河');
      logEvent('milestone', '试玩收官');
    },
  },
];

// 研究保障：新产业链下矩阵由传送带直接喂进研究站（背包没有存货）。
// 流程：等研究站库存凑齐费用 → 启动研究 → 等完成。超时/缺站则 warn 降级，不拖垮整段。
async function ensureResearch(techId, nameRe, { timeoutSec = 900 } = {}) {
  if (await techCompleted(techId)) { logEvent('info', `${techId} 已完成，跳过`); return true; }
  const catalog = await getCatalog();
  const tech = (catalog.techs ?? []).find((t) => t.id === techId);
  if (!tech) { logEvent('warn', `科技 ${techId} 不在 catalog 中（可能已移除），跳过研究`); return false; }
  const labId = await findLabId();
  if (!labId) { logEvent('warn', '没有研究站，无法研究'); return false; }
  // 等传送带把矩阵喂进研究站
  for (const c of tech.cost ?? []) {
    const fed = await waitFor(`研究站集齐 ${c.item_id}×${c.quantity}`, async () => {
      const scene = await getScene();
      const lab = Object.values(scene.buildings ?? {}).find((b) => b.id === labId);
      return lab && storageQty(lab, c.item_id) >= c.quantity;
    }, { timeoutSec, beatSec: 15 });
    if (!fed) { logEvent('warn', `研究站迟迟收不到 ${c.item_id}，跳过研究 ${techId}`); return false; }
  }
  const started = await startResearch(nameRe);
  if (!started) return false;
  logEvent('wait', `等待: ${techId} 研究完成`);
  const start = elapsed();
  while (elapsed() - start < 300) {
    if (await techCompleted(techId)) {
      logEvent('milestone', `${techId} 研究完成 ✓`);
      await shot(`milestone-${techId}`);
      return true;
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
