import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { useLobbyStore } from '@/stores/lobby';
import { useSessionStore } from '@/stores/session';
import { jsonResponse, renderApp } from '@/test/utils';

const GAME_A = {
  map_seed: 'seed-001',
  enemy_difficulty: 'normal',
  victory_mode: 'elimination',
  max_tick_rate: 10,
  active_planet_id: 'planet-1-1',
  tick: 100,
  started_at: '2026-09-29T12:00:00Z',
  players: [
    { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
  ],
  victory: { declared: false },
  status: 'running',
};

const GAME_B = {
  ...GAME_A,
  map_seed: 'seed-002',
  tick: 0,
  started_at: '2026-09-30T08:00:00Z',
};

function loginAs(playerId: string) {
  useSessionStore.getState().setSession({
    serverUrl: 'http://test-server',
    playerId,
    playerKey: `key_${playerId}`,
  });
}

describe('GameResetGuard', () => {
  it('对局身份变化（key 仍有效）→ 全量刷新并弹出提示条，可关闭', async () => {
    loginAs('p1');
    let currentGame: unknown = GAME_A;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/games/current')) {
        return Promise.resolve(jsonResponse(currentGame));
      }
      return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    }));
    const user = userEvent.setup();

    const { queryClient } = renderApp(['/lobby']);
    expect(await screen.findByText('seed-001')).toBeInTheDocument();
    expect(screen.queryByText(/对局已被管理员重置/)).not.toBeInTheDocument();

    // 管理员在别处热重置：started_at/seed 变化，但本机 key 仍被保留
    currentGame = GAME_B;
    await queryClient.invalidateQueries({ queryKey: ['current-game'] });

    expect(await screen.findByText(/对局已被管理员重置/)).toBeInTheDocument();
    // 缓存已清，大厅重新拉到新局概要
    expect(await screen.findByText('seed-002')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByText(/对局已被管理员重置/)).not.toBeInTheDocument();
    // 仍处于登录态
    expect(useSessionStore.getState().playerKey).toBe('key_p1');
  });

  it('连续 401（旧 key 失效）→ 自动登出并引导到登录页', async () => {
    loginAs('p2');
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/games/current')) {
        return Promise.resolve(jsonResponse({ error: 'invalid player key' }, { status: 401 }));
      }
      return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    }));

    const { queryClient } = renderApp(['/lobby']);

    // 第一次 401：仅计数，不登出（容忍换局瞬间竞态）
    await waitFor(() => {
      expect(useLobbyStore.getState().authFailureCount).toBe(1);
    });
    expect(useSessionStore.getState().playerKey).toBe('key_p2');

    // 第二次 401：强制登出并跳登录页
    await queryClient.invalidateQueries({ queryKey: ['current-game'] });
    expect(await screen.findByRole('heading', { name: '建立指挥链路' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/登录凭证已失效/);
    expect(useSessionStore.getState().playerKey).toBe('');
  });

  it('终局只提示一次，不登出，可前往结算页', async () => {
    loginAs('p1');
    const finished = {
      ...GAME_A,
      status: 'finished',
      tick: 5120,
      victory: { declared: true, winner_id: 'p1', reason: 'elimination' },
      settlement: {
        winner_id: 'p1',
        reason: 'elimination',
        victory_rule: 'elimination',
        start_tick: 0,
        declared_tick: 5120,
        duration_ticks: 5120,
        players: [
          { player_id: 'p1', is_alive: true, winner: true, units_killed: 1, units_lost: 0, buildings_destroyed: 0, buildings_lost: 0 },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/games/current')) {
        return Promise.resolve(jsonResponse(finished));
      }
      return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    }));
    const user = userEvent.setup();
    const { queryClient } = renderApp(['/lobby']);

    expect(await screen.findByText(/请前往结算页/)).toBeInTheDocument();
    expect(screen.getAllByText(/请前往结算页/)).toHaveLength(1);
    expect(useSessionStore.getState().playerKey).toBe('key_p1');

    await queryClient.invalidateQueries({ queryKey: ['current-game'] });
    await screen.findByText('seed-001');
    expect(screen.getAllByText(/请前往结算页/)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByText(/请前往结算页/)).not.toBeInTheDocument();

    await queryClient.invalidateQueries({ queryKey: ['current-game'] });
    await screen.findByText('seed-001');
    expect(screen.queryByText(/请前往结算页/)).not.toBeInTheDocument();
    expect(useSessionStore.getState().playerKey).toBe('key_p1');
  });
});

describe('GameResetGuard：重启恢复同一存档不报「对局重置」', () => {
  it('started_at 刷新但 tick 连续（服务端重启恢复存档）→ 只提示重新连接', async () => {
    loginAs('p1');
    let currentGame: unknown = GAME_A;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/games/current')) {
        return Promise.resolve(jsonResponse(currentGame));
      }
      return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    }));

    const { queryClient } = renderApp(['/lobby']);
    expect(await screen.findByText('seed-001')).toBeInTheDocument();

    // 服务端重启：started_at 变成「刚刚」，但同一存档（同 seed、tick 继续增长）。
    currentGame = {
      ...GAME_A,
      tick: 5200,
      started_at: new Date().toISOString(),
    };
    await queryClient.invalidateQueries({ queryKey: ['current-game'] });

    expect(await screen.findByText(/已重新连接到服务器/)).toBeInTheDocument();
    expect(screen.queryByText(/对局已被管理员重置/)).not.toBeInTheDocument();
    // 缓存没被清掉：大厅仍在（没有整页重拉）
    expect(useSessionStore.getState().playerKey).toBe('key_p1');
  });
});
