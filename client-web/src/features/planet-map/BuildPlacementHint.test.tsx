import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PlanetRuntimeView } from '@shared/types';

import { BuildPlacementHint } from '@/features/planet-map/BuildPlacementHint';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';

/** 极简行星：全部地形可建、无建筑，只有一格资源。 */
function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere', face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, () => Array.from({ length: 24 }, () => 'buildable')),
    buildings: {},
    units: {},
    resources: [],
  } as PlanetRenderView;
}

function makeRuntime(tasks: PlanetRuntimeView['construction_tasks']): PlanetRuntimeView {
  return { planet_id: 'planet-1-1', tick: 10, construction_tasks: tasks } as PlanetRuntimeView;
}

/** 让提示定位到指定格（组件依赖 hoveredTile + pointermove 的位置）。 */
function pointAt(tile: { x: number; y: number }) {
  act(() => {
    usePlanetViewStore.getState().setHoveredTile(tile);
    fireEvent.pointerMove(window, { clientX: 120, clientY: 90 });
  });
}

describe('BuildPlacementHint 同格施工任务提示（试玩 1010 G / 1011 E）', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    usePlanetViewStore.getState().setInteractionMode({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });
  });

  it('同一格已有自己的施工任务时，文案与服务端 constructionReservationMessage 同口径', () => {
    render(
      <BuildPlacementHint
        planet={makePlanet()}
        playerId="p1"
        runtime={makeRuntime([{
          id: 'ct-1',
          player_id: 'p1',
          building_type: 'wind_turbine',
          position: { x: 5, y: 6, z: 0 },
          state: 'pending',
          enqueue_tick: 1,
        } as never])}
      />,
    );
    pointAt({ x: 5, y: 6 });

    const hint = screen.getByRole('status');
    expect(hint).toHaveTextContent('该格已有你的施工任务：风力涡轮机（排队中）');
    expect(hint).not.toHaveTextContent('已被建筑占用');
    // 进行中 → 建造中
    expect(hint).not.toHaveTextContent('建造中');
  });

  it('别人的施工任务同样按服务端口径提示', () => {
    render(
      <BuildPlacementHint
        planet={makePlanet()}
        playerId="p1"
        runtime={makeRuntime([{
          id: 'ct-2',
          player_id: 'p2',
          building_type: 'wind_turbine',
          position: { x: 5, y: 6, z: 0 },
          state: 'in_progress',
          enqueue_tick: 1,
        } as never])}
      />,
    );
    pointAt({ x: 5, y: 6 });

    expect(screen.getByRole('status')).toHaveTextContent('该格已有其他玩家的施工任务：风力涡轮机（建造中）');
  });

  it('已取消/已完成的施工任务不提示', () => {
    render(
      <BuildPlacementHint
        planet={makePlanet()}
        playerId="p1"
        runtime={makeRuntime([{
          id: 'ct-3',
          player_id: 'p1',
          building_type: 'wind_turbine',
          position: { x: 5, y: 6, z: 0 },
          state: 'cancelled',
          enqueue_tick: 1,
        } as never])}
      />,
    );
    pointAt({ x: 5, y: 6 });

    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('BuildPlacementHint 未探索区不本地拦截（试玩 1009 F）', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    usePlanetViewStore.getState().setInteractionMode({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });
  });

  it('地形未知的格子只给中性提示，不说「无法建造」', () => {
    const planet = makePlanet();
    planet.terrain![6][5] = 'unknown';
    render(<BuildPlacementHint planet={planet} playerId="p1" />);
    pointAt({ x: 5, y: 6 });

    const hint = screen.getByRole('status');
    expect(hint).toHaveTextContent('未探索区域');
    expect(hint).not.toHaveTextContent('无法建造');
  });
});

describe('BuildPlacementHint 采集建筑「将开采哪一种矿」（第 16 轮契约 §5.1）', () => {
  const catalog = {
    buildings: [
      { id: 'mining_machine', name: '采矿机', buildable: true, requires_resource_node: true, coverage_radius: 1, footprint: { width: 3, height: 3 }, build_cost: { items: [{ item_id: 'iron_ore', quantity: 2 }] } },
    ],
    items: [
      { id: 'iron_ore', name: '铁矿' },
      { id: 'copper_ore', name: '铜矿' },
    ],
  } as never;

  /** 3×3 矿机锚点 (5,6)：覆盖框 4..8 × 5..9。 */
  function planetWith(resources: Array<{ kind: string; x: number; y: number }>) {
    const planet = makePlanet();
    planet.resources = resources.map((resource, index) => ({
      id: `res-${index}`,
      planet_id: 'planet-1-1',
      kind: resource.kind,
      behavior: 'finite',
      position: { x: resource.x, y: resource.y, z: 0 },
      remaining: 100,
    })) as never;
    return planet;
  }

  beforeEach(() => {
    resetPlanetViewStore();
    usePlanetViewStore.getState().setInteractionMode({
      kind: 'build',
      buildingType: 'mining_machine',
      direction: 'auto',
    });
  });

  it('只有一种矿：绿字「将开采：铁矿」，不带警示', () => {
    render(
      <BuildPlacementHint
        catalog={catalog}
        planet={planetWith([{ kind: 'iron_ore', x: 6, y: 7 }, { kind: 'iron_ore', x: 7, y: 7 }])}
        playerId="p1"
      />,
    );
    pointAt({ x: 5, y: 6 });

    const hint = screen.getByTestId('build-mining-hint');
    expect(hint).toHaveTextContent('将开采：铁矿');
    expect(hint).not.toHaveTextContent('不会开采');
    expect(hint.className).not.toContain('mining-mixed');
  });

  it('覆盖内混了别的矿种：警示色 + 列出不会开采的矿种与格数', () => {
    render(
      <BuildPlacementHint
        catalog={catalog}
        planet={planetWith([
          { kind: 'iron_ore', x: 5, y: 6 },
          { kind: 'copper_ore', x: 6, y: 6 }, { kind: 'copper_ore', x: 7, y: 6 }, { kind: 'copper_ore', x: 8, y: 6 },
        ])}
        playerId="p1"
      />,
    );
    pointAt({ x: 5, y: 6 });

    const hint = screen.getByTestId('build-mining-hint');
    expect(hint).toHaveTextContent('将开采：铜矿（覆盖内还有：铁矿×1，不会开采）');
    expect(hint.className).toContain('build-placement-hint--mining-mixed');
  });

  it('覆盖框里没有矿（预检拦截）时不显示「将开采」，仍报本地原因', () => {
    render(<BuildPlacementHint catalog={catalog} planet={planetWith([])} playerId="p1" />);
    pointAt({ x: 5, y: 6 });

    expect(screen.queryByTestId('build-mining-hint')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('无法建造：需要建在资源点上');
  });

  it('缺料时两行都给：「无法建造：缺少…」与「将开采：铁矿」不互相顶掉（试玩 1016 摩擦 2）', () => {
    render(
      <BuildPlacementHint
        catalog={catalog}
        inventory={{}}
        planet={planetWith([{ kind: 'iron_ore', x: 6, y: 7 }])}
        playerId="p1"
      />,
    );
    pointAt({ x: 5, y: 6 });

    const hint = screen.getByRole('status');
    // 缺料仍是第一行（主原因）
    expect(hint).toHaveTextContent('无法建造：缺少');
    // 开采预览同时在场，玩家能先看落点会采什么矿再决定补料/换位
    const mining = screen.getByTestId('build-mining-hint');
    expect(mining).toHaveTextContent('将开采：铁矿');
    expect(hint).toContainElement(mining);
  });

  it('缺料 + 混矿：开采行带混矿警示（不会开采的矿种仍列出）', () => {
    render(
      <BuildPlacementHint
        catalog={catalog}
        inventory={{}}
        planet={planetWith([
          { kind: 'iron_ore', x: 5, y: 6 },
          { kind: 'copper_ore', x: 6, y: 6 }, { kind: 'copper_ore', x: 7, y: 6 },
        ])}
        playerId="p1"
      />,
    );
    pointAt({ x: 5, y: 6 });
    const mining = screen.getByTestId('build-mining-hint');
    expect(mining).toHaveTextContent('不会开采');
    expect(mining.className).toContain('build-placement-hint--mining-mixed');
  });
});
