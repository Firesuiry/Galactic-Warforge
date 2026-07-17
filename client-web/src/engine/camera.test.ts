import { describe, expect, it } from 'vitest';

import { Camera2D } from '@/engine/camera';

const viewport = { width: 800, height: 600 };

describe('Camera2D', () => {
  it('world/screen 坐标互转', () => {
    const cam = new Camera2D({ x: 100, y: 50, zoom: 2 });
    const screen = cam.worldToScreen(100, 50, viewport);
    expect(screen).toEqual({ x: 400, y: 300 });
    const world = cam.screenToWorld(400, 300, viewport);
    expect(world).toEqual({ x: 100, y: 50 });
    const world2 = cam.screenToWorld(500, 400, viewport);
    expect(world2).toEqual({ x: 150, y: 100 });
  });

  it('panBy 以屏幕像素平移（方向与拖拽相反）', () => {
    const cam = new Camera2D({ x: 0, y: 0, zoom: 2 });
    cam.panBy(20, -10);
    expect(cam.x).toBe(-10);
    expect(cam.y).toBe(5);
  });

  it('zoomAt 保持锚点下的世界点不动', () => {
    const cam = new Camera2D({ x: 0, y: 0, zoom: 1 });
    const before = cam.screenToWorld(600, 200, viewport);
    cam.zoomAt(600, 200, 2, viewport);
    expect(cam.zoom).toBe(2);
    const after = cam.screenToWorld(600, 200, viewport);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoom 受 min/max 钳制', () => {
    const cam = new Camera2D({ x: 0, y: 0, zoom: 1 }, { minZoom: 0.5, maxZoom: 4 });
    cam.zoomAt(400, 300, 100, viewport);
    expect(cam.zoom).toBe(4);
    cam.zoomAt(400, 300, 0.0001, viewport);
    expect(cam.zoom).toBe(0.5);
  });

  it('flyTo 补间到目标，update 推进直到完成', () => {
    const cam = new Camera2D({ x: 0, y: 0, zoom: 1 });
    cam.flyTo({ x: 100, y: 0, zoom: 2 }, 100);
    expect(cam.animating).toBe(true);
    cam.update(50);
    expect(cam.x).toBeGreaterThan(0);
    expect(cam.x).toBeLessThan(100);
    cam.update(100);
    expect(cam.animating).toBe(false);
    expect(cam.x).toBe(100);
    expect(cam.zoom).toBe(2);
  });

  it('panBy/zoomAt/jumpTo 会取消进行中的飞行动画', () => {
    const cam = new Camera2D({ x: 0, y: 0, zoom: 1 });
    cam.flyTo({ x: 100 }, 500);
    cam.panBy(10, 0);
    expect(cam.animating).toBe(false);
    cam.flyTo({ x: 100 }, 500);
    cam.jumpTo({ x: 5 });
    expect(cam.animating).toBe(false);
    expect(cam.x).toBe(5);
  });
});
