import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';
import { jsonResponse } from '@/test/utils';
import { TopNav } from '@/widgets/TopNav';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

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
      <MemoryRouter initialEntries={['/galaxy']}>
        <TopNav />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
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
              resources: { energy: 1 },
              is_alive: true,
              mechas: [{ unit_id: 'u-3', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
                inventory: { iron_ore: 7, copper_ore: 2 }, inventory_slots_used: 2, inventory_slots_total: 40,
                operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
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
          combat_stats: { units_killed: 0, units_lost: 0, buildings_destroyed: 0, buildings_lost: 0, threat_level: 0, highest_threat: 0 },
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
    // 第 16 轮契约：资金维度已删，能量位改标「电网结余」（只读展示），背包库存走 title 提示。
    const energyChip = await screen.findByTitle('电网结余（只读展示）· 背包库存：铁矿 7 · 铜矿 2');
    expect(energyChip).toHaveTextContent('1');
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
              resources: { energy: 1 },
              is_alive: true,
              mechas: [{ unit_id: 'u-3', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
                inventory: { silicon_ore: 5 }, inventory_slots_used: 1, inventory_slots_total: 40,
                operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
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
          combat_stats: { units_killed: 0, units_lost: 0, buildings_destroyed: 0, buildings_lost: 0, threat_level: 0, highest_threat: 0 },
        }));
      }
      if (url.pathname === '/save') {
        return Promise.resolve(jsonResponse({ error: 'disk full' }, { status: 500 }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    const energyChip = await screen.findByTitle('电网结余（只读展示）· 背包库存：硅矿 5');
    expect(energyChip).toHaveTextContent('1');
    await user.click(await screen.findByRole('button', { name: '保存' }));

    await user.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByText('disk full')).toBeInTheDocument();
  });

  it('背包无矿石时能量位仍显示电网结余', async () => {
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
              resources: { energy: 140 },
              is_alive: true,
              mechas: [{ unit_id: 'u-3', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
                inventory: {}, inventory_slots_used: 0, inventory_slots_total: 40,
                operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
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
    const chip = await screen.findByTitle('电网结余（只读展示）· 背包库存：暂无矿石库存');
    await waitFor(() => expect(chip).toHaveTextContent('140'));
  });

  it('背包面板显示格数占用与每项堆叠（U5：DSP 格数制）', async () => {
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
              resources: { energy: 1 },
              is_alive: true,
              mechas: [{ unit_id: 'u-3', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
                inventory: { iron_ore: 250, gear: 30 }, inventory_slots_used: 4, inventory_slots_total: 40,
                operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
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
      if (url.pathname === '/catalog') {
        return Promise.resolve(jsonResponse({
          items: [
            { id: 'iron_ore', name: '铁矿', category: 'ore', form: 'solid', stack_limit: 100, unit_volume: 1, icon_key: 'iron_ore', color: '#fff' },
            { id: 'gear', name: '齿轮', category: 'component', form: 'solid', stack_limit: 200, unit_volume: 1, icon_key: 'gear', color: '#fff' },
          ],
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    const button = await screen.findByRole('button', { name: '背包库存' });
    await waitFor(() => expect(button).toHaveAttribute('title', '背包库存 · 4/40 格 · 机甲 u-3（点击展开全部）'));
    await user.click(button);
    expect(await screen.findByText('背包库存 · 2 种 · 已用 4/40 格 · 机甲 u-3')).toBeInTheDocument();
    expect(await screen.findByText('3 格')).toBeInTheDocument();
    expect(await screen.findByText('1 格')).toBeInTheDocument();
  });

  it('研究站（空 matrix_lab）的吞吐类告警不计入顶栏缺电角标', async () => {
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
          players: { p1: { player_id: 'p1', resources: { energy: 1 }, is_alive: true } },
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
    // 等告警快照请求返回后：噪音被过滤 → 电力 chip 不进告警态
    await waitFor(() => expect(alertFetched).toBe(true));
    await screen.findByText('tick 12');
    expect(document.querySelector('.top-nav__chip-alert')).not.toBeInTheDocument();
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
          players: { p1: { player_id: 'p1', resources: { energy: 1 }, is_alive: true } },
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
    expect(await screen.findByText('1', { selector: '.top-nav__chip-alert-count' })).toBeInTheDocument();
  });

  it('电力 chip 显示缺电建筑数（按 building_id 去重）并进入告警态', async () => {
    const user = userEvent.setup();
    const powerAlert = (alertId: string, buildingId: string, alertType = 'power_shortage') => ({
      alert_id: alertId,
      tick: 12,
      player_id: 'p1',
      building_id: buildingId,
      building_type: 'mining_machine',
      alert_type: alertType,
      severity: 'warning',
      message: '电力不足',
      metrics: {},
      details: {},
    });
    const throughputAlert = powerAlert('a-throughput', 'b-9', 'output_blocked');
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/alerts/production/snapshot') {
        // 同一建筑两条断电告警（不同 alert_type）应只算 1 座；吞吐类不计入；
        // 首座缺电建筑 b-1 带坐标 → 点击深链应同时带 select 与 x/y
        return Promise.resolve(jsonResponse({
          available_from_tick: 1,
          has_more: false,
          alerts: [
            { ...powerAlert('a-1', 'b-1'), details: { position: { x: 12.6, y: 7.2 } } },
            powerAlert('a-2', 'b-1', 'power_low'),
            powerAlert('a-3', 'b-2'),
            throughputAlert,
          ],
        }));
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({
          tick: 12,
          active_planet_id: 'planet-1-1',
          players: { p1: { player_id: 'p1', resources: { energy: 1 }, is_alive: true } },
        }));
      }
      if (url.pathname === '/state/stats') {
        return Promise.resolve(jsonResponse({
          player_id: 'p1',
          tick: 12,
          // 电力盈余：缺电告警态必须来自告警计数而非 delta
          energy_stats: { generation: 10, consumption: 8, storage: 0, current_stored: 0, shortage_ticks: 0 },
        }));
      }
      throw new Error(`unexpected request ${url.pathname}`);
    }));

    renderTopNav();
    await waitFor(() => {
      const chip = document.querySelector('.top-nav__chip--button');
      expect(chip?.getAttribute('title')).toBe('2 座建筑缺电 · 点击定位');
    });
    const chip = document.querySelector('.top-nav__chip--button') as HTMLElement;
    expect(chip).toHaveTextContent('10/8');
    expect(chip).toHaveTextContent('2');
    expect(chip.className).toContain('top-nav__chip--danger');
    expect(chip.className).toContain('top-nav__chip--pulse');
    // 点击跳转到当前活跃行星页并定位首座缺电建筑（带坐标）
    await user.click(chip);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/planet/planet-1-1?select=building:b-1&x=13&y=7',
    );
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
          players: { p1: { player_id: 'p1', resources: { energy: 1 }, is_alive: true } },
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

describe('顶栏背包 chip（契约 §7.3）', () => {
  beforeEach(() => {
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  function stubSummary(players: unknown) {
    const alertsStub = stubAlerts();
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      const alertResponse = alertsStub(url);
      if (alertResponse) {
        return Promise.resolve(alertResponse);
      }
      if (url.pathname === '/state/summary') {
        return Promise.resolve(jsonResponse({ tick: 12, active_planet_id: 'planet-1-1', players }));
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
  }

  it('未绑定机甲：灰色 chip「未绑定机甲」+ 悬浮提示', async () => {
    stubSummary({
      p1: {
        player_id: 'p1',
        resources: { energy: 1 },
        is_alive: true,
        mechas: [{ unit_id: 'u-3', planet_id: 'planet-1-1', operator: 'builder-a', alive: true, respawn_at_tick: 0,
          inventory: { iron_ore: 9 }, inventory_slots_used: 1, inventory_slots_total: 40,
          operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
      },
    });
    renderTopNav();
    const chip = await screen.findByTitle('在行星上选中一台机甲 → 接管');
    expect(chip).toHaveTextContent('未绑定机甲');
    expect(chip.className).toContain('top-nav__chip--muted');
    expect(screen.queryByRole('button', { name: '背包库存' })).toBeNull();
  });

  it('已绑定：可见「背包 used/total 格 · 机甲ID」chip + 关键物品 chip，点击展开完整面板', async () => {
    stubSummary({
      p1: {
        player_id: 'p1',
        resources: { energy: 1 },
        is_alive: true,
        mechas: [{ unit_id: 'u-7', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
          inventory: { iron_ingot: 9 }, inventory_slots_used: 1, inventory_slots_total: 40,
          operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
      },
    });
    renderTopNav();
    const user = userEvent.setup();
    const button = await screen.findByTitle('背包库存 · 1/40 格 · 机甲 u-7（点击展开全部）');
    // 格数与机甲 ID 是可见文字 chip（契约 §7.3 第 1 条），排在关键物品 chip 之前。
    expect(button).toHaveTextContent('背包 1/40 格 · u-7');
    const summaryChip = button.querySelector('.top-nav__chip--inventory-summary');
    expect(summaryChip).not.toBeNull();
    expect(summaryChip).toHaveTextContent('背包 1/40 格 · u-7');
    // 关键物品 chip 保留。
    expect(button).toHaveTextContent('铁块9');
    // 点格数 chip 与点关键物品 chip 一样展开完整面板。
    await user.click(summaryChip as HTMLElement);
    expect(await screen.findByRole('dialog', { name: '完整库存' })).toHaveTextContent('背包库存 · 1 种 · 已用 1/40 格 · 机甲 u-7');
    await user.click(screen.getByRole('button', { name: '背包库存' }));
    expect(screen.queryByRole('dialog', { name: '完整库存' })).toBeNull();
  });

  it('已绑定但背包为空：仍显示格数 chip，并保留「背包空」', async () => {
    stubSummary({
      p1: {
        player_id: 'p1',
        resources: { energy: 1 },
        is_alive: true,
        mechas: [{ unit_id: 'u-8', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
          inventory: {}, inventory_slots_used: 0, inventory_slots_total: 40,
          operate_range: 18, concurrent_tasks: 2, construction_active: 0, construction_pending: 0 }],
      },
    });
    renderTopNav();
    const button = await screen.findByTitle('背包库存 · 0/40 格 · 机甲 u-8（点击展开全部）');
    expect(button).toHaveTextContent('背包 0/40 格 · u-8');
    expect(button).toHaveTextContent('背包空');
  });
});
