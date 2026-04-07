import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
        http_api: { available: true },
        codex_cli: { available: false, reason: 'not_probed' },
        claude_code_cli: { available: false, reason: 'not_probed' },
      },
    });
  });

  it('exports providers and imports bundles', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
    });
    servers.push(server);

    const createResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'HTTP Builder',
        providerKind: 'http_api',
        description: 'provider',
        defaultModel: 'gpt-5',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 4,
          maxToolCallsPerTurn: 2,
          commandWhitelist: [],
        },
        providerConfig: {
          apiUrl: 'https://example.invalid/v1',
          apiStyle: 'openai',
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
    const bundle = await exportResponse.json() as { providers: Array<{ name: string }> };
    assert.equal(bundle.providers.length, 1);
    assert.equal(bundle.providers[0]?.name, 'HTTP Builder');

    const importResponse = await fetch(`${server.url}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: { version: 1 },
        providers: [{
          id: 'provider-imported',
          name: 'Imported Provider',
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

    const templatesResponse = await fetch(`${server.url}/providers`);
    const templates = await templatesResponse.json() as Array<{ id: string }>;
    assert.equal(templates.length, 2);
    assert.ok(templates.some((template) => template.id === 'provider-imported'));
  });

  it('creates conversations, invites agents by planet, posts messages, and manages schedules', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
    });
    servers.push(server);

    const templateResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-director',
        name: 'Director Provider',
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
      }),
    });
    assert.equal(templateResponse.status, 201);

    const directorResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-director',
        name: '总管',
        providerId: 'provider-director',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
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
        managedAgentIds: ['agent-builder'],
      }),
    });
    assert.equal(directorResponse.status, 201);

    const builderResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-builder',
        name: '建造官',
        providerId: 'provider-director',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-a'],
          commandCategories: ['build'],
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(builderResponse.status, 201);

    const updateAgentResponse = await fetch(`${server.url}/agents/agent-builder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'provider-director',
      }),
    });
    assert.equal(updateAgentResponse.status, 200);
    const updatedAgent = await updateAgentResponse.json() as { providerId: string };
    assert.equal(updatedAgent.providerId, 'provider-director');

    const createConversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-a',
        type: 'channel',
        name: '星球A协作',
        topic: '协调建设',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-director'],
      }),
    });
    assert.equal(createConversationResponse.status, 201);

    const addMembersResponse = await fetch(`${server.url}/conversations/conv-a/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actorType: 'player',
        actorId: 'p1',
        memberIds: ['agent:agent-builder'],
      }),
    });
    assert.equal(addMembersResponse.status, 200);
    const addedMembers = await addMembersResponse.json() as { memberIds: string[] };
    assert.ok(addedMembers.memberIds.includes('agent:agent-builder'));

    const inviteResponse = await fetch(`${server.url}/conversations/conv-a/members/invite-by-planet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actorType: 'player',
        actorId: 'p1',
        planetId: 'planet-a',
      }),
    });
    assert.equal(inviteResponse.status, 200);
    const invitedMembers = await inviteResponse.json() as { memberIds: string[] };
    assert.ok(invitedMembers.memberIds.includes('agent:agent-builder'));

    const messageResponse = await fetch(`${server.url}/conversations/conv-a/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '@建造官 检查星球A产线',
      }),
    });
    assert.equal(messageResponse.status, 202);

    const messagesResponse = await fetch(`${server.url}/conversations/conv-a/messages`);
    assert.equal(messagesResponse.status, 200);
    const messages = await messagesResponse.json() as Array<{ mentions: Array<{ id: string }> }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.mentions[0]?.id, 'agent-builder');

    const scheduleResponse = await fetch(`${server.url}/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'schedule-a',
        ownerAgentId: 'agent-director',
        creatorType: 'player',
        creatorId: 'p1',
        targetType: 'conversation',
        targetId: 'conv-a',
        intervalSeconds: 300,
        messageTemplate: '@总管 每5分钟检查一次星球A',
      }),
    });
    assert.equal(scheduleResponse.status, 201);

    const updateScheduleResponse = await fetch(`${server.url}/schedules/schedule-a`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intervalSeconds: 600,
        enabled: false,
      }),
    });
    assert.equal(updateScheduleResponse.status, 200);
    const updatedSchedule = await updateScheduleResponse.json() as {
      ownerAgentId: string;
      enabled: boolean;
      intervalSeconds: number;
    };
    assert.equal(updatedSchedule.ownerAgentId, 'agent-director');
    assert.equal(updatedSchedule.enabled, false);
    assert.equal(updatedSchedule.intervalSeconds, 600);

    const schedulesResponse = await fetch(`${server.url}/schedules`);
    assert.equal(schedulesResponse.status, 200);
    const schedules = await schedulesResponse.json() as Array<{ id: string; ownerAgentId: string; enabled: boolean }>;
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0]?.id, 'schedule-a');
    assert.equal(schedules[0]?.ownerAgentId, 'agent-director');
    assert.equal(schedules[0]?.enabled, false);
  });

  it('automatically wakes a mentioned agent and appends its reply to the conversation', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => ({
        assistantMessage: '收到，我现在检查星球A产线。',
        actions: [{ type: 'final_answer', message: '收到，我现在检查星球A产线。' }],
        done: true,
      }),
    });
    servers.push(server);

    await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-director',
        name: 'Director Provider',
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
      }),
    });

    await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-builder',
        name: '建造官',
        providerId: 'provider-director',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-a'],
          commandCategories: ['build'],
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });

    await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-a',
        type: 'channel',
        name: '星球A协作',
        topic: '协调建设',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-builder'],
      }),
    });

    const postMessage = await fetch(`${server.url}/conversations/conv-a/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '@建造官 检查星球A产线',
      }),
    });
    assert.equal(postMessage.status, 202);

    let messages: Array<{ senderType: string; senderId: string; content: string }> = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const messagesResponse = await fetch(`${server.url}/conversations/conv-a/messages`);
      messages = await messagesResponse.json() as Array<{ senderType: string; senderId: string; content: string }>;
      if (messages.length >= 2) {
        break;
      }
      await delay(20);
    }

    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.senderType, 'agent');
    assert.equal(messages[1]?.senderId, 'agent-builder');
    assert.match(messages[1]?.content ?? '', /检查星球A产线/);
  });

  it('auto replies in dm conversations through the codex cli provider', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const capturePath = path.join(tempDir, 'codex-capture.json');
    const fakeCodexPath = path.join(tempDir, 'fake-codex.js');
    await writeFile(fakeCodexPath, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const execIndex = args.indexOf('exec');
if (execIndex <= 0) {
  console.error('missing exec subcommand or approval flags before exec');
  process.exit(2);
}
if (args.includes('--ask-for-approval')) {
  console.error('unexpected legacy approval flag position');
  process.exit(2);
}
if (args.at(-1) === '-') {
  console.error('prompt must be passed as an argument');
  process.exit(2);
}
if (!(args.includes('-a') && args[args.indexOf('-a') + 1] === 'never')) {
  console.error('missing root approval policy');
  process.exit(2);
}
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args,
  cwd: process.cwd(),
  testFlag: process.env.TEST_FLAG ?? '',
}));
process.stdout.write(JSON.stringify({
  assistantMessage: '已收到你的私聊',
  actions: [],
  done: true,
}));
`);
    await chmod(fakeCodexPath, 0o755);

    const server = await createGatewayServer({
      dataRoot: tempDir,
      port: 0,
    });
    servers.push(server);

    const templateResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-codex',
        name: 'Codex Worker',
        providerKind: 'codex_cli',
        description: 'codex template',
        defaultModel: 'gpt-5-codex',
        systemPrompt: '请直接回复消息。',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 2,
          maxToolCallsPerTurn: 1,
          commandWhitelist: [],
        },
        providerConfig: {
          command: fakeCodexPath,
          model: 'gpt-5-codex',
          workdir: tempDir,
          argsTemplate: ['--profile', 'test-profile'],
          envOverrides: {
            CAPTURE_PATH: capturePath,
            TEST_FLAG: 'codex-ok',
          },
        },
      }),
    });
    assert.equal(templateResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-helper',
        name: '助手',
        providerId: 'provider-codex',
        serverUrl: 'http://127.0.0.1:18080',
        playerId: 'p1',
        playerKey: 'key_player_1',
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'dm-helper',
        type: 'dm',
        name: '与 助手 私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-helper'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const sendResponse = await fetch(`${server.url}/conversations/dm-helper/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '你好',
      }),
    });
    assert.equal(sendResponse.status, 202);

    let messages: Array<{ senderType: string; content: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${server.url}/conversations/dm-helper/messages`);
      messages = await response.json() as Array<{ senderType: string; content: string }>;
      if (messages.length >= 2) {
        break;
      }
      await delay(50);
    }

    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.senderType, 'agent');
    assert.equal(messages[1]?.content, '已收到你的私聊');

    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      args: string[];
      cwd: string;
      testFlag: string;
    };
    assert.equal(capture.cwd, tempDir);
    assert.equal(capture.testFlag, 'codex-ok');
    assert.ok(capture.args.includes('-a'));
    assert.ok(capture.args.includes('never'));
    assert.ok(capture.args.includes('exec'));
    assert.ok(capture.args.includes('--profile'));
    assert.ok(capture.args.includes('test-profile'));
    assert.ok(!capture.args.includes('--ask-for-approval'));
    assert.ok(capture.args.at(-1)?.includes('历史对话'));
  });

  it('appends a visible system error message when a dm agent turn fails', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => {
        throw new Error('provider upstream 502');
      },
    });
    servers.push(server);

    const templateResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-codex',
        name: 'Codex Worker',
        providerKind: 'codex_cli',
        description: 'codex template',
        defaultModel: 'gpt-5-codex',
        systemPrompt: '请直接回复消息。',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 2,
          maxToolCallsPerTurn: 1,
          commandWhitelist: [],
        },
        providerConfig: {
          command: 'codex',
          model: 'gpt-5-codex',
          workdir: dataRoot,
          argsTemplate: [],
          envOverrides: {},
        },
      }),
    });
    assert.equal(templateResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-helper',
        name: '助手',
        providerId: 'provider-codex',
        serverUrl: 'http://127.0.0.1:18080',
        playerId: 'p1',
        playerKey: 'key_player_1',
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'dm-helper',
        type: 'dm',
        name: '与 助手 私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-helper'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const sendResponse = await fetch(`${server.url}/conversations/dm-helper/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '你好',
      }),
    });
    assert.equal(sendResponse.status, 202);

    let messages: Array<{ senderType: string; kind: string; content: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${server.url}/conversations/dm-helper/messages`);
      messages = await response.json() as Array<{ senderType: string; kind: string; content: string }>;
      if (messages.length >= 2) {
        break;
      }
      await delay(50);
    }

    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.senderType, 'system');
    assert.equal(messages[1]?.kind, 'system');
    assert.match(messages[1]?.content ?? '', /助手/);
    assert.match(messages[1]?.content ?? '', /provider upstream 502/);
  });
});
