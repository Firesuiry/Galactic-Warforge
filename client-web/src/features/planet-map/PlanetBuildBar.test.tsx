import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView, StateSummary } from '@shared/types';

import { PlanetBuildBar } from '@/features/planet-map/PlanetBuildBar';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';

const catalog: CatalogView = {
  buildings: [
    {
      id: 'wind_turbine',
      name: '风力发电机',
      category: 'power',
      footprint: { width: 1, height: 1 },
      build_cost: { minerals: 30, energy: 0 },
      buildable: true,
      unlock_tech: ['tech-basic-power'],
      icon_key: 'wind_turbine',
      color: '#39e6d0',
    } as never,
    {
      id: 'matrix_lab',
      name: '矩阵研究站',
      category: 'research',
      footprint: { width: 2, height: 2 },
      build_cost: { minerals: 60, energy: 0 },
      buildable: true,
      unlock_tech: ['tech-electromagnetism'],
      icon_key: 'matrix_lab',
      color: '#5fb0ff',
    } as never,
  ],
};

// 玩家已完成 wind_turbine 所需科技，matrix_lab 所需科技未完成
const summary: StateSummary = {
  tick: 10,
  active_planet_id: 'planet-1-1',
  map_width: 8,
  map_height: 8,
  players: {
    p1: {
      player_id: 'p1',
      is_alive: true,
      tech: {
        player_id: 'p1',
        completed_techs: ['tech-basic-power'],
      },
    },
  },
};

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    map_width: 8,
    map_height: 8,
    tick: 10,
    terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'buildable')),
    buildings: {},
    units: {},
    resources: [],
  } as PlanetRenderView;
}

describe('PlanetBuildBar', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('点击建筑卡片进入建造模式，再次点击退出', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    const card = screen.getByRole('button', { name: /风力发电机/ });
    await user.click(card);
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });

    await user.click(card);
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('未解锁建筑默认隐藏，可通过按钮展开', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    // matrix_lab 所需科技未完成，属 locked 组，默认隐藏；wind_turbine 已解锁默认可见
    expect(screen.getByRole('button', { name: /风力发电机/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /矩阵研究站/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '显示未解锁' }));
    const lockedCard = screen.getByRole('button', { name: /矩阵研究站/ });
    expect(lockedCard).toBeDisabled();
  });
});
