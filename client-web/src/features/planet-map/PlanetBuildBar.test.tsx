import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView, StateSummary } from '@shared/types';

import { PlanetBuildBar } from '@/features/planet-map/PlanetBuildBar';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';

const catalog: CatalogView = {
  items: [
    { id: 'iron_ingot', name: '铁块' },
    { id: 'gear', name: '齿轮' },
    { id: 'circuit_board', name: '电路板' },
  ] as never,
  buildings: [
    {
      id: 'wind_turbine',
      name: '风力发电机',
      category: 'power',
      footprint: { width: 1, height: 1 },
      build_cost: { items: [{ item_id: 'iron_ingot', quantity: 6 }, { item_id: 'gear', quantity: 1 }] },
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
      build_cost: { items: [{ item_id: 'circuit_board', quantity: 4 }] },
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
      build_cost: { items: [{ item_id: 'iron_ingot', quantity: 2 }] },
      buildable: true,
      unlock_tech: ['tech-basic-power'],
      icon_key: 'conveyor_belt_mk1',
      color: '#8fa3c8',
    } as never,
    {
      id: 'sorter_mk1',
      name: '分拣器 Mk.I',
      category: 'transport',
      footprint: { width: 1, height: 1 },
      build_cost: { items: [{ item_id: 'iron_ingot', quantity: 1 }] },
      buildable: true,
      unlock_tech: ['tech-basic-power'],
      icon_key: 'sorter_mk1',
      color: '#8fa3c8',
    } as never,
    {
      id: 'assembling_machine_mk1',
      name: '组装机 Mk.I',
      category: 'production',
      footprint: { width: 2, height: 2 },
      build_cost: { items: [{ item_id: 'iron_ingot', quantity: 4 }] },
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
  surface: { topology: 'cube_sphere' as const, face_size: 24 / 3 }, map_width: 24,
  map_height: 16,
  players: {
    p1: {
      player_id: 'p1',
      is_alive: true,
      resources: { energy: 100 },
      inventory: { iron_ingot: 20, gear: 10, circuit_board: 10 },
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
    surface: { topology: 'cube_sphere' as const, face_size: 24 / 3 }, map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, (_, y) => Array.from({ length: 24 }, (_, x) => x < 8 && y < 8 ? 'buildable' : 'unknown')),
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

  /**
   * §3.2 DSP 式快捷栏：一次只显示一个分类页签下的图标格，
   * 跨分类的建筑要先点对应页签（或按数字键）才在 DOM 里出现。
   * 测试统一走这个 helper，避免把「页签」当成实现细节写进每条断言。
   */
  async function openCategory(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(screen.getByRole('tab', { name: new RegExp(`^\\d+\\s*${label}$`) }));
  }

  it('选中买不起的卡片时，建造栏立即给出缺料提示（试玩 1014 层 01 P2）', async () => {
    const user = userEvent.setup();
    const itemCatalog = { ...catalog, items: [{ id: 'gear', name: '齿轮' }, { id: 'iron_ingot', name: '铁块' }], buildings: catalog.buildings?.map((entry) => entry.id === 'wind_turbine'
      ? { ...entry, build_cost: { items: [{ item_id: 'gear', quantity: 1 }, { item_id: 'iron_ingot', quantity: 6 }] } }
      : entry) } as CatalogView;
    const poorSummary: StateSummary = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 100 }, inventory: { gear: 0, iron_ingot: 0 }, tech: { player_id: 'p1', completed_techs: ['tech-basic-power'] } } } };
    render(<PlanetBuildBar catalog={itemCatalog} summary={poorSummary} planet={makePlanet()} />);

    const card = screen.getByRole('button', { name: /风力发电机/ });
    // 买不起的卡片：仍然原生可点（缺料走 data-shortage），点了不进建造模式，只列出缺料清单
    // （试玩 1016 摩擦 1；用 aria-disabled 会让 Playwright 的 click 一直等 enabled）。
    expect(card).toBeEnabled();
    expect(card).toHaveAttribute('data-shortage', 'true');
    expect(screen.queryByTestId('planet-build-shortage')).not.toBeInTheDocument();

    await user.click(card);

    // 不进建造模式
    expect(usePlanetViewStore.getState().interactionMode.kind).not.toBe('build');
    // 缺料清单直接摊开：逐项写「还差多少 / 背包有需要」
    const notice = screen.getByTestId('planet-build-card-shortage');
    expect(notice).toHaveTextContent('建造 风力发电机 还缺');
    expect(notice).toHaveTextContent('齿轮 还差 1（背包 0/1）');
    expect(notice).toHaveTextContent('铁块 还差 6（背包 0/6）');
    // 底部建造模式状态行（「无法建造：缺少…」）不出现
    expect(screen.queryByTestId('planet-build-shortage')).not.toBeInTheDocument();

    // 「知道了」收起清单
    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByTestId('planet-build-card-shortage')).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: '显示未解锁' }));
    await openCategory(user, '研究');
    const lockedCard = screen.getByRole('button', { name: /矩阵研究站/ });
    expect(lockedCard).toBeDisabled();
  });

  it('背包缺料的卡片置灰并逐项显示「背包有/需要」（§4）', () => {
    const poorSummary: StateSummary = {
      ...summary,
      players: {
        p1: {
          player_id: 'p1',
          is_alive: true,
          resources: { energy: 100 },
          inventory: { iron_ingot: 4, gear: 0 },
          tech: {
            player_id: 'p1',
            completed_techs: ['tech-basic-power'],
          },
        },
      },
    };
    render(<PlanetBuildBar catalog={catalog} summary={poorSummary} planet={makePlanet()} />);

    // wind_turbine 要 铁块 6 / 齿轮 1，背包只有 4 / 0 → 整格置灰，逐项写出「背包有/需要」
    const card = screen.getByRole('button', { name: /风力发电机/ });
    expect(card).toBeEnabled();
    expect(card).toHaveAttribute('data-shortage', 'true');
    expect(card.className).toContain('planet-build-card--unaffordable');
    const cost = card.querySelector('.planet-build-card__cost');
    expect(cost?.textContent).toContain('4/6');
    expect(cost?.textContent).toContain('0/1');
    expect(cost?.querySelectorAll('.is-short').length).toBe(2);
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('铁块 4/6（不足）'));
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('齿轮 0/1（不足）'));
  });

  it('卡片与悬停详情显示物品造价（背包有/需要，不足标红并列缺什么）', () => {
    const itemCatalog = { ...catalog, buildings: catalog.buildings?.map((entry) => entry.id === 'wind_turbine'
      ? { ...entry, build_cost: { items: [{ item_id: 'iron_ingot', quantity: 6 }, { item_id: 'gear', quantity: 1 }] } }
      : entry) } as CatalogView;
    const stocked: StateSummary = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 100 }, inventory: { iron_ingot: 4, gear: 3 }, tech: { player_id: 'p1', completed_techs: ['tech-basic-power'] } } } };
    render(<PlanetBuildBar catalog={itemCatalog} summary={stocked} planet={makePlanet()} />);
    const card = screen.getByRole('button', { name: /风力发电机/ });
    expect(card.className).toContain('planet-build-card--unaffordable');
    // §3.2 复核：格子里只有图标 + 快捷键数字 + 造价条，物品造价同时走 aria-label 与悬停浮层。
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('铁块 4/6（不足）'));
    expect(card.querySelector('.planet-build-card__cost')?.textContent).toContain('4/6');
    fireEvent.mouseEnter(card);
    const detail = screen.getByTestId('planet-build-detail');
    expect(detail).toHaveTextContent('背包有 / 需要');
    expect(detail.querySelector('.is-short')?.textContent).toContain('4 / 6');
    // 悬停提示列出缺什么（§4）
    expect(detail.textContent).toContain('缺：铁块 2');
  });

  it('悬停浮层内联显示中文物品名与背包有/需要数量', () => {
    const itemCatalog = { ...catalog, items: [
      { id: 'custom_plate', name: '定制板材' },
      { id: 'gear', name: '齿轮' },
    ], buildings: catalog.buildings?.map((entry) => entry.id === 'wind_turbine'
      ? { ...entry, build_cost: { items: [{ item_id: 'custom_plate', quantity: 6 }, { item_id: 'gear', quantity: 1 }] } }
      : entry) } as CatalogView;
    const stocked: StateSummary = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 100 }, inventory: { custom_plate: 4, gear: 3 }, tech: { player_id: 'p1', completed_techs: ['tech-basic-power'] } } } };
    render(<PlanetBuildBar catalog={itemCatalog} summary={stocked} planet={makePlanet()} />);

    const card = screen.getByRole('button', { name: /风力发电机/ });
    // 卡片 aria-label 与悬停浮层都带中文物品名 + 背包有/需要（格内只留图标 + 造价条）
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('定制板材 4/6（不足）'));
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('齿轮 3/1'));
    fireEvent.mouseEnter(card);
    const detail = screen.getByTestId('planet-build-detail');
    expect(detail.textContent).toContain('定制板材');
    expect(detail.textContent).toContain('齿轮');
    const shortItem = detail.querySelector('.is-short');
    expect(shortItem?.textContent).toContain('定制板材');
    expect(shortItem?.textContent).toContain('4 / 6');
  });

  it('背包充足时卡片可点击进入建造模式', async () => {
    const user = userEvent.setup();
    const richSummary: StateSummary = {
      ...summary,
      players: {
        p1: {
          player_id: 'p1',
          is_alive: true,
          resources: { energy: 100 },
          inventory: { iron_ingot: 60, gear: 10 },
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
    expect(card.className).not.toContain('planet-build-card--unaffordable');
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

    // 普通建筑也支持 R 键旋转（试玩 1016 U3：统一显示方位，不再显示角度）
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.getByRole('button', { name: /^方位：/ })).toHaveTextContent('方位：北');
    await user.keyboard('r');
    expect(screen.getByRole('button', { name: /^方位：/ })).toHaveTextContent('方位：东');
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));

    await openCategory(user, '运输');
    await user.click(screen.getByRole('button', { name: /传送带 Mk.I/ }));
    // 试玩 1015 §6-4：单格放置默认用建造栏显示的方向（东），不再落成 auto。
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'conveyor_belt_mk1',
      direction: 'east',
    });

    // 按钮循环：east → north → south
    const directionButton = screen.getByRole('button', { name: /^方位：东/ });
    await user.click(directionButton);
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'north' });
    await user.click(screen.getByRole('button', { name: /^方位：北/ }));
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'south' });

    // R 键循环：south → west → auto（auto 是显式选项，排在最后）
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'west' });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'auto' });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'east' });
  });

  it('朝向复位：Shift+R 或「重置朝向」按钮一键回到默认（试玩 1016 U-1）', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    await openCategory(user, '运输');
    await user.click(screen.getByRole('button', { name: /传送带 Mk.I/ }));
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'east' });
    // 误点三次：东 → 北 → 南 → 西
    await user.keyboard('r');
    await user.keyboard('r');
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'west' });
    // Shift+R 直接回默认（朝东），不需要再循环 2 次
    await user.keyboard('{Shift>}r{/Shift}');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'east' });

    // 按钮同样可用
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'north' });
    await user.click(screen.getByTestId('planet-build-direction-reset'));
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'east' });

    // 分拣器：rotation 回到 0（正面北）
    await user.click(screen.getByRole('button', { name: /分拣器 Mk\.I/ }));
    await user.keyboard('r');
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 180 });
    await user.keyboard('{Shift>}r{/Shift}');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 0 });
  });

  it('分拣器建造模式：R 旋转写 rotation、提示行说明取货/放货端（第 16 轮契约 §4）', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    await openCategory(user, '运输');
    // 物流页里分拣器排在传送带后面。
    const cards = screen.getAllByRole('button').filter((button) => button.classList.contains('planet-build-card'));
    const ids = cards.map((card) => card.getAttribute('data-building-id'));
    expect(ids.indexOf('sorter_mk1')).toBe(ids.indexOf('conveyor_belt_mk1') + 1);

    await user.click(screen.getByRole('button', { name: /分拣器 Mk\.I/ }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({
      kind: 'build',
      buildingType: 'sorter_mk1',
      direction: 'auto',
    });
    // 提示行给出朝向语义（空心 = 取货端，实心 = 放货端，试玩 1016 U1），而不是传送带的「箭头 = 物流方向」。
    expect(screen.getByText(/空心箭头 = 取货端/)).toBeInTheDocument();

    // 分拣器不是传送带：R 旋转走 rotation 档位（0 → 90 → 180 → 270 → 0）。
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 90 });
    // 试玩 1016 U3：分拣器与传送带同一「方位」口径，并标出取/放端。
    expect(screen.getByRole('button', { name: /^方位：/ })).toHaveTextContent('方位：东（取货端 西 → 放货端 东）');
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 180 });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 270 });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 0 });
  });

  it('生产建筑建造模式：配方下拉选择后写入 interactionMode.recipeId', async () => {
    const user = userEvent.setup();
    render(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    // 无配方建筑不显示配方下拉
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.queryByRole('combobox', { name: '建造配方' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));

    await openCategory(user, '生产');
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
          build_cost: { items: [] },
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
          build_cost: { items: [] },
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
    // 格子里不再写名称，可读名走 aria-label：任何卡片名都不允许是 snake_case 裸 ID
    const names = screen
      .getAllByRole('button')
      .filter((button) => button.classList.contains('planet-build-card'))
      .map((button) => button.getAttribute('aria-label')?.split(' · ')[0] ?? '');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/^[a-z0-9_]+$/);
    }
  });
});
