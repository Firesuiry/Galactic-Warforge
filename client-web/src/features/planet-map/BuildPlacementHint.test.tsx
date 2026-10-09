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
