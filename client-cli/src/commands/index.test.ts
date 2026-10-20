import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COMMANDS, dispatch } from './index.js';
import { cmdHelp } from '@gw/shared/commands/help';

import { api } from '../api.js';

describe('agent query command registration', () => {
  it('registers catalog / networks / alerts with dedicated help', async () => {
    for (const name of ['catalog', 'networks', 'alerts']) {
      assert.ok(COMMANDS[name], `missing ${name}`);
      const help = await dispatch(`help ${name}`, { api, currentPlayer: 'p1', rl: {} as never });
      assert.doesNotMatch(help, /Unknown command/);
      assert.match(help, new RegExp(`^${name} `));
    }
    const sceneHelp = await dispatch('help scene', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(sceneHelp, /\[planet\] \[x y width height\]/);
    const inspectHelp = await dispatch('help inspect', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(inspectHelp, /\[planet\] \[building\|unit\|resource\|sector\] <entity_id>/);
  });
});

describe('save command registration', () => {
  it('registers save in command table', async () => {
    assert.ok(COMMANDS.save);

    const out = await dispatch('save --help', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(out, /save \[--reason <text>\]/);
  });

  it('shows dedicated help for save', async () => {
    const out = await cmdHelp(['save'], { api });
    assert.match(out, /^save /);
    assert.match(out, /manual save/i);
  });
});


describe('logistics command registration', () => {
  it('registers configure_logistics_station and configure_logistics_slot', async () => {
    assert.ok(COMMANDS.configure_logistics_station);
    assert.ok(COMMANDS.configure_logistics_slot);

    const stationHelp = await dispatch('help configure_logistics_station', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(stationHelp, /configure_logistics_station <building_id>/);

    const slotHelp = await dispatch('help configure_logistics_slot', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(slotHelp, /configure_logistics_slot <building_id> <planetary\|interstellar>/);
  });
});

describe('rocket command registration', () => {
  it('registers launch_rocket in command table', async () => {
    assert.ok(COMMANDS.launch_rocket);

    const help = await dispatch('help launch_rocket', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(help, /launch_rocket <building_id> <system_id>/);
  });
});

describe('transfer command registration', () => {
  it('registers transfer in command table', async () => {
    assert.ok(COMMANDS.transfer);

    const help = await dispatch('help transfer', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(help, /transfer <building_id> <item_id> <quantity>/);
  });
});

describe('mecha refuel command registration', () => {
  it('registers refuel_mecha and exposes its fuel arguments', async () => {
    assert.ok(COMMANDS.refuel_mecha);
    const help = await dispatch('help refuel_mecha', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(help, /refuel_mecha <fuel_item_id> \[count\]/);
  });
});

describe('T101 produce help boundary', () => {
  it('does not hardcode worker/soldier in produce help', async () => {
    const help = await dispatch('help produce', { api, currentPlayer: 'p1', rl: {} as never });
    assert.doesNotMatch(help, /worker\/soldier/);
    assert.match(help, /server/i);
    assert.doesNotMatch(help, /corvette|destroyer|precision_drone|prototype/);
  });
});

describe('multi-planet command registration', () => {
  it('registers switch_active_planet and set_ray_receiver_mode in command table', async () => {
    assert.ok(COMMANDS.switch_active_planet);
    assert.ok(COMMANDS.set_ray_receiver_mode);

    const switchHelp = await dispatch('help switch_active_planet', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(switchHelp, /switch_active_planet <planet_id>/);

    const rayHelp = await dispatch('help set_ray_receiver_mode', { api, currentPlayer: 'p1', rl: {} as never });
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

    const createHelp = await dispatch('help agent_create', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(createHelp, /agent_create <name> --provider <provider_id>/);

    const messageHelp = await dispatch('help agent_message', { api, currentPlayer: 'p1', rl: {} as never });
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
    assert.ok(COMMANDS.fleet_move);
    assert.ok(COMMANDS.fleet_status);
    assert.ok(COMMANDS.system_runtime);

    const deployHelp = await dispatch('help deploy_squad', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(deployHelp, /deploy_squad <building_id> <blueprint_id>/);

    const fleetHelp = await dispatch('help fleet_status', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(fleetHelp, /fleet_status \[fleet_id\]/);

    const systemRuntimeHelp = await dispatch('help system_runtime', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(systemRuntimeHelp, /system_runtime \[system_id\]/);
  });
});

describe('warfare command registration', () => {
  it('registers warfare query commands', async () => {
    assert.ok(COMMANDS.planet_runtime);
    assert.ok(COMMANDS.blueprints);
    assert.ok(COMMANDS.war_industry);
    assert.ok(COMMANDS.task_forces);
    assert.ok(COMMANDS.theaters);

    const runtimeHelp = await dispatch('help planet_runtime', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(runtimeHelp, /planet_runtime \[planet_id\]/);

    const blueprintHelp = await dispatch('help blueprints', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(blueprintHelp, /blueprints \[blueprint_id\]/);

    const industryHelp = await dispatch('help war_industry', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(industryHelp, /war_industry/);
  });

  it('registers warfare action commands', async () => {
    assert.ok(COMMANDS.blueprint_create);
    assert.ok(COMMANDS.blueprint_set_component);
    assert.ok(COMMANDS.blueprint_validate);
    assert.ok(COMMANDS.blueprint_finalize);
    assert.ok(COMMANDS.blueprint_variant);
    assert.ok(COMMANDS.queue_military_production);
    assert.ok(COMMANDS.refit_unit);
    assert.ok(COMMANDS.task_force_create);
    assert.ok(COMMANDS.task_force_assign);
    assert.ok(COMMANDS.task_force_set_stance);
    assert.ok(COMMANDS.task_force_deploy);
    assert.ok(COMMANDS.theater_create);
    assert.ok(COMMANDS.theater_define_zone);
    assert.ok(COMMANDS.theater_set_objective);
    assert.ok(COMMANDS.blockade_planet);

    const taskForceHelp = await dispatch('help task_force_create', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(taskForceHelp, /task_force_create <task_force_id>/);

    const blockadeHelp = await dispatch('help blockade_planet', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(blockadeHelp, /blockade_planet <task_force_id> <planet_id>/);
  });
});


describe('personal mecha job help and registration', () => {
  for (const [name, usage] of [
    ['mine_resource', 'mine_resource <resource_id> <quantity>'],
    ['craft_item', 'craft_item <recipe_id> <quantity>'],
    ['cancel_mecha_job', 'cancel_mecha_job [--planet'],
  ]) {
    it(`${name} exposes dedicated help and --help without submitting commands`, async () => {
      assert.equal(typeof COMMANDS[name]?.handler, 'function');
      for (const command of [`help ${name}`, `${name} --help`]) {
        const out = await dispatch(command, { api, currentPlayer: 'p1', rl: {} as never });
        assert.ok(out.includes(usage), out);
        assert.doesNotMatch(out, /missing authenticated player_id/);
      }
    });
  }
  it('craft help explains that quantity counts recipe batches', async () => {
    assert.match(await cmdHelp(['craft_item'], { api }), /批数/);
  });
});


describe('splitter public command', () => {
  it('registers and documents full port configuration', async () => {
    assert.ok(COMMANDS.configure_splitter);
    const help = await dispatch('help configure_splitter', { api, currentPlayer: 'p1', rl: {} as never });
    for (const option of ['--inputs', '--outputs', '--input-priority', '--output-priority', '--filters']) assert.ok(help.includes(option));
  });
});


describe('fast-forward command registration', () => {
  it('registers advance and advance_cancel with dedicated help', async () => {
    assert.ok(COMMANDS.advance);
    assert.ok(COMMANDS.advance_cancel);

    const help = await dispatch('help advance', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(help, /advance <ticks> \[--to <tick>\]/);
    assert.match(help, /--no-stop-attack/);
    assert.match(help, /--no-stop-alert/);
    assert.match(help, /--no-stop-gameover/);

    const inline = await dispatch('advance --help', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(inline, /POST \/admin\/advance/);

    const cancel = await dispatch('help advance_cancel', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(cancel, /advance_cancel/);
  });

  it('validates the target before calling the server', async () => {
    const out = await dispatch('advance', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(out, /需要 <ticks> 或 --to <tick>/);
  });
});


describe('issuer commands', () => {
  it('registers as and mecha commands', async () => {
    assert.ok(COMMANDS.as);
    assert.ok(COMMANDS.mecha);
    const mechaHelp = await dispatch('help mecha', { api, currentPlayer: 'p1', rl: {} as never });
    assert.match(mechaHelp, /mecha <list\|assign <mecha_id> \[operator\]\|assign <mecha_id> --release>/);
  });

  it('switches issuer with as <name> and restores the player with bare as', async () => {
    api.setAuth('p1', 'key_player_1');
    const ctx = { api, currentPlayer: 'p1', rl: {} as never };
    assert.match(await dispatch('as builder', ctx), /Now issuing as agent builder/);
    assert.equal(api.getAuth().issuerType, 'agent');
    assert.equal(api.getAuth().issuerId, 'builder');
    assert.match(await dispatch('as', ctx), /Now issuing as player p1/);
    assert.equal(api.getAuth().issuerType, 'player');
    assert.equal(api.getAuth().issuerId, 'p1');
  });

  it('rejects an agent name equal to the player id or with illegal characters', async () => {
    api.setAuth('p1', 'key_player_1');
    const ctx = { api, currentPlayer: 'p1', rl: {} as never };
    assert.match(await dispatch('as p1', ctx), /不能等于玩家 ID/);
    assert.match(await dispatch('as bad name', ctx), /Usage: as/);
    assert.equal(api.getAuth().issuerType, 'player');
  });

  it('shows the current issuer in status', async () => {
    api.setAuth('p1', 'key_player_1');
    const ctx = { api, currentPlayer: 'p1', rl: {} as never };
    assert.match(await dispatch('status', ctx), /Issuer: player:p1/);
    await dispatch('as scout', ctx);
    assert.match(await dispatch('status', ctx), /Issuer: agent:scout/);
    api.setAuth('', '');
  });
});

describe('help 补全（SK-CLI-B）', () => {
  const fakeCatalogApi = {
    fetchCatalog: async () => ({
      items: [{ id: 'iron_ingot', name: '铁块' }, { id: 'gear', name: '齿轮' }],
      recipes: [
        {
          id: 'craft_gear', name: '齿轮', handcraft_allowed: true, duration: 4,
          inputs: [{ item_id: 'iron_ingot', quantity: 2 }],
          outputs: [{ item_id: 'gear', quantity: 1 }],
        },
        {
          id: 'smelt_steel', name: '钢', handcraft_allowed: false, duration: 8,
          inputs: [{ item_id: 'iron_ingot', quantity: 3 }],
          outputs: [{ item_id: 'steel', quantity: 1 }],
        },
      ],
    }),
  } as never;

  it('总表 build 行带 --elevation', async () => {
    const out = await cmdHelp([], { api });
    assert.match(out, /build <x> <y> <type> .*--elevation 0-4/);
  });

  it('help craft_item 动态列出可手搓配方，排除不可手搓的', async () => {
    const out = await cmdHelp(['craft_item'], { api: fakeCatalogApi });
    assert.match(out, /可手搓配方（1/);
    assert.match(out, /craft_gear\s+铁块×2 -> 齿轮×1/);
    assert.doesNotMatch(out, /smelt_steel/);
  });

  it('help mine_resource 说明 resource_id 取自 scene.resources，不是物品 id', async () => {
    const out = await cmdHelp(['mine_resource'], { api });
    assert.match(out, /scene 的 resources\[\]\.id/);
    assert.match(out, /不是物品 id/);
  });

  it('help wait 说明 N 是 tick 数，并按 max_tick_rate 换算成秒 + 给例子', async () => {
    const fakeTickApi = {
      fetchCurrentGame: async () => ({ max_tick_rate: 10 }),
    } as never;
    const out = await cmdHelp(['wait'], { api: fakeTickApi });
    assert.match(out, /N 是 tick 数/);
    assert.match(out, /本服 10 tick\/秒/);
    assert.match(out, /wait ticks 500 ≈ 50 秒/);
    assert.match(out, /wait ticks 500 --timeout 90/);
  });

  it('help wait 取不到 tick 速率时仍给换算公式', async () => {
    const failingApi = { fetchCurrentGame: async () => { throw new Error('offline'); } } as never;
    const out = await cmdHelp(['wait'], { api: failingApi });
    assert.match(out, /秒 = N ÷ 速率/);
    assert.match(out, /max_tick_rate/);
  });

  it('help find_space / plan 带新选项', async () => {
    const findSpace = await cmdHelp(['find_space'], { api });
    assert.match(findSpace, /--spacing N/);
    assert.match(findSpace, /距锚点/);
    const plan = await cmdHelp(['plan'], { api });
    assert.match(plan, /craft_item recipe batches/);
    assert.match(plan, /递归/);
  });

  it('help build 说明 x,y 是占地左上角', async () => {
    const out = await cmdHelp(['build'], { api });
    assert.match(out, /占地左上角/);
    assert.match(out, /footprint/);
  });
});
