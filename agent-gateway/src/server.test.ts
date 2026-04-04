import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
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

  it('creates conversations, invites agents by planet, posts messages, and manages schedules', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-gateway-test-'));
    const server = await createGatewayServer({
      dataRoot,
      port: 0,
    });
    servers.push(server);

    const templateResponse = await fetch(`${server.url}/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'tpl-director',
        name: 'Director Template',
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
        templateId: 'tpl-director',
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
        templateId: 'tpl-director',
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

    await fetch(`${server.url}/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'tpl-director',
        name: 'Director Template',
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
        templateId: 'tpl-director',
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
});
