import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runSaveCommand } from './debug.js';

describe('save command', () => {
  it('shows help', async () => {
    const out = await runSaveCommand(['--help'], async () => {
      throw new Error('should not call api');
    });
    assert.match(out, /save \[--reason <text>\]/);
  });

  it('prints save result', async () => {
    const out = await runSaveCommand([], async () => ({
      ok: true,
      tick: 64,
      saved_at: '2026-04-02T12:00:00Z',
      path: '/tmp/game/save.json',
      trigger: 'manual',
    }));
    assert.match(out, /Saved at tick 64/);
    assert.match(out, /\/tmp\/game\/save\.json/);
  });

  it('prints formatted error', async () => {
    const out = await runSaveCommand([], async () => {
      throw new Error('disk full');
    });
    assert.match(out, /disk full/);
  });
});
