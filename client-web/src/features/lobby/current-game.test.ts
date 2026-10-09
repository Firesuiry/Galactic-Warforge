import type { GameSummary } from '@shared/game';

import {
  buildNewGameRequest,
  createEmptyPlayerRow,
  detectGameContinuity,
  gameIdentityOf,
  isAuthErrorMessage,
  newGameAdminWarning,
  prefillNewGameForm,
  resolveAdoptedAuth,
  validateNewGameForm,
  type NewGameFormValue,
} from '@/features/lobby/current-game';

function createGameSummary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    map_seed: 'seed-001',
    enemy_difficulty: 'hard',
    victory_mode: 'sandbox',
    max_tick_rate: 10,
    active_planet_id: 'planet-1-1',
    tick: 100,
    started_at: '2026-09-29T12:00:00Z',
    players: [
      { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
      { player_id: 'p2', role: 'commander', team_id: 'team-b', bot: 'easy', is_alive: true },
    ],
    victory: { declared: false },
    ...overrides,
  };
}

function createForm(overrides: Partial<NewGameFormValue> = {}): NewGameFormValue {
  return {
    map_seed: '',
    enemy_difficulty: 'normal',
    victory_mode: 'elimination',
    players: [
      { player_id: 'p1', key: 'key-a', role: 'admin', bot: '', team_id: '' },
      { player_id: 'p2', key: 'key-b', role: 'commander', bot: 'normal', team_id: 'team-b' },
    ],
    ...overrides,
  };
}

describe('gameIdentityOf', () => {
  it('started_at 或 map_seed 变化都视为换局', () => {
    const game = createGameSummary();
    const baseline = gameIdentityOf(game);
    expect(gameIdentityOf({ ...game, tick: 999 })).toBe(baseline);
    expect(gameIdentityOf({ ...game, started_at: '2026-09-30T00:00:00Z' })).not.toBe(baseline);
    expect(gameIdentityOf({ ...game, map_seed: 'seed-002' })).not.toBe(baseline);
  });
});

describe('isAuthErrorMessage', () => {
  it('识别服务端 401 文案', () => {
    expect(isAuthErrorMessage('invalid player key')).toBe(true);
    expect(isAuthErrorMessage('missing or invalid Authorization header')).toBe(true);
    expect(isAuthErrorMessage('HTTP 401')).toBe(true);
    expect(isAuthErrorMessage('admin role required')).toBe(false);
    expect(isAuthErrorMessage('Failed to fetch')).toBe(false);
  });
});

describe('prefillNewGameForm', () => {
  it('沿用当前阵容并仅回填本人 key，非法枚举回退默认值', () => {
    const form = prefillNewGameForm(createGameSummary(), 'p1', 'key_player_1');
    expect(form.enemy_difficulty).toBe('hard');
    expect(form.victory_mode).toBe('sandbox');
    expect(form.players).toHaveLength(2);
    expect(form.players[0]).toEqual({
      player_id: 'p1',
      key: 'key_player_1',
      role: 'admin',
      bot: '',
      team_id: '',
    });
    expect(form.players[1]).toEqual({
      player_id: 'p2',
      key: '',
      role: 'commander',
      bot: 'easy',
      team_id: 'team-b',
    });

    const fallback = prefillNewGameForm(
      createGameSummary({ enemy_difficulty: 'lunatic', victory_mode: '???' }),
      'p1',
      'key_player_1',
    );
    expect(fallback.enemy_difficulty).toBe('normal');
    expect(fallback.victory_mode).toBe('elimination');
  });
});

describe('validateNewGameForm', () => {
  it('合法表单通过', () => {
    expect(validateNewGameForm(createForm())).toEqual([]);
  });

  it('玩家列表为空时直接报错', () => {
    expect(validateNewGameForm(createForm({ players: [] }))).toEqual(['至少需要 1 名玩家。']);
  });

  it('拦截空/重复 player_id 与空/重复 key', () => {
    const errors = validateNewGameForm(createForm({
      players: [
        { player_id: 'p1', key: 'same-key', role: 'admin', bot: '', team_id: '' },
        { player_id: 'p1', key: 'key-b', role: 'commander', bot: '', team_id: '' },
        { player_id: '  ', key: 'same-key', role: 'commander', bot: '', team_id: '' },
        { player_id: 'p4', key: '', role: 'commander', bot: '', team_id: '' },
      ],
    }));
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('player_id「p1」重复');
    expect(errors[1]).toContain('第 3 行玩家：player_id 不能为空');
    expect(errors[2]).toContain('第 3 行玩家：key 与其他玩家重复');
    expect(errors[3]).toContain('第 4 行玩家：key 不能为空');
  });
});

describe('newGameAdminWarning', () => {
  it('没有 admin 时给出软警告', () => {
    expect(newGameAdminWarning(createForm())).toBe('');
    expect(newGameAdminWarning(createForm({
      players: [{ ...createEmptyPlayerRow(), player_id: 'p1', key: 'k' }],
    }))).toContain('没有 admin 角色');
  });
});

describe('buildNewGameRequest', () => {
  it('裁剪空白字段并组装请求体', () => {
    const request = buildNewGameRequest(createForm({
      map_seed: '  seed-42  ',
      players: [
        { player_id: ' p1 ', key: ' key-a ', role: 'admin', bot: '', team_id: '  ' },
        { player_id: 'p2', key: 'key-b', role: 'commander', bot: 'hard', team_id: ' team-b ' },
      ],
    }));
    expect(request).toEqual({
      map_seed: 'seed-42',
      enemy_difficulty: 'normal',
      victory_mode: 'elimination',
      players: [
        { player_id: 'p1', key: 'key-a', role: 'admin' },
        { player_id: 'p2', key: 'key-b', role: 'commander', team_id: 'team-b', bot: 'hard' },
      ],
    });
  });

  it('map_seed 留空则不携带', () => {
    const request = buildNewGameRequest(createForm());
    expect(request.map_seed).toBeUndefined();
  });
});

describe('resolveAdoptedAuth', () => {
  it('优先沿用当前登录玩家的新 key', () => {
    const adopted = resolveAdoptedAuth(buildNewGameRequest(createForm()), 'p1');
    expect(adopted).toEqual({ playerId: 'p1', playerKey: 'key-a', samePlayer: true });
  });

  it('本人不在新局时切换到第一个 admin', () => {
    const adopted = resolveAdoptedAuth(buildNewGameRequest(createForm()), 'ghost');
    expect(adopted).toEqual({ playerId: 'p1', playerKey: 'key-a', samePlayer: false });
  });

  it('没有 admin 时兜底第一个玩家，空列表返回 null', () => {
    const request = buildNewGameRequest(createForm({
      players: [{ player_id: 'p9', key: 'key-z', role: 'commander', bot: '', team_id: '' }],
    }));
    expect(resolveAdoptedAuth(request, 'ghost')).toEqual({
      playerId: 'p9',
      playerKey: 'key-z',
      samePlayer: false,
    });
    expect(resolveAdoptedAuth({ players: [] }, 'ghost')).toBeNull();
  });
});

describe('detectGameContinuity（服务端重启后 SSE 重连不应报「对局重置」）', () => {
  const now = Date.parse('2026-09-29T12:10:00Z');
  const base = createGameSummary({ tick: 9000, started_at: '2026-09-29T11:00:00Z' });

  it('身份与 tick 都没变 → none（普通 SSE 重连/心跳恢复）', () => {
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 8999 }, base, now)).toBe('none');
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 9000 }, base, now)).toBe('none');
  });

  it('服务端重启恢复同一存档（started_at 新但 tick 仍是长跑值）→ reconnected', () => {
    const restarted = { ...base, tick: 9000, started_at: new Date(now - 30_000).toISOString() };
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 9000 }, restarted, now)).toBe('reconnected');
    // tick 略回退（快照恢复丢几 tick）也算重连
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 9050 }, restarted, now)).toBe('reconnected');
  });

  it('真换局（新 seed 或 tick 回到 0 附近）→ reset', () => {
    const newGame = { ...base, tick: 0, map_seed: 'seed-002', started_at: new Date(now - 5_000).toISOString() };
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 9000 }, newGame, now)).toBe('reset');
    const newSeed = { ...base, map_seed: 'seed-002' };
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 9000 }, newSeed, now)).toBe('reset');
    // 老 session（started_at 很久以前）却 tick 回退：不是重启恢复，按重置处理
    const regressed = { ...base, tick: 100 };
    expect(detectGameContinuity({ identity: gameIdentityOf(base), tick: 9000 }, regressed, now)).toBe('reset');
  });

  it('没有基线（首次拿到对局概要）→ none', () => {
    expect(detectGameContinuity(null, base, now)).toBe('none');
  });
});
