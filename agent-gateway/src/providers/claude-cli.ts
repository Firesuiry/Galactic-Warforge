import { runCliCommand } from './cli-runner.js';
import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';

interface ClaudeTurnInput {
  command: string;
  model: string;
  prompt: string;
  schemaJson: string;
  systemPrompt?: string;
  workdir?: string;
  argsTemplate?: string[];
  envOverrides?: Record<string, string>;
}

export async function runClaudeTurn(input: ClaudeTurnInput): Promise<ProviderTurnResult> {
  const { stdout } = await runCliCommand({
    command: input.command,
    args: [
      '-p',
      '--model', input.model,
      '--output-format', 'json',
      '--json-schema', input.schemaJson,
      '--permission-mode', 'dontAsk',
      ...(input.systemPrompt ? ['--system-prompt', input.systemPrompt] : []),
      ...(input.argsTemplate ?? []),
      input.prompt,
    ],
    cwd: input.workdir,
    envOverrides: input.envOverrides,
  });

  return parseProviderResult(stdout);
}
