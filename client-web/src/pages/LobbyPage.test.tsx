import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import { createFixtureServerUrl } from '@/fixtures';
import { useSessionStore } from '@/stores/session';
import { jsonResponse, renderApp } from '@/test/utils';

const GAME_SUMMARY = {
  map_seed: 'seed-001',
  enemy_difficulty: 'normal',
  victory_mode: 'elimination',
  max_tick_rate: 10,
  active_planet_id: 'planet-1-1',
  tick: 4386,
  started_at: '2026-09-29T12:00:00Z',
  players: [
    { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
    { player_id: 'p2', role: 'commander', team_id: 'team-b', bot: 'easy', is_alive: true },
    { player_id: 'p3', role: 'commander', team_id: 'team-b', is_alive: false },
  ],
  victory: { declared: false },
};

function mockFetchWithGame(game: unknown) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/games/current')) {
      return Promise.resolve(jsonResponse(game));
    }
    return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
  }));
}

function loginAs(playerId: string) {
  useSessionStore.getState().setSession({
    serverUrl: 'http://test-server',
    playerId,
    playerKey: `key_${playerId}`,
  });
}

describe('LobbyPage', () => {
  it('渲染对局概要与玩家列表，admin 可见开新局入口', async () => {
    loginAs('p1');
    mockFetchWithGame(GAME_SUMMARY);

    renderApp(['/lobby']);

    expect(await screen.findByRole('heading', { name: '对局大厅' })).toBeInTheDocument();
    // 概要卡片
    expect(screen.getByText('seed-001')).toBeInTheDocument();
    expect(screen.getByText('标准')).toBeInTheDocument();
    expect(screen.getByText('歼灭')).toBeInTheDocument();
    expect(screen.getByText(/2\/3 存活/)).toBeInTheDocument();
    // 玩家列表：角色/bot/队伍/存活标记 + 本人标记
    expect(screen.getByText('p2')).toBeInTheDocument();
    expect(screen.getByText('bot·简单')).toBeInTheDocument();
    expect(screen.getAllByText('队伍 team-b')).toHaveLength(2);
    expect(screen.getByText('已淘汰')).toBeInTheDocument();
    expect(screen.getByText('我')).toBeInTheDocument();
    // admin 入口
    expect(screen.getByRole('link', { name: /开新局/ })).toHaveAttribute('href', '/lobby/new');
    // 未宣判胜利时不显示 victory 条
    expect(screen.queryByText(/对局已宣判/)).not.toBeInTheDocument();
  });

  it('非 admin 玩家看不到开新局入口', async () => {
    loginAs('p2');
    mockFetchWithGame(GAME_SUMMARY);

    renderApp(['/lobby']);

    expect(await screen.findByRole('heading', { name: '对局大厅' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /开新局/ })).not.toBeInTheDocument();
  });

  it('已宣判胜利时显示胜者与原因', async () => {
    loginAs('p1');
    mockFetchWithGame({
      ...GAME_SUMMARY,
      victory: { declared: true, winner_id: 'p1', team_id: 'p1', reason: 'elimination' },
    });

    renderApp(['/lobby']);

    expect(await screen.findByText(/对局已宣判：胜者 p1/)).toBeInTheDocument();
    expect(screen.getByText(/（队伍 p1）/)).toBeInTheDocument();
    expect(screen.getByText(/· elimination/)).toBeInTheDocument();
  });

  it('开新局成功后展示提示条', async () => {
    loginAs('p1');
    mockFetchWithGame({ ...GAME_SUMMARY, map_seed: 'seed-002', tick: 0 });

    renderApp([{ pathname: '/lobby', state: { notice: 'game-created', playerId: 'p1' } }]);

    expect(await screen.findByText(/新局已开启（tick 0）/)).toBeInTheDocument();
    expect(screen.getByText(/其他玩家需使用新局的 key 重新登录/)).toBeInTheDocument();
  });

  it('离线样例模式提示不支持对局大厅', async () => {
    useSessionStore.getState().setSession({
      serverUrl: createFixtureServerUrl('baseline'),
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    renderApp(['/lobby']);

    expect(await screen.findByText(/离线样例模式不提供对局大厅/)).toBeInTheDocument();
  });

  it('加载失败时展示错误', async () => {
    loginAs('p1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({ error: 'boom' }, { status: 500 }),
    )));

    renderApp(['/lobby']);

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
