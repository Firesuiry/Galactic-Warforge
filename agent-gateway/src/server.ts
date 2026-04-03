import { createServer } from 'node:http';
import path from 'node:path';

import { exportBundle } from './export/bundle.js';
import { handleAgentRoutes } from './routes/agents.js';
import { handleTemplateRoutes } from './routes/templates.js';
import { createEventBus } from './runtime/events.js';
import { createAgentStore } from './store/agent-store.js';
import { createSecretStore } from './store/secret-store.js';
import { createTemplateStore } from './store/template-store.js';
import { createThreadStore } from './store/thread-store.js';
import type { GatewayCapabilities } from './types.js';

export interface GatewayServerHandle {
  url: string;
  close: () => Promise<void>;
}

export interface GatewayServerOptions {
  dataRoot: string;
  port: number;
}

function buildCapabilities(): GatewayCapabilities {
  return {
    status: 'ok',
    providers: {
      openai_compatible_http: { available: true },
      codex_cli: { available: false, reason: 'not_probed' },
      claude_code_cli: { available: false, reason: 'not_probed' },
    },
  };
}

export async function createGatewayServer(options: GatewayServerOptions): Promise<GatewayServerHandle> {
  const templateStore = createTemplateStore(path.join(options.dataRoot, 'templates'));
  const agentStore = createAgentStore(path.join(options.dataRoot, 'agents'));
  const threadStore = createThreadStore(path.join(options.dataRoot, 'threads'));
  const secretStore = createSecretStore(path.join(options.dataRoot, 'secrets'));
  const eventBus = createEventBus();

  async function readJsonBody<T>(request: import('node:http').IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(raw) as T;
  }

  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.url === '/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(buildCapabilities()));
      return;
    }

    if (request.url?.startsWith('/templates')) {
      await handleTemplateRoutes(request, response, {
        templateStore,
        secretStore,
      });
      return;
    }

    if (request.url?.startsWith('/agents')) {
      await handleAgentRoutes(request, response, {
        dataRoot: options.dataRoot,
        agentStore,
        templateStore,
        threadStore,
        secretStore,
        eventBus,
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/export') {
      const payload = await readJsonBody<{ includeSecrets?: boolean }>(request);
      const templates = await templateStore.list();
      const agents = await agentStore.list();
      const threads = await threadStore.list();

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ...exportBundle({
          templates,
          includeSecrets: Boolean(payload.includeSecrets),
          encryptedSecrets: [],
        }),
        agents,
        threads,
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/import') {
      const payload = await readJsonBody<{
        templates?: Array<Awaited<ReturnType<typeof templateStore.list>>[number]>;
        agents?: Array<Awaited<ReturnType<typeof agentStore.list>>[number]>;
        threads?: Array<Awaited<ReturnType<typeof threadStore.list>>[number]>;
      }>(request);

      await Promise.all((payload.templates ?? []).map((template) => templateStore.save(template)));
      await Promise.all((payload.agents ?? []).map((agent) => agentStore.save(agent)));
      await Promise.all((payload.threads ?? []).map((thread) => threadStore.save(thread)));

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        imported: {
          templates: payload.templates?.length ?? 0,
          agents: payload.agents?.length ?? 0,
          threads: payload.threads?.length ?? 0,
        },
      }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found', data_root: options.dataRoot }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('gateway server failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
