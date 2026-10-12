import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView, Unit } from '@shared/types';

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
    cmdUnitOrder: vi.fn(),
    cmdHaulOrder: vi.fn(),
    cmdSquadOrder: vi.fn(),
    cmdTaskForceDeploy: vi.fn(),
    fetchEventSnapshot: vi.fn(),
  },
  submitMock: vi.fn((input: { execute: () => Promise<unknown> }) => input.execute()),
}));

vi.mock('@/hooks/use-api-client', () => ({ useApiClient: () => mockClient }));
vi.mock('@/features/planet-commands/executor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/planet-commands/executor')>()),
  submitPlanetCommand: (input: { execute: () => Promise<unknown> }) => submitMock(input),
}));

const catalog = { buildings: [] } as unknown as CatalogView;

function makeUnit(id: string, type: string, x: number, y: number): Unit {
  return {
    id, type, owner_id: 'p1', position: { x, y, z: 0 }, hp: 60, max_hp: 60,
    attack: 0, defense: 0, attack_range: 0, move_range: 0, vision_range: 4,
  } as Unit;
}

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, () => Array.from({ length: 24 }, () => 'buildable')),
    buildings: {
      'depot-1': {
        id: 'depot-1', type: 'depot_mk1', owner_id: 'p1', position: { x: 4, y: 4, z: 0 },
        hp: 100, max_hp: 100, level: 1, vision_range: 3,
        runtime: { params: { footprint: { width: 3, height: 3 } }, state: 'running' },
      },
      'smelter-1': {
        id: 'smelter-1', type: 'arc_smelter', owner_id: 'p1', position: { x: 10, y: 10, z: 0 },
        hp: 100, max_hp: 100, level: 1, vision_range: 3,
        runtime: { params: { footprint: { width: 3, height: 3 } }, state: 'running' },
      },
    },
    units: {
      'robot-1': makeUnit('robot-1', 'transport_robot', 5, 5),
      'robot-2': makeUnit('robot-2', 'transport_robot', 6, 5),
      'u-soldier': makeUnit('u-soldier', 'soldier', 7, 7),
    },
    resources: [],
  } as unknown as PlanetRenderView;
}

function setup() {
  resetPlanetViewStore();
  useSessionStore.getState().setSession({ serverUrl: 'http://localhost:5173', playerId: 'p1', playerKey: 'key_player_1' });
  usePlanetCommandStore.getState().resetForPlanet('planet-1-1');
  mockClient.cmdHaulOrder.mockResolvedValue({ accepted: true, request_id: 'r-haul' });
  mockClient.cmdUnitOrder.mockResolvedValue({ accepted: true, request_id: 'r-order' });
  mockClient.fetchEventSnapshot.mockResolvedValue({ events: [] });
  const planet = makePlanet();
  const { result } = renderHook(() => usePlanetInteractions({
    catalog,
    planet,
    runtime: { planet_id: 'planet-1-1', enemy_forces: [] } as never,
  }));
  return { planet, interactions: result.current };
}

describe('「设置运输」交互（§4 运输机器人）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('依次点起点建筑、终点建筑后发 unit_order haul（entity_ids=多选机器人）', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['robot-1', 'robot-2']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'haul' });

    // 第一点：起点（点建筑占地内任意一格都算命中）
    interactions.interactTile({ x: 5, y: 5 });
    expect(mockClient.cmdHaulOrder).not.toHaveBeenCalled();
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ kind: 'haul', fromBuildingId: 'depot-1' });

    // 第二点：终点 → 立即下达并退出模式
    interactions.interactTile({ x: 11, y: 11 });
    expect(mockClient.cmdHaulOrder).toHaveBeenCalledWith(
      ['robot-1', 'robot-2'],
      { fromBuildingId: 'depot-1', toBuildingId: 'smelter-1', itemId: undefined },
      'planet-1-1',
    );
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('点空地不推进（起点/终点必须是建筑）并写本地拦截', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['robot-1']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'haul' });

    interactions.interactTile({ x: 20, y: 2 });

    expect(mockClient.cmdHaulOrder).not.toHaveBeenCalled();
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('haul');
    expect(usePlanetCommandStore.getState().journal[0]?.authoritativeMessage).toContain('请点击建筑');
  });

  it('终点与起点相同时本地拦截，不覆盖已选起点', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['robot-1']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'haul', fromBuildingId: 'depot-1' });

    interactions.interactTile({ x: 4, y: 4 });

    expect(mockClient.cmdHaulOrder).not.toHaveBeenCalled();
    expect(usePlanetViewStore.getState().interactionMode).toMatchObject({ kind: 'haul', fromBuildingId: 'depot-1' });
    expect(usePlanetCommandStore.getState().journal[0]?.authoritativeMessage).toContain('终点不能与起点相同');
  });

  it('没有选中运输机器人时拦截（士兵不受理 haul）', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-soldier']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'haul', fromBuildingId: 'depot-1' });

    interactions.interactTile({ x: 11, y: 11 });

    expect(mockClient.cmdHaulOrder).not.toHaveBeenCalled();
    expect(usePlanetCommandStore.getState().journal[0]?.authoritativeMessage).toContain('没有选中的运输机器人');
  });
});
