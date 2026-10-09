import { describe, expect, it } from 'vitest';

import {
  advanceLogisticsFlow,
  createLogisticsFlowSprite,
  logisticsFlowSprite,
  logisticsFlowSpriteKey,
  logisticsFlowTexture,
  logisticsSorterTexture,
} from './logistics-flow-marks';

describe('2D 流向纹理', () => {
  it('水平/垂直两套变体各自缓存，同参数返回同一纹理', () => {
    expect(logisticsFlowTexture(true)).toBe(logisticsFlowTexture(true));
    expect(logisticsFlowTexture(true)).not.toBe(logisticsFlowTexture(false));
    expect(logisticsSorterTexture(true)).not.toBe(logisticsSorterTexture(false));
    expect(logisticsSorterTexture(true)).not.toBe(logisticsFlowTexture(true));
  });

  it('缓存键把「纹理变体 + 反向」编码进去（西/北靠 scale 负号，不重烘焙）', () => {
    expect(logisticsFlowSpriteKey('belt', 'east')).toBe('belt:h:+');
    expect(logisticsFlowSpriteKey('belt', 'west')).toBe('belt:h:-');
    expect(logisticsFlowSpriteKey('sorter', 'south')).toBe('sorter:v:+');
    expect(logisticsFlowSpriteKey('sorter', 'north')).toBe('sorter:v:-');
  });

  it('方向 → 纹理/旋转/翻转：垂直朝向旋转 -90°（局部 +x 对齐世界 +y = 南）', () => {
    const east = logisticsFlowSprite('belt', 'east');
    expect(east.rotation).toBe(0);
    expect(east.flip).toBe(false);
    expect(east.axis).toBe('x');
    const south = logisticsFlowSprite('belt', 'south');
    expect(south.rotation).toBeCloseTo(-Math.PI / 2, 6);
    expect(south.flip).toBe(false);
    expect(south.axis).toBe('y');
    expect(logisticsFlowSprite('belt', 'west').flip).toBe(true);
    expect(logisticsFlowSprite('belt', 'north').flip).toBe(true);
  });

  it('每格 sprite 用同一纹理、按 tile 平铺缩放', () => {
    const sprite = createLogisticsFlowSprite('belt', 'east', 24);
    expect(sprite.width).toBe(24);
    expect(sprite.height).toBe(12);
    expect(sprite.tileScale.x).toBeCloseTo(24 / 32, 6);
  });

  it('滚动：速度 0 时不动，速度 >0 时按 tile/s 推进', () => {
    const sprite = createLogisticsFlowSprite('belt', 'east', 20);
    advanceLogisticsFlow(sprite, 1, 0, 20, 'x');
    expect(sprite.tilePosition.x).toBe(0);
    advanceLogisticsFlow(sprite, 0.25, 1, 20, 'x');
    expect(sprite.tilePosition.x).toBeCloseTo(5, 6);
    advanceLogisticsFlow(sprite, 0.25, 1, 20, 'x');
    expect(sprite.tilePosition.x).toBeCloseTo(10, 6);
    // 一个平铺周期 = 一格：跑满一格回卷，不跳变（chevron 相位连续）。
    advanceLogisticsFlow(sprite, 0.5, 1, 20, 'x');
    expect(sprite.tilePosition.x).toBeCloseTo(0, 6);
  });

  it('垂直朝向沿 y 滚动，与水平朝向互不影响', () => {
    const sprite = createLogisticsFlowSprite('belt', 'south', 20);
    advanceLogisticsFlow(sprite, 0.25, 1, 20, 'y');
    expect(sprite.tilePosition.y).toBeCloseTo(5, 6);
    expect(sprite.tilePosition.x).toBe(0);
  });
});
