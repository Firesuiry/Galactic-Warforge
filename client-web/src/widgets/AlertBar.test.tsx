/**
 * 警报条（§3.3）单测：
 * - 收起态只显示最新一条（图标 · 类型 · 建筑 · tick）+ 总数徽标；
 * - 展开态是下拉列表，按「建筑 + 类型」合并计数，最多 8 条；
 * - 点某条聚焦到对应建筑（行星页内直接 setSelected）；
 * - 无警报时整条不渲染。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogView } from '@shared/types';

import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionStore } from '@/stores/session';
import { jsonResponse } from '@/test/utils';
import { AlertBar, mergeAlertRows } from '@/widgets/AlertBar';

function alertEntry(overrides: Record<string, unknown> = {}) {
  return {
    alert_id: 'a-1',
    tick: 100,
    player_id: 'p1',
    building_id: 'b-1',
    building_type: 'mining_machine',
    alert_type: 'power_shortage',
    severity: 'warning',
    message: 'building b-1 power shortage',
    metrics: {},
    details: {},
    ...overrides,
  };
}

const catalog: CatalogView = {
  buildings: [
    { id: 'mining_machine', name: '采矿机', category: 'collect' },
    { id: 'wind_turbine', name: '风力涡轮机', category: 'power' },
  ],
} as unknown as CatalogView;

function renderAlertBar(path = '/galaxy') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AlertBar />
        <Routes>
          <Route path="*" element={<div data-testid="route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubFetch(alerts: unknown[]) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === '/alerts/production/snapshot') {
      return Promise.resolve(jsonResponse({ available_from_tick: 1, has_more: false, alerts }));
    }
    if (url.pathname === '/state/summary') {
      return Promise.resolve(jsonResponse({
        tick: 120,
        active_planet_id: 'planet-1-1',
        players: { p1: { player_id: 'p1', resources: { minerals: 0, energy: 0 }, is_alive: true } },
      }));
    }
    if (url.pathname === '/catalog') {
      return Promise.resolve(jsonResponse(catalog));
    }
    return Promise.reject(new Error(`unexpected url ${url.pathname}`));
  }));
}

describe('AlertBar', () => {
  beforeEach(() => {
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'http://localhost:5173',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
  });

  it('无警报时整条不渲染', async () => {
    stubFetch([]);
    renderAlertBar();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(document.querySelector('.alert-bar')).not.toBeInTheDocument();
  });

  it('收起态只显示最新一条 + 总数徽标，展开后是合并计数的列表', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({ alert_id: 'a-1', tick: 100, building_id: 'b-1' }),
      alertEntry({ alert_id: 'a-2', tick: 140, building_id: 'b-1' }),
      alertEntry({ alert_id: 'a-3', tick: 120, building_id: 'b-2', building_type: 'wind_turbine' }),
    ]);
    renderAlertBar();

    const summary = await screen.findByRole('button', { name: '产线警报' });
    // 最新一条 = tick 140（b-1），总数徽标 = 3 条原始告警
    expect(summary).toHaveTextContent('t140');
    expect(document.querySelector('.alert-bar__count')).toHaveTextContent('3');
    // 收起态不渲染列表
    expect(screen.queryByTestId('alert-bar-list')).not.toBeInTheDocument();

    await user.click(summary);
    const list = screen.getByTestId('alert-bar-list');
    // 合并后两条：b-1（×2）在前（tick 更大），b-2 在后
    expect(list.querySelectorAll('.alert-bar__row')).toHaveLength(2);
    expect(list.querySelector('.alert-bar__row-count')).toHaveTextContent('×2');
    expect(list.textContent).toContain('风力涡轮机');
    // §3.3 复核：每条带建筑短标（id），同名建筑能区分
    const tags = [...list.querySelectorAll('.alert-bar__row-tag')].map((node) => node.textContent);
    expect(tags).toEqual(['b-1', 'b-2']);
  });

  it('展开列表最多显示 8 条（按建筑+类型合并后）', async () => {
    const user = userEvent.setup();
    stubFetch(Array.from({ length: 12 }, (_, index) => alertEntry({
      alert_id: `a-${index}`,
      tick: 100 + index,
      building_id: `b-${index}`,
    })));
    renderAlertBar();
    await user.click(await screen.findByRole('button', { name: '产线警报' }));
    expect(screen.getByTestId('alert-bar-list').querySelectorAll('.alert-bar__row')).toHaveLength(8);
    // 徽标仍是原始条数，不因截断而变小
    expect(document.querySelector('.alert-bar__count')).toHaveTextContent('12');
  });

  it('行星页内点击某条直接选中对应建筑', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({ alert_id: 'a-1', tick: 100, building_id: 'b-1' }),
      alertEntry({ alert_id: 'a-2', tick: 90, building_id: 'b-9', building_type: 'wind_turbine' }),
    ]);
    renderAlertBar('/planet/planet-1-1');
    await user.click(await screen.findByRole('button', { name: '产线警报' }));

    const rows = screen.getByTestId('alert-bar-list').querySelectorAll('.alert-bar__row');
    await user.click(rows[1] as HTMLElement);

    expect(usePlanetViewStore.getState().selected).toMatchObject({ kind: 'building', id: 'b-9' });
    // 点完收起列表
    expect(screen.queryByTestId('alert-bar-list')).not.toBeInTheDocument();
  });

  it('研究站吞吐噪音不进警报条（与顶栏同一份过滤后的快照）', async () => {
    stubFetch([
      alertEntry({
        alert_id: 'a-noise',
        building_type: 'matrix_lab',
        alert_type: 'throughput_drop',
      }),
    ]);
    renderAlertBar();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(document.querySelector('.alert-bar')).not.toBeInTheDocument();
  });

  it('mergeAlertRows 按建筑+类型合并、取最新 tick 并倒序排列', () => {
    const rows = mergeAlertRows([
      alertEntry({ alert_id: 'a-1', tick: 10, building_id: 'b-1', message: '旧' }) as never,
      alertEntry({ alert_id: 'a-2', tick: 30, building_id: 'b-1', message: '新' }) as never,
      alertEntry({ alert_id: 'a-3', tick: 20, building_id: 'b-2' }) as never,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ buildingId: 'b-1', count: 2, tick: 30, message: '新' });
    expect(rows[1]).toMatchObject({ buildingId: 'b-2', count: 1 });
  });
});
