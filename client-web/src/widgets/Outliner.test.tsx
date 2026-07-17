import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';

import { useSessionStore } from '@/stores/session';
import { jsonResponse } from '@/test/utils';
import { Outliner } from '@/widgets/Outliner';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderOutliner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/galaxy']}>
        <Outliner />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Outliner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 42,
          active_planet_id: 'planet-1-1',
          players: { p1: { player_id: 'p1', is_alive: true } },
        }));
      }
      if (url.pathname === '/world/galaxy') {
        return Promise.resolve(jsonResponse({
          galaxy_id: 'galaxy-1',
          name: 'Milky Test',
          discovered: true,
          systems: [
            { system_id: 'sys-1', name: 'Alpha', discovered: true, position: { x: 1, y: 2 }, star: { type: 'G' } },
            { system_id: 'sys-2', name: 'Beta', discovered: false, position: { x: 3, y: 4 }, star: { type: 'M' } },
          ],
        }));
      }
      if (url.pathname === '/world/fleets') {
        return Promise.resolve(jsonResponse([
          {
            fleet_id: 'fleet-1',
            owner_id: 'p1',
            system_id: 'sys-1',
            formation: 'line',
            state: 'idle',
            weapons: {},
            sustainment: {},
            armor: {},
            structure: {},
            subsystems: {},
          },
        ]));
      }
      if (url.pathname === '/alerts/production/snapshot') {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [
            {
              alert_id: 'a-1',
              tick: 40,
              player_id: 'p1',
              building_id: 'b-1',
              building_type: 'mining_machine',
              alert_type: 'power_shortage',
              severity: 'warning',
              message: '电力不足',
              metrics: {},
              details: {},
            },
          ],
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));
  });

  it('展示焦点行星/恒星系/舰队/警报，并可跳转', async () => {
    const user = userEvent.setup();
    renderOutliner();

    // 焦点行星
    const planetBtn = await screen.findByRole('button', { name: /planet-1-1/ });
    await user.click(planetBtn);
    expect(screen.getByTestId('location')).toHaveTextContent('/planet/planet-1-1');

    // 只列出已发现恒星系
    expect(await screen.findByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/system/sys-1');

    // 舰队
    expect(await screen.findByRole('button', { name: /fleet-1/ })).toBeInTheDocument();

    // 警报
    expect(await screen.findByRole('button', { name: /电力/ })).toBeInTheDocument();
  });

  it('可折叠为手柄并恢复', async () => {
    const user = userEvent.setup();
    renderOutliner();

    await screen.findByRole('button', { name: /planet-1-1/ });
    await user.click(screen.getByRole('button', { name: '收起总览栏' }));
    expect(screen.queryByRole('button', { name: /planet-1-1/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开总览栏' }));
    expect(await screen.findByRole('button', { name: /planet-1-1/ })).toBeInTheDocument();
  });
});
