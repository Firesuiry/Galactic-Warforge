import { runCliCommand } from './cli-runner.js';
import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';

interface CodexTurnInput {
  command: string;
  model: string;
  prompt: string;
  schemaFile: string;
  workdir?: string;
  argsTemplate?: string[];
  envOverrides?: Record<string, string>;
}

export async function runCodexTurn(input: CodexTurnInput): Promise<ProviderTurnResult> {
  const { stdout } = await runCliCommand({
    command: input.command,
    args: [
      '-a', 'never',
      'exec',
      '--model', input.model,
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      ...(input.workdir ? ['--cd', input.workdir] : []),
      '--output-schema', input.schemaFile,
      ...(input.argsTemplate ?? []),
      input.prompt,
    ],
    cwd: input.workdir,
    envOverrides: input.envOverrides,
  });

  return parseProviderResult(stdout);
}
