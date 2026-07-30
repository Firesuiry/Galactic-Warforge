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
    {
      id: 'conveyor_belt_mk1',
      name: '传送带 Mk.I',
      category: 'transport',
      footprint: { width: 1, height: 1 },
      build_cost: { minerals: 2, energy: 0 },
      buildable: true,
      unlock_tech: ['tech-basic-power'],
      icon_key: 'conveyor_belt_mk1',
      color: '#8fa3c8',
    } as never,
    {
      id: 'assembling_machine_mk1',
      name: '组装机 Mk.I',
      category: 'production',
      footprint: { width: 2, height: 2 },
      build_cost: { minerals: 40, energy: 0 },
      buildable: true,
      unlock_tech: ['tech-basic-power'],
      icon_key: 'assembling_machine_mk1',
      color: '#f59f00',
    } as never,
  ],
  recipes: [
    {
      id: 'gear',
      name: '齿轮',
      building_types: ['assembling_machine_mk1'],
    } as never,
    {
      id: 'circuit',
      name: '电路板',
      building_types: ['assembling_machine_mk1'],
      tech_unlock: ['tech-electronics'],
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

  it('传送带建造模式：方向按钮与 R 键循环切换方向', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    // 非传送带建筑不显示方向控件
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.queryByRole('button', { name: /^方向：/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));

    await user.click(screen.getByRole('button', { name: /传送带 Mk.I/ }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'conveyor_belt_mk1',
      direction: 'auto',
    });

    // 按钮循环：auto → north → east
    const directionButton = screen.getByRole('button', { name: '方向：自动（R）' });
    await user.click(directionButton);
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'north' });
    await user.click(screen.getByRole('button', { name: '方向：北（R）' }));
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'east' });

    // R 键循环：east → south → west → auto
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'south' });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'west' });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'auto' });
  });

  it('生产建筑建造模式：配方下拉选择后写入 interactionMode.recipeId', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    // 无配方建筑不显示配方下拉
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.queryByRole('combobox', { name: '建造配方' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));

    await user.click(screen.getByRole('button', { name: /组装机 Mk.I/ }));
    const select = screen.getByRole('combobox', { name: '建造配方' });
    // tech-electronics 未完成 → circuit 被过滤，仅"无配方 + 齿轮"
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '无配方（默认）',
      '齿轮',
    ]);
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'assembling_machine_mk1',
      direction: 'auto',
    });

    await user.selectOptions(select, 'gear');
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'assembling_machine_mk1',
      direction: 'auto',
      recipeId: 'gear',
    });

    // 选回"无配方"清除 recipeId（matrix_lab 即研究站语义）
    await user.selectOptions(select, '');
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'assembling_machine_mk1',
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
