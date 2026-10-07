import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';
import { jsonResponse, renderApp } from '@/test/utils';

const PLAYERS = [
  { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
  { player_id: 'p2', role: 'commander', team_id: 'p2', is_alive: false },
];

const RUNNING = {
  map_seed: 'seed-001',
  enemy_difficulty: 'normal',
  victory_mode: 'elimination',
  max_tick_rate: 10,
  active_planet_id: 'planet-1-1',
  tick: 100,
  started_at: '2026-09-29T12:00:00Z',
  players: PLAYERS,
  victory: { declared: false },
  status: 'running',
};

const SETTLEMENT = {
  winner_id: 'p1',
  team_id: 'p1',
  reason: 'elimination',
  victory_rule: 'elimination',
  start_tick: 0,
  declared_tick: 5120,
  duration_ticks: 5120,
  players: [
    {
      player_id: 'p1',
      team_id: 'p1',
      is_alive: true,
      winner: true,
      units_killed: 14,
      units_lost: 6,
      buildings_destroyed: 3,
      buildings_lost: 1,
    },
    {
      player_id: 'p2',
      team_id: 'p2',
      is_alive: false,
      units_killed: 6,
      units_lost: 14,
      buildings_destroyed: 1,
      buildings_lost: 3,
    },
  ],
};

const FINISHED = {
  ...RUNNING,
  tick: 5120,
  status: 'finished',
  victory: { declared: true, winner_id: 'p1', team_id: 'p1', reason: 'elimination' },
  settlement: SETTLEMENT,
};

function loginAs(playerId: string, serverUrl = 'http://test-server') {
  useSessionStore.getState().setSession({
    serverUrl,
    playerId,
    playerKey: `key_${playerId}`,
  });
}

function mockGame(game: unknown) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/games/current')) {
      return Promise.resolve(jsonResponse(game));
    }
    return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
  }));
}

describe('SettlementPage', () => {
  it('胜者视角展示战报，admin 可重开', async () => {
    loginAs('p1');
    mockGame(FINISHED);

    renderApp(['/settlement']);

    expect(await screen.findByRole('heading', { name: '胜利' })).toBeInTheDocument();
    expect(screen.getAllByText('歼灭').length).toBeGreaterThan(0);
    expect(screen.getByText('8 分 32 秒')).toBeInTheDocument();
    expect(screen.queryByText(/reason:|victory_rule:/)).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('14');
    expect(table).toHaveTextContent('6');
    expect(table).toHaveTextContent('3');
    expect(table).toHaveTextContent('1');
    expect(screen.getByRole('columnheader', { name: '摧毁建筑' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '损失建筑' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回大厅' })).toHaveAttribute('href', '/lobby');
    expect(screen.getByRole('link', { name: '查看战场' })).toHaveAttribute('href', '/planet/planet-1-1');
    expect(screen.getByRole('link', { name: '重开新局' })).toHaveAttribute('href', '/lobby/new');
    expect(screen.getByRole('link', { name: '结算' })).toHaveAttribute('href', '/settlement');
    expect(screen.queryByText(/请前往结算页/)).not.toBeInTheDocument();
  });

  it('失败视角显示战败', async () => {
    loginAs('p2');
    mockGame(FINISHED);

    renderApp(['/settlement']);

    expect(await screen.findByRole('heading', { name: '战败' })).toBeInTheDocument();
    expect(screen.getByText('已淘汰')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '胜利' })).not.toBeInTheDocument();
  });

  it('进行中不编造战报，并链回大厅与战场', async () => {
    loginAs('p1');
    mockGame(RUNNING);

    renderApp(['/settlement']);

    expect(await screen.findByRole('heading', { name: '对局尚未结束' })).toBeInTheDocument();
    expect(screen.getByText(/没有可展示的战报/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回大厅' })).toHaveAttribute('href', '/lobby');
    expect(screen.getByRole('link', { name: '查看战场' })).toHaveAttribute('href', '/planet/planet-1-1');
    expect(screen.queryByRole('link', { name: '重开新局' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '击杀' })).not.toBeInTheDocument();
    expect(screen.queryByText('14')).not.toBeInTheDocument();
  });

  it('admin 显示重开新局', async () => {
    loginAs('p1');
    mockGame(FINISHED);

    renderApp(['/settlement']);

    expect(await screen.findByRole('link', { name: '重开新局' })).toHaveAttribute('href', '/lobby/new');
  });

  it('非 admin 不显示重开', async () => {
    loginAs('p2');
    mockGame(FINISHED);

    renderApp(['/settlement']);

    expect(await screen.findByRole('heading', { name: '战败' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '重开新局' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回大厅' })).toBeInTheDocument();
  });

  it('离线样例给出与大厅一致的不可用说明', async () => {
    loginAs('p1', createFixtureServerUrl('baseline'));

    renderApp(['/settlement']);

    expect(await screen.findByText(/离线样例模式不提供对局大厅/)).toBeInTheDocument();
  });
});
