import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';

import type { FogMapView } from '@shared/types';

import { getFixtureScenario } from '@/fixtures';
import { PlanetMapPixi } from '@/features/planet-map/PlanetMapPixi';
import { DEFAULT_PLANET_ZOOM_INDEX, resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore, useSessionStore } from '@/stores/session';

// jsdom 无法真正初始化 Pixi Application；交互（拖拽/滚轮/点选）走 DOM 事件与 store，与 Pixi 无关。
vi.mock('@/engine/PixiStage', () => ({
  PixiStage: () => <div data-testid="pixi-stage" />,
}));

// jsdom 默认不暴露 PointerEvent 构造器；React 的 onPointerDown 由事件 type（'pointerdown'）触发，
// 与构造器无关，故用 MouseEvent 冒充指针事件分发即可携带 clientX/clientY。
const PointerEventCtor = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;

const SEED_OFFSET = 32;

function buildFullyVisibleFog(): FogMapView {
  const size = 48;
  const visible: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    visible.push(new Array(size).fill(true));
  }
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    map_width: size,
    map_height: size,
    visible,
    explored: visible,
  } as unknown as FogMapView;
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

describe('PlanetMapPixi 交互（拖拽/缩放/点选）', () => {
  afterEach(() => {
    resetSessionStore();
    resetPlanetViewStore();
  });

  it('拖拽的 N 次 pointermove 经 rAF 合帧为 ~1 次相机提交', async () => {
    seedStores();
    const planet = getFixtureScenario('baseline').planets['planet-1-1'];
    const { container } = render(createElement(PlanetMapPixi, { planet, fog: buildFullyVisibleFog() }));
    const surface = container.querySelector('.planet-map-canvas__surface');
    if (!surface) {
      throw new Error('交互面未渲染');
    }

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
      surface.dispatchEvent(new PointerEventCtor('pointerdown', { clientX: startX, clientY: startY, bubbles: true }));
      for (let i = 1; i <= N; i += 1) {
        surface.dispatchEvent(new PointerEventCtor('pointermove', { clientX: startX + i, clientY: startY, bubbles: true }));
      }
    });
    // 让 rAF 合帧回调落地（jsdom 的 requestAnimationFrame 异步触发）。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    unsubscribe();

    const finalOffsetX = usePlanetViewStore.getState().camera.offsetX;
    // 合帧前会是 ~N 次提交；合帧后一帧只提交一次（允许 initial camera 的一次兜底提交）。
    expect(cameraCommits).toBeLessThanOrEqual(2);
    // 终态反映最后一次 pointermove（dragState 起始 offset + 总位移 N）。
    expect(finalOffsetX).toBe(SEED_OFFSET + N);
  });

  it('滚轮在指针位置缩放一档（zoomIndex ±1）', async () => {
    seedStores();
    const planet = getFixtureScenario('baseline').planets['planet-1-1'];
    const { container } = render(createElement(PlanetMapPixi, { planet, fog: buildFullyVisibleFog() }));
    const surface = container.querySelector('.planet-map-canvas__surface');
    if (!surface) {
      throw new Error('交互面未渲染');
    }

    await act(async () => {
      surface.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(usePlanetViewStore.getState().camera.zoomIndex).toBe(DEFAULT_PLANET_ZOOM_INDEX - 1);
  });

  it('inspect 模式点击建筑所在 tile → 选中该建筑', async () => {
    seedStores();
    const planet = getFixtureScenario('baseline').planets['planet-1-1'];
    const { container } = render(createElement(PlanetMapPixi, { planet, fog: buildFullyVisibleFog() }));
    const surface = container.querySelector('.planet-map-canvas__surface');
    if (!surface) {
      throw new Error('交互面未渲染');
    }

    // miner-1 在 tile (1,1)；camera offset 32、tileSize 8（默认档 zoomIndex 6）。
    await act(async () => {
      surface.dispatchEvent(new MouseEvent('click', {
        clientX: SEED_OFFSET + 1.5 * 8,
        clientY: SEED_OFFSET + 1.5 * 8,
        bubbles: true,
      }));
    });

    const selected = usePlanetViewStore.getState().selected;
    expect(selected?.kind).toBe('building');
    expect(selected && 'id' in selected ? selected.id : '').toBe('miner-1');
  });
});
