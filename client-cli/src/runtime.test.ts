import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAgentAllowedCommands, runCommandLine } from './runtime.js';

describe('game cli runtime', () => {
  it('lists command metadata for agent whitelist', () => {
    const commands = getAgentAllowedCommands();
    assert.ok(commands.includes('summary'));
    assert.ok(commands.includes('build'));
    assert.ok(!commands.includes('rollback'));
  });

  it('dispatches a simple command line', async () => {
    const output = await runCommandLine('help save', {
      currentPlayer: 'p1',
      serverUrl: 'http://localhost:18080',
      playerKey: 'key_player_1',
    });

    assert.match(output, /save \[--reason <text>\]/);
  });
});
