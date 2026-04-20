import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS, dispatch } from './index.js';
import { cmdHelp } from './util.js';

describe('save command registration', () => {
  it('registers save in command table', async () => {
    assert.ok(COMMANDS.save);

    const out = await dispatch('save --help', { currentPlayer: 'p1', rl: {} });
    assert.match(out, /save \[--reason <text>\]/);
  });

  it('shows dedicated help for save', async () => {
    const out = await cmdHelp(['save']);
    assert.match(out, /^save /);
    assert.match(out, /manual save/i);
  });
});


describe('logistics command registration', () => {
  it('registers configure_logistics_station and configure_logistics_slot', async () => {
    assert.ok(COMMANDS.configure_logistics_station);
    assert.ok(COMMANDS.configure_logistics_slot);

    const stationHelp = await dispatch('help configure_logistics_station', { currentPlayer: 'p1', rl: {} });
    assert.match(stationHelp, /configure_logistics_station <building_id>/);

    const slotHelp = await dispatch('help configure_logistics_slot', { currentPlayer: 'p1', rl: {} });
    assert.match(slotHelp, /configure_logistics_slot <building_id> <planetary\|interstellar>/);
  });
});

describe('rocket command registration', () => {
  it('registers launch_rocket in command table', async () => {
    assert.ok(COMMANDS.launch_rocket);

    const help = await dispatch('help launch_rocket', { currentPlayer: 'p1', rl: {} });
    assert.match(help, /launch_rocket <building_id> <system_id>/);
  });
});

describe('transfer command registration', () => {
  it('registers transfer in command table', async () => {
    assert.ok(COMMANDS.transfer);

    const help = await dispatch('help transfer', { currentPlayer: 'p1', rl: {} });
    assert.match(help, /transfer <building_id> <item_id> <quantity>/);
  });
});

describe('T101 produce help boundary', () => {
  it('does not hardcode worker/soldier in produce help', async () => {
    const help = await dispatch('help produce', { currentPlayer: 'p1', rl: {} });
    assert.doesNotMatch(help, /worker\/soldier/);
    assert.match(help, /server/i);
    assert.doesNotMatch(help, /corvette|destroyer|precision_drone|prototype/);
  });
});

describe('multi-planet command registration', () => {
  it('registers switch_active_planet and set_ray_receiver_mode in command table', async () => {
    assert.ok(COMMANDS.switch_active_planet);
    assert.ok(COMMANDS.set_ray_receiver_mode);

    const switchHelp = await dispatch('help switch_active_planet', { currentPlayer: 'p1', rl: {} });
    assert.match(switchHelp, /switch_active_planet <planet_id>/);

    const rayHelp = await dispatch('help set_ray_receiver_mode', { currentPlayer: 'p1', rl: {} });
    assert.match(rayHelp, /set_ray_receiver_mode <building_id> <power\|photon\|hybrid>/);
  });
});

describe('agent gateway command registration', () => {
  it('registers agent management commands in command table', async () => {
    assert.ok(COMMANDS.agent_list);
    assert.ok(COMMANDS.agent_create);
    assert.ok(COMMANDS.agent_update);
    assert.ok(COMMANDS.agent_message);
    assert.ok(COMMANDS.agent_thread);

    const createHelp = await dispatch('help agent_create', { currentPlayer: 'p1', rl: {} });
    assert.match(createHelp, /agent_create <name> --provider <provider_id>/);

    const messageHelp = await dispatch('help agent_message', { currentPlayer: 'p1', rl: {} });
    assert.match(messageHelp, /agent_message <agent_id> <content>/);
  });
});

describe('fleet command registration', () => {
  it('registers fleet deployment, control and query commands', async () => {
    assert.ok(COMMANDS.deploy_squad);
    assert.ok(COMMANDS.commission_fleet);
    assert.ok(COMMANDS.fleet_assign);
    assert.ok(COMMANDS.fleet_attack);
    assert.ok(COMMANDS.fleet_disband);
    assert.ok(COMMANDS.fleet_status);
    assert.ok(COMMANDS.system_runtime);

    const deployHelp = await dispatch('help deploy_squad', { currentPlayer: 'p1', rl: {} });
    assert.match(deployHelp, /deploy_squad <building_id> <blueprint_id>/);

    const fleetHelp = await dispatch('help fleet_status', { currentPlayer: 'p1', rl: {} });
    assert.match(fleetHelp, /fleet_status \[fleet_id\]/);

    const systemRuntimeHelp = await dispatch('help system_runtime', { currentPlayer: 'p1', rl: {} });
    assert.match(systemRuntimeHelp, /system_runtime \[system_id\]/);
  });
});
