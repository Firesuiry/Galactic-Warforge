import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';
import { jsonResponse } from '@/test/utils';
import { TopNav } from '@/widgets/TopNav';

function renderTopNav() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TopNav save', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('在线模式下允许保存并显示成功提示', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      if (url.pathname === '/save') {
        expect(init?.method).toBe('POST');
        return Promise.resolve(jsonResponse({
          ok: true,
          tick: 12,
          saved_at: '2026-04-02T12:00:00Z',
          path: '/tmp/game/save.json',
          trigger: 'manual',
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    await user.click(await screen.findByRole('button', { name: '保存' }));

    expect(await screen.findByText('已保存到 tick 12')).toBeInTheDocument();
  });

  it('在线模式下保存失败会显示错误', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: {
            p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true },
          },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          production_stats: { total_output: 0, by_building_type: {}, by_item: {}, efficiency: 0 },
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      if (url.pathname === '/save') {
        return Promise.resolve(jsonResponse({ error: 'disk full' }, { status: 500 }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    await user.click(await screen.findByRole('button', { name: '保存' }));

    expect(await screen.findByText('disk full')).toBeInTheDocument();
  });

  it('fixture 模式下禁用保存按钮', async () => {
    useSessionStore.getState().setSession({
      serverUrl: createFixtureServerUrl('baseline'),
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    renderTopNav();

    expect(await screen.findByRole('button', { name: '保存' })).toBeDisabled();
  });
});
