import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView } from '@shared/types';

import { resetStarmapViewStore } from '@/features/starmap/store';
import { usePlanetInteractions } from '@/features/planet-map/use-planet-interactions';
import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { usePlanetCommandStore } from '@/features/planet-commands/store';
import { useSessionStore } from '@/stores/session';
import { renderHook } from '@testing-library/react';

const { mockClient, submitMock } = vi.hoisted(() => ({
  mockClient: {
    cmdBuild: vi.fn(),
    cmdMove: vi.fn(),
    cmdAttack: vi.fn(),
    fetchEventSnapshot: vi.fn(),
  },
  // 透传执行 execute，使命令客户端调用可被断言
  submitMock: vi.fn((input: { execute: () => Promise<unknown> }) => input.execute()),
}));

vi.mock('@/hooks/use-api-client', () => ({
  useApiClient: () => mockClient,
}));

vi.mock('@/features/planet-commands/executor', () => ({
  submitPlanetCommand: (input: { execute: () => Promise<unknown> }) => submitMock(input),
}));

const catalog: CatalogView = {
  buildings: [
    {
      id: 'wind_turbine',
      name: '风机',
      category: 'power',
      footprint: { width: 1, height: 1 },
      build_cost: { minerals: 30, energy: 0 },
      buildable: true,
      icon_key: 'wind_turbine',
      color: '#39e6d0',
    } as never,
  ],
};

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    map_width: 8,
    map_height: 8,
    tick: 10,
    terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'buildable')),
    buildings: {},
    units: {
      'u-1': {
        id: 'u-1',
        type: 'executor',
        owner_id: 'p1',
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        attack: 5,
        defense: 2,
        attack_range: 1,
        move_range: 4,
        vision_range: 5,
        is_moving: false,
      } as never,
      'u-9': {
        id: 'u-9',
        type: 'soldier',
        owner_id: 'p2',
        position: { x: 3, y: 3, z: 0 },
        hp: 80,
        max_hp: 80,
        attack: 9,
        defense: 3,
        attack_range: 2,
        move_range: 3,
        vision_range: 4,
        is_moving: false,
      } as never,
    },
    resources: [],
  } as PlanetRenderView;
}

function setup() {
  resetPlanetViewStore();
  resetStarmapViewStore();
  useSessionStore.getState().setSession({
    serverUrl: 'http://localhost:5173',
    playerId: 'p1',
    playerKey: 'key_player_1',
  });
  usePlanetCommandStore.getState().resetForPlanet('planet-1-1');
  mockClient.cmdBuild.mockResolvedValue({ accepted: true, request_id: 'r-1' });
  mockClient.cmdMove.mockResolvedValue({ accepted: true, request_id: 'r-2' });
  mockClient.cmdAttack.mockResolvedValue({ accepted: true, request_id: 'r-3' });
  mockClient.fetchEventSnapshot.mockResolvedValue({ events: [] });

  const planet = makePlanet();
  const { result } = renderHook(() => usePlanetInteractions({
    catalog,
    planet,
    runtime: { planet_id: 'planet-1-1', enemy_forces: [] } as never,
  }));
  return { planet, handle: result.current };
}

describe('usePlanetInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('build 模式：可建位置直接下达建造命令', () => {
    const { handle } = setup();
    usePlanetViewStore.getState().setInteractionMode({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });

    handle({ x: 4, y: 4 });

    expect(mockClient.cmdBuild).toHaveBeenCalledWith(
      { x: 4, y: 4, z: 0 },
      'wind_turbine',
      { direction: 'auto' },
    );
    expect(submitMock).toHaveBeenCalled();
    // 建造模式保持，便于连续放置
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('build');
  });

  it('build 模式：被占用位置本地拦截并写 journal', () => {
    const { handle, planet } = setup();
    planet.buildings = {
      'b-1': {
        id: 'b-1',
        type: 'tesla_tower',
        owner_id: 'p1',
        position: { x: 4, y: 4, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 3,
        runtime: {},
      } as never,
    };
    usePlanetViewStore.getState().setInteractionMode({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });

    handle({ x: 4, y: 4 });

    expect(mockClient.cmdBuild).not.toHaveBeenCalled();
    const journal = usePlanetCommandStore.getState().journal;
    expect(journal[0]?.status).toBe('failed');
    expect(journal[0]?.authoritativeCode).toBe('LOCAL_PREFLIGHT');
    expect(journal[0]?.authoritativeMessage).toContain('建筑占用');
  });

  it('move 模式：点击目标下达移动命令并退出模式', () => {
    const { handle } = setup();
    usePlanetViewStore.getState().setInteractionMode({ kind: 'move', unitId: 'u-1' });

    handle({ x: 5, y: 5 });

    expect(mockClient.cmdMove).toHaveBeenCalledWith('u-1', { x: 5, y: 5, z: 0 });
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('attack 模式：点击敌方单位下达攻击命令并退出模式', () => {
    const { handle } = setup();
    usePlanetViewStore.getState().setInteractionMode({ kind: 'attack', unitId: 'u-1' });

    handle({ x: 3, y: 3 });

    expect(mockClient.cmdAttack).toHaveBeenCalledWith('u-1', 'u-9');
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('attack 模式：点击空地本地拦截', () => {
    const { handle } = setup();
    usePlanetViewStore.getState().setInteractionMode({ kind: 'attack', unitId: 'u-1' });

    handle({ x: 6, y: 6 });

    expect(mockClient.cmdAttack).not.toHaveBeenCalled();
    const journal = usePlanetCommandStore.getState().journal;
    expect(journal[0]?.authoritativeMessage).toContain('没有可攻击目标');
  });
});
