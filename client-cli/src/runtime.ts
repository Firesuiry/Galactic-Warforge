import { setAuth, setServerUrl } from './api.js';
import { AGENT_ALLOWED_COMMANDS } from './command-catalog.js';
import { dispatch } from './commands/index.js';

export interface GameCliRuntimeContext {
  currentPlayer: string;
  serverUrl: string;
  playerKey: string;
}

export function getAgentAllowedCommands() {
  return [...AGENT_ALLOWED_COMMANDS];
}

export async function runCommandLine(line: string, context: GameCliRuntimeContext) {
  const commandName = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

  if (!AGENT_ALLOWED_COMMANDS.includes(commandName as typeof AGENT_ALLOWED_COMMANDS[number]) && commandName !== 'help') {
    throw new Error(`command not allowed for agent: ${commandName}`);
  }

  setServerUrl(context.serverUrl);
  setAuth(context.currentPlayer, context.playerKey);

  return dispatch(line, {
    currentPlayer: context.currentPlayer,
    rl: {} as never,
  });
}
