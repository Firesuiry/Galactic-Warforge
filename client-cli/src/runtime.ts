import { setAuth, setServerUrl } from './api.js';
import { AGENT_ALLOWED_COMMANDS, getAllowedCommandsByCategories, getCommandCategory } from './command-catalog.js';
import { dispatch } from './commands/index.js';

export interface GameCliRuntimeContext {
  currentPlayer: string;
  serverUrl: string;
  playerKey: string;
}

export interface AgentCommandRuntimePolicy {
  allowedCategories?: string[];
  allowedPlanetIds?: string[];
}

function extractExplicitPlanetIds(line: string) {
  return line
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith('planet-'));
}

export function getAgentAllowedCommands(policy?: AgentCommandRuntimePolicy) {
  return policy?.allowedCategories?.length
    ? getAllowedCommandsByCategories(policy.allowedCategories)
    : [...AGENT_ALLOWED_COMMANDS];
}

export async function runCommandLine(line: string, context: GameCliRuntimeContext, policy?: AgentCommandRuntimePolicy) {
  const commandName = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const allowedCommands = getAgentAllowedCommands(policy);

  if (policy?.allowedCategories?.length && commandName !== 'help') {
    const category = getCommandCategory(commandName);
    if (!category || !policy.allowedCategories.includes(category)) {
      throw new Error(`command category not allowed for agent: ${commandName}`);
    }
  }

  if (!allowedCommands.includes(commandName as typeof AGENT_ALLOWED_COMMANDS[number]) && commandName !== 'help') {
    throw new Error(`command not allowed for agent: ${commandName}`);
  }

  if (policy?.allowedPlanetIds?.length) {
    const explicitPlanetIds = extractExplicitPlanetIds(line);
    const disallowedPlanetId = explicitPlanetIds.find((planetId) => !policy.allowedPlanetIds?.includes(planetId));
    if (disallowedPlanetId) {
      throw new Error(`planet not allowed for agent: ${disallowedPlanetId}`);
    }
  }

  setServerUrl(context.serverUrl);
  setAuth(context.currentPlayer, context.playerKey);

  return dispatch(line, {
    currentPlayer: context.currentPlayer,
    rl: {} as never,
  });
}
