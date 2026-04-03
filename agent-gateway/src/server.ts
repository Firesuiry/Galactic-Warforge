import { createServer } from 'node:http';

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
  const server = createServer((request, response) => {
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
