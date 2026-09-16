import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cmdBlockadePlanet,
  cmdCommissionFleet,
  cmdDeploySquad,
  cmdLandingStart,
  cmdProduce,
  cmdRefuelMecha,
  cmdMineResource,
  cmdCraftItem,
  cmdCancelMechaJob,
  cmdConfigureSplitter,
  cmdTaskForceDeploy,
} from './action.js';

describe('mecha refuel command boundary', () => {
  it('requires a positive integer quantity', async () => {
    assert.match(await cmdRefuelMecha(['executor-1', 'fuel-1', '0']), /quantity 必须是正整数/);
    assert.match(await cmdRefuelMecha(['executor-1', 'fuel-1', '1.5']), /quantity 必须是正整数/);
  });
});

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


describe('personal mecha job command validation', () => {
  for (const [name, handler] of [['mine_resource', cmdMineResource], ['craft_item', cmdCraftItem]] as const) {
    it(`${name} rejects malformed quantities before sending a command`, async () => {
      for (const quantity of ['0', '-1', '1.5', '2tail', '1e3', 'Infinity', 'NaN', '', ' 2', '9007199254740992']) {
        const out = await handler(['executor-1', 'target-1', quantity]);
        assert.match(out, /quantity 必须是正整数/, `${name}: ${JSON.stringify(quantity)}`);
        assert.doesNotMatch(out, /missing authenticated player_id/);
      }
    });
    it(`${name} accepts integer quantities and leaves target validity to the server`, async () => {
      for (const quantity of ['1', '+2']) {
        const out = await handler(['executor-1', 'server-defined-target', quantity]);
        assert.match(out, /missing authenticated player_id/);
        assert.doesNotMatch(out, /quantity 必须是正整数/);
      }
    });
    it(`${name} requires exactly executor, resource or recipe, and quantity`, async () => {
      assert.match(await handler(['executor-1', 'target-1']), /Usage:/);
      assert.match(await handler(['executor-1', 'target-1', '1', 'extra']), /Usage:/);
    });
  }
  it('cancel_mecha_job requires exactly one executor and reaches the API for valid arguments', async () => {
    assert.match(await cmdCancelMechaJob([]), /Usage: cancel_mecha_job <executor_id>/);
    assert.match(await cmdCancelMechaJob(['executor-1', 'extra']), /Usage:/);
    assert.match(await cmdCancelMechaJob(['executor-1']), /missing authenticated player_id/);
  });
});


describe('splitter configuration', () => {
  it('rejects overlapping, duplicate, unknown, or missing ports before reaching the server', async () => {
    for (const args of [
      ['b', '--inputs', 'west', '--outputs', 'west'],
      ['b', '--inputs', 'west,west', '--outputs', 'east'],
      ['b', '--inputs', 'auto', '--outputs', 'east'],
      ['b', '--inputs', 'west'],
      ['b', '--inputs', 'west', '--outputs', 'east', '--output-priority', 'north'],
      ['b', '--inputs', 'west', '--outputs', 'east', '--filters', 'north:iron_ore'],
      ['b', '--inputs', 'west', '--outputs', 'east', '--filters', 'east:iron_ore,east:copper_ore'],
      ['b', '--inputs', 'west', '--outputs', 'east', '--filters'],
      ['b', '--inputs', 'west', '--outputs', 'east', '--typo', 'value'],
    ]) assert.doesNotMatch(await cmdConfigureSplitter(args), /missing authenticated player_id/);
  });
  it('allows full replacement configuration and help never sends commands', async () => {
    assert.match(await cmdConfigureSplitter(['b', '--inputs', 'west', '--outputs', 'east,south', '--output-priority', 'east', '--filters', 'east:iron_ore']), /missing authenticated player_id/);
    assert.match(await cmdConfigureSplitter(['--help']), /Usage: configure_splitter/);
  });
});
