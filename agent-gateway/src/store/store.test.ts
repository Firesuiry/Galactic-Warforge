import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { exportBundle } from '../export/bundle.js';
import { createAgentStore } from './agent-store.js';
import { createConversationStore } from './conversation-store.js';
import { listJsonFiles, writeJsonFile } from './file-store.js';
import { createMessageStore } from './message-store.js';
import { createScheduleStore } from './schedule-store.js';
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

describe('file store', () => {
  it('keeps json reads stable during concurrent overwrites', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-agent-file-store-'));
    const fileName = 'race.json';
    await writeJsonFile(root, fileName, {
      id: 'race',
      revision: 0,
      content: 'seed',
    });

    const revisions = Array.from({ length: 24 }, (_, index) => index + 1);

    await Promise.all([
      (async () => {
        for (const revision of revisions) {
          await writeJsonFile(root, fileName, {
            id: 'race',
            revision,
            content: `payload-${revision}-${'x'.repeat(128 * 1024)}`,
          });
        }
      })(),
      (async () => {
        for (let index = 0; index < 240; index += 1) {
          const values = await listJsonFiles<{ id: string; revision: number; content: string }>(root);
          assert.equal(values.length, 1);
          assert.equal(values[0]?.id, 'race');
          assert.equal(typeof values[0]?.revision, 'number');
          assert.equal(typeof values[0]?.content, 'string');
        }
      })(),
    ]);
  });
});

describe('collaboration stores', () => {
  it('persists agent policies, conversations, messages, and schedules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-agent-collaboration-'));
    const agentStore = createAgentStore(path.join(root, 'agents'));
    const conversationStore = createConversationStore(path.join(root, 'conversations'));
    const messageStore = createMessageStore(path.join(root, 'messages'));
    const scheduleStore = createScheduleStore(path.join(root, 'schedules'));

    await agentStore.save({
      id: 'agent-director',
      name: '总管',
      templateId: 'tpl-1',
      serverUrl: 'http://127.0.0.1:18081',
      playerId: 'p1',
      playerKeySecretId: 'secret-1',
      status: 'idle',
      role: 'director',
      policy: {
        planetIds: ['planet-a'],
        commandCategories: ['observe', 'management'],
        canCreateChannel: true,
        canManageMembers: true,
        canInviteByPlanet: true,
        canCreateSchedules: true,
        canDirectMessageAgentIds: ['agent-builder'],
        canDispatchAgentIds: ['agent-builder'],
      },
      supervisorAgentIds: [],
      managedAgentIds: ['agent-builder'],
      activeConversationIds: ['conv-a'],
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    });

    await conversationStore.save({
      id: 'conv-a',
      workspaceId: 'workspace-default',
      type: 'channel',
      name: '星球A协作',
      topic: '协调建设',
      memberIds: ['player:p1', 'agent:agent-director'],
      createdByType: 'player',
      createdById: 'p1',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    });

    await messageStore.append({
      id: 'msg-a',
      conversationId: 'conv-a',
      senderType: 'player',
      senderId: 'p1',
      kind: 'chat',
      content: '@agent-director 检查星球A',
      mentions: [{ type: 'agent', id: 'agent-director' }],
      trigger: 'player_message',
      createdAt: '2026-04-03T00:00:00.000Z',
    });

    await scheduleStore.save({
      id: 'schedule-a',
      workspaceId: 'workspace-default',
      name: 'A星巡检',
      creatorType: 'player',
      creatorId: 'p1',
      targetType: 'conversation',
      targetId: 'conv-a',
      intervalSeconds: 300,
      messageTemplate: '@agent-director 每五分钟检查一次星球A',
      enabled: true,
      nextRunAt: '2026-04-03T00:05:00.000Z',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    });

    const agent = await agentStore.get('agent-director');
    const conversations = await conversationStore.list();
    const messages = await messageStore.listByConversation('conv-a');
    const schedules = await scheduleStore.list();

    assert.equal(agent?.policy.commandCategories[0], 'observe');
    assert.equal(conversations[0]?.name, '星球A协作');
    assert.equal(messages[0]?.mentions[0]?.id, 'agent-director');
    assert.equal(schedules[0]?.intervalSeconds, 300);
  });
});
