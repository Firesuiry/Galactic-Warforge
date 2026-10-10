import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

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
  origin: 'new',
  players: [
    { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
    { player_id: 'p2', role: 'commander', team_id: 'team-b', is_alive: true },
  ],
  victory: { declared: false },
  status: 'running',
};

const SETTLEMENT = {
  winner_id: 'p1',
  reason: 'elimination',
  victory_rule: 'elimination',
  start_tick: 0,
  declared_tick: 5120,
  duration_ticks: 5120,
  players: [
    { player_id: 'p1', is_alive: true, winner: true, units_killed: 3, units_lost: 0, buildings_destroyed: 1, buildings_lost: 0 },
    { player_id: 'p2', is_alive: false, winner: false, units_killed: 0, units_lost: 3, buildings_destroyed: 0, buildings_lost: 1 },
  ],
};

function loginAs(playerId: string) {
  useSessionStore.getState().setSession({
    serverUrl: 'http://test-server',
    playerId,
    playerKey: `key_${playerId}`,
  });
}

function stubCurrentGame(getGame: () => unknown) {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/games/current')) {
      return Promise.resolve(jsonResponse(getGame()));
    }
    return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
  }));
}

describe('EndgameBanner：终局/出局胜负横幅', () => {
  it('对局进行中且本人存活 → 不出现横幅', async () => {
    loginAs('p1');
    stubCurrentGame(() => GAME_A);
    renderApp(['/lobby']);

    expect(await screen.findByText('seed-001')).toBeInTheDocument();
    expect(screen.queryByTestId('endgame-banner')).not.toBeInTheDocument();
  });

  it('本人被歼灭（对局仍在进行）→ 战败横幅 + 查看结算', async () => {
    loginAs('p1');
    stubCurrentGame(() => ({
      ...GAME_A,
      players: [
        { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: false },
        { player_id: 'p2', role: 'commander', team_id: 'team-b', is_alive: true },
      ],
    }));
    renderApp(['/lobby']);

    const banner = await screen.findByTestId('endgame-banner');
    expect(banner).toHaveTextContent('战败');
    expect(banner).toHaveTextContent('出局');
    expect(screen.getByRole('link', { name: '查看结算' })).toHaveAttribute('href', '/settlement');
  });

  it('对局结束：胜者看到胜利，败者看到战败，可关闭', async () => {
    loginAs('p1');
    stubCurrentGame(() => ({
      ...GAME_A,
      status: 'finished',
      tick: 5120,
      victory: { declared: true, winner_id: 'p1' },
      settlement: SETTLEMENT,
    }));
    const user = userEvent.setup();
    renderApp(['/lobby']);

    const banner = await screen.findByTestId('endgame-banner');
    expect(banner).toHaveTextContent('胜利');
    expect(banner).not.toHaveTextContent('战败');

    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByTestId('endgame-banner')).not.toBeInTheDocument();
  });

  it('读档存档点（换局）后横幅自动复位并按新局判定', async () => {
    loginAs('p1');
    let currentGame: unknown = {
      ...GAME_A,
      status: 'finished',
      tick: 5120,
      victory: { declared: true, winner_id: 'p1' },
      settlement: SETTLEMENT,
    };
    stubCurrentGame(() => currentGame);
    const user = userEvent.setup();
    const { queryClient } = renderApp(['/lobby']);

    expect(await screen.findByTestId('endgame-banner')).toHaveTextContent('胜利');
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByTestId('endgame-banner')).not.toBeInTheDocument();

    // 读档到更早的存档点：身份（started_at::map_seed）变化 → 横幅重新判定
    currentGame = {
      ...GAME_A,
      tick: 12037,
      started_at: '2026-09-30T08:00:00Z',
      origin: 'checkpoint',
      source_checkpoint: 'cp-a',
    };
    await queryClient.invalidateQueries({ queryKey: ['current-game'] });

    // 新局进行中且本人存活：横幅保持关闭，不会把上一局的关闭状态带过来（也不残留旧横幅）
    expect(await screen.findByText(/已读档存档点「cp-a」/)).toBeInTheDocument();
    expect(screen.queryByTestId('endgame-banner')).not.toBeInTheDocument();
  });
});
