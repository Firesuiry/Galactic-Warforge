import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';

const execFileAsync = promisify(execFile);

interface CodexTurnInput {
  command: string;
  model: string;
  prompt: string;
  schemaFile: string;
  workdir?: string;
}

export async function runCodexTurn(input: CodexTurnInput): Promise<ProviderTurnResult> {
  const { stdout } = await execFileAsync(
    input.command,
    [
      'exec',
      '--model', input.model,
      '--sandbox', 'read-only',
      '--ask-for-approval', 'never',
      '--skip-git-repo-check',
      ...(input.workdir ? ['--cd', input.workdir] : []),
      '--output-schema', input.schemaFile,
      '-',
    ],
    {
      input: input.prompt,
      maxBuffer: 1024 * 1024,
    },
  );

  return parseProviderResult(stdout.trim());
}
