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
    cmdUnitOrder: vi.fn(),
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
    {
      id: 'mining_machine',
      name: '采矿机',
      category: 'collect',
      footprint: { width: 1, height: 1 },
      build_cost: { minerals: 50, energy: 20 },
      buildable: true,
      requires_resource_node: true,
      icon_key: 'mining_machine',
      color: '#c9a06a',
    } as never,
  ],
};

function makeUnit(id: string, type: string, ownerId: string, x: number, y: number, mecha = false) {
  return {
    id,
    type,
    owner_id: ownerId,
    position: { x, y, z: 0 },
    hp: 100,
    max_hp: 100,
    attack: 5,
    defense: 2,
    attack_range: 1,
    move_range: 4,
    vision_range: 5,
    ...(mecha ? { mecha: { energy: 50, max_energy: 100 } } : {}),
  } as never;
}

function makePlanet(): PlanetRenderView {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 24 / 3 }, map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: Array.from({ length: 16 }, (_, y) => Array.from({ length: 24 }, (_, x) => x < 8 && y < 8 ? 'buildable' : 'unknown')),
    buildings: {},
    units: {
      'u-1': makeUnit('u-1', 'executor', 'p1', 1, 1, true),
      'u-2': makeUnit('u-2', 'soldier', 'p1', 2, 2),
      'u-3': makeUnit('u-3', 'soldier', 'p1', 4, 4),
      'u-9': makeUnit('u-9', 'soldier', 'p2', 3, 3),
      'df-1': makeUnit('df-1', 'dark_fog', 'dark_fog', 6, 6),
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
  mockClient.cmdUnitOrder.mockResolvedValue({ accepted: true, request_id: 'r-4' });
  mockClient.fetchEventSnapshot.mockResolvedValue({ events: [] });

  const planet = makePlanet();
  const { result } = renderHook(() => usePlanetInteractions({
    catalog,
    planet,
    runtime: { planet_id: 'planet-1-1', enemy_forces: [] } as never,
  }));
  return { planet, interactions: result.current };
}

describe('usePlanetInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('build 模式：可建位置直接下达建造命令', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setInteractionMode({
      kind: 'build',
      buildingType: 'wind_turbine',
      direction: 'auto',
    });

    interactions.interactTile({ x: 4, y: 4 });

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
    const { interactions, planet } = setup();
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

    interactions.interactTile({ x: 4, y: 4 });

    expect(mockClient.cmdBuild).not.toHaveBeenCalled();
    const journal = usePlanetCommandStore.getState().journal;
    expect(journal[0]?.status).toBe('failed');
    expect(journal[0]?.authoritativeCode).toBe('LOCAL_PREFLIGHT');
    expect(journal[0]?.authoritativeMessage).toContain('建筑占用');
  });

  it('move 模式：对多选集合下达批量移动并退出模式', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-1', 'u-2', 'u-3']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'move' });

    interactions.interactTile({ x: 5, y: 5 });

    // 批量：选择器为 id 数组（服务端走 target.entity_ids）
    expect(mockClient.cmdMove).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3'], { x: 5, y: 5, z: 0 });
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('move 模式：无选中己方单位时本地拦截', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setInteractionMode({ kind: 'move' });

    interactions.interactTile({ x: 5, y: 5 });

    expect(mockClient.cmdMove).not.toHaveBeenCalled();
    expect(usePlanetCommandStore.getState().journal[0]?.authoritativeMessage).toContain('没有选中');
  });

  it('attack 模式：点击敌方单位对多选集合下达批量攻击', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2', 'u-3']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'attack' });

    interactions.interactTile({ x: 3, y: 3 });

    expect(mockClient.cmdAttack).toHaveBeenCalledWith(['u-2', 'u-3'], 'u-9');
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('attack 模式：点击空地本地拦截', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'attack' });

    interactions.interactTile({ x: 7, y: 7 });

    expect(mockClient.cmdAttack).not.toHaveBeenCalled();
    expect(usePlanetCommandStore.getState().journal[0]?.authoritativeMessage).toContain('没有可攻击目标');
  });

  it('unit_order attack_move：过滤执行体后对士兵下达攻击移动', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-1', 'u-2', 'u-3']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'unit_order', order: 'attack_move' });

    interactions.interactTile({ x: 8, y: 8 });

    // u-1 是执行体（mecha），不受理 unit_order，选择器只剩士兵
    expect(mockClient.cmdUnitOrder).toHaveBeenCalledWith(['u-2', 'u-3'], 'attack_move', { position: { x: 8, y: 8, z: 0 } });
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('unit_order guard：点击目标实体下达守卫', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2', 'u-3']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'unit_order', order: 'guard' });

    interactions.interactTile({ x: 1, y: 1 });

    expect(mockClient.cmdUnitOrder).toHaveBeenCalledWith(['u-2', 'u-3'], 'guard', { targetEntityId: 'u-1' });
  });

  it('unit_order：只有执行体可选时本地拦截', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-1']);
    usePlanetViewStore.getState().setInteractionMode({ kind: 'unit_order', order: 'attack_move' });

    interactions.interactTile({ x: 8, y: 8 });

    expect(mockClient.cmdUnitOrder).not.toHaveBeenCalled();
    expect(usePlanetCommandStore.getState().journal[0]?.authoritativeMessage).toContain('执行体');
  });

  it('右键情境指令：点地下达批量移动', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2', 'u-3']);

    const handled = interactions.contextTile({ x: 7, y: 7 });

    expect(handled).toBe(true);
    expect(mockClient.cmdMove).toHaveBeenCalledWith(['u-2', 'u-3'], { x: 7, y: 7, z: 0 });
  });

  it('右键情境指令：点敌下达批量攻击（含黑雾单位）', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2', 'u-3']);

    const handled = interactions.contextTile({ x: 6, y: 6 });

    expect(handled).toBe(true);
    expect(mockClient.cmdAttack).toHaveBeenCalledWith(['u-2', 'u-3'], 'df-1');
  });

  it('右键情境指令：无选中时不动作', () => {
    const { interactions } = setup();

    const handled = interactions.contextTile({ x: 7, y: 7 });

    expect(handled).toBe(false);
    expect(mockClient.cmdMove).not.toHaveBeenCalled();
  });

  it('orderNow：S/H 立即指令对非执行体选择器下达 stop/hold', () => {
    const { interactions } = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-1', 'u-2']);

    interactions.orderNow('stop');
    expect(mockClient.cmdUnitOrder).toHaveBeenCalledWith(['u-2'], 'stop', {});

    interactions.orderNow('hold');
    expect(mockClient.cmdUnitOrder).toHaveBeenCalledWith(['u-2'], 'hold', {});
  });
});
