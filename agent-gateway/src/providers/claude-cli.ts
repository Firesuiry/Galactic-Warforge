import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseProviderResult } from './index.js';
import type { ProviderTurnResult } from './types.js';

const execFileAsync = promisify(execFile);

interface ClaudeTurnInput {
  command: string;
  model: string;
  prompt: string;
  schemaJson: string;
  systemPrompt?: string;
}

export async function runClaudeTurn(input: ClaudeTurnInput): Promise<ProviderTurnResult> {
  const { stdout } = await execFileAsync(
    input.command,
    [
      '-p',
      '--model', input.model,
      '--output-format', 'json',
      '--json-schema', input.schemaJson,
      '--permission-mode', 'dontAsk',
      '--tools', '',
      ...(input.systemPrompt ? ['--system-prompt', input.systemPrompt] : []),
      input.prompt,
    ],
    {
      maxBuffer: 1024 * 1024,
    },
  );

  return parseProviderResult(stdout.trim());
}
