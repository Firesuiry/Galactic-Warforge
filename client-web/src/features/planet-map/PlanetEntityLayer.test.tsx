import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

import { getFixtureScenario } from '@/fixtures';
import { renderEntitiesToCanvas } from '@/features/planet-map/entity-draw';
import { PlanetMapCanvas } from '@/features/planet-map/PlanetMapCanvas';
import { DEFAULT_PLANET_ZOOM_INDEX, resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore, useSessionStore } from '@/stores/session';

/**
 * 验证语义实体层把棋盘上的实体渲染成带 data-* 的真实 DOM 节点——
 * 这是 agent/DevTools 可调试的核心契约（之前纯 canvas 是读不到的不透明位图）。
 */
describe('PlanetMapCanvas 语义实体层（DOM 可调试）', () => {
  afterEach(() => {
    resetSessionStore();
    resetPlanetViewStore();
  });

  it('建筑渲染为带 data-* 的 DOM 节点，可被 querySelector/[data-entity-id] 定位', () => {
    resetSessionStore();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:18080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    usePlanetViewStore.getState().setCamera({
      offsetX: 32,
      offsetY: 32,
      zoomIndex: DEFAULT_PLANET_ZOOM_INDEX,
      ready: true,
    });

    const planet = getFixtureScenario('baseline').planets['planet-1-1'];
    const { container } = render(createElement(PlanetMapCanvas, { planet }));

    const miner = container.querySelector('[data-entity-kind="building"][data-entity-id="miner-1"]');
    expect(miner).not.toBeNull();
    expect(miner?.getAttribute('data-building-type')).toBe('mining_machine');
    expect(miner?.getAttribute('data-owner')).toBe('self');
    expect(miner?.getAttribute('data-tile-x')).toBe('1');
    expect(miner?.getAttribute('data-tile-y')).toBe('1');

    // 三个建筑都应渲染为独立节点
    const buildings = container.querySelectorAll('[data-entity-kind="building"]');
    expect(buildings.length).toBeGreaterThanOrEqual(3);

    // 单位与资源也应是可定位的 DOM 节点
    const worker = container.querySelector('[data-entity-kind="unit"][data-entity-id="worker-1"]');
    expect(worker).not.toBeNull();
    expect(worker?.getAttribute('data-owner')).toBe('self');

    const iron = container.querySelector('[data-entity-kind="resource"][data-resource-kind="iron_ore"]');
    expect(iron).not.toBeNull();
  });

  it('overview 缩放（zoom 0-2）下不渲染实体 DOM（canvas 只画热力图）', () => {
    resetSessionStore();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:18080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    usePlanetViewStore.getState().setCamera({
      offsetX: 0,
      offsetY: 0,
      zoomIndex: 0, // overview
      ready: true,
    });

    const planet = getFixtureScenario('baseline').planets['planet-1-1'];
    const { container } = render(createElement(PlanetMapCanvas, { planet }));

    expect(container.querySelectorAll('[data-entity-kind="building"]').length).toBe(0);
  });

  it('renderEntitiesToCanvas 把可见实体合成进 canvas（PNG 导出全保真）', () => {
    resetSessionStore();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:18080',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    usePlanetViewStore.getState().setCamera({
      offsetX: 32,
      offsetY: 32,
      zoomIndex: DEFAULT_PLANET_ZOOM_INDEX,
      ready: true,
    });

    const scenario = getFixtureScenario('baseline');
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const mockFillRect = ctx.fillRect as unknown as { mock: { calls: unknown[] } };
    const before = mockFillRect.mock.calls.length;

    renderEntitiesToCanvas(
      ctx,
      scenario.planets['planet-1-1'],
      scenario.runtimeByPlanet['planet-1-1'],
      scenario.networksByPlanet['planet-1-1'],
      usePlanetViewStore.getState().camera,
      960,
      640,
      scenario.catalog,
      'p1',
      { buildings: true, units: true, resources: true, logistics: true, construction: true, threat: true, power: true, pipelines: true },
    );

    // 建筑/单位/资源都应贡献绘制调用（实体被合成进 canvas）。
    expect(mockFillRect.mock.calls.length).toBeGreaterThan(before);
  });
});
