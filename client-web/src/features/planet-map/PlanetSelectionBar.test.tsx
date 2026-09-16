import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView } from '@shared/types';

import { PlanetSelectionBar } from '@/features/planet-map/PlanetSelectionBar';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    cmdMineResource: vi.fn().mockResolvedValue({ accepted: false, request_id: 'r-mine' }),
    cmdUpgrade: vi.fn().mockResolvedValue({ accepted: true, request_id: 'r-up' }),
    cmdDemolish: vi.fn().mockResolvedValue({ accepted: true, request_id: 'r-de' }),
    fetchEventSnapshot: vi.fn().mockResolvedValue({ events: [] }),
  },
}));

vi.mock('@/hooks/use-api-client', () => ({
  useApiClient: () => mockClient,
}));

const catalog: CatalogView = {
  buildings: [
    {
      id: 'tesla_tower',
      name: '特斯拉塔',
      category: 'power',
      footprint: { width: 1, height: 1 },
      build_cost: { minerals: 20, energy: 0 },
      buildable: true,
      icon_key: 'tesla_tower',
      color: '#39e6d0',
    } as never,
  ],
};

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 24 / 3 }, map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, (_, y) => Array.from({ length: 24 }, (_, x) => x < 8 && y < 8 ? 'buildable' : 'unknown')),
    buildings: {
      'b-1': {
        id: 'b-1',
        type: 'tesla_tower',
        owner_id: 'p1',
        position: { x: 2, y: 2, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 3,
        runtime: { state: 'running' },
      } as never,
    },
    units: {
      'u-1': {
        id: 'u-1',
        type: 'executor',
        owner_id: 'p1',
        position: { x: 1, y: 1, z: 0 },
        hp: 120,
        max_hp: 120,
        attack: 5,
        defense: 2,
        attack_range: 1,
        move_range: 4,
        vision_range: 5,
        is_moving: false,
      } as never,
    },
    resources: [],
  } as PlanetRenderView;
}

describe('PlanetSelectionBar', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    vi.clearAllMocks();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('选中建筑：显示升级/拆除并提交命令', async () => {
    const user = userEvent.setup();
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-1',
      position: { x: 2, y: 2, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);

    expect(screen.getByTestId('planet-selection-bar')).toHaveTextContent('特斯拉塔');

    await user.click(screen.getByRole('button', { name: '升级' }));
    expect(mockClient.cmdUpgrade).toHaveBeenCalledWith('b-1');

    await user.click(screen.getByRole('button', { name: '拆除' }));
    expect(mockClient.cmdDemolish).toHaveBeenCalledWith('b-1');
    // 拆除后清空选中
    expect(usePlanetViewStore.getState().selected).toBeNull();
  });

  it('选中单位：移动/攻击按钮切换交互模式', async () => {
    const user = userEvent.setup();
    usePlanetViewStore.getState().setSelected({
      kind: 'unit',
      id: 'u-1',
      position: { x: 1, y: 1, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);

    await user.click(screen.getByRole('button', { name: '移动' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'move', unitId: 'u-1' });

    await user.click(screen.getByRole('button', { name: '取消移动' }));
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');

    await user.click(screen.getByRole('button', { name: '攻击' }));
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'attack', unitId: 'u-1' });
  });

  it('未选中时不渲染', () => {
    const { container } = render(<PlanetSelectionBar catalog={catalog} planet={makePlanet()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('选中带本地存储的建筑：显示库存摘要与容量', () => {
    const planet = makePlanet();
    planet.buildings = {
      'b-mine': {
        id: 'b-mine',
        type: 'mining_machine',
        owner_id: 'p1',
        position: { x: 3, y: 3, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 3,
        runtime: {
          state: 'running',
          functions: { storage: { capacity: 20 } },
        },
        storage: { inventory: { silicon_ore: 12 } },
      } as never,
    };
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-mine',
      position: { x: 3, y: 3, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} planet={planet} />);

    const bar = screen.getByTestId('planet-selection-bar');
    expect(bar).toHaveTextContent('采矿机');
    expect(bar).toHaveTextContent('库存 硅矿 12 · 容量 12/20');
  });

  it('己方建筑提供"详情"入口并回调 onShowDetail', async () => {
    const user = userEvent.setup();
    const onShowDetail = vi.fn();
    usePlanetViewStore.getState().setSelected({
      kind: 'building',
      id: 'b-1',
      position: { x: 2, y: 2, z: 0 },
    });
    render(<PlanetSelectionBar catalog={catalog} onShowDetail={onShowDetail} planet={makePlanet()} />);

    await user.click(screen.getByRole('button', { name: '详情' }));
    expect(onShowDetail).toHaveBeenCalledTimes(1);
  });
});

function miningPlanet(): PlanetRenderView {
  const planet = makePlanet();
  planet.units!['u-1'].mecha = { energy: 50, max_energy: 100, fuel_energy: 0, shield: 0, max_shield: 0, attack_energy_cost: 8, move_energy_cost: 1, shield_recharge_delay: 10, last_hit_tick: 0 };
  planet.resources = [{ id: 'ore-1', planet_id: 'planet-1-1', kind: 'iron_ore', behavior: 'finite', position: { x: 2, y: 1, z: 0 }, remaining: 20 }];
  useSessionStore.getState().setSession({ serverUrl: 'http://localhost:5173', playerId: 'p1', playerKey: 'key_player_1' });
  usePlanetViewStore.getState().setSelected({ kind: 'resource', id: 'ore-1', position: { x: 2, y: 1, z: 0 } });
  return planet;
}
const miningCatalog = { items: [{ id: 'iron_ore', name: '铁矿', form: 'solid' }, { id: 'crude_oil', name: '原油', form: 'liquid' }] } as CatalogView;

it('collects selected solid resource using own nearby mecha and chosen quantity', async () => {
  vi.clearAllMocks();
  const user = userEvent.setup();
  render(<PlanetSelectionBar catalog={miningCatalog} planet={miningPlanet()} />);
  const quantity = screen.getByLabelText('采集数量');
  await user.clear(quantity);
  await user.type(quantity, '3');
  await user.click(screen.getByRole('button', { name: '手动采集' }));
  expect(mockClient.cmdMineResource).toHaveBeenCalledWith('u-1', 'ore-1', 3);
});

it('blocks distant or busy mecha and offers no mining control for another player or fluids', () => {
  const planet = miningPlanet();
  planet.units!['u-1'].position = { x: 6, y: 6, z: 0 };
  const { rerender } = render(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeDisabled();
  expect(screen.getByText('请将机甲移动到矿点 2 格内')).toBeInTheDocument();
  planet.units!['u-1'].position = { x: 1, y: 1, z: 0 };
  planet.units!['u-1'].mecha!.job = { kind: 'mine', resource_id: 'ore-1', remaining_ticks: 5, ticks_per_batch: 10, remaining_batches: 1, completed_batches: 0, energy_per_tick: 1, state: 'running' };
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeDisabled();
  planet.units!['u-1'].owner_id = 'p2';
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.queryByRole('button', { name: '手动采集' })).toBeNull();
  planet.units!['u-1'].owner_id = 'p1';
  planet.resources![0].kind = 'crude_oil';
  rerender(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.queryByRole('button', { name: '手动采集' })).toBeNull();
});

it('uses cube-sphere adjacency to allow mining across a face seam', () => {
  const planet = miningPlanet();
  planet.units!['u-1'].position = { x: 2, y: 0, z: 0 };
  planet.resources![0].position = { x: 10, y: 15, z: 0 };
  render(<PlanetSelectionBar catalog={miningCatalog} planet={planet} />);
  expect(screen.getByRole('button', { name: '手动采集' })).toBeEnabled();
});
