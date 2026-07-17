import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

import { getFixtureScenario } from '@/fixtures';
import { PlanetMapPixi } from '@/features/planet-map/PlanetMapPixi';
import { DEFAULT_PLANET_ZOOM_INDEX, resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore, useSessionStore } from '@/stores/session';

// jsdom 无法真正初始化 Pixi Application；实体 DOM 契约由 ghost 语义层承担，与 Pixi 无关。
vi.mock('@/engine/PixiStage', () => ({
  PixiStage: () => <div data-testid="pixi-stage" />,
}));

/**
 * 验证语义实体层把棋盘上的实体渲染成带 data-* 的真实 DOM 节点——
 * 这是 agent/DevTools 可调试的核心契约（Pixi 位图本身读不到实体语义）。
 * Pixi 迁移后实体视觉由 planet-scene 承担，DOM 以 ghost（opacity:0）形式保留。
 */
describe('PlanetMapPixi 语义实体层（DOM 可调试）', () => {
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
    const { container } = render(createElement(PlanetMapPixi, { planet }));

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

  it('实体层是 ghost 形式：带 entity-layer--ghost（opacity:0），视觉由 Pixi 承担', () => {
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
    const { container } = render(createElement(PlanetMapPixi, { planet }));

    const layer = container.querySelector('.entity-layer');
    expect(layer).not.toBeNull();
    expect(layer?.classList.contains('entity-layer--ghost')).toBe(true);
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
  });

  it('overview 缩放（zoom 0-2）下不渲染实体 DOM（Pixi 只画热力图）', () => {
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
    const { container } = render(createElement(PlanetMapPixi, { planet }));

    expect(container.querySelectorAll('[data-entity-kind="building"]').length).toBe(0);
  });
});
