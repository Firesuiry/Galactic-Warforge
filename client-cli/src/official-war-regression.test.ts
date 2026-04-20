import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { setAuth, setServerUrl } from './api.js';
import { dispatch } from './commands/index.js';

const TEST_PORT = 19482;
const TEST_SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.resolve(currentDir, '../../server/scripts/start_official_war_test_server.sh');

let serverProcess: ChildProcess | undefined;

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

async function runCli(line: string, context: { currentPlayer: string; playerKey: string }) {
  setServerUrl(TEST_SERVER_URL);
  setAuth(context.currentPlayer, context.playerKey);
  return dispatch(line, {
    currentPlayer: context.currentPlayer,
    rl: {} as never,
  });
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

describe('official war regression via real server', () => {
  before(async () => {
    serverProcess = spawn('bash', [serverScript, String(TEST_PORT)], {
      cwd: path.resolve(currentDir, '../..'),
      stdio: 'ignore',
      detached: true,
    });
    serverProcess.unref();
    await waitForHealth(TEST_SERVER_URL);
  });

  after(async () => {
    if (!serverProcess?.pid) {
      return;
    }
    try {
      process.kill(-serverProcess.pid, 'SIGTERM');
    } catch {
      return;
    }
    await delay(1_000);
  });

  it('runs the minimal warfare loop against the authoritative war scenario', async () => {
    const p1 = { currentPlayer: 'p1', playerKey: 'key_player_1' };
    const p1HubId = await findBuildingId(p1.playerKey, 'p1', 'battlefield_analysis_base');
    const p1FactoryId = await findBuildingId(p1.playerKey, 'p1', 'recomposing_assembler');

    const initialIndustry = await runCli('war_industry', p1);
    assert.match(initialIndustry, /Supply Nodes/);
    assert.match(initialIndustry, /planetary_logistics_station/);
    assert.match(initialIndustry, /interstellar_logistics_station/);
    assert.match(initialIndustry, /orbital_supply_port/);

    await runCli('blueprint_variant corvette corvette_cli_t122 utility --name CLI回归舰', p1);
    await runCli('blueprint_validate corvette_cli_t122', p1);
    await runCli('blueprint_finalize corvette_cli_t122 --target-state prototype', p1);

    const blueprintDetail = await waitForOutput('blueprints corvette_cli_t122', /State:\s+prototype/, p1);
    assert.match(blueprintDetail, /Validation:\s+valid/);

    await runCli(`queue_military_production ${p1FactoryId} ${p1HubId} corvette_cli_t122 --count 1`, p1);
    await waitForOutput('war_industry', /corvette_cli_t122:1/, p1);

    await runCli(`commission_fleet ${p1HubId} corvette_cli_t122 sys-1 --fleet-id fleet-cli-t122`, p1);
    await waitForOutput('fleet_status fleet-cli-t122', /Units:\s+corvette_cli_t122:1/, p1);

    await runCli('task_force_create tf-cli-t122 --name CLI前线群 --stance escort', p1);
    await runCli('task_force_assign tf-cli-t122 fleet fleet-cli-t122 --system sys-1 --planet planet-1-1', p1);
    await runCli('task_force_deploy tf-cli-t122 --system sys-1 --planet planet-1-1', p1);
    await runCli('theater_create theater-cli-t122 --name CLI战区', p1);
    await runCli('theater_define_zone theater-cli-t122 primary --system sys-1 --planet planet-1-1 --radius 8', p1);
    await runCli('theater_set_objective theater-cli-t122 secure_planet --system sys-1 --planet planet-1-1 --description CLI最小战争闭环', p1);

    const taskForces = await waitForOutput('task_forces', /tf-cli-t122/, p1);
    assert.match(taskForces, /escort|hold|intercept|siege/);
    const theaters = await waitForOutput('theaters', /theater-cli-t122/, p1);
    assert.match(theaters, /secure_planet/);
  });
});
