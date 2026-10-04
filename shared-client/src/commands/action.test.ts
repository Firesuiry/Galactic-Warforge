import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createApiClient } from '../api.js';

import {
  cmdBlockadePlanet,
  cmdConfigureLogisticsStation,
  cmdConfigureLogisticsSlot,
  cmdInstallLogisticsVehicle,
  cmdCommissionFleet,
  cmdDeploySquad,
  cmdFormSquad,
  cmdSquadOrder,
  cmdDissolveSquad,
  cmdProduce,
  cmdRefuelMecha,
  cmdMineResource,
  cmdCraftItem,
  cmdCancelMechaJob,
  cmdConfigureSplitter,
  cmdConfigureTrafficMonitor,
  cmdTaskForceDeploy,
} from './action.js';

const ctx = { api: createApiClient({ serverUrl: 'http://127.0.0.1:1' }) };

describe('mecha refuel command boundary', () => {
  it('requires a positive integer quantity', async () => {
    assert.match(await cmdRefuelMecha(['executor-1', 'fuel-1', '0'], ctx), /quantity 必须是正整数/);
    assert.match(await cmdRefuelMecha(['executor-1', 'fuel-1', '1.5'], ctx), /quantity 必须是正整数/);
  });
});

describe('T101 produce command boundary', () => {
  it('does not hard reject corvette in cmdProduce before hitting the API layer', async () => {
    const out = await cmdProduce(['b-1', 'corvette'], ctx);
    assert.doesNotMatch(out, /unit_type 必须是 worker 或 soldier/);
    assert.match(out, /missing authenticated player_id/);
  });
});

describe('warfare deployment command surface', () => {
  it('uses blueprint_id wording for deploy_squad validation', async () => {
    const out = await cmdDeploySquad(['hub-1'], ctx);
    assert.match(out, /deploy_squad <building_id> <blueprint_id>/);
  });

  it('uses blueprint_id wording for commission_fleet validation', async () => {
    const out = await cmdCommissionFleet(['hub-1'], ctx);
    assert.match(out, /commission_fleet <building_id> <blueprint_id> <system_id>/);
  });

  it('does not hard reject custom squad blueprints before hitting the API layer', async () => {
    const out = await cmdDeploySquad(['hub-1', 'raider_mk1'], ctx);
    assert.doesNotMatch(out, /blueprint_id 当前必须/);
    assert.match(out, /missing authenticated player_id/);
  });

  it('does not hard reject custom fleet blueprints before hitting the API layer', async () => {
    const out = await cmdCommissionFleet(['hub-1', 'escort_mk2', 'sys-1'], ctx);
    assert.doesNotMatch(out, /blueprint_id 当前必须/);
    assert.match(out, /missing authenticated player_id/);
  });
});

describe('warfare coordination command surface', () => {
  it('shows task_force_deploy usage with frontline and orbital support options', async () => {
    const out = await cmdTaskForceDeploy([], ctx);
    assert.match(out, /task_force_deploy <task_force_id>/);
    assert.match(out, /--ground-order/);
    assert.match(out, /--support-mode/);
  });

  it('shows blockade_planet usage', async () => {
    const blockade = await cmdBlockadePlanet([], ctx);
    assert.match(blockade, /blockade_planet <task_force_id> <planet_id>/);
  });
});


describe('personal mecha job command validation', () => {
  for (const [name, handler] of [['mine_resource', cmdMineResource], ['craft_item', cmdCraftItem]] as const) {
    it(`${name} rejects malformed quantities before sending a command`, async () => {
      for (const quantity of ['0', '-1', '1.5', '2tail', '1e3', 'Infinity', 'NaN', '', ' 2', '9007199254740992']) {
        const out = await handler(['executor-1', 'target-1', quantity], ctx);
        assert.match(out, /quantity 必须是正整数/, `${name}: ${JSON.stringify(quantity)}`);
        assert.doesNotMatch(out, /missing authenticated player_id/);
      }
    });
    it(`${name} accepts integer quantities and leaves target validity to the server`, async () => {
      for (const quantity of ['1', '+2']) {
        const out = await handler(['executor-1', 'server-defined-target', quantity], ctx);
        assert.match(out, /missing authenticated player_id/);
        assert.doesNotMatch(out, /quantity 必须是正整数/);
      }
    });
    it(`${name} requires exactly executor, resource or recipe, and quantity`, async () => {
      assert.match(await handler(['executor-1', 'target-1'], ctx), /Usage:/);
      assert.match(await handler(['executor-1', 'target-1', '1', 'extra'], ctx), /Usage:/);
    });
  }
  it('cancel_mecha_job requires exactly one executor and reaches the API for valid arguments', async () => {
    assert.match(await cmdCancelMechaJob([], ctx), /Usage: cancel_mecha_job <executor_id>/);
    assert.match(await cmdCancelMechaJob(['executor-1', 'extra'], ctx), /Usage:/);
    assert.match(await cmdCancelMechaJob(['executor-1'], ctx), /missing authenticated player_id/);
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
    ]) assert.doesNotMatch(await cmdConfigureSplitter(args, ctx), /missing authenticated player_id/);
  });
  it('allows full replacement configuration and help never sends commands', async () => {
    assert.match(await cmdConfigureSplitter(['b', '--inputs', 'west', '--outputs', 'east,south', '--output-priority', 'east', '--filters', 'east:iron_ore'], ctx), /missing authenticated player_id/);
    assert.match(await cmdConfigureSplitter(['--help'], ctx), /Usage: configure_splitter/);
  });
});

describe('traffic monitor command', () => {
  it('validates full configuration and never submits help', async () => {
    const valid = ['monitor', 'belt', '--window', '10', '--minimum', '0.5', '--alerts', 'on'];
    assert.match(await cmdConfigureTrafficMonitor(valid, ctx), /missing authenticated player_id/);
    assert.match(await cmdConfigureTrafficMonitor(['--help'], ctx), /Usage: configure_traffic_monitor/);
    for (const [index, value] of [[3, '0'], [3, '601'], [3, '1.5'], [5, '-1'], [5, 'Infinity'], [5, '61'], [7, 'true']] as const) {
      const args = [...valid]; args[index] = value;
      assert.doesNotMatch(await cmdConfigureTrafficMonitor(args, ctx), /missing authenticated player_id/);
    }
    assert.doesNotMatch(await cmdConfigureTrafficMonitor([...valid, '--typo', 'x'], ctx), /missing authenticated player_id/);
  });
});


describe('station installation and wiring command boundaries', () => {
  it('requires real vehicle IDs and positive safe integer quantities', async () => {
    for (const quantity of ['0', '-1', '1.5', '1e2', '2tail', '9007199254740992']) {
      assert.doesNotMatch(await cmdInstallLogisticsVehicle(['s', 'logistics_drone', quantity], ctx), /missing authenticated player_id/);
    }
    assert.doesNotMatch(await cmdInstallLogisticsVehicle(['s', 'free_drone', '1'], ctx), /missing authenticated player_id/);
    assert.match(await cmdInstallLogisticsVehicle(['s', 'logistics_vessel', '2'], ctx), /missing authenticated player_id/);
    assert.match(await cmdInstallLogisticsVehicle(['--help'], ctx), /Usage:/);
    assert.match(await cmdInstallLogisticsVehicle(['s', 'logistics_drone', '1', '--source', 'station'], ctx), /missing authenticated player_id/);
    for (const args of [['s', 'logistics_drone', '1', '--source'], ['s', 'logistics_drone', '1', '--source', 'factory'], ['s', 'logistics_drone', '1', '--unknown', 'true']]) assert.doesNotMatch(await cmdInstallLogisticsVehicle(args, ctx), /missing authenticated player_id/);
  });
  it('accepts explicit wiring replacement and clearing, and rejects malformed options', async () => {
    for (const value of ['west:input:iron_ore,east:output:copper_ore', 'none']) {
      assert.match(await cmdConfigureLogisticsStation(['s', '--belt-ports', value], ctx), /missing authenticated player_id/);
    }
    for (const args of [
      ['s', '--belt-ports'], ['s', '--typo', '1'], ['s', '--belt-ports', 'up:input:iron_ore'],
      ['s', '--belt-ports', 'west:input:iron_ore,west:output:iron_ore'],
      ['s', '--belt-ports', 'west:both:iron_ore'], ['s', '--belt-ports', 'west:input:'],
      ['s', '--belt-ports', 'west:input:iron_ore:extra'],
    ]) assert.doesNotMatch(await cmdConfigureLogisticsStation(args, ctx), /missing authenticated player_id/, args.join(' '));
    assert.match(await cmdConfigureLogisticsStation(['--help'], ctx), /Usage:/);
  });
  it('distinguishes empty slot removal from a local storage slot', async () => {
    assert.match(await cmdConfigureLogisticsSlot(['s', 'planetary', 'iron_ore', '--remove'], ctx), /missing authenticated player_id/);
    assert.match(await cmdConfigureLogisticsSlot(['s', 'planetary', 'iron_ore', 'none', '0'], ctx), /missing authenticated player_id/);
    for (const args of [ ['s', 'planetary', 'iron_ore', '--remove', 'false'], ['s', 'wrong', 'iron_ore', '--remove'], ['s', 'planetary', 'iron_ore', 'none', '0', '--remove'] ]) {
      assert.doesNotMatch(await cmdConfigureLogisticsSlot(args, ctx), /missing authenticated player_id/);
    }
  });
});

describe('legion commands (form_squad / squad_order / dissolve_squad)', () => {
  it('form_squad requires at least one entity id', async () => {
    assert.match(await cmdFormSquad([], ctx), /Usage: form_squad <entity_id\.\.\.>/);
    assert.match(await cmdFormSquad(['--help'], ctx), /Usage: form_squad/);
  });

  it('form_squad accepts ids and --name then reaches the API layer', async () => {
    const out = await cmdFormSquad(['u-1', 'u-2', '--name', '先锋', '--planet', 'planet-1'], ctx);
    assert.doesNotMatch(out, /Usage/);
    assert.match(out, /missing authenticated player_id/);
  });

  it('squad_order rejects unknown orders and missing squad id', async () => {
    assert.match(await cmdSquadOrder([], ctx), /Usage: squad_order/);
    assert.match(await cmdSquadOrder(['sq-1', 'charge', '1', '2'], ctx), /Usage: squad_order/);
  });

  it('squad_order needs x y except for resupply', async () => {
    assert.match(await cmdSquadOrder(['sq-1', 'attack'], ctx), /Usage: squad_order/);
    assert.match(await cmdSquadOrder(['sq-1', 'attack', '3'], ctx), /Usage: squad_order/);
    assert.match(await cmdSquadOrder(['sq-1', 'resupply', '3', '4'], ctx), /Usage: squad_order/);
  });

  it('squad_order validates integer coordinates', async () => {
    assert.match(await cmdSquadOrder(['sq-1', 'defend', 'a', '2'], ctx), /x/);
  });

  it('squad_order valid forms reach the API layer', async () => {
    for (const args of [['sq-1', 'attack', '3', '4'], ['sq-1', 'retreat', '0', '0'], ['sq-1', 'resupply']]) {
      const out = await cmdSquadOrder(args, ctx);
      assert.doesNotMatch(out, /Usage/);
      assert.match(out, /missing authenticated player_id/);
    }
  });

  it('dissolve_squad takes exactly one squad id', async () => {
    assert.match(await cmdDissolveSquad([], ctx), /Usage: dissolve_squad/);
    assert.match(await cmdDissolveSquad(['a', 'b'], ctx), /Usage: dissolve_squad/);
    const out = await cmdDissolveSquad(['sq-1'], ctx);
    assert.doesNotMatch(out, /Usage/);
    assert.match(out, /missing authenticated player_id/);
  });
});
