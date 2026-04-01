import { describe, expect, it } from 'vitest';

import { createFixtureFetch, createFixtureServerUrl } from '@/fixtures';

describe('fixture fetch', () => {
  it('为行星概要接口返回轻量 summary 载荷', async () => {
    const serverUrl = createFixtureServerUrl('baseline');
    const fetchFn = createFixtureFetch(serverUrl);

    const response = await fetchFn(`${serverUrl}/world/planets/planet-1-1`, {
      headers: {
        Authorization: 'Bearer key_player_1',
      },
    });

    expect(response.ok).toBe(true);
    const payload = await response.json();
    expect(payload).toMatchObject({
      planet_id: 'planet-1-1',
      building_count: 3,
      unit_count: 2,
      resource_count: 3,
    });
    expect(payload.terrain).toBeUndefined();
    expect(payload.buildings).toBeUndefined();
  });

  it('为行星场景接口按视窗裁剪地图内容', async () => {
    const serverUrl = createFixtureServerUrl('baseline');
    const fetchFn = createFixtureFetch(serverUrl);

    const response = await fetchFn(`${serverUrl}/world/planets/planet-1-1/scene?x=1&y=1&width=3&height=2`, {
      headers: {
        Authorization: 'Bearer key_player_1',
      },
    });

    expect(response.ok).toBe(true);
    const payload = await response.json();
    expect(payload.bounds).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 2,
    });
    expect(payload.terrain).toEqual([
      ['buildable', 'buildable', 'buildable'],
      ['buildable', 'buildable', 'buildable'],
    ]);
    expect(Object.keys(payload.buildings)).toContain('miner-1');
    expect(Object.keys(payload.buildings)).not.toContain('assembler-1');
  });

  it('为行星详情接口返回结构化实体详情', async () => {
    const serverUrl = createFixtureServerUrl('baseline');
    const fetchFn = createFixtureFetch(serverUrl);

    const response = await fetchFn(`${serverUrl}/world/planets/planet-1-1/inspect?entity_kind=building&entity_id=assembler-1`, {
      headers: {
        Authorization: 'Bearer key_player_1',
      },
    });

    expect(response.ok).toBe(true);
    const payload = await response.json();
    expect(payload).toMatchObject({
      planet_id: 'planet-1-1',
      entity_kind: 'building',
      entity_id: 'assembler-1',
      title: 'assembler',
    });
    expect(payload.building?.id).toBe('assembler-1');
  });

  it('不再提供整张 fog 全量接口', async () => {
    const serverUrl = createFixtureServerUrl('baseline');
    const fetchFn = createFixtureFetch(serverUrl);

    const response = await fetchFn(`${serverUrl}/world/planets/planet-1-1/fog`, {
      headers: {
        Authorization: 'Bearer key_player_1',
      },
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: 'not found',
    });
  });
});
