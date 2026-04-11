import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createSecretStore } from '../store/secret-store.js';
import { createProviderStore } from '../store/provider-store.js';
import { ensureBuiltinMiniMaxProvider, extractMiniMaxApiKey } from './minimax.js';

describe('minimax bootstrap', () => {
  it('extracts an api key from the current repo env note format', () => {
    const apiKey = extractMiniMaxApiKey(`1. minimax
apikey:sk-demo-value`);

    assert.equal(apiKey, 'sk-demo-value');
  });

  it('creates a builtin minimax provider from the env file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-agent-bootstrap-test-'));
    const envFile = path.join(root, '.env');
    await writeFile(envFile, '1. minimax\napikey:sk-demo-value\n', 'utf8');

    const providerStore = createProviderStore(path.join(root, 'providers'));
    const secretStore = createSecretStore(path.join(root, 'secrets'));

    await ensureBuiltinMiniMaxProvider({
      envFilePath: envFile,
      providerStore,
      secretStore,
    });

    const templates = await providerStore.list();
    assert.equal(templates.length, 1);
    assert.equal(templates[0]?.providerKind, 'http_api');
    assert.equal(templates[0]?.name, 'MiniMax API');
    assert.equal(templates[0]?.defaultModel, 'MiniMax-M2.1');
    assert.match(
      templates[0]?.systemPrompt ?? '',
      /assistantMessage.*actions.*done/i,
    );
    assert.match(
      templates[0]?.systemPrompt ?? '',
      /"actions":\[\],"done":true/,
    );
    assert.deepEqual(templates[0]?.providerConfig, {
      apiUrl: 'https://api.minimaxi.com/v1',
      apiStyle: 'openai',
      apiKeySecretId: 'provider-builtin-minimax-api-api-key',
      model: 'MiniMax-M2.1',
      extraHeaders: {},
    });

    const savedSecret = await secretStore.readValue('provider-builtin-minimax-api-api-key');
    assert.equal(savedSecret, 'sk-demo-value');
  });
});
