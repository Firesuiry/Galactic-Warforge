import { describe, expect, it } from 'vitest';

import { createFixtureFetch, createFixtureServerUrl, getFixtureScenario } from '@/fixtures';

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
      title: '制造台 Mk.I',
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

  it('为 system runtime 接口返回戴森运行态与 active planet 上下文', async () => {
    const serverUrl = createFixtureServerUrl('baseline');
    const fetchFn = createFixtureFetch(serverUrl);

    const response = await fetchFn(`${serverUrl}/world/systems/sys-1/runtime`, {
      headers: {
        Authorization: 'Bearer key_player_1',
      },
    });

    expect(response.ok).toBe(true);
    const payload = await response.json();
    expect(payload).toMatchObject({
      system_id: 'sys-1',
      dyson_sphere: {
        total_energy: 1500,
      },
      solar_sail_orbit: {
        total_energy: 900,
      },
      active_planet_context: {
        planet_id: 'planet-1-1',
        ray_receiver_count: 2,
      },
    });
  });
});


it('keeps full fixture terrain/fog and overview bins aligned to six complete cube faces', async () => {
  const fixture = getFixtureScenario('baseline');
  expect(fixture).toBeDefined();
  const planet = fixture!.planets['planet-1-1'];
  const fog = fixture!.fogByPlanet['planet-1-1'];
  for (const view of [fixture!.summary, planet, fog]) {
    expect(view.surface).toEqual({topology:'cube_sphere',face_size:8});
    expect(view.map_width).toBe(24);
    expect(view.map_height).toBe(16);
  }
  for (const matrix of [planet.terrain, fog.visible, fog.explored]) {
    expect(matrix).toHaveLength(16);
    expect(matrix!.every(row=>row.length===24)).toBe(true);
  }
  expect(planet.terrain![15][23]).toBe('unknown');
  expect(fog.explored![15][23]).toBe(false);
  const url=createFixtureServerUrl('baseline');
  const response=await createFixtureFetch(url)(`${url}/world/planets/planet-1-1/overview?step=3`);
  expect(await response.json()).toMatchObject({surface:planet.surface,step:2,cells_width:12,cells_height:8});
});
