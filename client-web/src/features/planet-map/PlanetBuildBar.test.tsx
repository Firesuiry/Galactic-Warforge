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

  it('建设资金不足的卡片置灰并提示差额', () => {
    const poorSummary: StateSummary = {
      ...summary,
      players: {
        p1: {
          player_id: 'p1',
          is_alive: true,
          resources: { minerals: 20, energy: 100 },
          tech: {
            player_id: 'p1',
            completed_techs: ['tech-basic-power'],
          },
        },
      },
    };
    render(<PlanetBuildBar catalog={catalog} summary={poorSummary} planet={makePlanet()} />);

    // wind_turbine 矿 30 > 余额 20 → 置灰禁用 + title 提示差额
    const card = screen.getByRole('button', { name: /风力发电机/ });
    expect(card).toBeDisabled();
    expect(card.className).toContain('planet-build-card--unaffordable');
    expect(card).toHaveAttribute('title', expect.stringContaining('矿不足：需要 30 / 现有 20'));
  });

  it('余额充足时卡片可点击进入建造模式', async () => {
    const user = userEvent.setup();
    const richSummary: StateSummary = {
      ...summary,
      players: {
        p1: {
          player_id: 'p1',
          is_alive: true,
          resources: { minerals: 240, energy: 100 },
          tech: {
            player_id: 'p1',
            completed_techs: ['tech-basic-power'],
          },
        },
      },
    };
    render(<PlanetBuildBar catalog={catalog} summary={richSummary} planet={makePlanet()} />);

    const card = screen.getByRole('button', { name: /风力发电机/ });
    expect(card).toBeEnabled();
    await user.click(card);
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });
  });

  it('卡片名称不出现裸英文 ID：字典命中显示中文，未命中回退 catalog 英文名', () => {
    const englishCatalog: CatalogView = {
      buildings: [
        {
          // 与服务端一致：英文 name，字典命中 → 中文
          id: 'wind_turbine',
          name: 'Wind Turbine',
          category: 'power',
          footprint: { width: 1, height: 1 },
          build_cost: { minerals: 30, energy: 0 },
          buildable: true,
          unlock_tech: ['tech-basic-power'],
          icon_key: 'wind_turbine',
          color: '#39e6d0',
        } as never,
        {
          // 字典未覆盖的新建筑：回退英文名而不是 wind_turbine 式裸 ID
          id: 'future_building_x',
          name: 'Future Building X',
          category: 'power',
          footprint: { width: 1, height: 1 },
          build_cost: { minerals: 10, energy: 0 },
          buildable: true,
          unlock_tech: ['tech-basic-power'],
          icon_key: 'wind_turbine',
          color: '#39e6d0',
        } as never,
      ],
    };
    render(<PlanetBuildBar catalog={englishCatalog} summary={summary} planet={makePlanet()} />);

    expect(screen.getByRole('button', { name: /风力涡轮机/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Future Building X/ })).toBeInTheDocument();
    // 任何卡片名都不允许是 snake_case 裸 ID
    const names = screen
      .getAllByRole('button')
      .map((button) => button.querySelector('.planet-build-card__name')?.textContent ?? '')
      .filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/^[a-z0-9_]+$/);
    }
  });
});
