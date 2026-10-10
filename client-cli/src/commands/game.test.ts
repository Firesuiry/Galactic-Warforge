import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GameSummary, NewGameRequest } from '@gw/shared/game';

import { gameNewCommand as runGameNew, gameStatusCommand } from './game.js';

function gameNewCommand(args: string[], createNewGame: (req: NewGameRequest) => Promise<GameSummary>) {
  return runGameNew(args, { createNewGame, setAuth: () => {} });
}

const sampleGame: GameSummary = {
  map_seed: 'seed-x',
  enemy_difficulty: 'normal',
  victory_mode: 'elimination',
  max_tick_rate: 10,
  active_planet_id: 'planet-1-1',
  tick: 0,
  started_at: '2026-09-29T00:00:00Z',
  origin: 'new',
  players: [
    { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
    { player_id: 'p2', role: 'commander', team_id: 'p2', bot: 'easy', is_alive: true },
  ],
  victory: { declared: false },
  status: 'running',
};

function stubCreate(t: (req: NewGameRequest) => void) {
  return async (req: NewGameRequest) => {
    t(req);
    return sampleGame;
  };
}

describe('game_new command', () => {
  it('shows help', async () => {
    const out = await gameNewCommand(['--help'], async () => {
      throw new Error('should not call api');
    });
    assert.match(out, /game_new \[options\]/);
  });

  it('posts request built from flags', async () => {
    let captured: NewGameRequest | undefined;
    const out = await gameNewCommand([
      '--seed', 'seed-42',
      '--difficulty', 'off',
      '--victory', 'sandbox',
      '--players', '[{"player_id":"p1","key":"k1","role":"admin"}]',
    ], stubCreate(req => { captured = req; }));
    assert.match(out, /新对局已创建/);
    assert.deepEqual(captured, {
      map_seed: 'seed-42',
      enemy_difficulty: 'off',
      victory_mode: 'sandbox',
      players: [{ player_id: 'p1', key: 'k1', role: 'admin' }],
    });
  });

  it('reads players from file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-cli-'));
    const file = join(dir, 'players.json');
    await writeFile(file, JSON.stringify([{ player_id: 'p9', key: 'k9', bot: 'hard' }]));
    let captured: NewGameRequest | undefined;
    const out = await gameNewCommand(['--players-file', file], stubCreate(req => { captured = req; }));
    assert.match(out, /seed-x/);
    assert.equal(captured?.players[0].bot, 'hard');
  });

  it('rejects invalid players input before calling api', async () => {
    const out = await gameNewCommand(['--players', 'not-json'], async () => {
      throw new Error('should not call api');
    });
    assert.match(out, /players/);

    const out2 = await gameNewCommand(['--players', '[]'], async () => {
      throw new Error('should not call api');
    });
    assert.match(out2, /非空数组/);
  });

  it('rejects invalid difficulty flag', async () => {
    const out = await gameNewCommand([
      '--difficulty', 'insane',
      '--players', '[{"player_id":"p1","key":"k1"}]',
    ], async () => {
      throw new Error('should not call api');
    });
    assert.match(out, /difficulty/);
  });

  it('prints formatted api error', async () => {
    const out = await gameNewCommand([
      '--players', '[{"player_id":"p1","key":"k1"}]',
    ], async () => {
      throw new Error('admin role required');
    });
    assert.match(out, /admin role required/);
  });
});

describe('game_status command', () => {
  it('shows help', async () => {
    const out = await gameStatusCommand(['--help'], async () => {
      throw new Error('should not call api');
    });
    assert.match(out, /game_status/);
  });

  it('renders current game summary', async () => {
    const out = await gameStatusCommand([], async () => sampleGame);
    assert.match(out, /status: .*running/);
    assert.match(out, /seed: .*seed-x/);
    assert.match(out, /p1/);
    assert.match(out, /bot:easy/);
    assert.doesNotMatch(out, /settlement:/);
  });

  it('prints winner, reason, duration and player losses when finished', async () => {
    const out = await gameStatusCommand([], async () => ({
      ...sampleGame,
      tick: 5120,
      status: 'finished',
      victory: { declared: true, winner_id: 'p1', reason: 'elimination' },
      settlement: {
        winner_id: 'p1',
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
      },
    }));
    assert.match(out, /status: .*finished/);
    assert.match(out, /winner: .*p1/);
    assert.match(out, /reason: elimination/);
    assert.match(out, /duration: 5120 ticks/);
    assert.match(out, /p1 killed=14 lost=6 buildings_destroyed=3 buildings_lost=1/);
    assert.match(out, /p2 killed=6 lost=14 buildings_destroyed=1 buildings_lost=3/);
  });

  it('treats a missing status as running', async () => {
    const { status: _status, ...legacy } = sampleGame;
    const out = await gameStatusCommand([], async () => legacy);
    assert.match(out, /status: .*running/);
    assert.doesNotMatch(out, /winner:/);
  });

  it('prints formatted error', async () => {
    const out = await gameStatusCommand([], async () => {
      throw new Error('connection refused');
    });
    assert.match(out, /connection refused/);
  });
});
