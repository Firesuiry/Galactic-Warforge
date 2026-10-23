#!/usr/bin/env node
/**
 * 粒子序列帧图集生成（离线、确定性、零依赖）。
 *
 * 输出 `client-web/public/assets/vfx/particles.png`：4×4 帧，每帧 128px（图集 512×512）。
 *   row 0（帧 0–3）：烟团——边缘柔和的圆团，随帧扩散、变淡
 *   row 1（帧 4–7）：火球——白热核心 → 橙 → 暗红，边缘撕裂
 *   row 2（帧 8–11）：火花——细长条，两端收尖
 *   row 3（帧 12–15）：闪光——中心亮、四周快速衰减的圆形光晕
 *
 * 全部像素由固定种子的哈希噪声算出，同一脚本每次输出字节一致；
 * 文件入库，客户端只按 URL 加载（见 `three/vfx/atlas.ts`）。
 *
 * 用法：node scripts/gen-vfx-atlas.mjs [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(HERE, '../client-web/public/assets/vfx/particles.png');

const FRAME = 128;
const COLS = 4;
const ROWS = 4;
const WIDTH = FRAME * COLS;
const HEIGHT = FRAME * ROWS;

/** 32 位整数哈希（与客户端 `vfx/noise.ts` 同一套乘子，纯确定性）。 */
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 双线性值噪声。 */
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** 一帧像素（RGBA，预乘前的直通 alpha）。坐标在帧内 -1..1。 */
function shade(kind, frame, u, v) {
  const r = Math.hypot(u, v);
  const angle = Math.atan2(v, u);
  const t = frame / 3;
  if (kind === 'smoke') {
    // 烟：外扩的软团，噪声撕边，越往后越大越淡。
    const radius = 0.42 + t * 0.5;
    const n = fbm(Math.cos(angle) * 2.4 + u * 2.2, Math.sin(angle) * 2.4 + v * 2.2, 11);
    const edge = radius * (0.72 + n * 0.5);
    const core = clamp01(1 - r / edge);
    const alpha = Math.pow(core, 1.4) * (1 - t * 0.55) * (0.55 + n * 0.45);
    const shade = 0.55 + n * 0.35 - t * 0.2;
    return [shade * 0.92, shade * 0.95, shade, alpha];
  }
  if (kind === 'fire') {
    // 火球：中心白热，外圈橙，噪声造成不规则火舌；后几帧转暗红。
    const radius = 0.35 + t * 0.55;
    const n = fbm(u * 3.1 + 5, v * 3.1 - 3, 23);
    const edge = radius * (0.7 + n * 0.6);
    const core = clamp01(1 - r / edge);
    const hot = Math.pow(core, 1.6);
    const alpha = clamp01(hot * 1.25) * (1 - t * 0.5);
    const heat = hot * (1 - t * 0.55) + n * 0.15;
    const rr = clamp01(0.55 + heat * 0.75);
    const gg = clamp01(heat * 0.62 + core * 0.2);
    const bb = clamp01(Math.pow(heat, 2.4) * 0.7);
    return [rr, gg, bb, alpha];
  }
  if (kind === 'spark') {
    // 火花：沿 U 轴细长，两端收尖；V 方向极窄。
    const along = 1 - Math.abs(u);
    const across = 1 - Math.abs(v) / 0.16;
    if (across <= 0) return [0, 0, 0, 0];
    const alpha = Math.pow(along, 0.7) * Math.pow(across, 0.8) * (1 - t * 0.3);
    return [1, 0.86 - t * 0.25, 0.5 - t * 0.3, alpha];
  }
  // glow：径向衰减的光晕。
  const core = clamp01(1 - r);
  const alpha = Math.pow(core, 2.2) * (1 - t * 0.35);
  return [1, 0.95 - t * 0.2, 0.82 - t * 0.35, alpha];
}

const kinds = ['smoke', 'fire', 'spark', 'glow'];
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4, 0);
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    for (let y = 0; y < FRAME; y++) {
      for (let x = 0; x < FRAME; x++) {
        const u = ((x + 0.5) / FRAME) * 2 - 1;
        const v = ((y + 0.5) / FRAME) * 2 - 1;
        const [r, g, b, a] = shade(kinds[row], col, u, v);
        const index = ((row * FRAME + y) * WIDTH + (col * FRAME + x)) * 4;
        pixels[index] = Math.round(clamp01(r) * 255);
        pixels[index + 1] = Math.round(clamp01(g) * 255);
        pixels[index + 2] = Math.round(clamp01(b) * 255);
        pixels[index + 3] = Math.round(clamp01(a) * 255);
      }
    }
  }
}

// ---------- 最小 PNG 编码（RGBA8、无滤波、单个 IDAT） ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  raw[y * (WIDTH * 4 + 1)] = 0; // filter: none
  pixels.copy(raw, y * (WIDTH * 4 + 1) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`[gen-vfx-atlas] ${WIDTH}×${HEIGHT} → ${OUT}（${(png.length / 1024).toFixed(1)} KB）`);
