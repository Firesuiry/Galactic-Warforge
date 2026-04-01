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

  it('会为行星场景接口序列化视口参数', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/world/planets/planet-1-1/scene');
      expect(url.searchParams.get('x')).toBe('96');
      expect(url.searchParams.get('y')).toBe('64');
      expect(url.searchParams.get('width')).toBe('160');
      expect(url.searchParams.get('height')).toBe('128');

      return Promise.resolve(jsonResponse({
        planet_id: 'planet-1-1',
        discovered: true,
        map_width: 2000,
        map_height: 2000,
        tick: 128,
        bounds: { x: 96, y: 64, width: 160, height: 128 },
        terrain: [],
        visible: [],
        explored: [],
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

    await expect(client.fetchPlanetScene('planet-1-1', {
      x: 96,
      y: 64,
      width: 160,
      height: 128,
    })).resolves.toMatchObject({
      bounds: { x: 96, y: 64, width: 160, height: 128 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('会为行星总览接口序列化下采样参数', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/world/planets/planet-1-1/overview');
      expect(url.searchParams.get('step')).toBe('100');

      return Promise.resolve(jsonResponse({
        planet_id: 'planet-1-1',
        discovered: true,
        map_width: 2000,
        map_height: 2000,
        tick: 128,
        step: 100,
        cells_width: 20,
        cells_height: 20,
        terrain: [],
        visible: [],
        explored: [],
        resource_counts: [],
        building_counts: [],
        unit_counts: [],
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

    await expect(client.fetchPlanetOverview('planet-1-1', {
      step: 100,
    })).resolves.toMatchObject({
      step: 100,
      cells_width: 20,
      cells_height: 20,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
