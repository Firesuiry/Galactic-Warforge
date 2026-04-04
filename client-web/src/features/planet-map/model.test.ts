import type { PlanetView } from '@shared/types';

import {
  getBuildingDisplayName,
  mergeRecentEvents,
  resolveSelectionAtTile,
  summarizeEvent,
} from '@/features/planet-map/model';

function createPlanetFixture(): PlanetView {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: 4,
    map_height: 4,
    tick: 18,
    terrain: [
      ['buildable', 'buildable', 'buildable', 'water'],
      ['buildable', 'buildable', 'buildable', 'water'],
      ['blocked', 'buildable', 'buildable', 'lava'],
      ['buildable', 'buildable', 'buildable', 'buildable'],
    ],
    buildings: {
      'miner-1': {
        id: 'miner-1',
        type: 'mining_machine',
        owner_id: 'p1',
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 5,
        runtime: {
          params: {
            energy_consume: 1,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 2, height: 1 },
          },
          state: 'running',
        },
      },
    },
    units: {
      'worker-1': {
        id: 'worker-1',
        type: 'worker',
        owner_id: 'p1',
        position: { x: 0, y: 3, z: 0 },
        hp: 20,
        max_hp: 20,
        attack: 2,
        defense: 1,
        attack_range: 1,
        move_range: 2,
        vision_range: 4,
        is_moving: false,
      },
    },
    resources: [
      {
        id: 'iron-1',
        planet_id: 'planet-1-1',
        kind: 'iron_ore',
        behavior: 'finite',
        position: { x: 0, y: 0, z: 0 },
        remaining: 900,
        current_yield: 3,
      },
    ],
  };
}

describe('planet map model helpers', () => {
  it('按建筑、单位、资源优先级解析地块选中对象', () => {
    const planet = createPlanetFixture();

    expect(resolveSelectionAtTile(planet, 1, 1)).toMatchObject({
      kind: 'building',
      id: 'miner-1',
    });
    expect(resolveSelectionAtTile(planet, 2, 1)).toMatchObject({
      kind: 'building',
      id: 'miner-1',
    });
    expect(resolveSelectionAtTile(planet, 0, 3)).toMatchObject({
      kind: 'unit',
      id: 'worker-1',
    });
    expect(resolveSelectionAtTile(planet, 0, 0)).toMatchObject({
      kind: 'resource',
      id: 'iron-1',
    });
  });

  it('合并事件时按 tick 倒序去重', () => {
    const merged = mergeRecentEvents(
      [
        {
          event_id: 'evt-1',
          tick: 10,
          event_type: 'entity_created',
          visibility_scope: 'p1',
          payload: {},
        },
      ],
      [
        {
          event_id: 'evt-2',
          tick: 12,
          event_type: 'tick_completed',
          visibility_scope: 'all',
          payload: { tick: 12 },
        },
        {
          event_id: 'evt-1',
          tick: 10,
          event_type: 'entity_created',
          visibility_scope: 'p1',
          payload: { entity_id: 'miner-1' },
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0].event_id).toBe('evt-2');
    expect(summarizeEvent(merged[0])).toContain('tick 12');
  });

  it('已知类型和状态摘要走中文翻译，未知值回退原值', () => {
    expect(getBuildingDisplayName(undefined, 'planetary_logistics_station')).toBe(
      '行星物流站',
    );

    expect(
      summarizeEvent({
        event_id: 'evt-3',
        tick: 13,
        event_type: 'building_state_changed',
        visibility_scope: 'p1',
        payload: {
          building_id: 'miner-1',
          prev_state: 'idle',
          next_state: 'running',
        },
      }),
    ).toContain('空闲 -> 运行中');

    expect(getBuildingDisplayName(undefined, 'unknown_building')).toBe(
      'unknown_building',
    );
  });
});
