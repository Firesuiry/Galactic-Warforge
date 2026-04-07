import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProviderProbeResult, ProviderTurnResult } from './types.js';

const execFileAsync = promisify(execFile);

function normalizeStructuredJsonText(raw: string) {
  let normalized = raw.trim();

  normalized = normalized.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (normalized.startsWith('```')) {
    normalized = normalized
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  if (!(normalized.startsWith('{') && normalized.endsWith('}'))) {
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      normalized = normalized.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  return normalized;
}

export function parseProviderResult(raw: string): ProviderTurnResult {
  const parsed = JSON.parse(normalizeStructuredJsonText(raw)) as Partial<ProviderTurnResult> & {
    structured_output?: Partial<ProviderTurnResult>;
  };
  const normalized = typeof parsed.structured_output === 'object' && parsed.structured_output !== null
    ? parsed.structured_output
    : parsed;

  if (typeof normalized.assistantMessage !== 'string') {
    throw new Error('assistantMessage is required');
  }
  if (!Array.isArray(normalized.actions)) {
    throw new Error('actions must be an array');
  }
  if (typeof normalized.done !== 'boolean') {
    throw new Error('done must be a boolean');
  }

  return normalized as ProviderTurnResult;
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
