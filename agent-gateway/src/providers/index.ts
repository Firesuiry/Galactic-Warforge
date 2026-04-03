import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProviderProbeResult, ProviderTurnResult } from './types.js';

const execFileAsync = promisify(execFile);

export function parseProviderResult(raw: string): ProviderTurnResult {
  const parsed = JSON.parse(raw) as Partial<ProviderTurnResult>;

  if (typeof parsed.assistantMessage !== 'string') {
    throw new Error('assistantMessage is required');
  }
  if (!Array.isArray(parsed.actions)) {
    throw new Error('actions must be an array');
  }
  if (typeof parsed.done !== 'boolean') {
    throw new Error('done must be a boolean');
  }

  return parsed as ProviderTurnResult;
}

export async function probeBinary(command: string, args: string[] = ['--help']): Promise<ProviderProbeResult> {
  try {
    await execFileAsync(command, args, { timeout: 5_000 });
    return { available: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, reason: message };
  }
}
