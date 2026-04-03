import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { createGatewayServer } from './server.js';

describe('gateway server', () => {
  const servers: Array<{ close: () => Promise<void>; url: string }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('serves health and capabilities', async () => {
    const server = await createGatewayServer({
      dataRoot: '/tmp/sw-agent-gateway-test-1',
      port: 0,
    });
    servers.push(server);

    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const capabilities = await fetch(`${server.url}/capabilities`);
    assert.equal(capabilities.status, 200);
    assert.deepEqual(await capabilities.json(), {
      status: 'ok',
      providers: {
        openai_compatible_http: { available: true },
        codex_cli: { available: false, reason: 'not_probed' },
        claude_code_cli: { available: false, reason: 'not_probed' },
      },
    });
  });
});
