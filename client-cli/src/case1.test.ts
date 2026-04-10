import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, it } from 'node:test';

import { createGatewayServer } from '../../agent-gateway/src/server.js';
import { setAuth, setServerUrl } from './api.js';
import { dispatch } from './commands/index.js';

describe('case1 cli flow', () => {
  const servers: Array<{ close: () => Promise<void>; url: string }> = [];
  const previousGateway = process.env.SW_AGENT_GATEWAY;

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    if (previousGateway === undefined) {
      delete process.env.SW_AGENT_GATEWAY;
    } else {
      process.env.SW_AGENT_GATEWAY = previousGateway;
    }
  });

  it('creates lisi, lets lisi create hujing, and delegates mining through cli commands', async () => {
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
          enqueue_tick: 1,
          results: [
            { command_index: 0, status: 'accepted', code: 'OK', message: 'accepted for build' },
          ],
        }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    });
    await new Promise<void>((resolve) => fakeGameServer.listen(0, '127.0.0.1', () => resolve()));
    const gameAddress = fakeGameServer.address();
    if (!gameAddress || typeof gameAddress === 'string') {
      throw new Error('fake game server failed to bind');
    }
    servers.push({
      url: `http://127.0.0.1:${gameAddress.port}`,
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

    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-cli-case1-'));
    const gateway = await createGatewayServer({
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
              { type: 'game.cli', commandLine: 'build 5 1 mining_machine' },
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
    servers.push(gateway);

    process.env.SW_AGENT_GATEWAY = gateway.url;
    setServerUrl(servers[0]!.url);
    setAuth('p1', 'key_player_1');

    const providerResponse = await fetch(`${gateway.url}/providers`, {
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

    const context = { currentPlayer: 'p1', rl: {} as never };
    const createOutput = await dispatch(
      'agent_create 李斯 --id agent-lisi --provider provider-case1 --role director --can-create-agents true --command-categories observe,build,combat,research,management --planet-ids planet-1-1',
      context,
    );
    assert.match(createOutput, /Created agent agent-lisi/);

    const createChildOutput = await dispatch('agent_message agent-lisi 创建胡景，并赋予其建筑权限', context);
    assert.match(createChildOutput, /Accepted message/);

    let listOutput = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      listOutput = await dispatch('agent_list', context);
      if (/agent-hujing/.test(listOutput)) {
        break;
      }
      await delay(20);
    }
    assert.match(listOutput, /agent-hujing/);

    const delegateOutput = await dispatch('agent_message agent-lisi 新建一个矿场', context);
    assert.match(delegateOutput, /Accepted message/);

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

    let threadOutput = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      threadOutput = await dispatch('agent_thread agent-lisi', context);
      if (/胡景/.test(threadOutput) && /建矿场/.test(threadOutput)) {
        break;
      }
      await delay(20);
    }
    assert.match(threadOutput, /胡景/);
    assert.match(threadOutput, /建矿场/);
  });
});
