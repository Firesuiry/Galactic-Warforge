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

  it('会为行星概要接口请求轻量 summary 载荷', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/world/planets/planet-1-1');

      return Promise.resolve(jsonResponse({
        planet_id: 'planet-1-1',
        discovered: true,
        map_width: 2000,
        map_height: 2000,
        tick: 128,
        building_count: 3,
        unit_count: 2,
        resource_count: 5,
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

    await expect(client.fetchPlanet('planet-1-1')).resolves.toMatchObject({
      building_count: 3,
      unit_count: 2,
      resource_count: 5,
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

  it('会为行星检视接口序列化实体定位参数', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/world/planets/planet-1-1/inspect');
      expect(url.searchParams.get('entity_kind')).toBe('building');
      expect(url.searchParams.get('entity_id')).toBe('assembler-1');
      expect(url.searchParams.get('sector_id')).toBeNull();

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

    await expect(client.fetchPlanetInspect('planet-1-1', {
      entityKind: 'building',
      entityId: 'assembler-1',
    })).resolves.toMatchObject({
      entity_kind: 'building',
      entity_id: 'assembler-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('会向 /save 发送 POST 并解析保存响应', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));

      expect(url.pathname).toBe('/save');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ reason: 'manual' }));

      return Promise.resolve(jsonResponse({
        ok: true,
        tick: 88,
        saved_at: '2026-04-02T12:00:00Z',
        path: '/tmp/game/save.json',
        trigger: 'manual',
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

    await expect(client.sendSave({ reason: 'manual' })).resolves.toMatchObject({
      ok: true,
      tick: 88,
      trigger: 'manual',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
