/**
 * 2D 平面战术图的物流方向纹：传送带 / 分拣器 / 分流器每格一个流向箭头。
 *
 * 与 3D（three/logistics-marks）同一套「UV 滚动 = 流向」的思路：
 * 纹理由 CanvasTexture 烘焙（方向 x 状态变体，全局缓存），TilingSprite 按格子平铺、
 * tilePosition 沿流向滚动（速度与货物圆点同口径），所以：
 * - 铺一条 9 格的带子只多 9 个 TilingSprite（不逐帧重画几何体）；
 * - 无货/冻结时滚动停住，箭头静止（不闪）。
 * 方向一律来自 logistics-direction（服务端 conveyor.output / sorter 配置）。
 */

import { Texture, TilingSprite } from 'pixi.js';

import { type CardinalDirection } from '@/features/planet-map/logistics-direction';

/** 带体底色/钢轨/琥珀箭头：与 planet-building-sprites 的 belt 调色板同系。 */
const BODY = '#4a5462';
const BODY_DARK = '#2e3642';
const CHEVRON = '#ffd43b';
const CHEVRON_DIM = '#8a6a1f';
const OUTLINE = '#1b2129';

const cache = new Map<string, Texture>();

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')];
}

function toTexture(key: string, element: HTMLCanvasElement): Texture {
  const texture = Texture.from(element);
  texture.source.scaleMode = 'linear';
  cache.set(key, texture);
  return texture;
}

/**
 * 一格带体的流向纹：带体 + 两条钢轨 + 沿 +x 的 chevron（32px/tile，与建筑精灵同分辨率）。
 * 水平变体烘焙；垂直朝向由 rotation 表达，反向由 scale.x 负号表达。
 * 滚动 tilePosition 即「流向」，无货/停摆时静止。
 */
export function logisticsFlowTexture(horizontal: boolean): Texture {
  const key = `logistics-flow:${horizontal ? 'h' : 'v'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 32;
  const [element, ctx] = canvas(size, size);
  if (!ctx) return toTexture(key, element);
  ctx.fillStyle = BODY;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = BODY_DARK;
  ctx.fillRect(0, 0, size, 5);
  ctx.fillRect(0, size - 5, size, 5);
  ctx.fillStyle = '#77839a';
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, size - 2, size, 2);
  // 两个 chevron（指向 +x），沿带体一个重复周期恰好一个流向提示。
  for (const [color, width] of [[CHEVRON_DIM, 6], [CHEVRON, 3.5]] as [string, number][]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const cx of [8, 24]) {
      ctx.beginPath();
      ctx.moveTo(cx - 4, 9);
      ctx.lineTo(cx + 4, size / 2);
      ctx.lineTo(cx - 4, size - 9);
      ctx.stroke();
    }
  }
  return toTexture(key, element);
}

/** 分拣器/分流器顶面箭头：透明底 + 琥珀实心箭头（指向 +x），水平/垂直两个变体。 */
export function logisticsSorterTexture(horizontal: boolean): Texture {
  const key = `logistics-sorter:${horizontal ? 'h' : 'v'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 32;
  const [element, ctx] = canvas(size, size);
  if (!ctx) return toTexture(key, element);
  const arrow = (fill: string, stroke: string, width: number) => {
    ctx.beginPath();
    ctx.moveTo(5, 7);
    ctx.lineTo(27, 16);
    ctx.lineTo(5, 25);
    ctx.lineTo(5, 19);
    ctx.lineTo(15, 16);
    ctx.lineTo(5, 13);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  ctx.save();
  ctx.translate(size / 2, size / 2);
  if (!horizontal) ctx.rotate(Math.PI / 2);
  ctx.translate(-size / 2, -size / 2);
  arrow(CHEVRON_DIM, OUTLINE, 5);
  arrow(CHEVRON, OUTLINE, 2);
  ctx.restore();
  return toTexture(key, element);
}

/** 纹理缓存键（scene 侧按此判断是否需要换纹理）。 */
export function logisticsFlowSpriteKey(kind: 'belt' | 'sorter', direction: CardinalDirection): string {
  const horizontal = direction === 'east' || direction === 'west';
  const flip = direction === 'west' || direction === 'north';
  return `${kind}:${horizontal ? 'h' : 'v'}:${flip ? '-' : '+'}`;
}

/**
 * 方向 → 显示参数：纹理只烘「水平/垂直」两套，反向靠 scale 负号（西/北），不重烘焙。
 * 垂直朝向时 rotation = -90°（局部 +x 转到世界 +y = 南），此时局部 x 的负号才等价于世界反向。
 */
export function logisticsFlowSprite(
  kind: 'belt' | 'sorter',
  direction: CardinalDirection,
): { texture: Texture; flip: boolean; rotation: number; axis: 'x' | 'y' } {
  const horizontal = direction === 'east' || direction === 'west';
  return {
    texture: kind === 'belt' ? logisticsFlowTexture(horizontal) : logisticsSorterTexture(horizontal),
    flip: direction === 'west' || direction === 'north',
    rotation: horizontal ? 0 : -Math.PI / 2,
    axis: horizontal ? 'x' : 'y',
  };
}

/** 一格 TilingSprite：朝向由 rotation/scale 表达，纹理由 tilePosition 沿带体滚动。 */
export function createLogisticsFlowSprite(kind: 'belt' | 'sorter', direction: CardinalDirection, tileSize: number): TilingSprite {
  const { texture, flip, rotation } = logisticsFlowSprite(kind, direction);
  const sprite = new TilingSprite({ texture, width: tileSize, height: tileSize * 0.5 });
  sprite.anchor.set(0.5);
  sprite.rotation = rotation;
  if (flip) sprite.scale.x = -1;
  sprite.tileScale.set(tileSize / 32, tileSize / 32);
  return sprite;
}

/**
 * 按流向推进 tilePosition（tile/s → px/s）。翻转由调用方的 scale 承担，这里只朝纹理正向滚。
 * 无货/冻结时 speed 传 0，箭头静止（不闪）。
 */
export function advanceLogisticsFlow(
  sprite: TilingSprite,
  deltaSeconds: number,
  speedTilesPerSecond: number,
  tileSize: number,
  axis: 'x' | 'y',
) {
  if (deltaSeconds <= 0 || speedTilesPerSecond <= 0) return;
  // 一个平铺周期 = 一格（纹理里两个 chevron 正好覆盖一格），循环不回卷跳变。
  const period = tileSize;
  const step = (deltaSeconds * speedTilesPerSecond * tileSize) % period;
  if (axis === 'x') sprite.tilePosition.x = (sprite.tilePosition.x + step) % period;
  else sprite.tilePosition.y = (sprite.tilePosition.y + step) % period;
}

/** 测试/热重载清空缓存。 */
export function clearLogisticsFlowTextures() {
  cache.forEach((texture) => texture.destroy(true));
  cache.clear();
}
