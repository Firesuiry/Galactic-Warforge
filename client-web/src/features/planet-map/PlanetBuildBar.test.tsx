import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/** 建造栏含「去科技树」路由按钮，渲染时需要一个 Router 上下文。 */
function renderBuildBar(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
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
    renderBuildBar(<PlanetBuildBar catalog={itemCatalog} summary={poorSummary} planet={makePlanet()} />);

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
    expect(notice).toHaveTextContent('齿轮 ×1（背包 0/1）');
    expect(notice).toHaveTextContent('铁块 ×6（背包 0/6）');
    // 底部建造模式状态行（「无法建造：缺少…」）不出现
    expect(screen.queryByTestId('planet-build-shortage')).not.toBeInTheDocument();

    // 「知道了」收起清单
    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByTestId('planet-build-card-shortage')).not.toBeInTheDocument();
  });

  it('缺料清单随背包补齐/进入建造模式自动收起，不再显示过期数字', async () => {
    const user = userEvent.setup();
    const itemCatalog = { ...catalog, buildings: catalog.buildings?.map((entry) => entry.id === 'wind_turbine'
      ? { ...entry, build_cost: { items: [{ item_id: 'gear', quantity: 1 }, { item_id: 'iron_ingot', quantity: 6 }] } }
      : entry) } as CatalogView;
    const poorSummary: StateSummary = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 100 }, inventory: { gear: 0, iron_ingot: 0 }, tech: { player_id: 'p1', completed_techs: ['tech-basic-power'] } } } };
    const { rerender } = renderBuildBar(<PlanetBuildBar catalog={itemCatalog} summary={poorSummary} planet={makePlanet()} />);

    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.getByTestId('planet-build-card-shortage')).toHaveTextContent('齿轮 ×1（背包 0/1）');

    // 背包补齐 → 清单自动消失（不能停在「还缺…」的旧数字上）
    const richSummary: StateSummary = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 100 }, inventory: { gear: 5, iron_ingot: 20 }, tech: { player_id: 'p1', completed_techs: ['tech-basic-power'] } } } };
    rerender(<MemoryRouter><PlanetBuildBar catalog={itemCatalog} summary={richSummary} planet={makePlanet()} /></MemoryRouter>);
    expect(screen.queryByTestId('planet-build-card-shortage')).not.toBeInTheDocument();

    // 再次缺料并点开 → 进入建造模式（点另一张买得起的卡）时也收起
    const gearlessSummary: StateSummary = { ...summary, players: { p1: { player_id: 'p1', is_alive: true, resources: { energy: 100 }, inventory: { gear: 0, iron_ingot: 20 }, tech: { player_id: 'p1', completed_techs: ['tech-basic-power'] } } } };
    rerender(<MemoryRouter><PlanetBuildBar catalog={itemCatalog} summary={gearlessSummary} planet={makePlanet()} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.getByTestId('planet-build-card-shortage')).toBeInTheDocument();
    await openCategory(user, '运输');
    await user.click(screen.getByRole('button', { name: /传送带/ }));
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('build');
    expect(screen.queryByTestId('planet-build-card-shortage')).not.toBeInTheDocument();
  });

  it('点击建筑卡片进入建造模式，再次点击退出', async () => {
    const user = userEvent.setup();
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

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

  it('未解锁建筑按分类常驻显示（灰化 + 需研究），排在已解锁建筑之后（试玩 1016 U6）', async () => {
    const user = userEvent.setup();
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    // 已解锁的风机在前
    expect(screen.getByRole('button', { name: /风力发电机/ })).toBeEnabled();

    // 研究分类：matrix_lab 未解锁但默认可见，卡上直接写「需研究：<科技名>」，灰化且可点
    await openCategory(user, '研究');
    const lockedCard = screen.getByRole('button', { name: /矩阵研究站/ });
    expect(lockedCard).toBeInTheDocument();
    expect(lockedCard).toHaveAttribute('data-locked', 'true');
    expect(lockedCard).toBeEnabled();
    expect(lockedCard.textContent).toContain('需研究：');
    // 目录里没有这条科技的显示名时回退到 id（getTechDisplayName 的口径），不能是空白。
    expect(lockedCard.textContent).toContain('tech-electromagnetism');
    // 点它不进建造模式，只在状态行给出解锁说明与去科技树入口
    await user.click(lockedCard);
    expect(usePlanetViewStore.getState().interactionMode.kind).not.toBe('build');
    const notice = screen.getByTestId('planet-build-locked');
    expect(notice).toHaveTextContent('矩阵研究站 尚未解锁：需研究 tech-electromagnetism');
    expect(screen.getByRole('button', { name: '去科技树' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByTestId('planet-build-locked')).not.toBeInTheDocument();
  });

  it('试玩 1017 K4-01：未解锁卡保留建筑图（只压暗）、小锁角标、科技名带完整 title', async () => {
    const user = userEvent.setup();
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);
    // 已解锁卡不受影响：没有锁角标、没有解锁条。
    const unlockedCard = screen.getByRole('button', { name: /风力发电机/ });
    expect(unlockedCard.querySelector('.planet-build-card__lock')).toBeNull();
    expect(unlockedCard.querySelector('.planet-build-card__unlock')).toBeNull();
    await openCategory(user, '研究');
    const lockedCard = screen.getByRole('button', { name: /矩阵研究站/ });
    // 建筑图仍在（不再被大锁覆盖）；锁是独立的装饰角标。
    expect(lockedCard.querySelector('.planet-build-card__icon')).not.toBeNull();
    expect(lockedCard.querySelector('.planet-build-card__lock')).not.toBeNull();
    // 科技名写在解锁条里，并把完整名称放进 title（两行截断时仍可悬停读全名）。
    const unlock = lockedCard.querySelector('.planet-build-card__unlock');
    expect(unlock).not.toBeNull();
    expect(unlock?.textContent).toBe('需研究：tech-electromagnetism');
    expect(unlock?.getAttribute('title')).toBe('需研究：tech-electromagnetism');
  });

  it('同一分类里已解锁建筑排在未解锁之前（试玩 1016 U6）', async () => {
    const user = userEvent.setup();
    // 研究分类里放一台已解锁的研究站 + 一台未解锁的矩阵研究站：已解锁的必须在前。
    const mixedCatalog = {
      ...catalog,
      buildings: catalog.buildings?.map((entry) => entry.id === 'matrix_lab'
        ? { ...entry, category: 'research' }
        : entry.id === 'wind_turbine'
          ? { ...entry, category: 'research' }
          : entry),
    } as CatalogView;
    renderBuildBar(<PlanetBuildBar catalog={mixedCatalog} summary={summary} planet={makePlanet()} />);
    await openCategory(user, '研究');
    const ids = screen.getAllByRole('button')
      .filter((button) => button.classList.contains('planet-build-card'))
      .map((button) => button.getAttribute('data-building-id'));
    expect(ids).toEqual(['wind_turbine', 'matrix_lab']);
    // 数字键角标只给已解锁卡（未解锁卡不参与数字键选卡）。
    expect(screen.getByRole('button', { name: /风力发电机/ }).textContent).toContain('1');
    expect(screen.getByRole('button', { name: /矩阵研究站/ }).querySelector('.planet-build-card__hotkey')).toBeNull();
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
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={poorSummary} planet={makePlanet()} />);

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
    renderBuildBar(<PlanetBuildBar catalog={itemCatalog} summary={stocked} planet={makePlanet()} />);
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
    renderBuildBar(<PlanetBuildBar catalog={itemCatalog} summary={stocked} planet={makePlanet()} />);

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
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={richSummary} planet={makePlanet()} />);

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
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

    // 普通建筑也支持 R 键旋转（试玩 1016 U3：统一显示方位，不再显示角度）
    await user.click(screen.getByRole('button', { name: /风力发电机/ }));
    expect(screen.getByTestId('planet-build-direction')).toHaveTextContent('朝向：北');
    await user.keyboard('r');
    expect(screen.getByTestId('planet-build-direction')).toHaveTextContent('朝向：东');
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
    expect(screen.getByTestId('planet-build-direction')).toHaveTextContent('方向：东');
    await user.click(screen.getByTestId('planet-build-direction'));
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ direction: 'north' });
    expect(screen.getByTestId('planet-build-direction')).toHaveTextContent('方向：北');
    await user.click(screen.getByTestId('planet-build-direction'));
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
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

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
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

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
    // 提示行给出朝向语义（虚线空心 = 取货端，实心 = 放货端，试玩 1016 U1），而不是传送带的「箭头 = 物流方向」。
    expect(screen.getByText(/虚线空心箭头 = 取货端/)).toBeInTheDocument();

    // 默认朝向（rotation=0 → 北）就写中文方位 + 取/放端，不显示角度（试玩 1016 U3）。
    expect(screen.getByTestId('planet-build-direction')).toHaveTextContent('朝向 北（从南取 → 往北放）');
    // 分拣器不是传送带：R 旋转走 rotation 档位（0 → 90 → 180 → 270 → 0）。
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 90 });
    // 试玩 1016 U3：分拣器与传送带同一中文方位口径（不再显角度），并标出从哪取、往哪放。
    expect(screen.getByTestId('planet-build-direction')).toHaveTextContent('朝向 东（从西取 → 往东放）');
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 180 });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 270 });
    await user.keyboard('r');
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ rotation: 0 });
  });

  it('生产建筑建造模式：配方下拉选择后写入 interactionMode.recipeId', async () => {
    const user = userEvent.setup();
    renderBuildBar(<PlanetBuildBar catalog={catalog} summary={summary} planet={makePlanet()} />);

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
    renderBuildBar(<PlanetBuildBar catalog={englishCatalog} summary={summary} planet={makePlanet()} />);

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
