import type { CanonicalGameCommandAction } from './game-command-schema.js';
import { serializeGameCommandAction, summarizeGameCommandAction } from './game-command-schema.js';

export interface GameCommandRuntime {
  run: (commandLine: string) => Promise<string>;
}

export async function executeGameCommand(
  action: CanonicalGameCommandAction,
  runtime: GameCommandRuntime,
) {
  const commandLine = serializeGameCommandAction(action);
  const result = await runtime.run(commandLine);
  return {
    commandLine,
    summary: summarizeGameCommandAction(action),
    result,
  };
}

export { summarizeGameCommandAction };
