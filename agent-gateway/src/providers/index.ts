import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProviderProbeResult, ProviderTurnResult } from './types.js';

const execFileAsync = promisify(execFile);

function extractFirstJsonObject(raw: string) {
  const start = raw.indexOf('{');
  if (start < 0) {
    return raw.trim();
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return raw.trim();
}

function normalizeStructuredJsonText(raw: string) {
  let normalized = raw.trim();

  normalized = normalized.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (normalized.startsWith('```')) {
    normalized = normalized
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  if (normalized.includes('{')) {
    normalized = extractFirstJsonObject(normalized);
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

  if (!Array.isArray(normalized.actions)) {
    throw new Error('actions must be an array');
  }
  if (typeof normalized.done !== 'boolean') {
    throw new Error('done must be a boolean');
  }

  const assistantMessage = typeof normalized.assistantMessage === 'string'
    ? normalized.assistantMessage
    : normalized.actions.find((action) => action?.type === 'final_answer' && typeof action.message === 'string')?.message ?? '';

  return {
    ...normalized,
    assistantMessage,
  } as ProviderTurnResult;
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
