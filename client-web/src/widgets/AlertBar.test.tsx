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
        players: { p1: { player_id: 'p1', resources: { energy: 0 }, is_alive: true } },
      }));
    }
    if (url.pathname === '/catalog') {
      return Promise.resolve(jsonResponse(catalog));
    }
    if (url.pathname === '/games/current') {
      return Promise.resolve(jsonResponse({ max_tick_rate: 10, tick: 120, active_planet_id: 'planet-1-1' }));
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

  it('传送带堵塞条目显示位置/件数/时长（中文，不裸显 belt_blocked）', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({
        alert_id: 'a-belt',
        tick: 500,
        building_id: 'b-9',
        building_type: 'conveyor_belt_mk1',
        alert_type: 'belt_blocked',
        message: '建筑 b-9：传送带被堵，物品运不出去',
        details: { position: { x: 12, y: 7, z: 0 }, queued_items: 5, blocked_ticks: 300 },
      }),
    ]);
    renderAlertBar('/planet/planet-1-1');
    const summary = await screen.findByRole('button', { name: '产线警报' });
    expect(summary.textContent).toContain('传送带堵塞');

    await user.click(summary);
    const row = screen.getByTestId('alert-bar-list').querySelector('.alert-bar__row') as HTMLElement;
    expect(row.textContent).toContain('(12, 7)：5 件货 30 秒没动');
    expect(row.getAttribute('title')).toBe('传送带堵塞 (12, 7)：5 件货 30 秒没动');
    expect(row.textContent).not.toMatch(/[a-z]+_[a-z]+/);
    expect(row.textContent).not.toContain('belt_blocked');
  });

  it('点传送带堵塞条目：镜头聚焦被堵的带格（不再选中建筑）', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({
        alert_id: 'a-belt',
        tick: 500,
        building_id: 'b-9',
        building_type: 'conveyor_belt_mk1',
        alert_type: 'belt_blocked',
        message: '建筑 b-9：传送带被堵，物品运不出去',
        details: { position: { x: 12, y: 7, z: 0 }, queued_items: 5, blocked_ticks: 300 },
      }),
    ]);
    renderAlertBar('/planet/planet-1-1');
    await user.click(await screen.findByRole('button', { name: '产线警报' }));
    const row = screen.getByTestId('alert-bar-list').querySelector('.alert-bar__row') as HTMLElement;
    await user.click(row);

    const state = usePlanetViewStore.getState();
    expect(state.selected).toMatchObject({ kind: 'tile', position: { x: 12, y: 7 } });
    expect(state.focusRequest?.position).toMatchObject({ x: 12, y: 7 });
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

  it('已解除的告警（active=false）不进警报条；只剩历史告警时整条不渲染', async () => {
    stubFetch([
      alertEntry({ alert_id: 'a-old', tick: 900, building_id: 'b-9', active: false }),
    ]);
    renderAlertBar();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(document.querySelector('.alert-bar')).not.toBeInTheDocument();
  });

  it('活跃 + 历史混合时只显示活跃条目，且总数徽标按活跃条数算', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({ alert_id: 'a-live', tick: 100, building_id: 'b-1' }),
      alertEntry({ alert_id: 'a-old', tick: 900, building_id: 'b-9', active: false }),
    ]);
    renderAlertBar();
    await user.click(await screen.findByRole('button', { name: '产线警报' }));
    const list = screen.getByTestId('alert-bar-list');
    expect(list.querySelectorAll('.alert-bar__row')).toHaveLength(1);
    expect(list.textContent).not.toContain('b-9');
    expect(document.querySelector('.alert-bar__count')).toHaveTextContent('1');
  });

  it('按 last_tick 排序：被持续提醒的老告警不会压住新告警', () => {
    const rows = mergeAlertRows([
      // 老告警 tick 很小，但最近一次重复在 950
      alertEntry({ alert_id: 'a-repeat', tick: 10, last_tick: 950, building_id: 'b-1' }) as never,
      // 新告警首现在 900
      alertEntry({ alert_id: 'a-new', tick: 900, building_id: 'b-2' }) as never,
    ]);
    expect(rows.map((row) => row.buildingId)).toEqual(['b-1', 'b-2']);
    expect(rows[0].tick).toBe(950);
  });

  it('haul_unreachable：中文标签 + 机器人/目标建筑/坐标；点条目聚焦目标建筑', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({
        alert_id: 'a-haul',
        tick: 700,
        // 服务端契约：告警的 building_id/building_type 是**目标建筑**，
        // details 只带 unit_id / building_id / position。
        building_id: 'b-164',
        building_type: 'arc_smelter',
        alert_type: 'haul_unreachable',
        message: 'unit u-184 cannot reach b-164',
        details: { unit_id: 'u-184', building_id: 'b-164', position: { x: 61, y: 135, z: 0 } },
      }),
    ]);
    renderAlertBar('/planet/planet-1-1');
    const summary = await screen.findByRole('button', { name: '产线警报' });
    expect(summary.textContent).toContain('运输机器人到不了目标');
    expect(summary.textContent).not.toContain('haul_unreachable');

    await user.click(summary);
    const row = screen.getByTestId('alert-bar-list').querySelector('.alert-bar__row') as HTMLElement;
    // 建筑列写的是「到不了的目标建筑」，不是服务端告警里的机器人 id。
    expect(row.textContent).toContain('电弧熔炉');
    expect(row.textContent).toContain('b-164');
    expect(row.textContent).toContain('机器人 u-184 → 电弧熔炉 (61, 135)');
    expect(row.textContent).not.toMatch(/[a-z]+_[a-z]+/);

    await user.click(row);
    const state = usePlanetViewStore.getState();
    // 聚焦的是「到不了的目标建筑」，不是机器人自己
    expect(state.selected).toMatchObject({ kind: 'building', id: 'b-164' });
    expect(state.focusRequest?.position).toMatchObject({ x: 61, y: 135 });
  });

  it('sorter_stalled：中文标签「分拣器停工」+ reason 中文 + 目标建筑；不裸显枚举', async () => {
    const user = userEvent.setup();
    stubFetch([
      alertEntry({
        alert_id: 'a-sorter',
        tick: 900,
        // 服务端契约：告警挂在分拣器上，details.building_id 是放货端的目标机器，
        // details.target_type 是目标建筑类型，details.position 是分拣器自己的坐标，
        // details.target_position 才是目标机器的坐标。
        building_id: 'b-42',
        building_type: 'sorter_mk1',
        alert_type: 'sorter_stalled',
        message: 'sorter b-42 stalled',
        details: {
          reason: 'no_power',
          building_id: 'b-164',
          target_type: 'arc_smelter',
          position: { x: 3, y: 6, z: 0 },
          target_position: { x: 61, y: 135, z: 0 },
        },
      }),
    ]);
    renderAlertBar('/planet/planet-1-1');
    const summary = await screen.findByRole('button', { name: '产线警报' });
    expect(summary.textContent).toContain('分拣器停工');
    expect(summary.textContent).not.toContain('sorter_stalled');

    await user.click(summary);
    const row = screen.getByTestId('alert-bar-list').querySelector('.alert-bar__row') as HTMLElement;
    expect(row.textContent).toContain('分拣器断电');
    expect(row.textContent).toContain('电弧熔炉');
    // 目标建筑后面跟的是目标坐标，不是分拣器自己的 (3, 6)。
    expect(row.textContent).toContain('电弧熔炉 (61, 135)');
    expect(row.textContent).not.toContain('电弧熔炉 (3, 6)');
    expect(row.textContent).not.toMatch(/[a-z]+_[a-z]+/);
  });
});
