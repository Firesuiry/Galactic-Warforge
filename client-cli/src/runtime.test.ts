import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAgentAllowedCommands, runCommandLine } from './runtime.js';

describe('game cli runtime', () => {
  it('lists command metadata for agent whitelist', () => {
    const commands = [...getAgentAllowedCommands()] as string[];
    assert.ok(commands.includes('summary'));
    assert.ok(commands.includes('build'));
    assert.ok(commands.includes('deploy_squad'));
    assert.ok(commands.includes('fleet_status'));
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

  it('rejects commands outside allowed categories', async () => {
    await assert.rejects(() => runCommandLine('attack unit-1 target-1', {
      currentPlayer: 'p1',
      serverUrl: 'http://localhost:18080',
      playerKey: 'key_player_1',
    }, {
      allowedCategories: ['observe'],
    }), /command category not allowed/);
  });
});
