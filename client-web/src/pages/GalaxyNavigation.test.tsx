import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { renderApp, jsonResponse, sseResponse } from '@/test/utils';
import { useSessionStore } from '@/stores/session';

function createRuntimePayload() {
  return {
    planet_id: 'planet-1-1',
    discovered: true,
    available: true,
    tick: 99,
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
    tick: 99,
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
    items: [],
    recipes: [],
    techs: [],
  };
}

describe('Galaxy navigation', () => {
  it('可从银河进入星系并继续进入已发现行星', async () => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/world/galaxy')) {
        return Promise.resolve(jsonResponse({
          galaxy_id: 'galaxy-1',
          name: 'Milky Test',
          discovered: true,
          systems: [
            {
              system_id: 'sys-1',
              name: 'Alpha',
              discovered: true,
              position: { x: 10, y: 12 },
            },
          ],
        }));
      }

      if (url.endsWith('/world/systems/sys-1')) {
        return Promise.resolve(jsonResponse({
          system_id: 'sys-1',
          name: 'Alpha',
          discovered: true,
          planets: [
            {
              planet_id: 'planet-1-1',
              name: 'Gaia',
              discovered: true,
              kind: 'terrestrial',
            },
          ],
        }));
      }

      if (url.endsWith('/world/planets/planet-1-1')) {
        return Promise.resolve(jsonResponse({
          planet_id: 'planet-1-1',
          name: 'Gaia',
          discovered: true,
          kind: 'terrestrial',
          tick: 99,
          map_width: 64,
          map_height: 64,
          building_count: 0,
          unit_count: 0,
          resource_count: 0,
        }));
      }

      if (url.includes('/world/planets/planet-1-1/scene')) {
        return Promise.resolve(jsonResponse({
          planet_id: 'planet-1-1',
          discovered: true,
          detail_level: 'tile',
          tick: 99,
          map_width: 64,
          map_height: 64,
          bounds: {
            min_x: 0,
            min_y: 0,
            max_x: 3,
            max_y: 3,
          },
          terrain: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 'buildable')),
          fog: {
            visible: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => true)),
            explored: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => true)),
          },
          buildings: {},
          units: {},
          resources: [],
        }));
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

      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 99,
          active_planet_id: 'planet-1-1',
          map_width: 64,
          map_height: 64,
          players: {
            p1: {
              player_id: 'p1',
              is_alive: true,
              resources: { minerals: 120, energy: 88 },
            },
          },
        }));
      }

      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 99,
          production_stats: { total_output: 12, by_building_type: {}, by_item: {}, efficiency: 0.9 },
          energy_stats: { generation: 50, consumption: 45, storage: 100, current_stored: 80, shortage_ticks: 0 },
          logistics_stats: { throughput: 3, avg_distance: 8, avg_travel_time: 5, deliveries: 7 },
          combat_stats: { units_lost: 0, enemies_killed: 2, threat_level: 1, highest_threat: 2 },
        }));
      }

      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
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
              event_types: ['entity_created'],
            },
          },
        ], init?.signal as AbortSignal));
      }

      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    const user = userEvent.setup();

    renderApp(['/galaxy']);

    expect(await screen.findByRole('heading', { name: 'Milky Test' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '进入星系' }));
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '进入行星' }));
    expect(await screen.findByRole('heading', { name: 'Gaia' }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '行星地图' })).toBeInTheDocument();
  });
});
