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

function isTransientCliError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('502')
    || message.includes('bad gateway')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('connection reset')
  );
}

export async function runCodexTurn(input: CodexTurnInput): Promise<ProviderTurnResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
    } catch (error) {
      if (attempt >= 2 || !isTransientCliError(error)) {
        throw error;
      }
    }
  }

  throw new Error('codex cli retry loop exhausted');
}
