import {
  PUBLIC_COMMAND_DEFINITIONS,
  type CommandPermissionCategory,
} from '../../shared-client/src/command-catalog.js';

export type AgentCommandCategory = CommandPermissionCategory;

const EXTRA_AGENT_COMMAND_CATALOG: Record<string, { category: AgentCommandCategory }> = {
  health: { category: 'observe' },
  metrics: { category: 'observe' },
  summary: { category: 'observe' },
  stats: { category: 'observe' },
  galaxy: { category: 'observe' },
  system: { category: 'observe' },
  system_runtime: { category: 'observe' },
  planet: { category: 'observe' },
  planet_runtime: { category: 'observe' },
  blueprints: { category: 'observe' },
  war_industry: { category: 'observe' },
  task_forces: { category: 'observe' },
  theaters: { category: 'observe' },
  scene: { category: 'observe' },
  inspect: { category: 'observe' },
  fleet_status: { category: 'observe' },
  fog: { category: 'observe' },
  save: { category: 'management' },
};

const PUBLIC_AGENT_COMMAND_CATALOG: Record<string, { category: AgentCommandCategory }> =
  Object.fromEntries(
    PUBLIC_COMMAND_DEFINITIONS
      .filter((definition) => definition.cliCommandName)
      .map((definition) => [
        definition.cliCommandName as string,
        { category: definition.permissionCategory },
      ]),
  );

export const AGENT_COMMAND_CATALOG: Record<string, { category: AgentCommandCategory }> = {
  ...EXTRA_AGENT_COMMAND_CATALOG,
  ...PUBLIC_AGENT_COMMAND_CATALOG,
};

export type AgentAllowedCommand = string;

export const AGENT_ALLOWED_COMMANDS = Object.keys(AGENT_COMMAND_CATALOG) as AgentAllowedCommand[];

export function getCommandCategory(commandName: string): AgentCommandCategory | null {
  return AGENT_COMMAND_CATALOG[commandName]?.category ?? null;
}

export function getAllowedCommandsByCategories(categories?: string[]) {
  if (!categories || categories.length === 0) {
    return [...AGENT_ALLOWED_COMMANDS];
  }

  const allowed = new Set(categories);
  return AGENT_ALLOWED_COMMANDS.filter((commandName) => allowed.has(AGENT_COMMAND_CATALOG[commandName].category));
}
