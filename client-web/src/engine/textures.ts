/**
 * 程序化纹理工厂：零美术资源，全部用 Canvas 2D 渐变/图形生成后转 Pixi Texture。
 * 纹理按 key 缓存。仅在浏览器环境调用（依赖 document.createElement('canvas')）。
 */

import type { IconNode } from 'lucide-react';
import { Texture } from 'pixi.js';

import { resolveIconNode } from '@/common/icon-map';

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

/** 硬边圆粒：实色填充 + 暗色描边 + 左上高光（传送带货物/采集矿粒等小圆点用）。 */
export function getDiscTexture(color: number, size = 64): Texture {
  const key = `disc:${color}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [canvas, ctx] = makeCanvas(size);
  const half = size / 2;
  const radius = half - 2;
  const gradient = ctx.createRadialGradient(
    half - radius * 0.35, half - radius * 0.35, radius * 0.1,
    half, half, radius,
  );
  gradient.addColorStop(0, numToCss(0xffffff, 0.95));
  gradient.addColorStop(0.25, numToCss(color, 1));
  gradient.addColorStop(1, numToCss(color, 0.82));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(half, half, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(6, 10, 18, 0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
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
 * lucide 图标纹理：把 common/icon-map 的 SVG 节点数据（24×24 viewBox 线稿）用 Path2D
 * 描进离屏 canvas 后转 Texture，按 `icon:<iconKey>:<color>:<size>` 缓存。
 * 供行星地图实体图标（建筑角标/资源/警示）使用；与 DOM 侧 common/Icon 同一映射。
 * 未命中映射时回退为首字母字形（与 DOM Icon 的回退一致）。
 */
const ICON_VIEWBOX = 24;
const ICON_STROKE_WIDTH = 2;

function parseSvgPoints(points: string): Array<[number, number]> {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y];
    });
}

/** 把 lucide 节点元素（path/circle/ellipse/line/rect/polyline/polygon）转成 Path2D。 */
function iconElementToPath2D(tag: string, attrs: Record<string, string>): Path2D | null {
  switch (tag) {
    case 'path':
      return attrs.d ? new Path2D(attrs.d) : null;
    case 'circle': {
      const p = new Path2D();
      p.arc(Number(attrs.cx), Number(attrs.cy), Number(attrs.r), 0, Math.PI * 2);
      return p;
    }
    case 'ellipse': {
      const p = new Path2D();
      p.ellipse(
        Number(attrs.cx),
        Number(attrs.cy),
        Number(attrs.rx),
        Number(attrs.ry),
        0,
        0,
        Math.PI * 2,
      );
      return p;
    }
    case 'line': {
      const p = new Path2D();
      p.moveTo(Number(attrs.x1), Number(attrs.y1));
      p.lineTo(Number(attrs.x2), Number(attrs.y2));
      return p;
    }
    case 'rect': {
      const p = new Path2D();
      p.rect(Number(attrs.x), Number(attrs.y), Number(attrs.width), Number(attrs.height));
      return p;
    }
    case 'polyline':
    case 'polygon': {
      const pts = parseSvgPoints(attrs.points ?? '');
      if (pts.length < 2) return null;
      const p = new Path2D();
      p.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) {
        p.lineTo(x, y);
      }
      if (tag === 'polygon') {
        p.closePath();
      }
      return p;
    }
    default:
      return null;
  }
}

function renderIconCanvas(node: IconNode, colorCss: string, size: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size);
  // 线稿贴边会发虚：留 6% 内边距后按 viewBox 缩放，stroke 属性在 viewBox 坐标系下设定。
  const scale = (size * 0.88) / ICON_VIEWBOX;
  ctx.save();
  ctx.translate(size * 0.06, size * 0.06);
  ctx.scale(scale, scale);
  ctx.strokeStyle = colorCss;
  ctx.fillStyle = colorCss;
  ctx.lineWidth = ICON_STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [tag, attrs] of node) {
    const path = iconElementToPath2D(tag, attrs);
    if (!path) {
      continue;
    }
    if (attrs.fill && attrs.fill !== 'none') {
      ctx.fill(path);
    } else {
      ctx.stroke(path);
    }
  }
  ctx.restore();
  return canvas;
}

export function getIconTexture(iconKey: string | undefined, color = 0x39e6d0, size = 64): Texture {
  const key = `icon:${iconKey ?? ''}:${color}:${size}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const node = resolveIconNode(iconKey);
  const canvas = node
    ? renderIconCanvas(node, numToCss(color), size)
    : renderFallbackLetterCanvas(iconKey, numToCss(color), size);
  return toTexture(key, canvas);
}

/** 未命中映射时的字母回退纹理（对齐 DOM Icon 的首字母回退）。 */
function renderFallbackLetterCanvas(
  iconKey: string | undefined,
  colorCss: string,
  size: number,
): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size);
  const letter = iconKey && iconKey.length > 0 ? iconKey.charAt(0).toUpperCase() : '?';
  ctx.font = `600 ${Math.round(size * 0.5)}px "Segoe UI", "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colorCss;
  ctx.fillText(letter, size / 2, size / 2 + Math.round(size * 0.03));
  return canvas;
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
