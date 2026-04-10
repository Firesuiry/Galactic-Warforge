import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PUBLIC_COMMAND_DEFINITIONS } from '../../shared-client/src/command-catalog.js';

import {
  AGENT_ALLOWED_COMMANDS,
  getCommandCategory,
} from './command-catalog.js';

describe('agent command catalog', () => {
  it('derives public CLI command aliases from shared-client catalog', () => {
    const publicCliCommands = PUBLIC_COMMAND_DEFINITIONS
      .map((definition) => definition.cliCommandName)
      .filter((commandName): commandName is string => Boolean(commandName));

    for (const commandName of publicCliCommands) {
      assert.ok(
        AGENT_ALLOWED_COMMANDS.includes(commandName),
        `missing shared public command alias: ${commandName}`,
      );
    }

    assert.equal(getCommandCategory('transfer'), 'management');
    assert.equal(getCommandCategory('switch_active_planet'), 'management');
    assert.equal(getCommandCategory('launch_rocket'), 'management');
  });
});
