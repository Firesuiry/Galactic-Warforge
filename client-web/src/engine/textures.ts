/**
 * 程序化纹理工厂：零美术资源，全部用 Canvas 2D 渐变/图形生成后转 Pixi Texture。
 * 纹理按 key 缓存。仅在浏览器环境调用（依赖 document.createElement('canvas')）。
 */

import { Texture } from 'pixi.js';

const cache = new Map<string, Texture>();

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }
  return [canvas, ctx];
}

function toTexture(key: string, canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas);
  cache.set(key, texture);
  return texture;
}

function numToCss(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 径向光晕：中心实色向外衰减到透明。 */
export function getGlowTexture(color: number, size = 128): Texture {
  const key = `glow:${color}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, numToCss(color, 0.9));
  gradient.addColorStop(0.25, numToCss(color, 0.45));
  gradient.addColorStop(0.6, numToCss(color, 0.12));
  gradient.addColorStop(1, numToCss(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(key, canvas);
}

/** 恒星：白热核心 + 谱色光晕。 */
export function getStarTexture(color: number, size = 128): Texture {
  const key = `star:${color}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.12, numToCss(0xffffff, 0.95));
  gradient.addColorStop(0.22, numToCss(color, 0.85));
  gradient.addColorStop(0.5, numToCss(color, 0.25));
  gradient.addColorStop(1, numToCss(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(key, canvas);
}

/** 行星球体：受光面高光 + 背光面阴影，带轻微带状纹理。 */
export function getPlanetTexture(color: number, size = 64, bandColor?: number): Texture {
  const key = `planet:${color}:${bandColor ?? 0}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const radius = half - 1;

  const sphere = ctx.createRadialGradient(
    half - radius * 0.35, half - radius * 0.35, radius * 0.1,
    half, half, radius,
  );
  sphere.addColorStop(0, numToCss(0xffffff, 0.95));
  sphere.addColorStop(0.18, numToCss(color, 1));
  sphere.addColorStop(0.75, numToCss(color, 0.55));
  sphere.addColorStop(1, 'rgba(4, 8, 18, 0.95)');
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(half, half, radius, 0, Math.PI * 2);
  ctx.fill();

  if (bandColor != null) {
    // 气态行星条纹：裁剪到球面内的水平带。
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = numToCss(bandColor, 1);
    const bandHeight = Math.max(2, size / 9);
    for (let i = 0; i < 3; i += 1) {
      const y = half - radius + bandHeight * (1 + i * 2.4);
      ctx.fillRect(half - radius, y, radius * 2, bandHeight * 0.7);
    }
    ctx.restore();
  }
  return toTexture(key, canvas);
}

/** 星场瓦片：随机星点，供 TilingSprite 平铺做视差背景。 */
export function getStarfieldTexture(seed: number, density: number, size = 512): Texture {
  const key = `starfield:${seed}:${density}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  let randomState = seed >>> 0 || 1;
  const rand = () => {
    // xorshift32：确定性随机，保证瓦片可缓存复用。
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return ((randomState >>> 0) / 0xffffffff);
  };
  for (let i = 0; i < density; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rand() * 1.4 + 0.3;
    const alpha = 0.25 + rand() * 0.75;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(key, canvas);
}

/** 星云团：若干叠加的柔和色团。 */
export function getNebulaTexture(color: number, seed: number, size = 512): Texture {
  const key = `nebula:${color}:${seed}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  let randomState = seed >>> 0 || 7;
  const rand = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return ((randomState >>> 0) / 0xffffffff);
  };
  for (let i = 0; i < 6; i += 1) {
    const cx = size * (0.25 + rand() * 0.5);
    const cy = size * (0.25 + rand() * 0.5);
    const r = size * (0.18 + rand() * 0.22);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, numToCss(color, 0.10));
    gradient.addColorStop(1, numToCss(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return toTexture(key, canvas);
}

/**
 * emoji 字形纹理：离屏 canvas fillText 绘制后转 Texture，按 `emoji:<glyph>:<size>` 缓存。
 * 供行星地图实体图标（建筑/单位/资源）使用；字形解析走 common/Icon 的 resolveIconGlyph。
 */
export function getEmojiTexture(glyph: string, size = 64): Texture {
  const key = `emoji:${glyph}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  ctx.font = `${Math.round(size * 0.78)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, size / 2, size / 2 + Math.round(size * 0.04));
  return toTexture(key, canvas);
}

/** 轻暗角：中心透明向四角渐暗，全屏叠加增强聚焦感（截图确定性：静态纹理）。 */
export function getVignetteTexture(size = 512): Texture {
  const key = `vignette:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, size * 0.32, half, half, size * 0.72);
  gradient.addColorStop(0, 'rgba(3, 7, 15, 0)');
  gradient.addColorStop(0.72, 'rgba(3, 7, 15, 0.16)');
  gradient.addColorStop(1, 'rgba(3, 7, 15, 0.52)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(key, canvas);
}

/** 测试/热重载时清空缓存。 */
export function clearTextureCache() {
  cache.forEach((texture) => texture.destroy(true));
  cache.clear();
}
