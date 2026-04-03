import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { useSessionStore } from '@/stores/session';
import { jsonResponse, renderApp } from '@/test/utils';

describe('AgentsPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('renders templates and lets the user open the agent workspace', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/templates')) {
        return Promise.resolve(jsonResponse([
          { id: 'tpl-http', name: 'HTTP Builder', providerKind: 'openai_compatible_http' },
        ]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-1-1',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 42,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    renderApp(['/agents']);

    expect(await screen.findByRole('heading', { name: '智能体工作台' })).toBeInTheDocument();
    expect(screen.getByText('HTTP Builder')).toBeInTheDocument();
  });

  it('shows the new navigation entry in TopNav', async () => {
    const user = userEvent.setup();

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/state/summary')) {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-1-1',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.endsWith('/state/stats')) {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 42,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      if (url.endsWith('/agent-api/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok' }));
      }
      if (url.endsWith('/agent-api/templates')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith('/agent-api/agents')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    }));

    renderApp(['/overview']);
    await user.click(await screen.findByRole('link', { name: '智能体' }));

    expect(await screen.findByRole('heading', { name: '智能体工作台' })).toBeInTheDocument();
  });
});
