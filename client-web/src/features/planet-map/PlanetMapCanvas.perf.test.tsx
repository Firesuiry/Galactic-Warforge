import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';

import type { FogMapView, PlanetView } from '@shared/types';

import { PlanetMapCanvas } from '@/features/planet-map/PlanetMapCanvas';
import { DEFAULT_PLANET_ZOOM_INDEX, resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore, useSessionStore } from '@/stores/session';

// jsdom 默认不暴露 PointerEvent 构造器；React 的 onPointerDown 由事件 type（'pointerdown'）触发，
// 与构造器无关，故用 MouseEvent 冒充指针事件分发即可携带 clientX/clientY。
const PointerEventCtor = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;

// 视口在 jsdom 下无布局，PlanetMapCanvas 会回退到 960x640 默认视口（见 getViewportDefaults）。
// scene 缩放 zoomIndex=5 => tileSize 12px => 可见 tile 约 80x53 ≈ 4200 格。
const MAP_W = 200;
const MAP_H = 200;
const SEED_OFFSET = 32;

function buildLargePlanet(): PlanetView {
  const terrain: string[][] = [];
  for (let y = 0; y < MAP_H; y += 1) {
    const row: string[] = [];
    for (let x = 0; x < MAP_W; x += 1) {
      row.push('buildable');
    }
    terrain.push(row);
  }
  return {
    planet_id: 'perf-planet',
    name: 'Perf',
    discovered: true,
    kind: 'terrestrial',
    map_width: MAP_W,
    map_height: MAP_H,
    tick: 1,
    terrain,
  } as unknown as PlanetView;
}

function buildFullyVisibleFog(): FogMapView {
  const visible: boolean[][] = [];
  for (let y = 0; y < MAP_H; y += 1) {
    visible.push(new Array(MAP_W).fill(true));
  }
  return {
    planet_id: 'perf-planet',
    discovered: true,
    map_width: MAP_W,
    map_height: MAP_H,
    visible,
    explored: visible,
  } as unknown as FogMapView;
}

// setup.ts 把 HTMLCanvasElement.prototype.getContext 替换成返回同一个 stub 的 vi.fn。
function grabCanvasContext() {
  const ctx = document.createElement('canvas').getContext('2d') as unknown as {
    fillRect: { mock: { calls: unknown[] } };
    drawImage: { mock: { calls: unknown[] } };
    clearRect: { mock: { calls: unknown[] } };
  };
  return ctx;
}

function clearCanvasMock(ctx: ReturnType<typeof grabCanvasContext>) {
  ctx.fillRect.mock.calls.length = 0;
  ctx.drawImage.mock.calls.length = 0;
  ctx.clearRect.mock.calls.length = 0;
}

function seedStores() {
  resetSessionStore();
  resetPlanetViewStore();
  useSessionStore.getState().setSession({
    serverUrl: 'http://localhost:18080',
    playerId: 'p1',
    playerKey: 'key_player_1',
  });
  usePlanetViewStore.getState().setCamera({
    offsetX: SEED_OFFSET,
    offsetY: SEED_OFFSET,
    zoomIndex: DEFAULT_PLANET_ZOOM_INDEX,
    ready: true,
  });
}

describe('PlanetMapCanvas 拖拽重绘开销（棋盘格子卡顿根因）', () => {
  afterEach(() => {
    resetSessionStore();
    resetPlanetViewStore();
  });

  it('一次相机偏移即触发整屏逐格重绘（千级 fillRect），证明底图为全量逐格绘制', () => {
    seedStores();
    const ctx = grabCanvasContext();
    render(createElement(PlanetMapCanvas, { planet: buildLargePlanet(), fog: buildFullyVisibleFog() }));

    clearCanvasMock(ctx);

    act(() => {
      usePlanetViewStore.getState().setCamera({ offsetX: SEED_OFFSET + 1, ready: true });
    });

    const fillRects = ctx.fillRect.mock.calls.length;
    const expectedTiles = Math.ceil(960 / 12) * Math.ceil(640 / 12);

    // eslint-disable-next-line no-console
    console.log(`[perf] 单次相机偏移: fillRect=${fillRects} (可见 tile≈${expectedTiles})`);
    expect(fillRects).toBeGreaterThan(1000);
  });

  it('拖拽的 N 次 pointermove 经 rAF 合帧为 ~1 次相机提交（不再逐事件整屏重绘）', async () => {
    seedStores();
    const ctx = grabCanvasContext();
    const { container } = render(createElement(PlanetMapCanvas, { planet: buildLargePlanet(), fog: buildFullyVisibleFog() }));
    const canvas = container.querySelector('canvas');
    if (!canvas) {
      throw new Error('canvas 未渲染');
    }

    clearCanvasMock(ctx);

    let cameraCommits = 0;
    const unsubscribe = usePlanetViewStore.subscribe((state, prevState) => {
      if (state.camera !== prevState.camera) {
        cameraCommits += 1;
      }
    });

    const startX = 200;
    const startY = 200;
    const N = 30;

    // 按下后连续 N 次 pointermove（同一帧内到达，模拟真实快速拖拽）。
    await act(async () => {
      canvas.dispatchEvent(new PointerEventCtor('pointerdown', { clientX: startX, clientY: startY, bubbles: true }));
      for (let i = 1; i <= N; i += 1) {
        canvas.dispatchEvent(new PointerEventCtor('pointermove', { clientX: startX + i, clientY: startY, bubbles: true }));
      }
    });
    // 让 rAF 合帧回调落地（jsdom 的 requestAnimationFrame 异步触发）。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    unsubscribe();

    const drawImageCount = ctx.drawImage.mock.calls.length;
    const finalOffsetX = usePlanetViewStore.getState().camera.offsetX;

    // eslint-disable-next-line no-console
    console.log(`[perf] ${N} 次拖拽 pointermove（合帧后）: 相机提交=${cameraCommits}, drawImage=${drawImageCount}, 终态 offsetX=${finalOffsetX}（期望 ${SEED_OFFSET + N}）`);

    // 合帧前会是 ~N 次提交/整屏重绘；合帧后一帧只提交一次。
    expect(cameraCommits).toBeLessThanOrEqual(2);
    expect(drawImageCount).toBeLessThanOrEqual(3);
    // 终态反映最后一次 pointermove（dragState 起始 offset + 总位移 N）。
    expect(finalOffsetX).toBe(SEED_OFFSET + N);
  });
});
