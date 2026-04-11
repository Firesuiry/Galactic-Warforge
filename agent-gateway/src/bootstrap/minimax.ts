import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AGENT_ALLOWED_COMMANDS } from '../../../client-cli/src/command-catalog.js';
import type { ModelProvider } from '../types.js';

const BUILTIN_MINIMAX_PROVIDER_ID = 'builtin-minimax-api';
const BUILTIN_MINIMAX_SECRET_ID = 'provider-builtin-minimax-api-api-key';
const BUILTIN_MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1';
const BUILTIN_MINIMAX_MODEL = 'MiniMax-M2.1';

interface ProviderStore {
  get: (id: string) => Promise<ModelProvider | null>;
  save: (provider: ModelProvider) => Promise<void>;
}

interface SecretStore {
  save: (id: string, value: string) => Promise<void>;
}

interface EnsureBuiltinMiniMaxProviderInput {
  envFilePath?: string;
  providerStore: ProviderStore;
  secretStore: SecretStore;
}

export function extractMiniMaxApiKey(raw: string) {
  const patterns = [
    /(?:^|\n)\s*MINIMAX_API_KEY\s*=\s*["']?([^"'\n]+)["']?/i,
    /(?:^|\n)\s*MINIMAX_APIKEY\s*=\s*["']?([^"'\n]+)["']?/i,
    /(?:^|\n)\s*apikey\s*:\s*(\S+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

async function readOptionalText(filePath: string) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function resolveEnvCandidates(explicitPath?: string) {
  const candidates = [
    explicitPath,
    process.env.SW_AGENT_GATEWAY_ENV_FILE,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
  ].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)];
}

export async function ensureBuiltinMiniMaxProvider(input: EnsureBuiltinMiniMaxProviderInput) {
  const existing = await input.providerStore.get(BUILTIN_MINIMAX_PROVIDER_ID);
  if (existing) {
    return;
  }

  let envText: string | null = null;
  for (const candidate of resolveEnvCandidates(input.envFilePath)) {
    envText = await readOptionalText(candidate);
    if (envText) {
      break;
    }
  }

  if (!envText) {
    return;
  }

  const apiKey = extractMiniMaxApiKey(envText);
  if (!apiKey) {
    return;
  }

  await input.secretStore.save(BUILTIN_MINIMAX_SECRET_ID, apiKey);

  const now = new Date().toISOString();
  const provider: ModelProvider = {
    id: BUILTIN_MINIMAX_PROVIDER_ID,
    name: 'MiniMax API',
    providerKind: 'http_api',
    description: '启动时从仓库 .env 自动导入的 MiniMax API 模型 Provider。',
    defaultModel: BUILTIN_MINIMAX_MODEL,
    systemPrompt: '你是智能体成员。请直接在当前会话中回复，并保持结论清晰。',
    toolPolicy: {
      cliEnabled: true,
      maxSteps: 8,
      maxToolCallsPerTurn: 4,
      commandWhitelist: AGENT_ALLOWED_COMMANDS,
    },
    providerConfig: {
      apiUrl: BUILTIN_MINIMAX_BASE_URL,
      apiStyle: 'openai',
      apiKeySecretId: BUILTIN_MINIMAX_SECRET_ID,
      model: BUILTIN_MINIMAX_MODEL,
      extraHeaders: {},
    },
    createdAt: now,
    updatedAt: now,
  };

  await input.providerStore.save(provider);
}
