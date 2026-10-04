import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CreateProviderPayload, ModelProvider, ModelProviderView } from '@gw/shared/agent-gateway';

interface ProviderStore {
  list: () => Promise<ModelProvider[]>;
  get: (id: string) => Promise<ModelProvider | null>;
  save: (provider: ModelProvider) => Promise<void>;
}

interface SecretStore {
  save: (id: string, value: string) => Promise<void>;
}

interface ProviderRouteContext {
  providerStore: ProviderStore;
  secretStore: SecretStore;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
}

function sanitizeProvider(provider: ModelProvider): ModelProviderView {
  return {
    ...provider,
    providerConfig: 'apiKeySecretId' in provider.providerConfig
      ? {
          ...provider.providerConfig,
          hasSecret: Boolean(provider.providerConfig.apiKeySecretId),
        }
      : provider.providerConfig,
  };
}

export async function handleProviderRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: ProviderRouteContext,
) {
  const url = new URL(request.url ?? '/providers', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/providers') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify((await context.providerStore.list()).map(sanitizeProvider)));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/providers') {
    const payload = await readJsonBody<CreateProviderPayload>(request);
    const now = new Date().toISOString();
    const id = payload.id || randomUUID();
    // 未提交 apiKey 的配置（CLI provider、或沿用已有 secret 的 http_api）原样落盘
    let providerConfig = payload.providerConfig as ModelProvider['providerConfig'];

    if (
      payload.providerKind === 'http_api'
      && 'apiKey' in payload.providerConfig
      && typeof payload.providerConfig.apiKey === 'string'
      && payload.providerConfig.apiKey.trim() !== ''
    ) {
      const secretId = `provider-${id}-api-key`;
      await context.secretStore.save(secretId, payload.providerConfig.apiKey.trim());
      const { apiKey: _apiKey, ...rest } = payload.providerConfig;
      providerConfig = {
        ...rest,
        apiKeySecretId: secretId,
      };
    }

    const provider: ModelProvider = {
      id,
      name: payload.name,
      providerKind: payload.providerKind,
      description: payload.description ?? '',
      defaultModel: payload.defaultModel,
      systemPrompt: payload.systemPrompt ?? '',
      toolPolicy: payload.toolPolicy,
      providerConfig,
      createdAt: payload.createdAt ?? now,
      updatedAt: now,
    };

    await context.providerStore.save(provider);
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify(sanitizeProvider(provider)));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/providers/')) {
    const id = url.pathname.slice('/providers/'.length);
    const provider = await context.providerStore.get(id);
    if (!provider) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'provider_not_found' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(sanitizeProvider(provider)));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'provider_route_not_found' }));
}
