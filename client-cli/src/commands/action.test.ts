import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cmdBlockadePlanet,
  cmdCommissionFleet,
  cmdDeploySquad,
  cmdLandingStart,
  cmdProduce,
  cmdTaskForceDeploy,
} from './action.js';

describe('T101 produce command boundary', () => {
  it('does not hard reject corvette in cmdProduce before hitting the API layer', async () => {
    const out = await cmdProduce(['b-1', 'corvette']);
    assert.doesNotMatch(out, /unit_type 必须是 worker 或 soldier/);
    assert.match(out, /missing authenticated player_id/);
  });
});

describe('warfare deployment command surface', () => {
  it('uses blueprint_id wording for deploy_squad validation', async () => {
    const out = await cmdDeploySquad(['hub-1']);
    assert.match(out, /deploy_squad <building_id> <blueprint_id>/);
  });

  it('uses blueprint_id wording for commission_fleet validation', async () => {
    const out = await cmdCommissionFleet(['hub-1']);
    assert.match(out, /commission_fleet <building_id> <blueprint_id> <system_id>/);
  });

  it('does not hard reject custom squad blueprints before hitting the API layer', async () => {
    const out = await cmdDeploySquad(['hub-1', 'raider_mk1']);
    assert.doesNotMatch(out, /blueprint_id 当前必须/);
    assert.match(out, /missing authenticated player_id/);
  });

  it('does not hard reject custom fleet blueprints before hitting the API layer', async () => {
    const out = await cmdCommissionFleet(['hub-1', 'escort_mk2', 'sys-1']);
    assert.doesNotMatch(out, /blueprint_id 当前必须/);
    assert.match(out, /missing authenticated player_id/);
  });
});

describe('warfare coordination and landing command surface', () => {
  it('shows task_force_deploy usage with frontline and orbital support options', async () => {
    const out = await cmdTaskForceDeploy([]);
    assert.match(out, /task_force_deploy <task_force_id>/);
    assert.match(out, /--ground-order/);
    assert.match(out, /--support-mode/);
  });

  it('shows blockade_planet and landing_start usage', async () => {
    const blockade = await cmdBlockadePlanet([]);
    assert.match(blockade, /blockade_planet <task_force_id> <planet_id>/);

    const landing = await cmdLandingStart([]);
    assert.match(landing, /landing_start <task_force_id> <planet_id>/);
  });
});
