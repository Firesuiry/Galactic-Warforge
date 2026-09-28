import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { PlanetRenderView } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { usePlanetRtsHotkeys } from '@/features/planet-map/use-planet-rts-hotkeys';
import type { PlanetInteractions } from '@/features/planet-map/use-planet-interactions';
import { useSessionStore } from '@/stores/session';

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
    discovered: true,
    surface: { topology: 'cube_sphere' as const, face_size: 8 },
    map_width: 24,
    map_height: 16,
    tick: 10,
    terrain: [],
    buildings: {},
    units: {
      'u-1': makeUnit('u-1', 'executor', 'p1', 1, 1, true),
      'u-2': makeUnit('u-2', 'soldier', 'p1', 2, 2),
      'u-3': makeUnit('u-3', 'soldier', 'p1', 4, 4),
    },
    resources: [],
  } as PlanetRenderView;
}

function keydown(key: string, options: KeyboardEventInit = {}, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  (target ?? window).dispatchEvent(event);
  return event;
}

describe('usePlanetRtsHotkeys（C1 快捷键体系）', () => {
  const orderNow = vi.fn();

  function setup() {
    resetPlanetViewStore();
    orderNow.mockClear();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    const planet = makePlanet();
    const interactions: PlanetInteractions = {
      interactTile: vi.fn(),
      contextTile: vi.fn(() => false),
      orderNow,
    };
    renderHook(() => usePlanetRtsHotkeys({ planet, interactions }));
    return planet;
  }

  beforeEach(() => {
    resetPlanetViewStore();
  });

  it('A/P/G 进入对应 unit_order 模式（有可选单位时）', () => {
    setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2', 'u-3']);

    keydown('a');
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'unit_order', order: 'attack_move' });
    keydown('p');
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'unit_order', order: 'patrol' });
    keydown('g');
    expect(usePlanetViewStore.getState().interactionMode).toEqual({ kind: 'unit_order', order: 'guard' });
  });

  it('只选执行体时 A 不进入指令模式（执行体不受理 unit_order）', () => {
    setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-1']);

    keydown('a');
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
  });

  it('S/H 立即下达 stop/hold', () => {
    setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2']);

    keydown('s');
    expect(orderNow).toHaveBeenCalledWith('stop');
    keydown('h');
    expect(orderNow).toHaveBeenCalledWith('hold');
  });

  it('Ctrl+数字记录编队，数字键选取编队（过滤阵亡）', () => {
    const planet = setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2', 'u-3']);

    keydown('2', { ctrlKey: true });
    expect(usePlanetViewStore.getState().controlGroups[2]).toEqual(['u-2', 'u-3']);

    // 清空选择后按 2 选回编队
    usePlanetViewStore.getState().setSelectedUnits([]);
    keydown('2');
    expect(usePlanetViewStore.getState().selectedUnits).toEqual(['u-2', 'u-3']);
    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'unit', id: 'u-2' });

    // u-3 阵亡后选编队自动过滤
    delete planet.units!['u-3'];
    usePlanetViewStore.getState().setSelectedUnits([]);
    keydown('2');
    expect(usePlanetViewStore.getState().selectedUnits).toEqual(['u-2']);
  });

  it('输入框聚焦时快捷键不生效', () => {
    setup();
    usePlanetViewStore.getState().setSelectedUnits(['u-2']);
    const input = document.createElement('input');
    document.body.appendChild(input);

    keydown('a', {}, input);
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
    input.remove();
  });

  it('无选中单位时指令键不动作', () => {
    setup();
    keydown('a');
    keydown('s');
    expect(usePlanetViewStore.getState().interactionMode.kind).toBe('inspect');
    expect(orderNow).not.toHaveBeenCalled();
  });
});
