// SiliconWorld 真实试玩录像导演脚本
// 通过 Playwright 驱动真实 Web UI 玩游戏，全程分段录像 + 事件时间戳日志 + 里程碑截图。
// 用法: node play_session.mjs [--minutes 120] [--seg-sec 480] [--out .run/video-playtest/session] [--preset full|expansion|industry|finale|recovery] [--no-pad] [--start-offset N]
// 环境变量覆盖: PLAY_WEB / PLAY_SERVER / PLAY_PLAYER_ID / PLAY_PLAYER_KEY / PLAY_PLANET_ID
//   例: PLAY_WEB=http://127.0.0.1:5698 PLAY_SERVER=http://127.0.0.1:5697 node play_session.mjs --minutes 30 --preset full --no-pad
// recovery: 从现场重建（跳过 P0-P3），续跑装配枢纽→联网→研究→终幕；幂等可重复跑
// --no-pad: 阶段干完即走（冒烟用）；正式长录不加，阶段窗口内用观察节拍填充画面
import { chromium } from '/home/firesuiry/develop/siliconWorld/client-web/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
}
const TOTAL_SEC = argVal('minutes', 120) * 60 + argVal('start-offset', 0); // --minutes 为本次运行时长；--start-offset 续接时间轴时终点相应后移
const SEG_SEC = argVal('seg-sec', 480);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '.run/video-playtest/session';
const START_OFFSET_SEC = argVal('start-offset', 0); // 续跑时的事件日志时间偏移
const NO_PAD = args.includes('--no-pad'); // 冒烟用：阶段干完即走，不做 minEnd 收尾填充

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
  // 非行星页（星图/银河）没有画布：直接返回空盒，避免 locator 自动等待 30s 超时
  if ((await surface.count()) === 0) return { offsetX: 0, offsetY: 0, tileSize: 0, box: null };
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
async function powerBoost(target = 1, avoid = PLANNED_TILES) {
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
        if (avoid?.has(`${x}:${y}`)) continue;
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
// near: 候选按到该位置的曼哈顿距离排序（默认按到执行体距离）；
// avoid: 规划预留格集合（"x:y"），避免电网建筑抢占带线/厂房规划位。
function findBuildTile(scene, { range = 6, avoidResources = true, near = null, adjacentTo = null, avoid = PLANNED_TILES } = {}) {
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
        if (avoid?.has(`${x}:${y}`)) continue;
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
  const ok = result !== before && /成功/.test(result) && !/失败|超出|out of range|拒绝/i.test(result);
  // “待回写/accepted”= 已进入建造队列但未执行：不是失败，等建筑在现场出现再判定
  const queued = !ok && result !== before && /accepted|待回写/i.test(result) && !/失败|超出|out of range|拒绝/i.test(result);
  // 账本读不到时，用服务端 scene 兜底验证（回执 UI 异常不代表命令失败）；
  // 排队受理的建造要等更久（队列执行+施工耗时）
  let finalOk = ok;
  if (!finalOk) {
    const deadline = Date.now() + (queued ? 90000 : 3000);
    while (Date.now() < deadline && !finalOk) {
      await sleep(queued ? 5000 : 3000);
      const scene = await getSceneAt(Math.max(0, tile.x - 30), Math.max(0, tile.y - 30), 60, 60).catch(() => null);
      if (scene && Object.values(scene.buildings ?? {}).some(
        (b) => b.type === buildingType && b.position.x === tile.x && b.position.y === tile.y)) finalOk = true;
    }
  }
  logEvent(finalOk ? 'action' : 'warn', `建造 ${buildingType}${recipe ? `[${recipe}]` : ''} @(${tile.x},${tile.y}) → ${finalOk ? '成功' : result.slice(0, 60)}`);
  await shot(`build-${buildingType}`);
  return finalOk;
}

// 带重试的建造：自动在执行体范围内找空地；unlessExists 指定时已存在同型建筑则跳过
async function buildNear(buildingType, { near = null, adjacentTo = null, retries = 3, unlessExists = null, avoid = null } = {}) {
  if (unlessExists) {
    const scene = await getScene();
    if (Object.values(scene.buildings ?? {}).some((b) => b.type === unlessExists)) {
      logEvent('info', `${unlessExists} 已存在，跳过建造`);
      return true;
    }
  }
  for (let i = 0; i < retries; i++) {
    const scene = await getScene();
    let tile = findBuildTile(scene, { near, adjacentTo, avoid });
    if (!tile && adjacentTo) {
      // 正交相邻格占满时退而求其次：找靠近电网节点的空地
      tile = findBuildTile(scene, { near: adjacentTo, avoid });
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

// 全局规划预留登记：所有自动选址（电网/仓储/炮塔等）都必须避开，
// 否则发电建筑会落在规划带线/厂房位上（曾整场抢占矿机短带位导致断链）
const PLANNED_TILES = new Set();
const reserveTiles = (tiles) => { for (const t of tiles) PLANNED_TILES.add(`${t.x}:${t.y}`); };

// 配方 → 产出物（防溢毒邻接判断用）
const RECIPE_OUTPUT = {
  smelt_magnet: 'magnet', smelt_iron: 'iron_ingot', smelt_copper: 'copper_ingot',
  magnetic_coil: 'magnetic_coil', circuit_board: 'circuit_board', electromagnetic_matrix: 'electromagnetic_matrix',
};
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

// 沿路径逐格铺传送带。tiles[i] 的输出方向为 dirs[i]；建造模式全程保持，最后统一退出。
// 幂等：已有自有带子的格跳过不铺（计入 placed）。
async function layBelts(tiles, dirs, { label = '传送带' } = {}) {
  if (!tiles.length) return true;
  // 预扫描：方向一致的旧带沿用；方向不符的旧带标记拆除重铺
  const xs0 = tiles.map((t) => t.x), ys0 = tiles.map((t) => t.y);
  const pre = await getSceneAt(Math.max(0, Math.min(...xs0) - 2), Math.max(0, Math.min(...ys0) - 2),
    Math.max(...xs0) - Math.min(...xs0) + 5, Math.max(...ys0) - Math.min(...ys0) + 5).catch(() => null);
  const existing = new Map(Object.values(pre?.buildings ?? {})
    .filter((b) => b.type === BELT_TYPE && b.owner_id === PLAYER_ID)
    .map((b) => [`${b.position.x}:${b.position.y}`, b.conveyor?.output]));
  const todo = [];
  let skipped = 0;
  tiles.forEach((t, i) => {
    const key = `${t.x}:${t.y}`;
    if (!existing.has(key)) { todo.push({ t, d: dirs[i], redemolish: false }); return; }
    const out = existing.get(key);
    if (out && out !== dirs[i]) { todo.push({ t, d: dirs[i], redemolish: true }); return; }
    skipped++;
  });
  if (skipped > 0) logEvent('info', `${label}: ${skipped} 格传送带已存在，直接沿用`);
  if (!todo.length) return tiles.length;
  const card = page.locator(`.planet-build-card[data-building-id="${BELT_TYPE}"]`);
  if ((await card.count()) === 0) { logEvent('skip', '传送带未解锁'); return false; }
  await card.scrollIntoViewIfNeeded().catch(() => {});
  if (!(await card.isEnabled().catch(() => false))) {
    logEvent('warn', `${label}: 传送带卡片不可用（矿产不足），放弃铺设`);
    return false;
  }
  let placed = skipped;
  // 长途带分段铺：执行体操作范围只有 6 格，每段先把执行体挪到段首附近再进建造模式
  const CHUNK = 5;
  for (let ci = 0; ci < todo.length; ci += CHUNK) {
    const chunk = todo.slice(ci, ci + CHUNK);
    if (elapsed() > TOTAL_SEC) break;
    await moveExecutorTo(chunk[0].t, { arriveDist: 3, maxSteps: 14 }).catch(() => false);
    await ensureOnPlanet().catch(() => {});
    // 方向不符的旧带先拆（建造模式外操作）
    for (const { t, redemolish } of chunk) {
      if (redemolish) {
        logEvent('info', `${label}: 拆除方向不符的旧带 @(${t.x},${t.y}) 重铺`);
        await demolishAt(t, BELT_TYPE).catch(() => false);
      }
    }
    const card2 = page.locator(`.planet-build-card[data-building-id="${BELT_TYPE}"]`);
    if ((await card2.count()) === 0 || !(await card2.isEnabled().catch(() => false))) {
      logEvent('warn', `${label}: 传送带卡片不可用，第 ${ci / CHUNK + 1} 段放弃`);
      break;
    }
    await card2.click();
    await sleep(600);
    for (const { t, d } of chunk) {
      if (elapsed() > TOTAL_SEC) break;
      await setBeltDirection(d);
      if (await clickTile(t)) placed++;
      await sleep(250);
    }
    await exitBuildMode();
  }
  logEvent('action', `${label}: 铺设传送带 ${placed}/${tiles.length} 格`);
  // 服务端核验：点击成功≠命令被受理（超距/占用会被拒）；对漏放/方向不符的格子逐格修复一次
  // （移动已自愈后，修复基本都能落地），仍不通才打 warn 降级。
  const audit = async () => {
    await sleep(1500);
    const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
    const scene = await getSceneAt(Math.max(0, Math.min(...xs) - 4), Math.max(0, Math.min(...ys) - 4),
      Math.max(...xs) - Math.min(...xs) + 9, Math.max(...ys) - Math.min(...ys) + 9).catch(() => null);
    if (!scene) return { missing: [], wrongDir: [] };
    const belts = Object.values(scene.buildings ?? {})
      .filter((b) => b.type === BELT_TYPE && b.owner_id === PLAYER_ID);
    const at = new Map(belts.map((b) => [`${b.position.x}:${b.position.y}`, b.conveyor?.output]));
    return {
      missing: tiles.filter((t) => !at.has(`${t.x}:${t.y}`)),
      wrongDir: tiles.filter((t, i) => at.has(`${t.x}:${t.y}`) && at.get(`${t.x}:${t.y}`) && at.get(`${t.x}:${t.y}`) !== dirs[i]),
    };
  };
  let { missing, wrongDir } = await audit();
  for (const t of wrongDir) {
    if (elapsed() > TOTAL_SEC) break;
    logEvent('info', `${label}: 修复方向不符 @(${t.x},${t.y})`);
    await moveExecutorTo(t, { arriveDist: 3, maxSteps: 14 }).catch(() => false);
    await demolishAt(t, BELT_TYPE).catch(() => false);
    const i = tiles.findIndex((x) => x.x === t.x && x.y === t.y);
    const card3 = page.locator(`.planet-build-card[data-building-id="${BELT_TYPE}"]`);
    if (i >= 0 && (await card3.count()) > 0 && (await card3.isEnabled().catch(() => false))) {
      await card3.click();
      await sleep(500);
      await setBeltDirection(dirs[i]);
      await clickTile(t);
      await sleep(300);
      await exitBuildMode();
    }
  }
  for (const t of missing) {
    if (elapsed() > TOTAL_SEC) break;
    logEvent('info', `${label}: 补铺漏放 @(${t.x},${t.y})`);
    await moveExecutorTo(t, { arriveDist: 3, maxSteps: 14 }).catch(() => false);
    const i = tiles.findIndex((x) => x.x === t.x && x.y === t.y);
    const card4 = page.locator(`.planet-build-card[data-building-id="${BELT_TYPE}"]`);
    if (i >= 0 && (await card4.count()) > 0 && (await card4.isEnabled().catch(() => false))) {
      await card4.click();
      await sleep(500);
      await setBeltDirection(dirs[i]);
      await clickTile(t);
      await sleep(300);
      await exitBuildMode();
    }
  }
  if (wrongDir.length || missing.length) ({ missing, wrongDir } = await audit());
  if (missing.length > 0) {
    logEvent('warn', `${label}: ${missing.length} 格传送带未落地，首漏 (${missing[0].x},${missing[0].y})，货流可能断档`);
  }
  if (wrongDir.length > 0) {
    logEvent('warn', `${label}: ${wrongDir.length} 格传送带方向不符，首处 (${wrongDir[0].x},${wrongDir[0].y})，链路可能不通`);
  }
  await shot('belts-laid');
  return placed;
}

// BFS 找一条传送带路径：从 start 格到终点集合中的任意格。
// endSet: Map<"x:y", finalDir|null>——终点为枢纽入口时 finalDir 固定（带指向建筑，末端不许掉头）；
// 终点为既有路线的汇流格时 finalDir=null（方向沿用既有带，无掉头约束）。
// BFS 寻路一条皮带路径。ableDir(x,y,dir)（可选）：方向感知的合法性校验——
// 扩展 cur→next 时锁定 cur 的带子方向为步进方向，终点格方向为 finalDir，
// 用于"定向溢毒"约束（带子方向背离生产商才会被其溢出货物的服务端实测规则）。
function beltRoute(isBeltAble, start, endSet, bounds, ableDir = null) {
  const key = (x, y) => `${x}:${y}`;
  const prev = new Map([[key(start.x, start.y), null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const curKey = key(cur.x, cur.y);
    if (endSet.has(curKey)) {
      const finalDir = endSet.get(curKey);
      if (finalDir && ableDir && !ableDir(cur.x, cur.y, finalDir)) {
        // 终点格以 finalDir 指向时非法（如末端指向会中毒），本终点不可达
        continue;
      }
      const path = [];
      let ck = curKey;
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
      if (finalDir) {
        if (dirs.length && DIR_OPPOSITE[finalDir] === dirs[dirs.length - 1]) return null; // 末端掉头，皮带无法回灌
        dirs.push(finalDir);
      }
      return { tiles: path, dirs, endTile: cur };
    }
    for (const [stepDir, [dx, dy]] of Object.entries(DIR_VECTORS)) {
      const nx = cur.x + dx, ny = cur.y + dy, nk = key(nx, ny);
      if (prev.has(nk)) continue;
      if (nx < bounds.x0 || nx > bounds.x1 || ny < bounds.y0 || ny > bounds.y1) continue;
      if (!endSet.has(nk) && !isBeltAble(nx, ny)) continue;
      // cur 的带子方向被本步锁定为 stepDir：非法则不走这个方向
      if (ableDir && !ableDir(cur.x, cur.y, stepDir)) continue;
      prev.set(nk, curKey);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// 装配枢纽规划（星型拓扑 + BFS 实算路由）：给 4 台熔炉（磁/铁/铜×2，已建成或仅规划均可）配
// 一个「3 装配机+研究站」枢纽。布局：矩阵装配机居中，线圈/电路板装配机左右各 2 格，研究站
// 下（或上）方 2 格；内部带仅 3 格（线圈→矩阵、电路板→矩阵、矩阵→研究站），互不贴邻。
// 4 条熔炉入线用 beltRoute 从熔炉侧面实算到装配机空闲侧面。
// 规则（全部来自服务端实测）：建筑只从"指向自己"的带子取货；生产商满线后会向侧面
// 任意带子溢出（溢毒），故带路中段不得贴"产出≠本线物品"的生产商；
// 已存在的自有建筑/带子可复用（幂等：probe 建了一半，正式跑接着来）。
// 诊断：每个锚点的失败环节（layout / 哪条路线 no-path）计数上报。
async function planAssemblerHub(smelters, { center = BASE_POS, extraProducers = new Map(), extraPlanned = [] } = {}) {
  const scene = await getScene();
  const occupied = new Map(); // "x:y" -> building
  for (const b of Object.values(scene.buildings ?? {})) occupied.set(`${b.position.x}:${b.position.y}`, b);
  const unitAt = new Set(Object.values(scene.units ?? {}).map((u) => `${u.position.x}:${u.position.y}`));
  const resourceAt = new Set((scene.resources ?? []).map((r) => `${r.position.x}:${r.position.y}`));
  const resourceKindAt = new Map((scene.resources ?? []).map((r) => [`${r.position.x}:${r.position.y}`, r.kind]));
  // 生产商产出图：矿机→矿种，熔炉/装配机→配方产出；规划中的矿机/熔炉同样算生产商
  const producerMap = new Map(extraProducers);
  for (const b of occupied.values()) {
    const k = `${b.position.x}:${b.position.y}`;
    if (b.type === 'mining_machine') producerMap.set(k, resourceKindAt.get(k) ?? 'ore');
    else if (RECIPE_OUTPUT[recipeOf(b)]) producerMap.set(k, RECIPE_OUTPUT[recipeOf(b)]);
  }
  const beltAt = new Set();
  for (const b of occupied.values()) {
    if (b.type === BELT_TYPE && b.owner_id === PLAYER_ID) beltAt.add(`${b.position.x}:${b.position.y}`);
  }
  const planned = new Set(extraPlanned.map((t) => `${t.x}:${t.y}`));
  // 产线直供带保护：矿机出料带（方向背离矿机）与熔炉入料带（指向熔炉）是既有产线的命门，
  // 路线规划不得穿越/改向（曾反复被长途线改向导致矿机断料）
  for (const b of occupied.values()) {
    if (b.owner_id !== PLAYER_ID) continue;
    if (b.type !== 'mining_machine' && b.type !== 'arc_smelter') continue;
    for (const [ndir, [dx, dy]] of Object.entries(DIR_VECTORS)) {
      const k = `${b.position.x + dx}:${b.position.y + dy}`;
      const belt = occupied.get(k);
      if (!belt || belt.type !== BELT_TYPE || belt.owner_id !== PLAYER_ID) continue;
      const out = belt.conveyor?.output;
      if (!out) continue;
      // 矿机相邻带一律保护：方向背离矿机的是现役出料带；方向不对的带一旦被路线复用改向，
      // 就会变成矿机出料口，把原矿泄进路线造成污染
      if (b.type === 'mining_machine') { planned.add(k); continue; }
      if (out === DIR_OPPOSITE[ndir]) planned.add(k); // 熔炉入料带（指向熔炉）
    }
  }
  const free = (x, y) => x >= 0 && y >= 0 && x < scene.map_width && y < scene.map_height
    && scene.terrain?.[y]?.[x] === 'buildable'
    && !occupied.has(`${x}:${y}`) && !unitAt.has(`${x}:${y}`) && !resourceAt.has(`${x}:${y}`) && !planned.has(`${x}:${y}`);
  const freeOrOwn = (x, y, type) => {
    if (free(x, y)) return true;
    const ex = occupied.get(`${x}:${y}`);
    return !!(ex && ex.owner_id === PLAYER_ID && ex.type === type);
  };
  // 定向溢毒（服务端 building_io_settlement.go 实测规则）：生产商只把货溢到
  // "方向背离自己"的相邻带子上（allowsInput 要求带子从其背侧接货）；指向生产商或
  // 与其轴向垂直的带子都是安全的。因此只需按带子的实际方向判定：
  // 格 (x,y) 上方向为 dir 的带子，相邻生产商位于 ndir 方向时，仅当 dir === DIR_OPPOSITE[ndir]
  // （带子背离生产商）且其产出不在 items 白名单时才中毒。
  const poisonByDir = (x, y, dir, items, exemptKeys) => {
    for (const [ndir, [dx, dy]] of Object.entries(DIR_VECTORS)) {
      const kk = `${x + dx}:${y + dy}`;
      if (exemptKeys.has(kk)) continue;
      const out = producerMap.get(kk);
      if (out && !items.includes(out) && dir === DIR_OPPOSITE[ndir]) return false;
    }
    return true;
  };

  // ---------- 快速路径：贴炉直供枢纽 ----------
  // 线圈机贴磁炉、电路板机贴铁炉（各一格直供带）；矩阵机与线圈机同轴隔格相连，
  // 且与电路板机同轴相距 2（另一条直连带）；研究站贴矩阵机。只有两条铜线需要长途 BFS。
  // 拥挤出生区里，2 条长线远比 4 条缠绕可靠。
  const tryDirectFeedHub = () => {
    const { magnet, iron, copperA, copperB } = smelters;
    if (!magnet || !iron || !copperA || !copperB) return null;
    const bail = {}; // 诊断：各失败环节计数
    const bailAt = (k) => { bail[k] = (bail[k] ?? 0) + 1; };
    const DIRS = Object.entries(DIR_VECTORS);
    const taken = new Set([...planned]);
    const take = (t) => { const k = `${t.x}:${t.y}`; if (taken.has(k)) return false; return true; };
    const add = (t) => taken.add(`${t.x}:${t.y}`);
    const routeBfs = (srcTile, endTile, finalDir, item, extraExempt, forbidFn = null) => {
      const srcKey = `${srcTile.x}:${srcTile.y}`;
      const exempt = new Set([srcKey, ...extraExempt]);
      const starts = Object.values(DIR_VECTORS)
        .map(([dx, dy]) => ({ x: srcTile.x + dx, y: srcTile.y + dy }))
        .filter((t) => !taken.has(`${t.x}:${t.y}`))
        .filter((t) => free(t.x, t.y) || beltAt.has(`${t.x}:${t.y}`));
      for (const start of starts) {
        const srcDir = DIR_OF_VECTOR(start.x - srcTile.x, start.y - srcTile.y);
        const able = (x, y) => {
          const kk = `${x}:${y}`;
          if (x === start.x && y === start.y) return true;
          if (taken.has(kk)) return false;
          if (forbidFn && forbidFn(x, y)) return false;
          return free(x, y) || beltAt.has(kk);
        };
        const ableDir = (x, y, dir) => {
          if (x === start.x && y === start.y && dir !== srcDir) return false;
          return poisonByDir(x, y, dir, [item], exempt);
        };
        const xs = [srcTile.x, endTile.x], ys = [srcTile.y, endTile.y];
        const bounds = {
          x0: Math.max(0, Math.min(...xs) - 18), x1: Math.max(...xs) + 18,
          y0: Math.max(0, Math.min(...ys) - 18), y1: Math.max(...ys) + 18,
        };
        const r = beltRoute(able, start, new Map([[`${endTile.x}:${endTile.y}`, finalDir]]), bounds, ableDir);
        if (r) return r;
      }
      return null;
    };
    // 两种直供配置：北枢纽（磁/铁直供，双铜布线）与南枢纽（双铜直供，磁/铁布线）。
    // 哪一种的两条布线都能放得下就用哪一种
    const FEED_CONFIGS = [
      { coilFeed: { item: 'magnet', src: magnet }, boardFeed: { item: 'iron_ingot', src: iron },
        coilRoute: { item: 'copper_ingot', src: copperA, name: 'copperA' }, boardRoute: { item: 'copper_ingot', src: copperB, name: 'copperB' } },
      { coilFeed: { item: 'copper_ingot', src: copperA }, boardFeed: { item: 'copper_ingot', src: copperB },
        coilRoute: { item: 'magnet', src: magnet, name: 'magnet' }, boardRoute: { item: 'iron_ingot', src: iron, name: 'iron' } },
    ];
    for (const cfg of FEED_CONFIGS) {
      for (const [d1, [dx1, dy1]] of DIRS) {
        const beltC = { x: cfg.coilFeed.src.x + dx1, y: cfg.coilFeed.src.y + dy1 };
        const coilAsm = { x: cfg.coilFeed.src.x + 2 * dx1, y: cfg.coilFeed.src.y + 2 * dy1 };
        if (!take(beltC) || !take(coilAsm)) continue;
        if (!(free(coilAsm.x, coilAsm.y) || (occupied.get(`${coilAsm.x}:${coilAsm.y}`)?.type === 'assembling_machine_mk1'))) { bailAt('coilAsm格'); continue; }
        if (!(free(beltC.x, beltC.y) || beltAt.has(`${beltC.x}:${beltC.y}`))) continue;
        if (!poisonByDir(beltC.x, beltC.y, d1, [cfg.coilFeed.item], new Set([`${cfg.coilFeed.src.x}:${cfg.coilFeed.src.y}`, `${coilAsm.x}:${coilAsm.y}`]))) { bailAt('beltC毒'); continue; }
        for (const [d2, [dx2, dy2]] of DIRS) {
          const beltB = { x: cfg.boardFeed.src.x + dx2, y: cfg.boardFeed.src.y + dy2 };
          const boardAsm = { x: cfg.boardFeed.src.x + 2 * dx2, y: cfg.boardFeed.src.y + 2 * dy2 };
          if (!take(beltB) || !take(boardAsm)) continue;
          if (!(free(boardAsm.x, boardAsm.y) || (occupied.get(`${boardAsm.x}:${boardAsm.y}`)?.type === 'assembling_machine_mk1'))) continue;
          if (!(free(beltB.x, beltB.y) || beltAt.has(`${beltB.x}:${beltB.y}`))) continue;
          if (!poisonByDir(beltB.x, beltB.y, d2, [cfg.boardFeed.item], new Set([`${cfg.boardFeed.src.x}:${cfg.boardFeed.src.y}`, `${boardAsm.x}:${boardAsm.y}`]))) continue;
          for (const [d3, [dx3, dy3]] of DIRS) {
            const beltM1 = { x: coilAsm.x + dx3, y: coilAsm.y + dy3 };
            const matrixAsm = { x: coilAsm.x + 2 * dx3, y: coilAsm.y + 2 * dy3 };
            if (!take(beltM1) || !take(matrixAsm)) continue;
            // 矩阵机必须与电路板机同轴相距 2（直连带喂电路板）
            const bdx = matrixAsm.x - boardAsm.x, bdy = matrixAsm.y - boardAsm.y;
            if (Math.abs(bdx) + Math.abs(bdy) !== 2 || (bdx !== 0 && bdy !== 0)) { bailAt('矩阵不同轴'); continue; }
            const beltM2 = { x: boardAsm.x + bdx / 2, y: boardAsm.y + bdy / 2 };
            const beltM2Dir = DIR_OF_VECTOR(bdx, bdy);
            if (!take(beltM2)) continue;
            if (!(free(matrixAsm.x, matrixAsm.y) || (occupied.get(`${matrixAsm.x}:${matrixAsm.y}`)?.type === 'assembling_machine_mk1'))) continue;
            if (!(free(beltM1.x, beltM1.y) || beltAt.has(`${beltM1.x}:${beltM1.y}`))) continue;
            if (!(free(beltM2.x, beltM2.y) || beltAt.has(`${beltM2.x}:${beltM2.y}`))) continue;
            const coilK = `${coilAsm.x}:${coilAsm.y}`, boardK = `${boardAsm.x}:${boardAsm.y}`, matrixK = `${matrixAsm.x}:${matrixAsm.y}`;
            if (!poisonByDir(beltM1.x, beltM1.y, d3, ['magnetic_coil'], new Set([coilK, matrixK]))) continue;
            if (!poisonByDir(beltM2.x, beltM2.y, beltM2Dir, ['circuit_board'], new Set([boardK, matrixK]))) continue;
            // 研究站：矩阵机外侧（不回头朝线圈机）
            for (const [d4, [dx4, dy4]] of DIRS) {
              if (d4 === DIR_OPPOSITE[d3]) continue;
              const beltL = { x: matrixAsm.x + dx4, y: matrixAsm.y + dy4 };
              const lab = { x: matrixAsm.x + 2 * dx4, y: matrixAsm.y + 2 * dy4 };
              if (!take(beltL) || !take(lab)) continue;
              if (!(free(lab.x, lab.y) || (occupied.get(`${lab.x}:${lab.y}`)?.type === 'matrix_lab'))) continue;
              if (!(free(beltL.x, beltL.y) || beltAt.has(`${beltL.x}:${beltL.y}`))) continue;
              if (!poisonByDir(beltL.x, beltL.y, d4, ['electromagnetic_matrix'], new Set([matrixK, `${lab.x}:${lab.y}`]))) continue;
              // 布线入料侧：线圈机/电路板机未被占用的侧面
              const sideOf = (asm, blockedKeys) => Object.entries(DIR_VECTORS)
                .map(([dir, [dx, dy]]) => ({ tile: { x: asm.x + dx, y: asm.y + dy }, finalDir: DIR_OPPOSITE[dir] }))
                .filter((e) => !blockedKeys.has(`${e.tile.x}:${e.tile.y}`) && !taken.has(`${e.tile.x}:${e.tile.y}`))
                .filter((e) => free(e.tile.x, e.tile.y) || beltAt.has(`${e.tile.x}:${e.tile.y}`));
              const hubBlock = new Set([coilK, boardK, matrixK, `${lab.x}:${lab.y}`,
                `${beltC.x}:${beltC.y}`, `${beltB.x}:${beltB.y}`, `${beltM1.x}:${beltM1.y}`, `${beltM2.x}:${beltM2.y}`, `${beltL.x}:${beltL.y}`]);
              // 枢纽全部格子（含直供/内部带）必须先占位，否则布线会穿越直供带并改向它们；
              // 布线失败换布局时必须回滚，否则后续变体的格子被上一次尝试毒化
              for (const k of hubBlock) taken.add(k);
              // 汇流优先：布线路线只需接入对应直供带的任意相邻格（混合带，装配机按配方拣货），
              // 不再需要两条独立长线各自挤进枢纽——这是决胜关键
              const routeWithMerge = (srcTile, item, mergeBelt, asmEnds, asmKey) => {
                const dbg = process.env.HUB_DEBUG;
                const srcKey = `${srcTile.x}:${srcTile.y}`;
                const exempt = new Set([srcKey, asmKey]);
                const starts = Object.values(DIR_VECTORS)
                  .map(([dx, dy]) => ({ x: srcTile.x + dx, y: srcTile.y + dy }))
                  .filter((t) => !taken.has(`${t.x}:${t.y}`))
                  .filter((t) => free(t.x, t.y) || beltAt.has(`${t.x}:${t.y}`));
                // 汇流目标：直供带的空格邻居（指向直供带即汇入）
                const mergeEnds = [];
                for (const [md, [mdx, mdy]] of Object.entries(DIR_VECTORS)) {
                  const t = { x: mergeBelt.x + mdx, y: mergeBelt.y + mdy };
                  if (taken.has(`${t.x}:${t.y}`)) continue;
                  if (!(free(t.x, t.y) || beltAt.has(`${t.x}:${t.y}`))) continue;
                  mergeEnds.push({ tile: t, finalDir: DIR_OPPOSITE[md] }); // 末段必须指向汇流带（md 是带到格的方位，取反）
                }
                for (const start of starts) {
                  const srcDir = DIR_OF_VECTOR(start.x - srcTile.x, start.y - srcTile.y);
                  const mkAble = () => (x, y) => {
                    const kk = `${x}:${y}`;
                    if (x === start.x && y === start.y) return true;
                    if (taken.has(kk)) return false;
                    return free(x, y) || beltAt.has(kk);
                  };
                  const ableDir = (x, y, dir) => {
                    if (x === start.x && y === start.y && dir !== srcDir) return false;
                    return poisonByDir(x, y, dir, [item], exempt);
                  };
                  const allY = [srcTile.y, mergeBelt.y, ...asmEnds.map((e) => e.tile.y)];
                  const allX = [srcTile.x, mergeBelt.x, ...asmEnds.map((e) => e.tile.x)];
                  const bounds = {
                    x0: Math.max(0, Math.min(...allX) - 18), x1: Math.max(...allX) + 18,
                    y0: Math.max(0, Math.min(...allY) - 18), y1: Math.max(...allY) + 18,
                  };
                  for (const e of [...mergeEnds, ...asmEnds]) {
                    const r = routeBfs0(start, e, bounds, mkAble(), ableDir);
                    if (r) return r;
                    if (dbg) console.log(`[hubdbg]   ${item} start(${start.x},${start.y})->end(${e.tile.x},${e.tile.y})${e.finalDir} 无果`);
                  }
                }
                return null;
              };
              // 底层 BFS 包装（汇流/独立统一）
              const routeBfs0 = (start, end, bounds, able, ableDir) =>
                beltRoute(able, start, new Map([[`${end.tile.x}:${end.tile.y}`, end.finalDir]]), bounds, ableDir);
              const rCoil = routeWithMerge(cfg.coilRoute.src, cfg.coilRoute.item, beltC, sideOf(coilAsm, hubBlock), coilK);
              if (rCoil) for (const t of rCoil.tiles) taken.add(`${t.x}:${t.y}`); // 先占线，第二条必须绕行
              const rBoard = rCoil ? routeWithMerge(cfg.boardRoute.src, cfg.boardRoute.item, beltB, sideOf(boardAsm, hubBlock), boardK) : null;
              const routed = (rCoil && rBoard)
                ? { [cfg.coilRoute.name]: rCoil, [cfg.boardRoute.name]: rBoard } : null;
              if (!routed) {
                if (rCoil) for (const t of rCoil.tiles) taken.delete(`${t.x}:${t.y}`);
                for (const k of hubBlock) taken.delete(k);
                bailAt('布线全败');
                continue;
              }
              // 全部落定：登记+返回
              for (const t of [...hubBlock].map((k) => k.split(':').map(Number))) planned.add(`${t[0]}:${t[1]}`);
              const beltList = [
                { tile: beltC, dir: d1, items: [cfg.coilFeed.item] },
                { tile: beltB, dir: d2, items: [cfg.boardFeed.item] },
                { tile: beltM1, dir: d3, items: ['magnetic_coil'] },
                { tile: beltM2, dir: beltM2Dir, items: ['circuit_board'] },
                { tile: beltL, dir: d4, items: ['electromagnetic_matrix'] },
              ];
              const directBeltRoute = (belt, dir) => ({ tiles: [belt], dirs: [dir] });
              const routeOf = (feed, belt, dir) => routed[feed.name] ?? null;
              const routes = {};
              // 磁/铁/铜A/铜B 四线各自对应直供带或布线路由
              const assign = (name, feed, belt, dir) => {
                if (cfg.coilFeed.src === feed.src && cfg.coilFeed.item === feed.item) routes[name] = directBeltRoute(beltC, d1);
                else if (cfg.boardFeed.src === feed.src && cfg.boardFeed.item === feed.item) routes[name] = directBeltRoute(beltB, d2);
                else routes[name] = routed[name];
              };
              assign('magnet', { src: magnet, item: 'magnet' }, beltC, d1);
              assign('iron', { src: iron, item: 'iron_ingot' }, beltB, d2);
              assign('copperA', { src: copperA, item: 'copper_ingot' }, beltC, d1);
              assign('copperB', { src: copperB, item: 'copper_ingot' }, beltB, d2);
              const buildings = [
                { key: 'coilAsm', type: 'assembling_machine_mk1', recipe: 'magnetic_coil', tile: coilAsm },
                { key: 'boardAsm', type: 'assembling_machine_mk1', recipe: 'circuit_board', tile: boardAsm },
                { key: 'matrixAsm', type: 'assembling_machine_mk1', recipe: 'electromagnetic_matrix', tile: matrixAsm },
                { key: 'lab', type: 'matrix_lab', recipe: null, tile: lab },
              ];
              let stand = null;
              outer: for (let d = 0; d <= 6; d++) {
                for (let dx = -d; dx <= d; dx++) {
                  const dy = d - Math.abs(dx);
                  for (const sy of (dy === 0 ? [0] : [-dy, dy])) {
                    const t = { x: matrixAsm.x + dx, y: matrixAsm.y + 2 + sy };
                    if (free(t.x, t.y) && !taken.has(`${t.x}:${t.y}`)) { stand = t; break outer; }
                  }
                }
              }
              stand ??= { x: matrixAsm.x, y: matrixAsm.y + 2 };
              const allT = [...buildings.map((b) => b.tile), ...beltList.map((b) => b.tile),
                ...Object.values(routes).filter(Boolean).flatMap((r) => r.tiles)];
              reserveTiles(allT);
              logEvent('action', `装配枢纽选址 (${matrixAsm.x},${matrixAsm.y})（贴炉直供）：3 装配机+研究站，布线 ${Object.values(routes).map((r) => r.tiles.length).join('/')} 格`);
              return { anchor: matrixAsm, rot: 0, buildings, belts: beltList, routes, stand };
            }
          }
        }
      }
    }
    logEvent('warn', `贴炉直供选址失败诊断: ${JSON.stringify(bail)}`);
    return null;
  };
  const directPlan = tryDirectFeedHub();
  if (directPlan) return directPlan;

  // 星型布局变体（锚点 = 矩阵装配机 M）：线圈 C/电路板 B 左右各 2 格，研究站 L 上下 2 格。
  // 内部带恰好落在两建筑中间格，指向目标建筑，天然互不贴邻。
  const LAYOUTS = [
    { coil: [-2, 0], board: [2, 0], lab: [0, 2] },
    { coil: [2, 0], board: [-2, 0], lab: [0, 2] },
    { coil: [-2, 0], board: [2, 0], lab: [0, -2] },
    { coil: [2, 0], board: [-2, 0], lab: [0, -2] },
  ];
  const smelterArr = [smelters.magnet, smelters.iron, smelters.copperA, smelters.copperB].filter(Boolean);
  const cx = Math.round(smelterArr.reduce((s, t) => s + t.x, 0) / smelterArr.length);
  const cy = Math.round(smelterArr.reduce((s, t) => s + t.y, 0) / smelterArr.length);
  // 候选锚点：熔炉质心与基地两处的螺旋环（距离 3 起，避开熔炉集群），按到熔炉总距离升序
  const anchors = [];
  const seenAnchor = new Set();
  for (const c of [{ x: cx, y: cy }, center]) {
    for (let d = 3; d <= 30; d++) {
      for (let dx = -d; dx <= d; dx++) {
        const dy = d - Math.abs(dx);
        for (const sy of (dy === 0 ? [0] : [-dy, dy])) {
          const a = { x: c.x + dx, y: c.y + sy };
          const k = `${a.x}:${a.y}`;
          if (seenAnchor.has(k)) continue;
          seenAnchor.add(k);
          anchors.push(a);
        }
      }
    }
  }
  const distSum = (a) => smelterArr.reduce((s, t) => s + Math.abs(t.x - a.x) + Math.abs(t.y - a.y), 0);
  // 空旷度优先：出生区/矿区集群内走廊极度拥挤，枢纽落在开阔地才能让 4 条入线各自绕行；
  // 空旷度 = 锚点 7×7 邻域内的空格数（矿石/建筑/水体都算障碍），先空旷后近距
  const openness = (a) => {
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (free(a.x + dx, a.y + dy)) n++;
      }
    }
    return n;
  };
  // 幂等优先：现场已有枢纽建筑（probe 建了一半/全部）时，优先在其位置续建，不起第二座枢纽
  const hubAnchors = [];
  for (const b of occupied.values()) {
    if (b.owner_id === PLAYER_ID && (b.type === 'assembling_machine_mk1' || b.type === 'matrix_lab')) {
      hubAnchors.push({ x: b.position.x, y: b.position.y });
      // 已有装配机可能处于星型的 C/B/M 任意位，连带其周边 2 格也作为候选锚点
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        hubAnchors.push({ x: b.position.x + dx, y: b.position.y + dy });
      }
    }
  }
  anchors.sort((a, b) => (openness(b) - openness(a)) || (distSum(a) - distSum(b)));
  anchors.unshift(...hubAnchors.filter((a, i) => hubAnchors.findIndex((c) => c.x === a.x && c.y === a.y) === i));

  const diag = { layout: 0 };
  for (const anchor of anchors.slice(0, 1200)) {
    for (const lay of LAYOUTS) {
      const at = (rel) => ({ x: anchor.x + rel[0], y: anchor.y + rel[1] });
      const buildings = [
        { key: 'coilAsm', type: 'assembling_machine_mk1', recipe: 'magnetic_coil', tile: at(lay.coil) },
        { key: 'boardAsm', type: 'assembling_machine_mk1', recipe: 'circuit_board', tile: at(lay.board) },
        { key: 'matrixAsm', type: 'assembling_machine_mk1', recipe: 'electromagnetic_matrix', tile: { ...anchor } },
        { key: 'lab', type: 'matrix_lab', recipe: null, tile: at(lay.lab) },
      ];
      const midOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const dirOf = (from, to) => DIR_OF_VECTOR(to.x - from.x, to.y - from.y);
      const belts = [
        { tile: midOf(buildings[0].tile, anchor), dir: dirOf(buildings[0].tile, anchor), items: ['magnetic_coil'] },
        { tile: midOf(buildings[1].tile, anchor), dir: dirOf(buildings[1].tile, anchor), items: ['circuit_board'] },
        { tile: midOf(anchor, buildings[3].tile), dir: dirOf(anchor, buildings[3].tile), items: ['electromagnetic_matrix'] },
      ];
      const hubKeys = new Set(buildings.map((b) => `${b.tile.x}:${b.tile.y}`));
      const coreTiles = [...buildings.map((b) => b.tile), ...belts.map((b) => b.tile)];
      // 落位：空格，或可复用的同型自有建筑/自有带子
      const okTiles = buildings.every((b) => freeOrOwn(b.tile.x, b.tile.y, b.type))
        && belts.every((b) => free(b.tile.x, b.tile.y) || beltAt.has(`${b.tile.x}:${b.tile.y}`));
      if (!okTiles) { diag.layout++; if (process.env.HUB_DEBUG && anchor.x === 5 && anchor.y === 10) console.log('[hubdbg] okTiles失败', JSON.stringify(lay)); continue; }
      // 安静区：内部带的实际方向不得被外部生产商定向溢毒（建筑格本身不会接溢出，无需检查）
      const quiet = belts.every((b) => poisonByDir(b.tile.x, b.tile.y, b.dir, b.items, hubKeys));
      if (!quiet) { diag.layout++; if (process.env.HUB_DEBUG && anchor.x === 5 && anchor.y === 10) console.log('[hubdbg] quiet失败', JSON.stringify(lay), JSON.stringify(belts)); continue; }
      const attemptTiles = [...coreTiles];
      for (const t of coreTiles) planned.add(`${t.x}:${t.y}`);

      // 4 条熔炉入线：磁/铜A → 线圈装配机，铁/铜B → 电路板装配机
      const ROUTES = [
        ['magnet', 'magnet', smelters.magnet, buildings[0]],
        ['copperA', 'copper_ingot', smelters.copperA, buildings[0]],
        ['iron', 'iron_ingot', smelters.iron, buildings[1]],
        ['copperB', 'copper_ingot', smelters.copperB, buildings[1]],
      ];
      // 端点保护：两台装配机的入料口候选格只允许作为“以其为目标”路线的终点，
      // 禁止被其他路线穿越占用（否则先到路线会把后到路线的所有入料侧全部堵死）
      const asmEndTiles = new Set();
      for (const b of [buildings[0], buildings[1]]) {
        for (const [dx, dy] of Object.values(DIR_VECTORS)) {
          asmEndTiles.add(`${b.tile.x + dx}:${b.tile.y + dy}`);
        }
      }
      for (const t of coreTiles) asmEndTiles.delete(`${t.x}:${t.y}`);
      // 路线顺序影响成败：先走的路线会挤占走廊（后走的路线可能失去起点/终点）。
      // 预定义几种顺序逐一尝试（含回滚），第一个四线全通的胜出
      const ROUTE_ORDERS = [
        [0, 1, 2, 3], // 磁→铜A→铁→铜B
        [3, 2, 1, 0], // 铜B→铁→铜A→磁（铜B 可选起点最少，优先保障）
        [3, 1, 2, 0], // 铜B→铜A→铁→磁
        [2, 3, 0, 1], // 铁→铜B→磁→铜A
      ];
      let routes = null;
      for (const order of ROUTE_ORDERS) {
        const orderTiles = [];
        const attempt = {};
        let failName = null;
        for (const idx of order) {
          const [name, item, srcTile, asm] = ROUTES[idx];
          const srcKey = `${srcTile.x}:${srcTile.y}`;
          const asmKey = `${asm.tile.x}:${asm.tile.y}`;
          // 终点候选：装配机空闲侧面（带子指向建筑才会被取货）
          const ends = Object.entries(DIR_VECTORS)
            .map(([dir, [dx, dy]]) => ({ tile: { x: asm.tile.x + dx, y: asm.tile.y + dy }, finalDir: DIR_OPPOSITE[dir] }))
            .filter((e) => !planned.has(`${e.tile.x}:${e.tile.y}`))
            .filter((e) => free(e.tile.x, e.tile.y) || beltAt.has(`${e.tile.x}:${e.tile.y}`));
          let best = null;
          for (const e of ends) {
            const endKey = `${e.tile.x}:${e.tile.y}`;
            const srcDir = (t) => DIR_OF_VECTOR(t.x - srcTile.x, t.y - srcTile.y);
            const starts = Object.values(DIR_VECTORS)
              .map(([dx, dy]) => ({ x: srcTile.x + dx, y: srcTile.y + dy }))
              .filter((t) => !planned.has(`${t.x}:${t.y}`))
              .filter((t) => free(t.x, t.y) || beltAt.has(`${t.x}:${t.y}`))
              .sort((a, b) => (Math.abs(a.x - e.tile.x) + Math.abs(a.y - e.tile.y)) - (Math.abs(b.x - e.tile.x) + Math.abs(b.y - e.tile.y)));
            for (const start of starts) {
              const able = (x, y) => {
                const kk = `${x}:${y}`;
                if (x === start.x && y === start.y) return true;
                if (planned.has(kk)) return false;
                if (asmEndTiles.has(kk) && kk !== endKey) return false; // 入料口专属保护
                return free(x, y) || beltAt.has(kk);
              };
              // 方向校验：起点带必须背离源熔炉才接得到货；中途带按定向溢毒规则判定
              const ableDir = (x, y, dir) => {
                if (x === start.x && y === start.y && dir !== srcDir(start)) return false;
                return poisonByDir(x, y, dir, [item], new Set([srcKey, asmKey]));
              };
              const xs = [srcTile.x, e.tile.x, anchor.x];
              const ys = [srcTile.y, e.tile.y, anchor.y];
              const bounds = {
                x0: Math.max(0, Math.min(...xs) - 16), x1: Math.max(...xs) + 16,
                y0: Math.max(0, Math.min(...ys) - 16), y1: Math.max(...ys) + 16,
              };
              const route = beltRoute(able, start, new Map([[endKey, e.finalDir]]), bounds, ableDir);
              if (route && (!best || route.tiles.length < best.tiles.length)) best = route;
            }
            if (best) break;
          }
          if (!best) {
            failName = name; diag[`${name}:no-path`] = (diag[`${name}:no-path`] ?? 0) + 1;
            break;
          }
          attempt[name] = best;
          for (const t of best.tiles) { planned.add(`${t.x}:${t.y}`); orderTiles.push(t); }
        }
        if (!failName) { routes = attempt; break; }
        for (const t of orderTiles) planned.delete(`${t.x}:${t.y}`);
      }
      if (!routes) {
        for (const t of attemptTiles) planned.delete(`${t.x}:${t.y}`);
        continue;
      }
      // 站位：枢纽周边空格（默认在下侧，操作范围 6 内覆盖全部建筑）
      let stand = null;
      outer: for (let d = 0; d <= 6; d++) {
        for (let dx = -d; dx <= d; dx++) {
          const dy = d - Math.abs(dx);
          for (const sy of (dy === 0 ? [0] : [-dy, dy])) {
            const t = { x: anchor.x + dx, y: anchor.y + 3 + sy };
            if (free(t.x, t.y)) { stand = t; break outer; }
          }
        }
      }
      stand ??= { x: anchor.x, y: anchor.y + 3 };
      reserveTiles(attemptTiles);
      logEvent('action', `装配枢纽选址 (${anchor.x},${anchor.y})（星型）：3 装配机+研究站，4 条入线 ${Object.values(routes).map((r) => r.tiles.length).join('/')} 格`);
      return { anchor, rot: 0, buildings, belts, routes, stand };
    }
  }
  logEvent('warn', `装配枢纽选址失败诊断: ${JSON.stringify(diag)}（layout=布局放不下，其余=对应路线无路径）`);
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

// 矿机→短带→熔炉 三联格：矿机压矿脉，皮带一格、熔炉紧随其后，方向朝 preferToward 优先
// 带格除目标矿脉外不得贴其他矿脉格：矿机出料会被侧面任意带子拉走，
// 带格贴到别家矿机必然跨线偷料（铜带拉铁矿喂铜炉，整条线卡死）。
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
    if (!grid.free(belt.x, belt.y) || !grid.free(smelter.x, smelter.y)) continue;
    if (touchesForeignResource(grid, belt, minerTile)) continue;
    return { minerTile, beltTile: belt, beltDir: dir, smelterTile: smelter, dir };
  }
  return null;
}

function touchesForeignResource(grid, tile, minerTile) {
  for (const [dx, dy] of Object.values(DIR_VECTORS)) {
    const x = tile.x + dx, y = tile.y + dy;
    if (x === minerTile.x && y === minerTile.y) continue;
    if (grid.resourceAt.has(`${x}:${y}`)) return true;
  }
  return false;
}


// ---------------- 产业链建造编排 ----------------
// 精确落格建造；失败时把执行体挪近目标格（操作范围 6）重试。
// 幂等：目标格已有同型自有建筑（配方一致）则直接使用，不重复建造
async function buildAtExact(buildingType, tile, { recipe = null, retries = 2 } = {}) {
  const existing = await findBuildingNear(buildingType, tile, 0);
  if (existing && (!recipe || !recipeOf(existing) || recipeOf(existing) === recipe)) {
    logEvent('info', `${buildingType} @(${tile.x},${tile.y}) 已存在，直接沿用`);
    return true;
  }
  for (let i = 0; i <= retries; i++) {
    if (await buildAt(buildingType, tile, { recipe })) {
      // 建造落地后执行体可能正站在新建筑格上（客户端建筑优先选中会让单位永久点选不到）
      await ensureExecutorFree().catch(() => {});
      return true;
    }
    if (i < retries) {
      logEvent('info', `建造 ${buildingType} @(${tile.x},${tile.y}) 未果，执行体挪近后重试`);
      await moveExecutorTo({ x: tile.x, y: tile.y }, { arriveDist: 3, maxSteps: 6 }).catch(() => false);
      await ensureOnPlanet().catch(() => {});
    }
  }
  return false;
}

// 规划一片矿区：每个配方一条「矿机→短带→熔炉」支线。
// 出生保障矿脉只有 1 格时，多台熔炉共用一台矿机——矿机不同侧面各拉一条带
// （建筑只能从“指向自己”的带子取货，支线互不干扰）。
async function planMiningSite(cluster, recipes, toward) {
  const scene = await getScene();
  const reserved = [];
  const spots = [];
  const usableTiles = cluster.tiles.filter((t) => scene.terrain?.[t.y]?.[t.x] === 'buildable');
  if (!usableTiles.length) {
    logEvent('warn', `矿区 (${cluster.tiles[0].x},${cluster.tiles[0].y}) 规划失败：矿脉格均不可建造`);
    return null;
  }
  // 只取最近矿格周边 8 格内的矿脉：无 cluster 的 starter 节点会把全图同名节点
  // 混成一个簇（含远处其他玩家的保障矿），支线必须收拢在最近矿格周边
  const home = usableTiles[0];
  const nearTiles = usableTiles.filter((t) => Math.abs(t.x - home.x) + Math.abs(t.y - home.y) <= 8);
  for (let i = 0; i < recipes.length; i++) {
    // 矿脉格多于配方数时一机一炉；不够时最近一格被多条支线共用
    const tile = nearTiles[Math.min(i, nearTiles.length - 1)];
    const grid = makeSiteGrid(scene, reserved);
    const plan = planMinerSmelter(grid, tile, toward);
    if (!plan) {
      logEvent('warn', `矿区 (${tile.x},${tile.y}) 第 ${i + 1} 条支线规划失败：矿脉周边空地不足`);
      return null;
    }
    reserved.push(plan.beltTile, plan.smelterTile);
    spots.push({
      minerTile: plan.minerTile,
      beltTiles: [plan.beltTile],
      beltDirs: [plan.beltDir],
      smelterTile: plan.smelterTile,
      recipe: recipes[i],
      kind: cluster.kind,
    });
  }
  const last = spots[spots.length - 1];
  const stand = {
    x: Math.round((spots[0].smelterTile.x + last.smelterTile.x) / 2),
    y: Math.round((spots[0].smelterTile.y + last.smelterTile.y) / 2),
  };
  return { spots, stand, reserved, kind: cluster.kind };
}


// 站点电力预建：特斯拉塔贴中心 + 两台风机贴塔（消费建筑落地前先把电网铺好）。
// avoid：站点规划预留格（带线/厂房位），电网建筑不得抢占。
async function seedSitePower(center, { label = '站点', windCount = 2, avoid = null } = {}) {
  const hasTesla = await findBuildingNear('tesla_tower', center, 8);
  if (!hasTesla) await buildNear('tesla_tower', { near: center, avoid });
  const tesla = await findBuildingNear('tesla_tower', center, 10);
  for (let i = 0; i < windCount; i++) {
    if (tesla) await buildNear('wind_turbine', { adjacentTo: tesla.position, avoid });
    else await powerBoost(1, avoid);
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
    // 补电要贴着“没电的那台”建塔（特斯拉 range=4，贴站位中心可能够不着边缘建筑）
    const scene0 = await getScene().catch(() => null);
    const offline = Object.values(scene0?.buildings ?? {}).filter(
      (b) => types.includes(b.type) && b.owner_id === PLAYER_ID
        && Math.abs(b.position.x - center.x) + Math.abs(b.position.y - center.y) <= 22
        && !['running', 'idle'].includes(b.runtime?.state));
    const target = offline[0]?.position ?? center;
    logEvent('info', `${label}存在未通电建筑，第 ${r + 1} 轮补电（贴 (${target.x},${target.y}) 建塔+风机）`);
    await buildNear('tesla_tower', { near: target });
    const scene = await getScene().catch(() => null);
    const tesla = Object.values(scene?.buildings ?? {})
      .filter((b) => b.type === 'tesla_tower' && b.owner_id === PLAYER_ID)
      .sort((a, b) => (Math.abs(a.position.x - target.x) + Math.abs(a.position.y - target.y))
        - (Math.abs(b.position.x - target.x) + Math.abs(b.position.y - target.y)))[0];
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

// 建设一片矿区：电力 → 逐支线（矿机/短带/熔炉）→ 验证通电与产出。
// 先进场再开工：执行体操作范围只有 6 格，远离厂址的一切建造都会被服务端拒绝；
// 多炉共用矿脉时矿机只建一台；熔炉落地后必须看到矿石入炉（落地≠连通）。
async function buildMiningSite(site, { label, milestones = [] } = {}) {
  const arrived = await moveExecutorTo(site.stand, { arriveDist: 2, maxSteps: 40 });
  if (!arrived) logEvent('warn', `${label}: 执行体未能抵达厂址 (${site.stand.x},${site.stand.y})，建造可能超距失败`);
  // 避开本站预留格 + 全局规划预留（枢纽/长途带等曾把风机建到枢纽装配机位上）
  const avoid = new Set([...site.reserved.map((t) => `${t.x}:${t.y}`), ...PLANNED_TILES]);
  await seedSitePower(site.stand, { label, avoid });
  const oreLabel = site.kind === 'copper_ore' ? '铜矿' : '铁矿';
  const builtSmelters = [];
  for (const spot of site.spots) {
    const minerExisting = await findBuildingNear('mining_machine', spot.minerTile, 0);
    if (!minerExisting) {
      await waitResources(50, 20, 420);
      const minerOk = await buildAtExact('mining_machine', spot.minerTile);
      if (!minerOk) {
        logEvent('warn', `${label}: 矿机落地失败 @(${spot.minerTile.x},${spot.minerTile.y})，该支线熔炉一并跳过`);
        continue;
      }
    }
    await layBelts(spot.beltTiles, spot.beltDirs, { label: `${label}矿机短带` });
    await waitResources(120, 60, 720);
    const smelterOk = await buildAtExact('arc_smelter', spot.smelterTile, { recipe: spot.recipe });
    if (!smelterOk) {
      logEvent('warn', `${label}: 熔炉落地失败 @(${spot.smelterTile.x},${spot.smelterTile.y})，该支线停产`);
      continue;
    }
    builtSmelters.push(spot);
  }
  // 先保电再验货：矿机没电什么都采不出来，入炉等待只会空超时
  await ensureSitePower(site.stand, ['mining_machine', 'arc_smelter'], { label });
  // 矿石入炉：传送带真正把矿喂进熔炉才算链路通（落地≠连通）
  for (const spot of builtSmelters) {
    const sm = await findBuildingNear('arc_smelter', spot.smelterTile, 0);
    if (sm) await waitStorageQty(`${label}${oreLabel}入炉`, sm.id, site.kind, 1, { timeoutSec: 240 });
  }
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

// API 救援移动（多跳）：单位站上建筑格时，客户端“建筑优先”的选中逻辑让单位永远点选不到，
// UI 移动彻底失效；此时直接走服务端命令通道分跳移动（单跳曼哈顿 ≤10，满足服务端 ≤12 限距；
// 此前单跳超距/压格被静默拒，永远等不到抵达）。每跳等待抵达，抵达目标附近才算成功。
async function apiRescueMove(dest, { arriveDist = 0, maxHops = 6 } = {}) {
  for (let hop = 0; hop < maxHops; hop++) {
    const scene = await getScene();
    const ex = analyzeScene(scene).executor;
    if (!ex) return false;
    const pos = ex.position;
    if (Math.abs(pos.x - dest.x) + Math.abs(pos.y - dest.y) <= arriveDist) return true;
    const occ = new Set();
    for (const b of Object.values(scene.buildings ?? {})) occ.add(`${b.position.x}:${b.position.y}`);
    for (const u of Object.values(scene.units ?? {})) occ.add(`${u.position.x}:${u.position.y}`);
    // 本跳目标：优先 x 轴再 y 轴，总量 ≤10；目标格被占则在周边找空格
    const sx = Math.sign(dest.x - pos.x) * Math.min(Math.abs(dest.x - pos.x), 10);
    const sy = Math.sign(dest.y - pos.y) * Math.min(Math.abs(dest.y - pos.y), 10 - Math.abs(sx));
    let target = { x: pos.x + sx, y: pos.y + sy };
    if (occ.has(`${target.x}:${target.y}`)) {
      let alt = null;
      outer: for (let d = 1; d <= 3; d++) {
        for (let dx = -d; dx <= d; dx++) {
          const dy = d - Math.abs(dx);
          for (const sy2 of (dy === 0 ? [0] : [-dy, dy])) {
            const t = { x: target.x + dx, y: target.y + sy2 };
            if (!occ.has(`${t.x}:${t.y}`)) { alt = t; break outer; }
          }
        }
      }
      if (!alt) return false;
      target = alt;
    }
    const res = await fetch(`${SERVER}/commands`, {
      method: 'POST',
      headers: { authorization: `Bearer ${PLAYER_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: `rescue-${Date.now()}-${hop}`,
        issuer_type: 'player',
        issuer_id: PLAYER_ID,
        commands: [{ type: 'move', target: { entity_id: ex.id, position: { x: target.x, y: target.y, z: 0 } }, payload: {} }],
      }),
    }).catch(() => null);
    if (!res?.ok) { logEvent('warn', `API 救援移动被拒: HTTP ${res?.status}`); return false; }
    if (hop === 0) logEvent('warn', `UI 移动失效（单位疑站上建筑格），API 救援移动至 (${dest.x},${dest.y})`);
    const arrived = await waitFor(`救援移动至 (${target.x},${target.y})`, async () => {
      const p2 = await executorPos();
      return p2 && p2.x === target.x && p2.y === target.y;
    }, { timeoutSec: 60, beatSec: 12, quiet: true });
    if (!arrived) { logEvent('warn', `API 救援移动第 ${hop + 1} 跳未抵达`); return false; }
  }
  const p = await executorPos();
  return !!p && Math.abs(p.x - dest.x) + Math.abs(p.y - dest.y) <= arriveDist;
}

// 站上建筑格自愈：建造/拆除后若执行体被压在建筑格上（客户端“建筑优先”选中逻辑会让
// 单位永久点选不到，UI 行军/建造全部卡死），立即用 API 挪到相邻空格。
async function ensureExecutorFree() {
  const scene = await getScene().catch(() => null);
  if (!scene) return false;
  const ex = analyzeScene(scene).executor;
  if (!ex) return false;
  const pos = ex.position;
  const onBuilding = Object.values(scene.buildings ?? {}).some(
    (b) => b.position.x === pos.x && b.position.y === pos.y);
  if (!onBuilding) return true;
  const occ = new Set(Object.values(scene.buildings ?? {}).map((b) => `${b.position.x}:${b.position.y}`));
  for (const [dx, dy] of Object.values(DIR_VECTORS)) {
    const t = { x: pos.x + dx, y: pos.y + dy };
    if (occ.has(`${t.x}:${t.y}`)) continue;
    logEvent('warn', `执行体站上建筑格 (${pos.x},${pos.y})，API 侧移自救至 (${t.x},${t.y})`);
    return apiRescueMove(t, { arriveDist: 0, maxHops: 2 });
  }
  return false;
}

// 行军落点避障：直接踩到建筑格（含传送带）会让客户端“建筑优先”选中逻辑锁死单位；
// 落点被占时在周边 1~2 环找最接近最终目标的空格。
async function pickFreeStepDest(pos, dest, target) {
  const scene = await getSceneAt(Math.max(0, pos.x - 14), Math.max(0, pos.y - 14), 29, 29).catch(() => null);
  const occ = new Set();
  for (const b of Object.values(scene?.buildings ?? {})) occ.add(`${b.position.x}:${b.position.y}`);
  if (!occ.has(`${dest.x}:${dest.y}`)) return dest;
  const score = (t) => Math.abs(t.x - target.x) + Math.abs(t.y - target.y);
  for (let d = 1; d <= 2; d++) {
    const cands = [];
    for (let dx = -d; dx <= d; dx++) {
      const dy = d - Math.abs(dx);
      for (const sy of (dy === 0 ? [0] : [-dy, dy])) {
        const t = { x: dest.x + dx, y: dest.y + sy };
        if (t.x === pos.x && t.y === pos.y) continue;
        if (occ.has(`${t.x}:${t.y}`)) continue;
        cands.push(t);
      }
    }
    if (cands.length) { cands.sort((a, b) => score(a) - score(b)); return cands[0]; }
  }
  return null;
}

// 分步把执行体开到目标附近（每步曼哈顿 ≤4）。
// 单步失败/超时不再整段放弃：重新读取实际位置后重试，连续失败 4 次才认输。
async function moveExecutorTo(target, { arriveDist = 2, maxSteps = 12 } = {}) {
  // 先自愈：单位若正站在建筑格上，UI 选中已失效，直接 UI 行军必然连败
  await ensureExecutorFree().catch(() => {});
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
    // 落点避障：踩到建筑格（含传送带）会让客户端“建筑优先”选中逻辑锁死单位
    const freeDest = await pickFreeStepDest(pos, dest, target);
    if (!freeDest) {
      consecutiveFails++;
      logEvent('warn', `落点 (${dest.x},${dest.y}) 及周边均被占用（连续第 ${consecutiveFails} 次），换轴重试`);
      step--;
      continue;
    }
    const moved = await moveUnit(pos, freeDest);
    if (!moved) {
      consecutiveFails++;
      logEvent('warn', `移动命令未下达（连续第 ${consecutiveFails} 次），重新定位后重试`);
      if (consecutiveFails >= 4) {
        // UI 连续失败（多见于单位站上建筑格无法被点选）：走服务端命令通道救援
        if (await apiRescueMove(freeDest, { arriveDist: 1 })) { consecutiveFails = 0; continue; }
        logEvent('warn', '移动命令连续失败，放弃行军');
        return false;
      }
      step--; // 重试本步，不消耗步数预算
      await sleep(2500);
      continue;
    }
    // 行军等待期间不做地图点击（quiet），避免误触把部队带偏
    const arrived = await waitFor(`执行体移动到 (${freeDest.x},${freeDest.y})`, async () => {
      const p2 = await executorPos();
      return p2 && p2.x === freeDest.x && p2.y === freeDest.y;
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
  { name: 'R1-勘察与规划', minEnd: 300, run: async () => { await phases[1].run(); } },
  { name: 'R2-铁矿区开工', minEnd: 700, run: async () => { await phases[2].run(); } },
  { name: 'R3-铜矿区开工', minEnd: 1300, run: async () => { await phases[3].run(); } },
  { name: 'R4-装配枢纽', minEnd: 1900, run: async () => { await phases[4].run(); } },
  { name: 'R5-传送带联网', minEnd: 2700, run: async () => { await phases[5].run(); } },
  { name: 'R6-电磁学', minEnd: 3600, run: async () => { await phases[6].run(); } },
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
// 产业链全局状态：P1 勘察规划后填充矿区，P2-P6 逐级建设并填充枢纽与带线路径
let CHAIN = null;

// 按距离排序尝试矿带，直到规划成功（出生保障的单格 starter 矿脉优先，失败退到远矿带）
async function planSiteNear(clusters, kind, recipes, toward, label) {
  const cands = clusters.filter((c) => c.kind === kind);
  for (const c of cands) {
    c.tiles.sort((a, b) => (Math.abs(a.x - BASE_POS.x) + Math.abs(a.y - BASE_POS.y))
      - (Math.abs(b.x - BASE_POS.x) + Math.abs(b.y - BASE_POS.y)));
    c.dist = Math.abs(c.tiles[0].x - BASE_POS.x) + Math.abs(c.tiles[0].y - BASE_POS.y);
  }
  cands.sort((a, b) => a.dist - b.dist);
  for (const c of cands.slice(0, 4)) {
    const site = await planMiningSite(c, recipes, toward);
    if (site) {
      const starter = c.id == null || c.id === undefined;
      logEvent('milestone', `${label}矿带锁定 (${c.tiles[0].x},${c.tiles[0].y}) 储量 ${c.total}${starter ? '（出生保障矿脉）' : ''}，矿机×1+熔炉×${recipes.length}`);
      return site;
    }
  }
  return null;
}

// 建筑配方读取（scene 里配方挂在 production.recipe_id 下，部分快照字段在顶层 recipe_id）
function recipeOf(b) {
  return b?.recipe_id ?? b?.production?.recipe_id ?? null;
}

// 从现场找装配枢纽四件套（按配方区分装配机；研究站须为无配方的研究模式）
async function hubBuildingsFromScene() {
  const scene = await getScene();
  const bs = Object.values(scene.buildings ?? {}).filter((b) => b.owner_id === PLAYER_ID);
  const findAsm = (recipe) => bs.find((b) => b.type === 'assembling_machine_mk1' && recipeOf(b) === recipe) ?? null;
  const coilAsm = findAsm('magnetic_coil');
  const boardAsm = findAsm('circuit_board');
  const matrixAsm = findAsm('electromagnetic_matrix');
  const lab = bs.find((b) => b.type === 'matrix_lab' && !recipeOf(b)) ?? null;
  return { complete: !!(coilAsm && boardAsm && matrixAsm && lab), coilAsm, boardAsm, matrixAsm, lab };
}

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
    name: 'P1-勘察与规划', minEnd: 300,
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
      // 全图勘察铁/铜矿带并完成厂址规划。服务端出生保障铁铜（starter 矿脉紧贴基地），
      // 整条矩阵链落在出生区，sink-first 一次建到位；starter 规划失败才退到远矿带。
      // 装配枢纽与 4 条熔炉入线在空地阶段同批规划，全部预留格登记（后续建造自动避让）。
      const clusters = await scanClusters(['iron_ore', 'copper_ore']);
      CHAIN = CHAIN ?? {};
      CHAIN.feSite = await planSiteNear(clusters, 'iron_ore', ['smelt_magnet', 'smelt_iron'], BASE_POS, '铁');
      CHAIN.cuSite = await planSiteNear(clusters, 'copper_ore', ['smelt_copper', 'smelt_copper'], CHAIN.feSite?.stand ?? BASE_POS, '铜');
      if (!CHAIN.feSite || !CHAIN.cuSite) {
        logEvent('warn', '铁/铜矿区规划失败，后续产业链阶段将降级跳过');
      } else {
        CHAIN.smelters = {
          magnet: CHAIN.feSite.spots[0].smelterTile,
          iron: CHAIN.feSite.spots[1].smelterTile,
          copperA: CHAIN.cuSite.spots[0].smelterTile,
          copperB: CHAIN.cuSite.spots[1].smelterTile,
        };
        // 规划中的矿机/熔炉也是生产商：参与防溢毒邻接判断
        const extraProducers = new Map();
        for (const s of [CHAIN.feSite, CHAIN.cuSite]) {
          for (const spot of s.spots) {
            extraProducers.set(`${spot.minerTile.x}:${spot.minerTile.y}`, s.kind);
            extraProducers.set(`${spot.smelterTile.x}:${spot.smelterTile.y}`, RECIPE_OUTPUT[spot.recipe]);
          }
        }
        CHAIN.asmHub = await planAssemblerHub(CHAIN.smelters, {
          center: BASE_POS,
          extraProducers,
          extraPlanned: [...CHAIN.feSite.reserved, ...CHAIN.cuSite.reserved],
        });
        if (!CHAIN.asmHub) logEvent('warn', '装配枢纽规划失败，P4 阶段将按现状重试');
        await shot('survey-sites');
      }
      await wander(15, '查看地图细节');
    },
  },
  {
    name: 'P2-铁矿区开工', minEnd: 700,
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
    name: 'P3-铜矿区开工', minEnd: 1300,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.cuSite) { logEvent('skip', '铜区未规划，跳过'); return; }
      await buildMiningSite(CHAIN.cuSite, {
        label: '铜矿区',
        milestones: [
          { buildingType: 'arc_smelter', near: CHAIN.cuSite.spots[0].smelterTile, itemId: 'copper_ingot', qty: 2, desc: '铜块×2产出' },
          { buildingType: 'arc_smelter', near: CHAIN.cuSite.spots[1].smelterTile, itemId: 'copper_ingot', qty: 2, desc: '铜块×2产出（二线）' },
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
    name: 'P4-装配枢纽', minEnd: 1900,
    async run() {
      await ensureOnPlanet();
      // 熔炉布局来源：full 由 P1 规划填入，recovery 由 R0 从现场重建
      const sm = CHAIN?.smelters;
      if (!sm?.magnet || !sm?.iron || !sm?.copperA || !sm?.copperB) {
        logEvent('skip', '熔炉布局不全（磁/铁/铜×2），跳过装配枢纽');
        return;
      }
      // 幂等：枢纽未规划（或部分已建成）时，以现存建筑为锚重新规划；已有建筑/带子会被复用
      if (!CHAIN.asmHub) {
        const built = await hubBuildingsFromScene();
        const center = built.coilAsm?.position ?? BASE_POS;
        CHAIN.asmHub = await planAssemblerHub(sm, { center });
        if (!CHAIN.asmHub) { logEvent('warn', '装配枢纽选址失败，本阶段放弃'); return; }
      }
      const hub = CHAIN.asmHub;
      await moveExecutorTo(hub.stand, { arriveDist: 3, maxSteps: 20 });
      await seedSitePower(hub.stand, { label: '装配枢纽', windCount: 3, avoid: PLANNED_TILES });
      const COSTS = { assembling_machine_mk1: [100, 50], matrix_lab: [120, 60] };
      for (const b of hub.buildings) {
        const [cm, ce] = COSTS[b.type] ?? [100, 50];
        await waitResources(cm, ce, 720);
        await buildAtExact(b.type, b.tile, { recipe: b.recipe });
      }
      await layBelts(hub.belts.map((b) => b.tile), hub.belts.map((b) => b.dir), { label: '枢纽内部带' });
      await ensureSitePower(hub.stand, ['assembling_machine_mk1', 'matrix_lab'], { label: '装配枢纽' });
      await shot('hub-built');
      logEvent('milestone', '装配枢纽建成（3 装配机+研究站）');
    },
  },
  {
    name: 'P5-传送带联网', minEnd: 2700,
    async run() {
      await ensureOnPlanet();
      if (!CHAIN?.asmHub) { logEvent('skip', '枢纽未规划，跳过联网'); return; }
      const { routes, buildings } = CHAIN.asmHub;
      // 4 条熔炉入线：磁铁/铁块自铁区熔炉，铜块×2 自铜区熔炉
      for (const [name, label] of [['magnet', '磁铁入线'], ['iron', '铁块入线'], ['copperA', '铜块入线①'], ['copperB', '铜块入线②']]) {
        const route = routes[name];
        if (!route) { logEvent('warn', `${label}无路径，跳过`); continue; }
        await waitResources(route.tiles.length * 4 + 20, 0, 600);
        await layBelts(route.tiles, route.dirs, { label });
        await wander(6, `${label}货流观察`);
      }
      await shot('factory-linked');
      logEvent('milestone', '产业链传送带全线贯通，货流圆点上线');
      // 生产里程碑：线圈 → 电路板 → 电磁矩阵
      const byKey = Object.fromEntries(buildings.map((b) => [b.key, b]));
      const coil = await findBuildingNear('assembling_machine_mk1', byKey.coilAsm.tile, 0);
      if (coil) await waitStorageQty('磁线圈×2产出', coil.id, 'magnetic_coil', 2, { timeoutSec: 600 });
      const board = await findBuildingNear('assembling_machine_mk1', byKey.boardAsm.tile, 0);
      if (board) await waitStorageQty('电路板×2产出', board.id, 'circuit_board', 2, { timeoutSec: 600 });
      const matrix = await findBuildingNear('assembling_machine_mk1', byKey.matrixAsm.tile, 0);
      if (matrix) await waitStorageQty('电磁矩阵×1下线', matrix.id, 'electromagnetic_matrix', 1, { timeoutSec: 600 });
    },
  },
  {
    name: 'P6-首门科技·电磁学', minEnd: 3600,
    async run() {
      await ensureOnPlanet();
      const labId = await findLabId();
      if (labId) await waitStorageQty('电磁矩阵×5送入研究站', labId, 'electromagnetic_matrix', 5, { timeoutSec: 600 });
      await ensureResearch('electromagnetism', /^电磁学/, { timeoutSec: 900 });
      await wander(10, '研究站运转特写');
    },
  },
  {
    name: 'P7-物流系统拓展', minEnd: 4400,
    async run() {
      await ensureOnPlanet();
      await ensureResearch('basic_logistics_system', /^基础物流/, { timeoutSec: 900 });
      // 电磁学解锁储物仓：造一座展示仓储落地
      if (await techCompleted('electromagnetism')) {
        await waitResources(60, 20, 300);
        await buildNear('depot_mk1', { near: CHAIN?.asmHub?.anchor ?? BASE_POS, avoid: PLANNED_TILES });
      }
      await wander(15, '物流线观察');
    },
  },
  {
    name: 'P8-冶金与武器', minEnd: 5600,
    async run() {
      await ensureOnPlanet();
      await ensureResearch('automatic_metallurgy', /自动化冶金/, { timeoutSec: 700 });
      await ensureResearch('weapon_system', /武器系统/, { timeoutSec: 1200 });
      if (await techCompleted('weapon_system')) {
        await waitResources(80, 30, 300);
        await buildNear('gauss_turret', { near: CHAIN?.asmHub?.anchor ?? BASE_POS, avoid: PLANNED_TILES });
        await wander(15, '炮塔防区观察');
      } else {
        logEvent('warn', '武器系统未完成（矩阵产能不足），炮塔阶段降级');
      }
    },
  },
  {
    name: 'P9-外扩侦察与终幕', minEnd: 99999,
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

// ---------------- recovery 预设 ----------------
// 从现场重建产业链状态（跳过 P0-P3），直接从装配枢纽续跑到终幕。
// 配合 --start-offset 续接事件时间轴；幂等：已建成的建筑/带子直接沿用。
const recoveryPhases = [
  {
    name: 'R0-重建现场', minEnd: 120,
    async run() {
      await page.goto(`${WEB}/planet/${PLANET_ID}`);
      await page.locator('.planet-map-canvas__surface').waitFor({ timeout: 30000 });
      await sleep(3000);
      logEvent('milestone', '回到行星指挥位（recovery 续跑）');
      CHAIN = CHAIN ?? {};
      const scene = await getScene();
      const bs = Object.values(scene.buildings ?? {}).filter((b) => b.owner_id === PLAYER_ID);
      const smBy = (recipe) => bs.find((b) => b.type === 'arc_smelter' && recipeOf(b) === recipe)?.position ?? null;
      const coppers = bs.filter((b) => b.type === 'arc_smelter' && recipeOf(b) === 'smelt_copper')
        .map((b) => b.position)
        .sort((a, b) => (Math.abs(a.x - BASE_POS.x) + Math.abs(a.y - BASE_POS.y)) - (Math.abs(b.x - BASE_POS.x) + Math.abs(b.y - BASE_POS.y)));
      CHAIN.smelters = {
        magnet: smBy('smelt_magnet'),
        iron: smBy('smelt_iron'),
        copperA: coppers[0] ?? null,
        copperB: coppers[1] ?? coppers[0] ?? null,
      };
      const missing = Object.entries(CHAIN.smelters).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) {
        logEvent('warn', `现场缺少熔炉: ${missing.join('/')}，装配枢纽阶段将降级`);
      } else {
        const f = (p) => `(${p.x},${p.y})`;
        logEvent('milestone', `现场重建完成：磁炉${f(CHAIN.smelters.magnet)} 铁炉${f(CHAIN.smelters.iron)} 铜炉${f(CHAIN.smelters.copperA)}/${f(CHAIN.smelters.copperB)}`);
      }
      await shot('recovery-scene');
      await ensureOnPlanet();
    },
  },
  { name: 'R4-装配枢纽', minEnd: 2100, run: async () => { await phases[4].run(); } },
  { name: 'R5-传送带联网', minEnd: 2900, run: async () => { await phases[5].run(); } },
  { name: 'R6-首门科技·电磁学', minEnd: 3800, run: async () => { await phases[6].run(); } },
  { name: 'R7-物流系统拓展', minEnd: 4600, run: async () => { await phases[7].run(); } },
  { name: 'R8-冶金与武器', minEnd: 5800, run: async () => { await phases[8].run(); } },
  { name: 'R9-外扩侦察与终幕', minEnd: 99999, run: async () => { await phases[9].run(); } },
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
    : preset === 'recovery' ? recoveryPhases
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
    // 填充到阶段窗口结束（--no-pad 时跳过，冒烟直接推进）
    const remain = phase.minEnd - elapsed();
    if (!NO_PAD && remain > 5 && elapsed() < TOTAL_SEC) {
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
