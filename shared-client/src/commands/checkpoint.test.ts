import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CheckpointListView,
  CheckpointLoadResult,
  CheckpointSaveRequest,
  CheckpointSummary,
} from '../types.js';

import { cmdCheckpoint, checkpointList, checkpointLoad, checkpointSave } from './checkpoint.js';

import { createApiClient } from '../api.js';

const api = createApiClient({ serverUrl: 'http://127.0.0.1:1', auth: { playerId: 'p1', playerKey: 'key1' } });

const summary: CheckpointSummary = {
  format_version: 1,
  name: 'base-ok',
  kind: 'regression',
  parent: 'step-1',
  tick: 1234,
  map_seed: 'seed-x',
  players: [{ player_id: 'p1', role: 'admin', key: 'key1' }],
  commit: 'abcdef0123456789',
  dirty: false,
  created_at: '2026-10-10T00:00:00Z',
  note: '开局 20 分钟',
  contract: { checks: [{ kind: 'tick_gte', tick: 1000 }] },
  contract_report: { passed: true, results: [] },
  stale: false,
};

const stubApi = (overrides: Partial<Record<'fetchCheckpoints' | 'saveCheckpoint' | 'loadCheckpoint', unknown>>) => ({
  fetchCheckpoints: async () => ({ checkpoint_dir: '/tmp/cp', source: 'step-1', checkpoints: [] }) as CheckpointListView,
  saveCheckpoint: async () => summary,
  loadCheckpoint: async () => ({
    manifest: summary,
    warnings: [],
    game: {
      map_seed: 'seed-x',
      enemy_difficulty: 'normal',
      victory_mode: 'elimination',
      max_tick_rate: 10,
      active_planet_id: 'planet-1-1',
      tick: 1234,
      started_at: '2026-10-10T00:05:00Z',
      origin: 'checkpoint',
      players: [],
      victory: { declared: false },
      status: 'running',
    },
  }) as CheckpointLoadResult,
  ...overrides,
});

describe('checkpoint command registration', () => {
  it('handles --help with both subcommand usages', async () => {
    const out = await cmdCheckpoint(['--help'], { api });
    assert.match(out, /save <name>/);
    assert.match(out, /load <name>/);
  });
});

describe('checkpoint list', () => {
  it('prints dir, source and each checkpoint', async () => {
    const out = await checkpointList(
      stubApi({
        fetchCheckpoints: async () => ({
          checkpoint_dir: '/tmp/cp',
          source: 'step-1',
          checkpoints: [summary],
        }),
      }) as never,
    );
    assert.match(out, /\/tmp\/cp/);
    assert.match(out, /step-1/);
    assert.match(out, /base-ok/);
    assert.match(out, /parent=step-1/);
  });

  it('marks stale checkpoints', async () => {
    const out = await checkpointList(
      stubApi({
        fetchCheckpoints: async () => ({
          checkpoint_dir: '/tmp/cp',
          source: '',
          checkpoints: [{ ...summary, stale: true }],
        }),
      }) as never,
    );
    assert.match(out, /stale/);
    assert.match(out, /\(新局\)/);
  });
});

describe('checkpoint save', () => {
  it('requires a name', async () => {
    await assert.rejects(
      () => checkpointSave(undefined, {}, stubApi({}) as never),
      /checkpoint save <name>/,
    );
  });

  it('builds the request from flags and parses the contract file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-cp-'));
    const file = join(dir, 'contract.json');
    await writeFile(file, JSON.stringify({ checks: [{ kind: 'tick_gte', tick: 500 }] }));

    let captured: CheckpointSaveRequest | undefined;
    const out = await checkpointSave(
      'base-ok',
      { note: 'hello', contract: file, replace: true },
      stubApi({ saveCheckpoint: async (req: CheckpointSaveRequest) => { captured = req; return summary; } }) as never,
    );
    assert.deepEqual(captured, {
      name: 'base-ok',
      note: 'hello',
      replace: true,
      contract: { checks: [{ kind: 'tick_gte', tick: 500 }] },
    });
    assert.match(out, /base-ok/);
    assert.match(out, /全部通过/);
  });

  it('rejects a malformed contract file before calling the api', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-cp-'));
    const file = join(dir, 'bad.json');
    await writeFile(file, '{"nope":1}');
    await assert.rejects(
      () => checkpointSave('x', { contract: file }, stubApi({}) as never),
      /checks/,
    );
  });
});

describe('checkpoint load', () => {
  it('requires a name', async () => {
    await assert.rejects(() => checkpointLoad(undefined, stubApi({}) as never), /checkpoint load <name>/);
  });

  it('prints the loaded tick and warnings', async () => {
    const out = await checkpointLoad(
      'base-ok',
      stubApi({
        loadCheckpoint: async () => ({
          manifest: { ...summary, stale: true },
          warnings: ['存档点 base-ok 由另一份构建创建'],
          game: {
            map_seed: 'seed-x',
            enemy_difficulty: 'normal',
            victory_mode: 'elimination',
            max_tick_rate: 10,
            active_planet_id: 'planet-1-1',
            tick: 1234,
            started_at: '2026-10-10T00:05:00Z',
            origin: 'checkpoint',
            players: [],
            victory: { declared: false },
            status: 'running',
          },
        }),
      }) as never,
    );
    assert.match(out, /已从存档点 base-ok 热加载/);
    assert.match(out, /tick: 1234/);
    assert.match(out, /另一份构建/);
  });
});
