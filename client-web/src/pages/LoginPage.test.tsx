import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { renderApp, jsonResponse } from '@/test/utils';
import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';

function mockFetchForOverview() {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith('/health')) {
      return Promise.resolve(jsonResponse({ status: 'ok', tick: 42 }));
    }
    if (url.endsWith('/state/summary')) {
      return Promise.resolve(jsonResponse({
        tick: 42,
        active_planet_id: 'planet-1-1',
        map_width: 128,
        map_height: 128,
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
        tick: 42,
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

    return Promise.reject(new Error(`unexpected url ${url}`));
  }));
}

describe('LoginPage', () => {
  it('支持快捷填充并在验证成功后进入总览', async () => {
    mockFetchForOverview();
    const user = userEvent.setup();

    renderApp(['/login']);

    await user.click(screen.getByRole('button', { name: '使用 p2' }));
    expect(screen.getByDisplayValue('p2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('key_player_2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '连接并进入总览' }));

    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();

    await waitFor(() => {
      expect(useSessionStore.getState().playerId).toBe('p2');
      expect(useSessionStore.getState().playerKey).toBe('key_player_2');
    });
  });

  it('支持直接进入离线 fixtures 总览页', async () => {
    const user = userEvent.setup();

    renderApp(['/login']);

    await user.click(screen.getByRole('radio', { name: '离线样例' }));
    await user.click(screen.getByRole('button', { name: '打开离线场景' }));

    expect(await screen.findByRole('heading', { name: '全局总览' })).toBeInTheDocument();
    expect(screen.getByText('样例：基准观察场景')).toBeInTheDocument();

    await waitFor(() => {
      expect(useSessionStore.getState().serverUrl).toBe(createFixtureServerUrl('baseline'));
    });
  });

  it('在线模式明确提示填写 Web 入口地址，并把代理/CORS 失败转换成可理解错误', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Failed to fetch'))));
    const user = userEvent.setup();

    renderApp(['/login']);

    expect(screen.getByLabelText('Web 入口地址')).toBeInTheDocument();
    expect(screen.getByText(/游戏服务端地址已由当前 Web 入口代理处理/)).toBeInTheDocument();

    const webEntryInput = screen.getByLabelText('Web 入口地址');
    await user.clear(webEntryInput);
    await user.type(webEntryInput, 'http://127.0.0.1:18081');
    await user.click(screen.getByRole('button', { name: '连接并进入总览' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/请填写 Web 入口地址/);
    expect(screen.getByRole('alert')).toHaveTextContent(/不要直接填写游戏服务端端口/);
  });
});
