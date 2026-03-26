import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@shared/api';
import { DEFAULT_EVENT_TYPES } from '@shared/config';

import { jsonResponse } from '@/test/utils';

describe('shared api client', () => {
  it('在未显式传入 event_types 时为事件快照补默认类型', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/events/snapshot');
      expect(url.searchParams.get('event_types')).toBe(DEFAULT_EVENT_TYPES.join(','));
      expect(url.searchParams.get('limit')).toBe('8');

      return Promise.resolve(jsonResponse({
        event_types: DEFAULT_EVENT_TYPES,
        available_from_tick: 0,
        has_more: false,
        events: [],
      }));
    });

    const client = createApiClient({
      serverUrl: 'http://localhost:5173',
      fetchFn: fetchMock as typeof fetch,
      auth: {
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
    });

    await expect(client.fetchEventSnapshot({ limit: 8 })).resolves.toMatchObject({
      events: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('行星概要接口暴露轻量统计字段', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      planet_id: 'planet-1-1',
      discovered: true,
      map_width: 2000,
      map_height: 2000,
      tick: 128,
      building_count: 3,
      unit_count: 2,
      resource_count: 3,
    })));

    const client = createApiClient({
      serverUrl: 'http://localhost:5173',
      fetchFn: fetchMock as typeof fetch,
      auth: {
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
    });

    const summary = await client.fetchPlanet('planet-1-1');
    expect(summary.building_count).toBe(3);
    expect(summary.resource_count).toBe(3);
  });

  it('为行星场景请求序列化视窗与图层参数', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/world/planets/planet-1-1/scene');
      expect(url.searchParams.get('x')).toBe('16');
      expect(url.searchParams.get('y')).toBe('32');
      expect(url.searchParams.get('width')).toBe('64');
      expect(url.searchParams.get('height')).toBe('48');
      expect(url.searchParams.get('detail_level')).toBe('tile');
      expect(url.searchParams.get('layers')).toBe('terrain,buildings,units');

      return Promise.resolve(jsonResponse({
        planet_id: 'planet-1-1',
        discovered: true,
        detail_level: 'tile',
        map_width: 2000,
        map_height: 2000,
        tick: 128,
        bounds: { min_x: 16, min_y: 32, max_x: 79, max_y: 79 },
        terrain: [['buildable']],
        fog: { visible: [[true]], explored: [[true]] },
        buildings: {},
        units: {},
        resources: [],
      }));
    });

    const client = createApiClient({
      serverUrl: 'http://localhost:5173',
      fetchFn: fetchMock as typeof fetch,
      auth: {
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
    });

    const scene = await client.fetchPlanetScene('planet-1-1', {
      x: 16,
      y: 32,
      width: 64,
      height: 48,
      detailLevel: 'tile',
      layers: ['terrain', 'buildings', 'units'],
    });
    expect(scene.bounds.min_x).toBe(16);
    expect(scene.detail_level).toBe('tile');
  });

  it('为行星详情请求序列化实体定位参数', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/world/planets/planet-1-1/inspect');
      expect(url.searchParams.get('entity_kind')).toBe('building');
      expect(url.searchParams.get('entity_id')).toBe('assembler-1');

      return Promise.resolve(jsonResponse({
        planet_id: 'planet-1-1',
        discovered: true,
        entity_kind: 'building',
        entity_id: 'assembler-1',
        title: 'assembler',
        building: {
          id: 'assembler-1',
          type: 'assembler',
          owner_id: 'p1',
          position: { x: 4, y: 2, z: 0 },
          hp: 160,
          max_hp: 160,
          level: 2,
          vision_range: 7,
          runtime: {
            params: {
              energy_consume: 8,
              energy_generate: 0,
              capacity: 60,
              maintenance_cost: { minerals: 0, energy: 1 },
              footprint: { width: 2, height: 2 },
            },
            state: 'paused',
          },
        },
      }));
    });

    const client = createApiClient({
      serverUrl: 'http://localhost:5173',
      fetchFn: fetchMock as typeof fetch,
      auth: {
        playerId: 'p1',
        playerKey: 'key_player_1',
      },
    });

    const inspect = await client.fetchPlanetInspect('planet-1-1', {
      entityKind: 'building',
      entityId: 'assembler-1',
    });
    expect(inspect.entity_kind).toBe('building');
    expect(inspect.building?.id).toBe('assembler-1');
  });
});
