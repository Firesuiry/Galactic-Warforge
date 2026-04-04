import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { renderApp, jsonResponse } from '@/test/utils';
import { useSessionStore } from '@/stores/session';

describe('OverviewPage', () => {
  it('展示大战略总览，并将情报默认折叠', async () => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 88,
          active_planet_id: 'planet-1-1',
          map_width: 128,
          map_height: 128,
          players: {
            p1: {
              player_id: 'p1',
              is_alive: true,
              resources: { minerals: 240, energy: 140 },
              inventory: {
                iron_ore: 24,
                silicon_ore: 8,
                stone_ore: 3,
              },
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
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 88,
          production_stats: { total_output: 24, by_building_type: {}, by_item: {}, efficiency: 0.95 },
          energy_stats: { generation: 120, consumption: 90, storage: 100, current_stored: 75, shortage_ticks: 0 },
          logistics_stats: { throughput: 8, avg_distance: 16, avg_travel_time: 10, deliveries: 12 },
          combat_stats: { units_lost: 1, enemies_killed: 5, threat_level: 3, highest_threat: 4 },
        }));
      }
      if (url.includes('/events/snapshot')) {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          events: [
            {
              event_id: 'evt-1',
              tick: 87,
              event_type: 'entity_created',
              visibility_scope: 'p1',
              payload: { entity_id: 'miner-1', type: 'miner' },
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
              tick: 88,
              player_id: 'p1',
              building_id: 'assembler-1',
              building_type: 'assembler',
              alert_type: 'power_low',
              severity: 'warning',
              message: '电力不足',
              metrics: {
                throughput: 0,
                backlog: 0,
                idle_ratio: 1,
                efficiency: 0,
                input_shortage: false,
                output_blocked: false,
                power_state: 'low',
              },
              details: {},
            },
          ],
        }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    const user = userEvent.setup();

    renderApp(['/overview']);

    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();
    expect(screen.getAllByText('铁矿 24 · 石矿 3 · 硅矿 8').length).toBeGreaterThan(0);
    expect(screen.queryByText('矿物 240')).not.toBeInTheDocument();
    expect(screen.getAllByText('基础能源学').length).toBeGreaterThan(0);
    expect(screen.queryByText('[t87] 实体已创建')).not.toBeInTheDocument();
    expect(screen.queryByText('电力不足')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '情报' }));

    expect(await screen.findByText('[t87] 实体已创建')).toBeInTheDocument();
    expect(screen.getByText('电力不足')).toBeInTheDocument();
  });
});
