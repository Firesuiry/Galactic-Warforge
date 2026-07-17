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
    map_width: 8,
    map_height: 8,
    tick: 10,
    terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'buildable')),
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
});
