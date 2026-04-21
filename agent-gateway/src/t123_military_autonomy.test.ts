import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { setAuth, setServerUrl } from '../../client-cli/src/api.js';
import { dispatch } from '../../client-cli/src/commands/index.js';
import { createGatewayServer } from './server.js';

const TEST_PORT = 19483;
const TEST_SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const warServerScript = path.resolve(repoRoot, 'server/scripts/start_official_war_test_server.sh');

let warServerProcess: ChildProcess | undefined;

async function waitForHealth(url: string) {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError ?? new Error('war regression server did not become healthy');
}

async function runCli(line: string, context: { currentPlayer: string; playerKey: string }) {
  setServerUrl(TEST_SERVER_URL);
  setAuth(context.currentPlayer, context.playerKey);
  return dispatch(line, {
    currentPlayer: context.currentPlayer,
    rl: {} as never,
  });
}

async function waitForOutput(commandLine: string, pattern: RegExp, context: { currentPlayer: string; playerKey: string }) {
  const deadline = Date.now() + 120_000;
  let lastOutput = '';
  while (Date.now() < deadline) {
    lastOutput = await runCli(commandLine, context);
    if (pattern.test(lastOutput)) {
      return lastOutput;
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for ${pattern} in output:\n${lastOutput}`);
}

async function findBuildingId(authKey: string, ownerID: string, buildingType: string) {
  const response = await fetch(`${TEST_SERVER_URL}/world/planets/planet-1-1/scene?x=0&y=0&width=48&height=48`, {
    headers: {
      authorization: `Bearer ${authKey}`,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as {
    buildings?: Record<string, {
      id: string;
      owner_id: string;
      type: string;
    }>;
  };
  const building = Object.values(body.buildings ?? {}).find((entry) => (
    entry.owner_id === ownerID && entry.type === buildingType
  ));
  assert.ok(building, `missing ${ownerID} ${buildingType} in authoritative war scene`);
  return building.id;
}

describe('T123 military agent autonomy', () => {
  before(async () => {
    warServerProcess = spawn('bash', [warServerScript, String(TEST_PORT)], {
      cwd: repoRoot,
      stdio: 'ignore',
      detached: true,
    });
    warServerProcess.unref();
    await waitForHealth(TEST_SERVER_URL);
  });

  after(async () => {
    if (!warServerProcess?.pid) {
      return;
    }
    try {
      process.kill(-warServerProcess.pid, 'SIGTERM');
    } catch {
      return;
    }
    await delay(1_000);
  });

  it('delegates an assigned theater to a military agent and returns audited war results', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-war-t123-'));
    const gateway = await createGatewayServer({
      dataRoot,
      port: 0,
      agentTurnRunner: async ({ history }) => {
        const toolResults = history.filter((entry) => entry.role === 'tool').map((entry) => entry.content);
        if (toolResults.length === 0) {
          return {
            assistantMessage: '先把任务群切到巡逻姿态，并重新部署到委派战区，再核对当前恒星系局势。',
            actions: [
              {
                type: 'game.command',
                command: 'task_force_set_stance',
                args: {
                  task_force_id: 'tf-agent-t123',
                  stance: 'patrol',
                },
              },
              {
                type: 'game.command',
                command: 'task_force_deploy',
                args: {
                  task_force_id: 'tf-agent-t123',
                  theater_id: 'theater-agent-t123',
                  system_id: 'sys-1',
                  planet_id: 'planet-1-1',
                },
              },
              {
                type: 'game.command',
                command: 'system_runtime',
                args: {
                  system_id: 'sys-1',
                },
              },
            ],
            done: false,
          };
        }

        return {
          assistantMessage: '巡逻姿态已切换。',
          actions: [
            {
              type: 'final_answer',
              message: '巡逻姿态已切换。',
            },
          ],
          done: true,
        };
      },
    });

    try {
      const p1 = { currentPlayer: 'p1', playerKey: 'key_player_1' };
      const p1HubId = await findBuildingId(p1.playerKey, 'p1', 'battlefield_analysis_base');
      const p1FactoryId = await findBuildingId(p1.playerKey, 'p1', 'recomposing_assembler');

      await runCli('blueprint_variant corvette corvette_agent_t123 utility --name 军事委派舰', p1);
      await runCli('blueprint_validate corvette_agent_t123', p1);
      await runCli('blueprint_finalize corvette_agent_t123 --target-state prototype', p1);
      await runCli(`queue_military_production ${p1FactoryId} ${p1HubId} corvette_agent_t123 --count 1`, p1);
      await waitForOutput('war_industry', /corvette_agent_t123:1/, p1);
      await runCli(`commission_fleet ${p1HubId} corvette_agent_t123 sys-1 --fleet-id fleet-agent-t123`, p1);
      await waitForOutput('fleet_status fleet-agent-t123', /corvette_agent_t123:1/, p1);

      await runCli('task_force_create tf-agent-t123 --name AI巡逻群 --stance hold', p1);
      await runCli('task_force_assign tf-agent-t123 fleet fleet-agent-t123 --system sys-1 --planet planet-1-1', p1);
      await runCli('task_force_deploy tf-agent-t123 --system sys-1 --planet planet-1-1', p1);
      await runCli('theater_create theater-agent-t123 --name AI前线战区', p1);
      await runCli('theater_define_zone theater-agent-t123 primary --system sys-1 --planet planet-1-1 --radius 8', p1);
      await runCli('theater_set_objective theater-agent-t123 secure_planet --system sys-1 --planet planet-1-1 --description AI军事委派回归', p1);

      const providerResponse = await fetch(`${gateway.url}/providers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'provider-war-t123',
          name: 'war provider',
          providerKind: 'codex_cli',
          description: 't123 regression provider',
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

      const agentResponse = await fetch(`${gateway.url}/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'agent-war-director',
          name: '总参谋',
          providerId: 'provider-war-t123',
          serverUrl: TEST_SERVER_URL,
          playerId: 'p1',
          playerKey: 'key_player_1',
          role: 'director',
          policy: {
            commandCategories: ['observe', 'combat', 'management'],
            military: {
              theaterIds: ['theater-agent-t123'],
              taskForceIds: ['tf-agent-t123'],
              allowedCommandIds: ['system_runtime', 'task_force_set_stance', 'task_force_deploy'],
              allowBlockade: false,
              allowLanding: false,
              allowMilitaryProduction: false,
              maxMilitaryProductionCount: 0,
            },
          },
        }),
      });
      assert.equal(agentResponse.status, 201);

      const messageResponse = await fetch(`${gateway.url}/agents/agent-war-director/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: '接管 theater-agent-t123，并让 tf-agent-t123 在战区内维持巡逻，汇报当前局势。',
        }),
      });
      assert.equal(messageResponse.status, 202);

      const deadline = Date.now() + 120_000;
      let thread: {
        lastTurn?: {
          status: string;
          outcomeKind?: string;
          finalMessage?: string;
        };
        toolCalls: Array<{ type: string; payload: Record<string, unknown> }>;
      } | null = null;
      while (Date.now() < deadline) {
        const threadResponse = await fetch(`${gateway.url}/agents/agent-war-director/thread`);
        assert.equal(threadResponse.status, 200);
        thread = await threadResponse.json() as typeof thread;
        if (thread?.lastTurn?.status === 'completed') {
          break;
        }
        await delay(250);
      }

      assert.equal(thread?.lastTurn?.status, 'completed');
      assert.equal(thread?.lastTurn?.outcomeKind, 'acted');
      assert.match(thread?.lastTurn?.finalMessage ?? '', /做了什么：/);
      assert.match(thread?.lastTurn?.finalMessage ?? '', /当前战区状态：/);
      assert.match(thread?.lastTurn?.finalMessage ?? '', /需要玩家批准：否/);
      assert.ok(thread?.toolCalls.some((call) => (
        call.type === 'game.command'
        && String(call.payload.commandLine ?? '').includes('task_force_set_stance tf-agent-t123 patrol')
      )));

      const taskForces = await waitForOutput('task_forces', /tf-agent-t123/, p1);
      assert.match(taskForces, /patrol/);
    } finally {
      await gateway.close();
    }
  });
});
