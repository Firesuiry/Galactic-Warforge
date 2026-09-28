import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GameSummary, NewGameRequest } from '../api.js';
import { gameNewCommand, gameStatusCommand } from './game.js';

const sampleGame: GameSummary = {
  map_seed: 'seed-x',
  enemy_difficulty: 'normal',
  victory_mode: 'elimination',
  max_tick_rate: 10,
  active_planet_id: 'planet-1-1',
  tick: 0,
  started_at: '2026-09-29T00:00:00Z',
  players: [
    { player_id: 'p1', role: 'admin', team_id: 'p1', is_alive: true },
    { player_id: 'p2', role: 'commander', team_id: 'p2', bot: 'easy', is_alive: true },
  ],
  victory: { declared: false },
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
    assert.match(out, /seed: .*seed-x/);
    assert.match(out, /p1/);
    assert.match(out, /bot:easy/);
  });

  it('prints formatted error', async () => {
    const out = await gameStatusCommand([], async () => {
      throw new Error('connection refused');
    });
    assert.match(out, /connection refused/);
  });
});
