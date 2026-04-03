import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { exportBundle } from '../export/bundle.js';
import { createSecretStore } from './secret-store.js';
import { createTemplateStore } from './template-store.js';

describe('template store', () => {
  it('saves and reloads templates from disk', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-agent-templates-'));
    const store = createTemplateStore(root);

    await store.save({
      id: 'tpl-http',
      name: 'HTTP Builder',
      providerKind: 'openai_compatible_http',
      description: 'build things',
      defaultModel: 'gpt-5',
      systemPrompt: 'You are an operations agent.',
      toolPolicy: {
        cliEnabled: true,
        maxSteps: 8,
        maxToolCallsPerTurn: 3,
        commandWhitelist: ['summary', 'build'],
      },
      providerConfig: {
        baseUrl: 'https://example.invalid/v1',
        apiKeySecretId: 'sec-1',
        model: 'gpt-5',
        extraHeaders: {},
      },
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    });

    const templates = await store.list();
    assert.equal(templates.length, 1);
    assert.equal(templates[0]?.id, 'tpl-http');
  });
});

describe('secret store', () => {
  it('encrypts values at rest and decrypts them on read', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-agent-secrets-'));
    const store = createSecretStore(root);

    await store.save('sec-1', 'demo-key');
    const raw = await store.readRaw('sec-1');

    assert.match(raw, /encryptedValue/);
    assert.ok(!raw.includes('demo-key'));
    assert.equal(await store.readValue('sec-1'), 'demo-key');
  });
});

describe('bundle export', () => {
  it('omits encryptedSecrets by default', async () => {
    const bundle = exportBundle({
      templates: [{ id: 'tpl-http', name: 'HTTP Builder' }],
      includeSecrets: false,
      encryptedSecrets: [{ id: 'sec-1', ciphertext: 'abc' }],
    });

    assert.equal(bundle.encryptedSecrets, undefined);
  });
});
