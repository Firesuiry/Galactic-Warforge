import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AgentTemplate } from '../types.js';

interface TemplateStore {
  list: () => Promise<AgentTemplate[]>;
  get: (id: string) => Promise<AgentTemplate | null>;
  save: (template: AgentTemplate) => Promise<void>;
}

interface SecretStore {
  save: (id: string, value: string) => Promise<void>;
}

interface TemplateRouteContext {
  templateStore: TemplateStore;
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

function sanitizeTemplate(template: AgentTemplate) {
  return {
    ...template,
    providerConfig: 'apiKeySecretId' in template.providerConfig
      ? {
          ...template.providerConfig,
          hasSecret: Boolean(template.providerConfig.apiKeySecretId),
        }
      : template.providerConfig,
  };
}

export async function handleTemplateRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: TemplateRouteContext,
) {
  const url = new URL(request.url ?? '/templates', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/templates') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify((await context.templateStore.list()).map(sanitizeTemplate)));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/templates') {
    const payload = await readJsonBody<AgentTemplate & {
      providerConfig: Record<string, unknown> & { apiKey?: string };
    }>(request);
    const now = new Date().toISOString();
    const id = payload.id || randomUUID();
    let providerConfig: AgentTemplate['providerConfig'] = payload.providerConfig;

    if (payload.providerKind === 'openai_compatible_http' && typeof payload.providerConfig.apiKey === 'string') {
      const secretId = `tpl-${id}-api-key`;
      await context.secretStore.save(secretId, payload.providerConfig.apiKey);
      const { apiKey: _apiKey, ...rest } = payload.providerConfig;
      providerConfig = {
        ...rest,
        apiKeySecretId: secretId,
      } as AgentTemplate['providerConfig'];
    }

    const template: AgentTemplate = {
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

    await context.templateStore.save(template);
    response.writeHead(201, { 'content-type': 'application/json' });
    response.end(JSON.stringify(sanitizeTemplate(template)));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/templates/')) {
    const id = url.pathname.slice('/templates/'.length);
    const template = await context.templateStore.get(id);
    if (!template) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'template_not_found' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(sanitizeTemplate(template)));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'template_route_not_found' }));
}
