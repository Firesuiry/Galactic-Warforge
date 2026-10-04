import { describe, expect, it } from 'vitest';

import {
  AGENT_ALLOWED_COMMANDS,
  EXTRA_AGENT_COMMAND_CATALOG,
  PUBLIC_COMMAND_DEFINITIONS,
  getAllowedCommandsByCategories,
  getCommandCategory,
} from './command-catalog.js';
import { GAME_COMMANDS } from './commands/game-commands.js';

describe('agent command catalog', () => {
  it('derives public CLI command aliases from the public catalog', () => {
    const publicCliCommands = PUBLIC_COMMAND_DEFINITIONS
      .map((definition) => definition.cliCommandName)
      .filter((commandName): commandName is string => Boolean(commandName));

    for (const commandName of publicCliCommands) {
      expect(AGENT_ALLOWED_COMMANDS, `missing shared public command alias: ${commandName}`).toContain(commandName);
    }

    expect(getCommandCategory('transfer')).toBe('management');
    expect(getCommandCategory('switch_active_planet')).toBe('management');
    expect(getCommandCategory('launch_rocket')).toBe('management');
    expect(getCommandCategory('refuel_mecha')).toBe('management');
    expect(AGENT_ALLOWED_COMMANDS).toContain('blueprint_create');
    expect(AGENT_ALLOWED_COMMANDS).toContain('queue_military_production');
    expect(AGENT_ALLOWED_COMMANDS).toContain('task_force_create');
    expect(AGENT_ALLOWED_COMMANDS).toContain('blockade_planet');
  });

  it('includes every extra observe / management command', () => {
    for (const commandName of Object.keys(EXTRA_AGENT_COMMAND_CATALOG)) {
      expect(AGENT_ALLOWED_COMMANDS).toContain(commandName);
    }
    expect(getCommandCategory('briefing')).toBe('observe');
    expect(getCommandCategory('save')).toBe('management');
  });

  it('backs every agent-allowed command with a shared game command handler', () => {
    for (const commandName of AGENT_ALLOWED_COMMANDS) {
      expect(GAME_COMMANDS[commandName], `missing shared handler: ${commandName}`).toBeDefined();
    }
  });

  it('filters allowed commands by permission category', () => {
    const observe = getAllowedCommandsByCategories(['observe']);
    expect(observe).toContain('planet_runtime');
    expect(observe).not.toContain('build');
    expect(getAllowedCommandsByCategories()).toEqual(AGENT_ALLOWED_COMMANDS);
  });
});
