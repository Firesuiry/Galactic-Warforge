import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { createGatewayServer } from './server.js';

describe('gateway server', () => {
  const servers: Array<{ close: () => Promise<void>; url: string }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('serves health and capabilities', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
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

  it('exports templates and imports bundles', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
    });
    servers.push(server);

    const createResponse = await fetch(`${server.url}/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'HTTP Builder',
        providerKind: 'openai_compatible_http',
        description: 'template',
        defaultModel: 'gpt-5',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 4,
          maxToolCallsPerTurn: 2,
          commandWhitelist: [],
        },
        providerConfig: {
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'demo-key',
          model: 'gpt-5',
          extraHeaders: {},
        },
      }),
    });
    assert.equal(createResponse.status, 201);

    const exportResponse = await fetch(`${server.url}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includeSecrets: false }),
    });
    assert.equal(exportResponse.status, 200);
    const bundle = await exportResponse.json() as { templates: Array<{ name: string }> };
    assert.equal(bundle.templates.length, 1);
    assert.equal(bundle.templates[0]?.name, 'HTTP Builder');

    const importResponse = await fetch(`${server.url}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: { version: 1 },
        templates: [{
          id: 'tpl-imported',
          name: 'Imported Template',
          providerKind: 'codex_cli',
          description: '',
          defaultModel: 'gpt-5-codex',
          systemPrompt: 'Return JSON.',
          toolPolicy: {
            cliEnabled: true,
            maxSteps: 4,
            maxToolCallsPerTurn: 2,
            commandWhitelist: [],
          },
          providerConfig: {
            command: 'codex',
            model: 'gpt-5-codex',
            workdir: '/tmp',
            argsTemplate: [],
            envOverrides: {},
          },
          createdAt: '2026-04-03T00:00:00.000Z',
          updatedAt: '2026-04-03T00:00:00.000Z',
        }],
      }),
    });
    assert.equal(importResponse.status, 200);

    const templatesResponse = await fetch(`${server.url}/templates`);
    const templates = await templatesResponse.json() as Array<{ id: string }>;
    assert.equal(templates.length, 2);
    assert.ok(templates.some((template) => template.id === 'tpl-imported'));
  });
});
