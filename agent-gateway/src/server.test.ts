import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, it } from 'node:test';

import { createGatewayServer } from './server.js';

describe('gateway server', () => {
  const servers: Array<{ close: () => Promise<void>; url: string }> = [];
  const helperServers: Array<{ close: () => Promise<void>; url: string }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    await Promise.all(helperServers.splice(0).map((server) => server.close()));
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
        providerId: 'provider-missing',
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
        assistantMessage: '收到，我马上同步当前安排。',
        actions: [{ type: 'final_answer', message: '收到，我马上同步当前安排。' }],
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
        name: '阿土',
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
        content: '@阿土 请同步当前安排',
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
    assert.match(messages[1]?.content ?? '', /同步当前安排/);
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
  assistantMessage: '准备回复这条私聊。',
  actions: [{ type: 'final_answer', message: '已收到你的私聊' }],
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

  it('appends a public system error message when a dm agent turn fails', async () => {
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
    let turns: Array<{ status: string; errorCode?: string; errorMessage?: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${server.url}/conversations/dm-helper/messages`);
      messages = await response.json() as Array<{ senderType: string; kind: string; content: string }>;
      const turnsResponse = await fetch(`${server.url}/conversations/dm-helper/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (messages.length >= 2 && turns[0]?.status === 'failed') {
        break;
      }
      await delay(50);
    }

    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.senderType, 'system');
    assert.equal(messages[1]?.kind, 'system');
    assert.match(messages[1]?.content ?? '', /助手/);
    assert.match(messages[1]?.content ?? '', /模型服务暂时不可用/);
    assert.doesNotMatch(messages[1]?.content ?? '', /provider upstream 502/i);
    assert.equal(turns[0]?.status, 'failed');
    assert.equal(turns[0]?.errorCode, 'provider_unavailable');
    assert.equal(turns[0]?.errorMessage, '模型服务暂时不可用，请稍后重试。');
  });

  it('supports case1 delegation: lisi creates hujing and dispatches mining construction', async () => {
    const fakeGameCommands: Array<Record<string, unknown>> = [];
    const fakeGameServer = createServer(async (request, response) => {
      if (request.method === 'POST' && request.url === '/commands') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fakeGameCommands.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          request_id: 'fake-build',
          accepted: true,
          commands: [
            { command_index: 0, status: 'accepted', code: 'OK', message: 'accepted for build' },
          ],
        }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    });
    await new Promise<void>((resolve) => fakeGameServer.listen(0, '127.0.0.1', () => resolve()));
    const address = fakeGameServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('fake game server failed to bind');
    }
    helperServers.push({
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve, reject) => {
        fakeGameServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    });

    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async ({ history }) => {
        const latestUserMessage = [...history].reverse().find((entry) => entry.role === 'user')?.content ?? '';
        if (latestUserMessage.includes('创建胡景')) {
          return {
            assistantMessage: '我会创建胡景并给他建筑权限。',
            actions: [
              {
                type: 'agent.create',
                id: 'agent-hujing',
                name: '胡景',
                role: 'worker',
                policy: {
                  commandCategories: ['build'],
                  planetIds: ['planet-1-1'],
                  canCreateAgents: false,
                  canCreateChannel: false,
                  canManageMembers: false,
                  canInviteByPlanet: false,
                  canCreateSchedules: false,
                  canDispatchAgentIds: [],
                  canDirectMessageAgentIds: [],
                },
              },
              { type: 'final_answer', message: '胡景已创建。' },
            ],
            done: true,
          };
        }

        if (latestUserMessage.includes('去新建一个矿场')) {
          return {
            assistantMessage: '收到，我去建造 mining_machine。',
            actions: [
              {
                type: 'game.command',
                command: 'build',
                args: { x: 5, y: 1, buildingType: 'mining_machine' },
              },
              { type: 'final_answer', message: '矿场已开始施工。' },
            ],
            done: true,
          };
        }

        if (latestUserMessage.includes('新建一个矿场')) {
          return {
            assistantMessage: '我会通知胡景去建矿场。',
            actions: [
              { type: 'conversation.ensure_dm', targetAgentId: 'agent-hujing' },
              { type: 'conversation.send_message', conversationId: 'dm-agent-lisi-agent-hujing', content: '去新建一个矿场，在 5 1 建造 mining_machine' },
              { type: 'final_answer', message: '已通知胡景。' },
            ],
            done: true,
          };
        }

        return {
          assistantMessage: '收到。',
          actions: [{ type: 'final_answer', message: '收到。' }],
          done: true,
        };
      },
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-case1',
        name: 'Case1 Provider',
        providerKind: 'codex_cli',
        description: 'case1',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 4,
          maxToolCallsPerTurn: 4,
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
    assert.equal(providerResponse.status, 201);

    const lisiResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-lisi',
        name: '李斯',
        providerId: 'provider-case1',
        serverUrl: helperServers[0]?.url,
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'director',
        policy: {
          planetIds: ['planet-1-1'],
          commandCategories: ['observe', 'build', 'combat', 'research', 'management'],
          canCreateAgents: true,
          canCreateChannel: true,
          canManageMembers: true,
          canInviteByPlanet: true,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(lisiResponse.status, 201);

    const dmResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'dm-player-lisi',
        type: 'dm',
        name: '与 李斯 私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-lisi'],
      }),
    });
    assert.equal(dmResponse.status, 201);

    const createHujingMessage = await fetch(`${server.url}/conversations/dm-player-lisi/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '创建胡景，并赋予其建筑权限',
      }),
    });
    assert.equal(createHujingMessage.status, 202);

    let agents: Array<{ id: string; name: string; policy?: { commandCategories?: string[] } }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${server.url}/agents`);
      agents = await response.json() as Array<{ id: string; name: string; policy?: { commandCategories?: string[] } }>;
      if (agents.some((agent) => agent.id === 'agent-hujing')) {
        break;
      }
      await delay(20);
    }

    const hujing = agents.find((agent) => agent.id === 'agent-hujing');
    assert.ok(hujing);
    assert.equal(hujing?.name, '胡景');
    assert.deepEqual(hujing?.policy?.commandCategories, ['build']);

    const delegateMessage = await fetch(`${server.url}/conversations/dm-player-lisi/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '新建一个矿场',
      }),
    });
    assert.equal(delegateMessage.status, 202);

    let dmMessages: Array<{ senderType: string; senderId: string; content: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${server.url}/conversations`);
      const conversations = await response.json() as Array<{ id: string; memberIds: string[] }>;
      const hujingDm = conversations.find((conversation) => (
        conversation.memberIds.includes('agent:agent-lisi')
        && conversation.memberIds.includes('agent:agent-hujing')
      ));
      if (!hujingDm) {
        await delay(20);
        continue;
      }

      const dmMessagesResponse = await fetch(`${server.url}/conversations/${hujingDm.id}/messages`);
      dmMessages = await dmMessagesResponse.json() as Array<{ senderType: string; senderId: string; content: string }>;
      if (dmMessages.some((message) => message.senderId === 'agent-hujing')) {
        break;
      }
      await delay(20);
    }

    assert.ok(
      dmMessages.some((message) => message.senderId === 'agent-lisi' && /矿场/.test(message.content)),
      JSON.stringify(dmMessages),
    );
    assert.ok(
      dmMessages.some((message) => message.senderId === 'agent-hujing' && /mining_machine|施工/.test(message.content)),
      JSON.stringify(dmMessages),
    );

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fakeGameCommands.length > 0) {
        break;
      }
      await delay(20);
    }
    assert.equal(fakeGameCommands.length, 1);

    const buildRequest = fakeGameCommands[0];
    const commands = Array.isArray(buildRequest?.commands) ? buildRequest.commands as Array<Record<string, unknown>> : [];
    assert.equal(commands[0]?.type, 'build');
    assert.equal((commands[0]?.payload as { building_type?: string } | undefined)?.building_type, 'mining_machine');
  });

  it('returns initial turns for player messages and binds final replies back to the original request', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async ({ history }) => {
        const latestUserMessage = [...history].reverse().find((entry) => entry.role === 'user')?.content ?? '';
        if (latestUserMessage.includes('第一条')) {
          await delay(40);
          return {
            assistantMessage: '正在处理第一条请求。',
            actions: [{ type: 'final_answer', message: '第一条已经处理完成。' }],
            done: true,
          };
        }

        return {
          assistantMessage: '正在处理第二条请求。',
          actions: [{ type: 'final_answer', message: '第二条已经处理完成。' }],
          done: true,
        };
      },
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-turns',
        name: 'Turn Provider',
        providerKind: 'codex_cli',
        description: 'turn test',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 2,
          maxToolCallsPerTurn: 4,
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
    assert.equal(providerResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-builder',
        name: '建造官',
        providerId: 'provider-turns',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-1-1'],
          commandCategories: ['build'],
          canCreateAgents: false,
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-turns',
        type: 'dm',
        name: '与建造官私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-builder'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const firstMessageResponse = await fetch(`${server.url}/conversations/conv-turns/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '第一条：请回复 alpha',
      }),
    });
    assert.equal(firstMessageResponse.status, 202);
    const firstAccepted = await firstMessageResponse.json() as {
      accepted: boolean;
      message: { id: string };
      turns: Array<{ id: string; requestMessageId: string; status: string }>;
    };
    assert.equal(firstAccepted.accepted, true);
    assert.equal(firstAccepted.turns.length, 1);
    assert.equal(firstAccepted.turns[0]?.requestMessageId, firstAccepted.message.id);

    const secondMessageResponse = await fetch(`${server.url}/conversations/conv-turns/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '第二条：请回复 beta',
      }),
    });
    assert.equal(secondMessageResponse.status, 202);
    const secondAccepted = await secondMessageResponse.json() as {
      accepted: boolean;
      message: { id: string };
      turns: Array<{ id: string; requestMessageId: string; status: string }>;
    };
    assert.equal(secondAccepted.accepted, true);
    assert.equal(secondAccepted.turns.length, 1);
    assert.equal(secondAccepted.turns[0]?.requestMessageId, secondAccepted.message.id);

    let turns: Array<{
      id: string;
      requestMessageId: string;
      status: string;
      assistantPreview?: string;
      finalMessageId?: string;
      outcomeKind?: string;
      executedActionCount?: number;
      repairCount?: number;
    }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turnsResponse = await fetch(`${server.url}/conversations/conv-turns/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (turns.length === 2 && turns.every((turn) => turn.status === 'succeeded')) {
        break;
      }
      await delay(20);
    }

    assert.equal(turns.length, 2);
    assert.ok(turns.every((turn) => turn.status === 'succeeded'));
    assert.match(turns[0]?.assistantPreview ?? '', /正在处理/);
    assert.ok(turns.every((turn) => turn.outcomeKind === 'reply_only'));
    assert.ok(turns.every((turn) => turn.executedActionCount === 0));
    assert.ok(turns.every((turn) => turn.repairCount === 0));

    const messagesResponse = await fetch(`${server.url}/conversations/conv-turns/messages`);
    const messages = await messagesResponse.json() as Array<{
      id: string;
      senderType: string;
      content: string;
      replyToMessageId?: string;
      turnId?: string;
    }>;

    const finalReplies = messages.filter((message) => message.senderType === 'agent');
    assert.equal(finalReplies.length, 2);
    assert.ok(finalReplies.some((message) => (
      message.content.includes('第一条已经处理完成')
      && message.replyToMessageId === firstAccepted.message.id
      && message.turnId === firstAccepted.turns[0]?.id
    )));
    assert.ok(finalReplies.some((message) => (
      message.content.includes('第二条已经处理完成')
      && message.replyToMessageId === secondAccepted.message.id
      && message.turnId === secondAccepted.turns[0]?.id
    )));
  });

  it('accepts assistantMessage-only completion and binds the formal reply back to the request', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => ({
        assistantMessage: '已收到你的私聊',
        actions: [{}],
        done: true,
      }),
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-no-final-answer',
        name: 'No Final Answer Provider',
        providerKind: 'codex_cli',
        description: 'missing final answer test',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 1,
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
    assert.equal(providerResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-no-final-answer',
        name: '最小回复测试成员',
        providerId: 'provider-no-final-answer',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-1-1'],
          commandCategories: ['observe'],
          canCreateAgents: false,
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-no-final-answer',
        type: 'dm',
        name: '与最小回复测试成员私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-no-final-answer'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const messageResponse = await fetch(`${server.url}/conversations/conv-no-final-answer/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '你好',
      }),
    });
    assert.equal(messageResponse.status, 202);
    const accepted = await messageResponse.json() as {
      message: { id: string };
      turns: Array<{ id: string }>;
    };

    let turns: Array<{
      id: string;
      status: string;
      assistantPreview?: string;
      finalMessageId?: string;
      outcomeKind?: string;
      executedActionCount?: number;
      repairCount?: number;
      errorCode?: string;
      errorMessage?: string;
    }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turnsResponse = await fetch(`${server.url}/conversations/conv-no-final-answer/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (turns.length === 1 && turns[0]?.status === 'succeeded') {
        break;
      }
      await delay(20);
    }

    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.status, 'succeeded');
    assert.equal(turns[0]?.assistantPreview, '已收到你的私聊');
    assert.ok(turns[0]?.finalMessageId);
    assert.equal(turns[0]?.outcomeKind, 'reply_only');
    assert.equal(turns[0]?.executedActionCount, 0);
    assert.equal(turns[0]?.repairCount, 0);
    assert.equal(turns[0]?.errorCode, undefined);

    const messagesResponse = await fetch(`${server.url}/conversations/conv-no-final-answer/messages`);
    const messages = await messagesResponse.json() as Array<{
      id: string;
      senderType: string;
      content: string;
      replyToMessageId?: string;
      turnId?: string;
    }>;

    const agentReplies = messages.filter((message) => message.senderType === 'agent');
    assert.equal(agentReplies.length, 1);
    assert.equal(agentReplies[0]?.content, '已收到你的私聊');
    assert.equal(agentReplies[0]?.id, turns[0]?.finalMessageId);
    assert.equal(agentReplies[0]?.replyToMessageId, accepted.message.id);
    assert.equal(agentReplies[0]?.turnId, accepted.turns[0]?.id);
    assert.equal(messages.filter((message) => message.senderType === 'system').length, 0);
  });

  it('persists raw schema errors and actionable hints when command args are incomplete', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => ({
        assistantMessage: '开始装料。',
        actions: [
          {
            type: 'game.command',
            command: 'transfer_item',
            args: {
              itemId: 'electromagnetic_matrix',
              quantity: 10,
            },
          },
        ],
        done: true,
      }),
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-invalid-transfer',
        name: 'Invalid Transfer Provider',
        providerKind: 'codex_cli',
        description: 'invalid transfer test',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 1,
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
    assert.equal(providerResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-invalid-transfer',
        name: '科研官',
        providerId: 'provider-invalid-transfer',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-1-1'],
          commandCategories: ['research'],
          canCreateAgents: false,
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-invalid-transfer',
        type: 'dm',
        name: '与科研官私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-invalid-transfer'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const messageResponse = await fetch(`${server.url}/conversations/conv-invalid-transfer/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '把 10 个 electromagnetic_matrix 装入 b-9',
      }),
    });
    assert.equal(messageResponse.status, 202);

    let turns: Array<{
      status: string;
      errorCode?: string;
      errorMessage?: string;
      rawErrorMessage?: string;
      errorHint?: string;
    }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turnsResponse = await fetch(`${server.url}/conversations/conv-invalid-transfer/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (turns[0]?.status === 'failed') {
        break;
      }
      await delay(20);
    }

    assert.equal(turns[0]?.status, 'failed');
    assert.equal(turns[0]?.errorCode, 'provider_schema_invalid');
    assert.equal(turns[0]?.errorMessage, '模型返回结构无效，请稍后重试。');
    assert.equal(turns[0]?.rawErrorMessage, 'transfer_item requires buildingId');
    assert.match(turns[0]?.errorHint ?? '', /缺少目标建筑 ID/);
    assert.match(turns[0]?.errorHint ?? '', /b-9/);
  });

  it('persists loop exhaustion as a real failure cause instead of permission denied', async () => {
    let scanCommandCount = 0;
    const fakeGameServer = createServer(async (request, response) => {
      if (request.method === 'POST' && request.url === '/commands') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        scanCommandCount += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          request_id: `scan-${scanCommandCount}`,
          accepted: true,
          commands: [
            { command_index: 0, status: 'accepted', code: 'OK', message: 'accepted for scan' },
          ],
        }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    });
    await new Promise<void>((resolve) => fakeGameServer.listen(0, '127.0.0.1', () => resolve()));
    const address = fakeGameServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('fake game server failed to bind');
    }
    helperServers.push({
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve, reject) => {
        fakeGameServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    });

    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => ({
        assistantMessage: '我先持续观察 planet-1-2。',
        actions: [
          {
            type: 'game.command',
            command: 'scan_planet',
            args: {
              planetId: 'planet-1-2',
            },
          },
        ],
        done: false,
      }),
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-loop-exhausted',
        name: 'Loop Exhausted Provider',
        providerKind: 'codex_cli',
        description: 'loop exhausted test',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 2,
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
    assert.equal(providerResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-loop-observer',
        name: '观察官',
        providerId: 'provider-loop-exhausted',
        serverUrl: helperServers[0]?.url,
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-1-2'],
          commandCategories: ['observe'],
          canCreateAgents: false,
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-loop-exhausted',
        type: 'dm',
        name: '与观察官私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-loop-observer'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const messageResponse = await fetch(`${server.url}/conversations/conv-loop-exhausted/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '观察 planet-1-2，并告诉我结果',
      }),
    });
    assert.equal(messageResponse.status, 202);
    const accepted = await messageResponse.json() as {
      message: { id: string };
      turns: Array<{ id: string }>;
    };

    let turns: Array<{
      requestMessageId: string;
      status: string;
      errorCode?: string;
      errorMessage?: string;
      rawErrorMessage?: string;
      errorHint?: string;
    }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turnsResponse = await fetch(`${server.url}/conversations/conv-loop-exhausted/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (turns[0]?.status === 'failed') {
        break;
      }
      await delay(20);
    }

    assert.equal(scanCommandCount, 2);
    assert.equal(turns[0]?.requestMessageId, accepted.message.id);
    assert.equal(turns[0]?.status, 'failed');
    assert.equal(turns[0]?.errorCode, 'loop_exhausted');
    assert.equal(turns[0]?.errorMessage, '智能体在最大步数内未完成任务。');
    assert.equal(turns[0]?.rawErrorMessage, 'agent loop exceeded maxSteps');
    assert.match(turns[0]?.errorHint ?? '', /最大步数/);

    const messagesResponse = await fetch(`${server.url}/conversations/conv-loop-exhausted/messages`);
    const messages = await messagesResponse.json() as Array<{
      senderType: string;
      content: string;
      replyToMessageId?: string;
      turnId?: string;
    }>;
    const failureMessage = messages.find((message) => message.senderType === 'system');
    assert.ok(failureMessage);
    assert.match(failureMessage?.content ?? '', /最大步数内未完成任务/);
    assert.doesNotMatch(failureMessage?.content ?? '', /权限不足/);
    assert.equal(failureMessage?.replyToMessageId, accepted.message.id);
    assert.equal(failureMessage?.turnId, accepted.turns[0]?.id);
  });

  it('completes research delegation by executing transfer_item before start_research', async () => {
    const gameCommands: Array<Record<string, unknown>> = [];
    const fakeGameServer = createServer(async (request, response) => {
      if (request.method === 'POST' && request.url === '/commands') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        gameCommands.push(payload);
        const command = (payload.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
        const commandType = String(command.type ?? 'unknown');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          request_id: `req-${gameCommands.length}`,
          accepted: true,
          commands: [
            { command_index: 0, status: 'accepted', code: 'OK', message: `${commandType} accepted` },
          ],
        }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    });
    await new Promise<void>((resolve) => fakeGameServer.listen(0, '127.0.0.1', () => resolve()));
    const address = fakeGameServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('fake game server failed to bind');
    }
    helperServers.push({
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve, reject) => {
        fakeGameServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    });

    let attempts = 0;
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            assistantMessage: '先把矩阵装入研究站。',
            actions: [
              {
                type: 'game.command',
                command: 'transfer_item',
                args: {
                  buildingId: 'b-27',
                  itemId: 'electromagnetic_matrix',
                  quantity: 10,
                },
              },
            ],
            done: false,
          };
        }
        if (attempts === 2) {
          return {
            assistantMessage: '继续启动科研。',
            actions: [
              {
                type: 'game.command',
                command: 'start_research',
                args: {
                  techId: 'basic_logistics_system',
                },
              },
            ],
            done: false,
          };
        }
        return {
          assistantMessage: '已把 10 个 electromagnetic_matrix 装入 b-27，并启动 basic_logistics_system 研究。',
          actions: [],
          done: true,
        };
      },
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-research-flow',
        name: 'Research Flow Provider',
        providerKind: 'codex_cli',
        description: 'research flow test',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 4,
          maxToolCallsPerTurn: 4,
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
    assert.equal(providerResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-researcher',
        name: '科研官',
        providerId: 'provider-research-flow',
        serverUrl: helperServers[0]?.url,
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'worker',
        policy: {
          planetIds: ['planet-1-1'],
          commandCategories: ['research'],
          canCreateAgents: false,
          canCreateChannel: false,
          canManageMembers: false,
          canInviteByPlanet: false,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-research-flow',
        type: 'dm',
        name: '与科研官私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-researcher'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const messageResponse = await fetch(`${server.url}/conversations/conv-research-flow/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '在 planet-1-1 把 10 个 electromagnetic_matrix 装入 b-27，然后启动 basic_logistics_system 研究。',
      }),
    });
    assert.equal(messageResponse.status, 202);
    const accepted = await messageResponse.json() as {
      message: { id: string };
      turns: Array<{ id: string }>;
    };

    let turns: Array<{
      status: string;
      finalMessageId?: string;
      outcomeKind?: string;
      executedActionCount?: number;
      errorCode?: string;
    }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turnsResponse = await fetch(`${server.url}/conversations/conv-research-flow/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (turns[0]?.status === 'succeeded') {
        break;
      }
      await delay(20);
    }

    assert.equal(turns[0]?.status, 'succeeded');
    assert.equal(turns[0]?.outcomeKind, 'acted');
    assert.equal(turns[0]?.executedActionCount, 2);
    assert.ok(turns[0]?.finalMessageId);
    assert.equal(turns[0]?.errorCode, undefined);
    assert.equal(gameCommands.length, 2);

    const firstCommand = (gameCommands[0]?.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    const secondCommand = (gameCommands[1]?.commands as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
    assert.equal(firstCommand.type, 'transfer_item');
    assert.deepEqual(firstCommand.payload, {
      building_id: 'b-27',
      item_id: 'electromagnetic_matrix',
      quantity: 10,
    });
    assert.equal(secondCommand.type, 'start_research');
    assert.deepEqual(secondCommand.payload, {
      tech_id: 'basic_logistics_system',
    });

    const messagesResponse = await fetch(`${server.url}/conversations/conv-research-flow/messages`);
    const messages = await messagesResponse.json() as Array<{
      id: string;
      senderType: string;
      content: string;
      replyToMessageId?: string;
      turnId?: string;
    }>;
    const finalReply = messages.find((message) => message.id === turns[0]?.finalMessageId);
    assert.ok(finalReply);
    assert.match(finalReply?.content ?? '', /已把 10 个 electromagnetic_matrix 装入 b-27/);
    assert.match(finalReply?.content ?? '', /basic_logistics_system/);
    assert.equal(finalReply?.replyToMessageId, accepted.message.id);
    assert.equal(finalReply?.turnId, accepted.turns[0]?.id);
  });

  it('fails the turn when agent.create exceeds creator policy and keeps the failure bound to the request', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async () => ({
        assistantMessage: '我来创建胡景。',
        actions: [
          {
            type: 'agent.create',
            name: '胡景',
            policy: {
              planetIds: ['planet-1-1', 'planet-1-2'],
              commandCategories: ['build', 'research'],
            },
          },
        ],
        done: true,
      }),
    });
    servers.push(server);

    const providerResponse = await fetch(`${server.url}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-invalid-create',
        name: 'Invalid Create Provider',
        providerKind: 'codex_cli',
        description: 'invalid create test',
        defaultModel: 'gpt-5-codex',
        systemPrompt: 'Return JSON.',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 1,
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
    assert.equal(providerResponse.status, 201);

    const agentResponse = await fetch(`${server.url}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'agent-director',
        name: '总管',
        providerId: 'provider-invalid-create',
        serverUrl: 'http://127.0.0.1:18081',
        playerId: 'p1',
        playerKey: 'key_player_1',
        role: 'director',
        policy: {
          planetIds: ['planet-1-1'],
          commandCategories: ['observe', 'build', 'management'],
          canCreateAgents: true,
          canCreateChannel: true,
          canManageMembers: true,
          canInviteByPlanet: true,
          canCreateSchedules: false,
          canDirectMessageAgentIds: [],
          canDispatchAgentIds: [],
        },
      }),
    });
    assert.equal(agentResponse.status, 201);

    const conversationResponse = await fetch(`${server.url}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conv-invalid-create',
        type: 'dm',
        name: '与总管私聊',
        topic: '',
        createdByType: 'player',
        createdById: 'p1',
        memberIds: ['player:p1', 'agent:agent-director'],
      }),
    });
    assert.equal(conversationResponse.status, 201);

    const messageResponse = await fetch(`${server.url}/conversations/conv-invalid-create/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        senderType: 'player',
        senderId: 'p1',
        content: '创建胡景',
      }),
    });
    assert.equal(messageResponse.status, 202);
    const accepted = await messageResponse.json() as {
      message: { id: string };
      turns: Array<{ id: string }>;
    };

    let turns: Array<{
      id: string;
      requestMessageId: string;
      status: string;
      errorCode?: string;
      errorMessage?: string;
    }> = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const turnsResponse = await fetch(`${server.url}/conversations/conv-invalid-create/turns`);
      turns = await turnsResponse.json() as typeof turns;
      if (turns[0]?.status === 'failed') {
        break;
      }
      await delay(20);
    }

    assert.equal(turns[0]?.requestMessageId, accepted.message.id);
    assert.equal(turns[0]?.status, 'failed');
    assert.equal(turns[0]?.errorCode, 'permission_denied');
    assert.equal(turns[0]?.errorMessage, '当前智能体权限不足，无法执行该操作。');

    const messagesResponse = await fetch(`${server.url}/conversations/conv-invalid-create/messages`);
    const messages = await messagesResponse.json() as Array<{
      senderType: string;
      content: string;
      replyToMessageId?: string;
      turnId?: string;
    }>;
    const failureMessage = messages.find((message) => message.senderType === 'system');
    assert.ok(failureMessage);
    assert.match(failureMessage?.content ?? '', /当前智能体权限不足/);
    assert.doesNotMatch(failureMessage?.content ?? '', /complete policy/i);
    assert.equal(failureMessage?.replyToMessageId, accepted.message.id);
    assert.equal(failureMessage?.turnId, accepted.turns[0]?.id);

    const agentsResponse = await fetch(`${server.url}/agents`);
    const agents = await agentsResponse.json() as Array<{ id: string }>;
    assert.equal(agents.some((agent) => agent.id === 'agent-hujing'), false);
  });
});
