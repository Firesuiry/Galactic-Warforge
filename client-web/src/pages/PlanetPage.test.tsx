import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { renderApp, jsonResponse, sseResponse } from '@/test/utils';
import { useSessionStore } from '@/stores/session';

function createPlanetPayload() {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: 4,
    map_height: 4,
    tick: 120,
    terrain: [
      ['buildable', 'buildable', 'buildable', 'water'],
      ['buildable', 'buildable', 'buildable', 'water'],
      ['blocked', 'buildable', 'buildable', 'lava'],
      ['buildable', 'buildable', 'buildable', 'buildable'],
    ],
    environment: {
      wind_factor: 0.8,
      light_factor: 1.1,
    },
    buildings: {
      'miner-1': {
        id: 'miner-1',
        type: 'mining_machine',
        owner_id: 'p1',
        position: { x: 1, y: 1, z: 0 },
        hp: 100,
        max_hp: 100,
        level: 1,
        vision_range: 6,
        runtime: {
          params: {
            energy_consume: 1,
            energy_generate: 0,
            capacity: 0,
            maintenance_cost: { minerals: 0, energy: 0 },
            footprint: { width: 1, height: 1 },
          },
          state: 'running',
          state_reason: '',
        },
        storage: {
          inventory: {
            iron_ore: 12,
          },
        },
        production: {
          recipe_id: 'mining-iron',
          remaining_ticks: 4,
        },
      },
    },
    units: {
      'worker-1': {
        id: 'worker-1',
        type: 'worker',
        owner_id: 'p1',
        position: { x: 2, y: 1, z: 0 },
        hp: 24,
        max_hp: 24,
        attack: 3,
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
        is_rare: false,
      },
    ],
  };
}

function createFogPayload() {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    map_width: 4,
    map_height: 4,
    visible: [
      [true, true, true, false],
      [true, true, true, false],
      [false, true, true, false],
      [false, false, false, false],
    ],
    explored: [
      [true, true, true, false],
      [true, true, true, false],
      [true, true, true, false],
      [true, true, false, false],
    ],
  };
}

function createScenePayload() {
  const planet = createPlanetPayload();
  const fog = createFogPayload();
  return {
    planet_id: planet.planet_id,
    name: planet.name,
    discovered: planet.discovered,
    kind: planet.kind,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    terrain: planet.terrain,
    environment: planet.environment,
    visible: fog.visible,
    explored: fog.explored,
    buildings: planet.buildings,
    units: planet.units,
    resources: planet.resources,
    building_count: Object.keys(planet.buildings ?? {}).length,
    unit_count: Object.keys(planet.units ?? {}).length,
    resource_count: planet.resources?.length ?? 0,
  };
}

function createOverviewPayload() {
  return {
    planet_id: 'planet-1-1',
    name: 'Gaia',
    discovered: true,
    kind: 'terrestrial',
    map_width: 4,
    map_height: 4,
    tick: 120,
    step: 100,
    cells_width: 1,
    cells_height: 1,
    terrain: [['buildable']],
    visible: [[true]],
    explored: [[true]],
    resource_counts: [[1]],
    building_counts: [[1]],
    unit_counts: [[1]],
    building_count: 1,
    unit_count: 1,
    resource_count: 1,
  };
}

function createSummaryPayload() {
  return {
    tick: 120,
    active_planet_id: 'planet-1-1',
    map_width: 4,
    map_height: 4,
    players: {
      p1: {
        player_id: 'p1',
        is_alive: true,
        resources: { minerals: 240, energy: 140 },
        tech: {
          player_id: 'p1',
          current_research: {
            tech_id: 'tech-energy-1',
            state: 'running',
            progress: 40,
            total_cost: 100,
          },
        },
      },
    },
  };
}

function createStatsPayload() {
  return {
    player_id: 'p1',
    tick: 120,
    production_stats: { total_output: 24, by_building_type: {}, by_item: {}, efficiency: 0.95 },
    energy_stats: { generation: 120, consumption: 90, storage: 100, current_stored: 75, shortage_ticks: 0 },
    logistics_stats: { throughput: 8, avg_distance: 16, avg_travel_time: 10, deliveries: 12 },
    combat_stats: { units_lost: 1, enemies_killed: 5, threat_level: 3, highest_threat: 4 },
  };
}

function createRuntimePayload() {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    available: true,
    tick: 120,
    logistics_stations: [],
    logistics_drones: [],
    logistics_ships: [],
    construction_tasks: [],
    enemy_forces: [],
    detections: [],
    threat_level: 0,
  };
}

function createNetworksPayload() {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    available: true,
    tick: 120,
    power_networks: [],
    power_nodes: [],
    power_links: [],
    power_coverage: [],
    pipeline_nodes: [],
    pipeline_segments: [],
    pipeline_endpoints: [],
  };
}

function createCatalogPayload() {
  return {
    buildings: [
      {
        id: 'mining_machine',
        name: '采矿机',
        category: 'production',
        subcategory: 'mining',
        footprint: { width: 1, height: 1 },
        build_cost: { minerals: 12 },
        buildable: true,
        icon_key: 'mining_machine',
        color: '#d8a23a',
      },
    ],
    items: [
      {
        id: 'iron_ore',
        name: '铁矿',
        category: 'ore',
        form: 'solid',
        stack_limit: 100,
        unit_volume: 1,
        icon_key: 'iron_ore',
        color: '#8893a5',
      },
    ],
    recipes: [
      {
        id: 'mining-iron',
        name: '开采铁矿',
        inputs: [],
        outputs: [{ item_id: 'iron_ore', amount: 1 }],
        duration: 4,
        energy_cost: 1,
        building_types: ['mining_machine'],
        icon_key: 'mining-iron',
        color: '#d8a23a',
      },
    ],
    techs: [
      {
        id: 'tech-energy-1',
        name: '基础能源学',
        category: 'energy',
        type: 'upgrade',
        level: 1,
        icon_key: 'tech-energy-1',
        color: '#4c8bf5',
      },
    ],
  };
}

describe('PlanetPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('渲染地图、迷雾、事件和实体详情侧栏', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse(createSummaryPayload()));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse(createStatsPayload()));
      }
      if (url.includes('/world/planets/planet-1-1/scene')) {
        return Promise.resolve(jsonResponse(createScenePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/runtime')) {
        return Promise.resolve(jsonResponse(createRuntimePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/networks')) {
        return Promise.resolve(jsonResponse(createNetworksPayload()));
      }
      if (url.endsWith('/catalog')) {
        return Promise.resolve(jsonResponse(createCatalogPayload()));
      }
      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          event_types: ['building_state_changed'],
          available_from_tick: 1,
          next_event_id: 'evt-10',
          has_more: false,
          events: [
            {
              event_id: 'evt-10',
              tick: 119,
              event_type: 'building_state_changed',
              visibility_scope: 'p1',
              payload: {
                building_id: 'miner-1',
                building_type: 'mining_machine',
                prev_state: 'idle',
                next_state: 'running',
                reason: 'power_restored',
              },
            },
          ],
        }));
      }
      if (url.includes('/alerts/production/snapshot')) {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [
            {
              alert_id: 'alert-1',
              tick: 118,
              player_id: 'p1',
              building_id: 'miner-1',
              building_type: 'mining_machine',
              alert_type: 'input_shortage',
              severity: 'warning',
              message: '矿物输入不足',
              metrics: {
                throughput: 0,
                backlog: 2,
                idle_ratio: 0.5,
                efficiency: 0.3,
                input_shortage: true,
                output_blocked: false,
                power_state: 'normal',
              },
              details: {},
            },
          ],
        }));
      }
      if (url.includes('/events/stream')) {
        return Promise.resolve(sseResponse([
          {
            event: 'connected',
            data: {
              player_id: 'p1',
              event_types: ['building_state_changed'],
            },
          },
        ], init?.signal as AbortSignal));
      }

      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();

    renderApp(['/planet/planet-1-1']);

    expect(await screen.findByRole('heading', { name: 'Gaia' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '行星地图' })).toBeInTheDocument();
    expect(screen.getByText('事件时间线')).toBeInTheDocument();
    expect(screen.getByText('告警面板')).toBeInTheDocument();
    expect(screen.getByText('miner-1 idle -> running')).toBeInTheDocument();
    expect(screen.getByText('miner-1 · 矿物输入不足')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '定位' })[0]);

    expect(await screen.findByText('建筑详情')).toBeInTheDocument();
    expect(screen.getByText('mining_machine')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开调试' }));
    expect(screen.getByText('调试面板')).toBeInTheDocument();
  });

  it('接收 SSE 后会把新事件和新告警并入页面并触发快照重拉', async () => {
    let alertSnapshotCalls = 0;
    const liveAlert = {
      alert_id: 'alert-2',
      tick: 121,
      player_id: 'p1',
      building_id: 'miner-1',
      building_type: 'mining_machine',
      alert_type: 'output_blocked',
      severity: 'warning',
      message: '产线堵塞',
      metrics: {
        throughput: 0,
        backlog: 5,
        idle_ratio: 0.2,
        efficiency: 0,
        input_shortage: false,
        output_blocked: true,
        power_state: 'normal',
      },
      details: {},
    };

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse(createSummaryPayload()));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse(createStatsPayload()));
      }
      if (url.includes('/world/planets/planet-1-1/scene')) {
        return Promise.resolve(jsonResponse(createScenePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/runtime')) {
        return Promise.resolve(jsonResponse(createRuntimePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/networks')) {
        return Promise.resolve(jsonResponse(createNetworksPayload()));
      }
      if (url.endsWith('/catalog')) {
        return Promise.resolve(jsonResponse(createCatalogPayload()));
      }
      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          event_types: ['production_alert'],
          available_from_tick: 1,
          next_event_id: 'evt-121',
          has_more: false,
          events: [],
        }));
      }
      if (url.includes('/alerts/production/snapshot')) {
        alertSnapshotCalls += 1;
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: alertSnapshotCalls > 1 ? [liveAlert] : [],
        }));
      }
      if (url.includes('/events/stream')) {
        return Promise.resolve(sseResponse([
          {
            event: 'connected',
            data: {
              player_id: 'p1',
              event_types: ['production_alert'],
            },
          },
          {
            event: 'game',
            data: {
              event_id: 'evt-121',
              tick: 121,
              event_type: 'production_alert',
              visibility_scope: 'p1',
              payload: {
                alert: liveAlert,
              },
            },
          },
        ], init?.signal as AbortSignal));
      }

      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp(['/planet/planet-1-1']);

    expect(await screen.findByRole('heading', { name: 'Gaia' })).toBeInTheDocument();
    expect(await screen.findByText('[t121] production_alert')).toBeInTheDocument();
    expect(screen.getByText('miner-1 · 产线堵塞')).toBeInTheDocument();

    await waitFor(() => {
      expect(alertSnapshotCalls).toBeGreaterThan(1);
    });
  });

  it('命令操作面板可以发送扫描命令', async () => {
    const commandRequests: Array<{ commands?: Array<{ type?: string; target?: { planet_id?: string } }> }> = [];
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse(createSummaryPayload()));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse(createStatsPayload()));
      }
      if (url.includes('/world/planets/planet-1-1/scene')) {
        return Promise.resolve(jsonResponse(createScenePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/runtime')) {
        return Promise.resolve(jsonResponse(createRuntimePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/networks')) {
        return Promise.resolve(jsonResponse(createNetworksPayload()));
      }
      if (url.endsWith('/catalog')) {
        return Promise.resolve(jsonResponse(createCatalogPayload()));
      }
      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          event_types: ['building_state_changed'],
          available_from_tick: 1,
          next_event_id: 'evt-10',
          has_more: false,
          events: [],
        }));
      }
      if (url.includes('/alerts/production/snapshot')) {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [],
        }));
      }
      if (url.includes('/events/stream')) {
        return Promise.resolve(sseResponse([
          {
            event: 'connected',
            data: {
              player_id: 'p1',
              event_types: ['building_state_changed'],
            },
          },
        ], init?.signal as AbortSignal));
      }
      if (url.endsWith('/commands') && init?.method === 'POST') {
        commandRequests.push(JSON.parse(String(init.body)));
        return Promise.resolve(jsonResponse({
          request_id: 'req-scan-1',
          accepted: true,
          enqueue_tick: 120,
          results: [
            {
              command_index: 0,
              status: 'queued',
              code: 'OK',
              message: 'scan_planet accepted',
            },
          ],
        }));
      }

      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();

    renderApp(['/planet/planet-1-1']);

    expect(await screen.findByRole('heading', { name: 'Gaia' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '命令' }));

    await user.click(screen.getByRole('button', { name: '扫描当前行星' }));

    expect(await screen.findByText('scan_planet accepted')).toBeInTheDocument();
    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0]?.commands?.[0]?.type).toBe('scan_planet');
    expect(commandRequests[0]?.commands?.[0]?.target?.planet_id).toBe('planet-1-1');
  });

  it('切到全局缩放时会请求行星总览并显示总览状态', async () => {
    let overviewCalls = 0;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse(createSummaryPayload()));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse(createStatsPayload()));
      }
      if (url.includes('/world/planets/planet-1-1/scene')) {
        return Promise.resolve(jsonResponse(createScenePayload()));
      }
      if (url.includes('/world/planets/planet-1-1/overview')) {
        overviewCalls += 1;
        return Promise.resolve(jsonResponse(createOverviewPayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/runtime')) {
        return Promise.resolve(jsonResponse(createRuntimePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/networks')) {
        return Promise.resolve(jsonResponse(createNetworksPayload()));
      }
      if (url.endsWith('/catalog')) {
        return Promise.resolve(jsonResponse(createCatalogPayload()));
      }
      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          event_types: ['building_state_changed'],
          available_from_tick: 1,
          next_event_id: 'evt-10',
          has_more: false,
          events: [],
        }));
      }
      if (url.includes('/alerts/production/snapshot')) {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [],
        }));
      }
      if (url.includes('/events/stream')) {
        return Promise.resolve(sseResponse([
          {
            event: 'connected',
            data: {
              player_id: 'p1',
              event_types: ['building_state_changed'],
            },
          },
        ], init?.signal as AbortSignal));
      }

      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();

    renderApp(['/planet/planet-1-1']);

    expect(await screen.findByRole('heading', { name: 'Gaia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1px/100tile' }));

    expect(await screen.findByText('缩放 1px/100tile')).toBeInTheDocument();
    await waitFor(() => {
      expect(overviewCalls).toBeGreaterThan(0);
    });
  });

  it('调试面板可以导出当前视角 JSON', async () => {
    let exportedHref = '';
    let exportedDownload = '';
    const anchorClick = vi.fn(function captureAnchor(this: HTMLAnchorElement) {
      exportedHref = this.href;
      exportedDownload = this.download;
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: anchorClick,
    });

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse(createSummaryPayload()));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse(createStatsPayload()));
      }
      if (url.includes('/world/planets/planet-1-1/scene')) {
        return Promise.resolve(jsonResponse(createScenePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/runtime')) {
        return Promise.resolve(jsonResponse(createRuntimePayload()));
      }
      if (url.endsWith('/world/planets/planet-1-1/networks')) {
        return Promise.resolve(jsonResponse(createNetworksPayload()));
      }
      if (url.endsWith('/catalog')) {
        return Promise.resolve(jsonResponse(createCatalogPayload()));
      }
      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          event_types: ['building_state_changed'],
          available_from_tick: 1,
          next_event_id: 'evt-10',
          has_more: false,
          events: [],
        }));
      }
      if (url.includes('/alerts/production/snapshot')) {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [],
        }));
      }
      if (url.includes('/events/stream')) {
        return Promise.resolve(sseResponse([
          {
            event: 'connected',
            data: {
              player_id: 'p1',
              event_types: ['building_state_changed'],
            },
          },
        ], init?.signal as AbortSignal));
      }

      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();

    renderApp(['/planet/planet-1-1']);

    expect(await screen.findByRole('heading', { name: 'Gaia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开调试' }));
    expect(screen.getByRole('button', { name: '收起调试' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '导出视角 JSON' }));

    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    expect(exportedDownload).toBe('planet-1-1-viewport.json');
    expect(exportedHref).toContain('data:application/json');
    expect(decodeURIComponent(exportedHref)).toContain('"planet_id": "planet-1-1"');
    expect(decodeURIComponent(exportedHref)).toContain('"share_url":');
  });
});
