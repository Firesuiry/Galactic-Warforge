// 固定机位截图的公共库：读档、等 tick、3D/2D 取景、截图与特写。
//
// 场景脚本（scripts/playtest-shots/<场景名>.mjs）的约定见 docs/guide/试玩速查.md
// 「固定机位截图」。脚本导出一个对象：
//   export default {
//     title: 'cp-belt-dsp 标准镜头',
//     shots: [ { name, kind: '3d'|'2d', ... }, ... ],
//   }
// 运行器（run.mjs）按 shots 顺序逐张拍，文件名固定为 <name>.png。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 服务端 REST（不依赖驱动，运行器自己就能读档/查状态）----
export function makeApi({ server, key = 'key_player_1' }) {
  const headers = { authorization: `Bearer ${key}` };
  const get = async (p) => {
    const r = await fetch(`${server}${p}`, { headers });
    if (!r.ok) throw new Error(`GET ${p} → HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  };
  return {
    server,
    get,
    health: () => get('/health'),
    game: () => get('/games/current'),
    async load(name) {
      const r = await fetch(`${server}/checkpoints/${name}/load`, { method: 'POST', headers });
      const text = await r.text();
      if (!r.ok) throw new Error(`读档 ${name} 失败（HTTP ${r.status}）：${text.slice(0, 500)}`);
      return text ? JSON.parse(text) : null;
    },
    async advance(ticks) {
      const r = await fetch(`${server}/admin/advance`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ticks }),
      });
      if (!r.ok) throw new Error(`快进失败（HTTP ${r.status}）：${await r.text()}`);
      return r.json();
    },
  };
}

/** 等 tick 前进 n（快进接口若不可用就按实时等）。 */
export async function waitTicks(api, n = 50, tickRate = 4) {
  const t0 = (await api.health()).tick;
  try {
    await api.advance(n);
  } catch {
    // 多人对局门禁等情况下快进被拒：按 tick 速率实时等，超时 60s。
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const tick = (await api.health()).tick;
    if (tick >= t0 + n) return tick;
    await sleep(200);
  }
  return (await api.health()).tick;
}

// ---- 驱动（常驻 Playwright 页面）----
export async function runSnippet(driver, body, timeoutMs = 180000) {
  const r = await fetch(`http://127.0.0.1:${driver}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`驱动片段失败：${text.slice(0, 1200)}`);
  return text ? JSON.parse(text) : null;
}

const pageReady = () =>
  "await page.emulateMedia({ reducedMotion: 'no-preference' });\n" +
  "await L.open3d(page, 'high');\n" +
  'await L.sleep(3000);\n';

/** 3D 机位：focus（含 close）、zoom、tilt、绕 Z 轴转（侧视/斜视）。 */
export async function shoot3d(driver, shot, outDir) {
  const body = `
${pageReady()}
// 鼠标移到右下角空白处，避免悬停提示挡住画面。
await page.mouse.move(1150, 620);
await L.focus(page, { x: ${shot.focus.x}, y: ${shot.focus.y} }, true);
${shot.tilt != null ? `await page.evaluate(() => window.__planetThree.setTilt(${shot.tilt}));` : ''}
${shot.zoom != null ? `await page.evaluate(() => window.__planetThree.zoom(${shot.zoom}));` : ''}
${shot.rotateZ ? `await page.evaluate((a) => {
  const s = window.__planetThree; const Q = s.world.quaternion.constructor; const V = s.camera.position.constructor;
  s.world.quaternion.premultiply(new Q().setFromAxisAngle(new V(0, 0, 1), a));
}, ${shot.rotateZ});` : ''}
await L.sleep(${shot.settleMs ?? 2200});
await page.screenshot({ path: ${JSON.stringify(path.join(outDir, shot.name + '.png'))}, timeout: 120000 });
return S.errors.slice(-5);
`;
  const errs = await runSnippet(driver, body);
  return errs ?? [];
}

/**
 * 2D「平面战术」机位：view=2d + zoom（px/cell 档位，见 PLANET_ZOOM_LEVELS）+ x/y 聚焦。
 * 2D 视图没有暴露测试钩子，取景全靠 URL 深链（PlanetPage 的 x/y/zoom 参数）。
 *
 * 注意：深链聚焦在视口测量完成前结算，目标格固定落在 (480, 320)（默认 960×640 视口
 * 的中心），与 zoom 档无关。取景分两步：
 *   1) 按 zoom=16 打开，用**滚轮**逐档放大（以鼠标位置为锚，目标格在屏幕上不动）；
 *   2) 双击目标格 = requestFocus，把目标格移到视口正中（双击落在传送带/建筑上时
 *      可能触发「同类型全选」，截图前按 Esc 清空选中）。
 */
export async function shoot2d(driver, shot, outDir, web) {
  const target = shot.zoom;
  const zoomInSteps = { 8: 1, 16: 0, 24: 1, 32: 2 }[target];
  if (zoomInSteps == null) throw new Error(`2D 机位只支持 zoom ∈ {8,16,24,32}，收到 ${target}`);
  const q = new URLSearchParams({
    view: '2d',
    quality: 'low',
    e2e: '1',
    zoom: '16',
    x: String(shot.focus.x),
    y: String(shot.focus.y),
  });
  const body = `
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.goto(${JSON.stringify(`${web}/planet/planet-1-1?${q}`)});
await page.waitForSelector('.planet-map-canvas__pixi canvas', { timeout: 90000 });
await L.sleep(${shot.settleMs ?? 3000});
const readCam = () => page.evaluate(() => {
  const s = document.querySelector('.planet-map-canvas__surface');
  const tile = parseFloat(s.dataset.tileSize);
  const tx = Number(s.dataset.cameraOffsetX), ty = Number(s.dataset.cameraOffsetY);
  return { tile, sx: tx + ${shot.focus.x + 0.5} * tile, sy: ty + ${shot.focus.y + 0.5} * tile };
});
let cam = await readCam();
for (let i = 0; i < ${zoomInSteps}; i++) {
  await page.mouse.move(cam.sx, cam.sy);
  await page.mouse.wheel(0, -1);
  await L.sleep(1200);
  cam = await readCam();
}
await page.mouse.dblclick(cam.sx, cam.sy);
await L.sleep(1200);
await page.keyboard.press('Escape');
cam = await readCam();
await page.mouse.move(1150, 620);
await L.sleep(${shot.settleMs ?? 1500});
await page.screenshot({ path: ${JSON.stringify(path.join(outDir, shot.name + '.png'))}, timeout: 120000 });
return { tile: cam.tile, sx: cam.sx, sy: cam.sy, errors: S.errors.slice(-5) };
`;
  const info = await runSnippet(driver, body);
  if (info?.tile !== target) throw new Error(`2D 缩放未到 ${target}px/cell（实际 ${info?.tile}）`);
  return info?.errors ?? [];
}

// ---- 2x 特写：裁剪局部再放大（纯 Node 解码 PNG，避免额外依赖）----
// PNG 由 Playwright 输出为 8-bit RGBA/RGB 非隔行；这里只支持这种（不满足时抛错，
// 运行器会打印警告并跳过特写，不影响整屏图）。
export function cropAndScale(src, dst, { cx, cy, w, h, scale = 2 }) {
  const png = decodePng(fs.readFileSync(src));
  const x0 = Math.max(0, Math.round(cx - w / 2));
  const y0 = Math.max(0, Math.round(cy - h / 2));
  const cw = Math.min(w, png.width - x0);
  const ch = Math.min(h, png.height - y0);
  const ow = Math.round(cw * scale);
  const oh = Math.round(ch * scale);
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy = y0 + Math.floor(y / scale);
    for (let x = 0; x < ow; x++) {
      const sx = x0 + Math.floor(x / scale);
      const si = (sy * png.width + sx) * png.channels;
      const di = (y * ow + x) * 4;
      out[di] = png.data[si];
      out[di + 1] = png.data[si + 1];
      out[di + 2] = png.data[si + 2];
      out[di + 3] = png.channels === 4 ? png.data[si + 3] : 255;
    }
  }
  fs.writeFileSync(dst, encodePng(ow, oh, out));
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`不支持的 PNG（bitDepth=${bitDepth}, interlace=${interlace}）`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`不支持的 PNG colorType=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    const cur = data.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const LIB_DIR = HERE;
