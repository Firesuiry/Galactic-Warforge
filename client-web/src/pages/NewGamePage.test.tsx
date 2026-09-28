import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { useSessionStore } from '@/stores/session';
import { jsonResponse, renderApp } from '@/test/utils';

const CURRENT_GAME = {
  map_seed: 'seed-001',
  enemy_difficulty: 'normal',
  victory_mode: 'elimination',
  max_tick_rate: 10,
  active_planet_id: 'planet-1-1',
  tick: 4386,
  started_at: '2026-09-29T12:00:00Z',
  players: [
    { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
    { player_id: 'p2', role: 'commander', team_id: 'p2', is_alive: true },
  ],
  victory: { declared: false },
};

interface CapturedRequest {
  url: string;
  method: string;
  body?: unknown;
}

/** 模拟服务端：POST /games/new 后切换到新局（新 key 集生效，旧 key 401）。 */
function mockFetchWithNewGame() {
  const state = {
    game: CURRENT_GAME,
    validKeys: new Set(['key_p1', 'key_p2']),
    requests: [] as CapturedRequest[],
  };

  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/games/current')) {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      const key = auth.replace('Bearer ', '');
      if (!state.validKeys.has(key)) {
        return Promise.resolve(jsonResponse({ error: 'invalid player key' }, { status: 401 }));
      }
      return Promise.resolve(jsonResponse(state.game));
    }

    if (url.endsWith('/games/new') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as {
        map_seed?: string;
        enemy_difficulty?: string;
        victory_mode?: string;
        players: Array<{ player_id: string; key: string; role?: string; team_id?: string; bot?: string }>;
      };
      state.requests.push({ url, method, body });
      state.validKeys = new Set(body.players.map((player) => player.key));
      state.game = {
        map_seed: body.map_seed ?? 'seed-random',
        enemy_difficulty: body.enemy_difficulty ?? 'normal',
        victory_mode: body.victory_mode ?? 'elimination',
        max_tick_rate: 10,
        active_planet_id: 'planet-1-1',
        tick: 0,
        started_at: '2026-09-30T08:00:00Z',
        players: body.players.map((player) => ({
          player_id: player.player_id,
          role: player.role ?? 'commander',
          team_id: player.team_id ?? player.player_id,
          bot: player.bot,
          is_alive: true,
        })),
        victory: { declared: false },
      };
      return Promise.resolve(jsonResponse(state.game, { status: 201 }));
    }

    return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
  }));

  return state;
}

function loginAs(playerId: string) {
  useSessionStore.getState().setSession({
    serverUrl: 'http://test-server',
    playerId,
    playerKey: `key_${playerId}`,
  });
}

describe('NewGamePage', () => {
  it('admin 打开表单并按当前对局预填，提交成功后切换新 key 并回到大厅', async () => {
    loginAs('p1');
    const server = mockFetchWithNewGame();
    const user = userEvent.setup();

    renderApp(['/lobby/new']);

    expect(await screen.findByRole('heading', { name: '开新局' })).toBeInTheDocument();

    // 预填：本人行回填当前 key，其他玩家 key 为空
    expect(screen.getByDisplayValue('key_p1')).toBeInTheDocument();
    const p2KeyInput = screen.getByLabelText('玩家 2 key');
    expect(p2KeyInput).toHaveValue('');

    // 填上 p2 的新 key，并把 p1 的 key 换成新值
    await user.type(p2KeyInput, 'new_key_p2');
    const p1KeyInput = screen.getByLabelText('玩家 1 key');
    await user.clear(p1KeyInput);
    await user.type(p1KeyInput, 'new_key_p1');

    await user.clear(screen.getByLabelText('map_seed'));
    await user.type(screen.getByLabelText('map_seed'), 'seed-42');
    await user.selectOptions(screen.getByLabelText('黑雾难度'), 'hard');
    await user.selectOptions(screen.getByLabelText('胜利模式'), 'sandbox');
    await user.selectOptions(screen.getByLabelText('玩家 2 bot'), 'easy');

    await user.click(screen.getByRole('button', { name: '确认开新局（丢弃当前对局）' }));

    // 回到大厅并提示新局已开
    expect(await screen.findByText(/新局已开启（tick 0）/)).toBeInTheDocument();
    expect(screen.getByText(/其他玩家需使用新局的 key 重新登录/)).toBeInTheDocument();

    // POST 体校验
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].body).toEqual({
      map_seed: 'seed-42',
      enemy_difficulty: 'hard',
      victory_mode: 'sandbox',
      players: [
        { player_id: 'p1', key: 'new_key_p1', role: 'admin' },
        { player_id: 'p2', key: 'new_key_p2', role: 'commander', bot: 'easy' },
      ],
    });

    // 本机 session 已切换到新 key，大厅轮询用新 key 成功
    await waitFor(() => {
      expect(useSessionStore.getState().playerKey).toBe('new_key_p1');
    });
    expect(await screen.findByText('seed-42')).toBeInTheDocument();
  });

  it('重复/空 key 被前端预检拦截，不发请求', async () => {
    loginAs('p1');
    const server = mockFetchWithNewGame();
    const user = userEvent.setup();

    renderApp(['/lobby/new']);

    expect(await screen.findByRole('heading', { name: '开新局' })).toBeInTheDocument();

    // p2 key 留空 → 校验失败
    await user.click(screen.getByRole('button', { name: '确认开新局（丢弃当前对局）' }));
    expect(await screen.findByText(/第 2 行玩家：key 不能为空/)).toBeInTheDocument();
    expect(server.requests).toHaveLength(0);

    // 填成与 p1 相同的 key → 重复校验
    const p2KeyInput = screen.getByLabelText('玩家 2 key');
    await user.type(p2KeyInput, 'key_p1');
    await user.click(screen.getByRole('button', { name: '确认开新局（丢弃当前对局）' }));
    expect(await screen.findByText(/第 2 行玩家：key 与其他玩家重复/)).toBeInTheDocument();
    expect(server.requests).toHaveLength(0);
  });

  it('支持增删玩家行（至少保留 1 行）', async () => {
    loginAs('p1');
    mockFetchWithNewGame();
    const user = userEvent.setup();

    renderApp(['/lobby/new']);

    expect(await screen.findByRole('heading', { name: '开新局' })).toBeInTheDocument();
    expect(screen.getByText('玩家（2）')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加玩家' }));
    expect(screen.getByText('玩家（3）')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除玩家 3' }));
    expect(screen.getByText('玩家（2）')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除玩家 2' }));
    expect(screen.getByText('玩家（1）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除玩家 1' })).toBeDisabled();
  });

  it('非 admin 玩家被拒绝进入', async () => {
    loginAs('p2');
    mockFetchWithNewGame();

    renderApp(['/lobby/new']);

    expect(await screen.findByRole('alert')).toHaveTextContent('仅管理员（role=admin）可以开新局');
  });
});
