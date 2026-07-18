import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

function stubAlerts(alerts: unknown[] = []) {
  return (url: URL) => {
    if (url.pathname === '/alerts/production/snapshot') {
      return jsonResponse({
        available_from_tick: 1,
        has_more: false,
        alerts,
      });
    }
    return null;
  };
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
    const alertsStub = stubAlerts();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const alertResponse = alertsStub(url);
      if (alertResponse) {
        return Promise.resolve(alertResponse);
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: {
            p1: {
              player_id: 'p1',
              resources: { minerals: 1, energy: 1 },
              inventory: { iron_ore: 7, copper_ore: 2 },
              is_alive: true,
            },
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
    // 顶栏矿产位显示建设资金 resources.minerals，背包矿石库存降级为 title 提示
    const mineralChip = await screen.findByTitle('建设资金（矿石）· 背包库存：铁矿 7 · 铜矿 2');
    expect(mineralChip).toHaveTextContent('1');
    await user.click(await screen.findByRole('button', { name: '保存' }));

    // 保存成功提示收进设置弹层
    await user.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByText('已保存到 tick 12')).toBeInTheDocument();
  });

  it('在线模式下保存失败会显示错误', async () => {
    const user = userEvent.setup();
    const alertsStub = stubAlerts();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const alertResponse = alertsStub(url);
      if (alertResponse) {
        return Promise.resolve(alertResponse);
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: {
            p1: {
              player_id: 'p1',
              resources: { minerals: 1, energy: 1 },
              inventory: { silicon_ore: 5 },
              is_alive: true,
            },
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
    const mineralChip = await screen.findByTitle('建设资金（矿石）· 背包库存：硅矿 5');
    expect(mineralChip).toHaveTextContent('1');
    await user.click(await screen.findByRole('button', { name: '保存' }));

    await user.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByText('disk full')).toBeInTheDocument();
  });

  it('背包无矿石时矿产位仍显示 minerals 余额', async () => {
    const alertsStub = stubAlerts();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const alertResponse = alertsStub(url);
      if (alertResponse) {
        return Promise.resolve(alertResponse);
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: {
            p1: {
              player_id: 'p1',
              resources: { minerals: 240, energy: 140 },
              inventory: {},
              is_alive: true,
            },
          },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    const chip = await screen.findByTitle('建设资金（矿石）· 背包库存：暂无矿石库存');
    await waitFor(() => expect(chip).toHaveTextContent('240'));
  });

  it('研究站（空 matrix_lab）的吞吐类告警不计入顶栏告警数', async () => {
    const researchNoiseAlert = {
      alert_id: 'a-noise',
      tick: 12,
      player_id: 'p1',
      building_id: 'b-25',
      building_type: 'matrix_lab',
      alert_type: 'throughput_drop',
      severity: 'warning',
      message: 'building b-25 throughput drop detected',
      metrics: {},
      details: {},
    };
    const powerAlert = {
      ...researchNoiseAlert,
      alert_id: 'a-power',
      alert_type: 'power_shortage',
    };
    let alertFetched = false;
    const alertsStub = (url: URL) => {
      if (url.pathname === '/alerts/production/snapshot') {
        alertFetched = true;
        return jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [researchNoiseAlert],
        });
      }
      return null;
    };
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const alertResponse = alertsStub(url);
      if (alertResponse) {
        return Promise.resolve(alertResponse);
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: { p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true } },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    const { unmount } = renderTopNav();
    // 等告警快照请求返回后：噪音被过滤 → 不出现告警按钮
    await waitFor(() => expect(alertFetched).toBe(true));
    await screen.findByText('tick 12');
    expect(document.querySelector('.top-nav__alert-btn')).not.toBeInTheDocument();
    unmount();

    // 断电告警保留 → 显示计数 1
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/alerts/production/snapshot') {
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [powerAlert],
        }));
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: { p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true } },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));
    renderTopNav();
    expect(await screen.findByText('1', { selector: '.top-nav__alert-count' })).toBeInTheDocument();
  });

  it('fixture 模式下禁用保存按钮', async () => {    useSessionStore.getState().setSession({
      serverUrl: createFixtureServerUrl('baseline'),
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    renderTopNav();

    expect(await screen.findByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('设置弹层展示玩家与服务信息', async () => {
    const user = userEvent.setup();
    const alertsStub = stubAlerts();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const alertResponse = alertsStub(url);
      if (alertResponse) {
        return Promise.resolve(alertResponse);
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: { p1: { player_id: 'p1', resources: { minerals: 1, energy: 1 }, is_alive: true } },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    await user.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByText('玩家')).toBeInTheDocument();
    expect(screen.getByText('p1')).toBeInTheDocument();
    expect(screen.getByText(/localhost:5173/)).toBeInTheDocument();
  });
});
