import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { fmtPlanetRuntime, fmtSystemRuntime, fmtWarIndustry } from './format.js';

describe('warfare formatting', () => {
  it('renders contacts, blockades and battle reports in system runtime output', () => {
    const out = fmtSystemRuntime({
      system_id: 'sys-1',
      discovered: true,
      available: true,
      fleets: [],
      contacts: [{
        id: 'contact-1',
        scope_type: 'system',
        scope_id: 'sys-1',
        contact_kind: 'fleet',
        entity_id: 'fleet-ghost',
        entity_type: 'fleet',
        level: 'classified_contact',
        classification: 'escort_group',
        last_updated_tick: 55,
      }],
      orbital_superiority: {
        system_id: 'sys-1',
        advantage_player_id: 'p1',
        contest_intensity: 0.35,
        last_reason: 'fleet_presence_margin',
        updated_tick: 55,
      },
      planet_blockades: [{
        planet_id: 'planet-1-1',
        system_id: 'sys-1',
        owner_id: 'p1',
        task_force_id: 'tf-1',
        status: 'active',
      }],
      battle_reports: [{
        battle_id: 'battle-1',
        tick: 56,
        system_id: 'sys-1',
        fleet_id: 'fleet-1',
        owner_id: 'p1',
        fleet_firepower: {},
        enemy_firepower: {},
        target_id: 'enemy-force-1',
        target_type: 'enemy_force',
      }],
    } as any);

    assert.match(out, /Contacts/);
    assert.match(out, /battle-1/);
    assert.match(out, /active/);
  });

  it('renders production, hubs and supply nodes in war industry output', () => {
    const out = fmtWarIndustry({
      production_orders: [{
        id: 'prod-1',
        factory_building_id: 'factory-1',
        deployment_hub_id: 'hub-1',
        blueprint_id: 'raider_mk1',
        domain: 'ground',
        count: 2,
        completed_count: 1,
        status: 'in_progress',
        stage: 'assembly',
      }],
      refit_orders: [{
        id: 'refit-1',
        building_id: 'factory-1',
        unit_id: 'squad-1',
        unit_kind: 'squad',
        source_blueprint_id: 'raider_mk1',
        target_blueprint_id: 'raider_support',
        status: 'queued',
      }],
      deployment_hubs: [{
        building_id: 'hub-1',
        building_type: 'battlefield_analysis_base',
        ready_payloads: { raider_mk1: 2 },
      }],
      supply_nodes: [{
        node_id: 'supply_station:sup-1',
        source_type: 'supply_station',
        label: 'Supply Station',
        inventory: { ammo: 5 },
      }],
    });

    assert.match(out, /Production Orders/);
    assert.match(out, /hub-1/);
    assert.match(out, /Supply Nodes/);
  });
});

describe('planet_runtime 施工与物流', () => {
  const runtime = {
    planet_id: 'planet-1-1',
    discovered: true,
    available: true,
    tick: 100,
    threat_level: 0,
    construction_tasks: [
      {
        id: 'c-1', player_id: 'p1', mecha_id: 'u-40', building_type: 'conveyor_belt_mk1',
        building_name: '传送带 Mk.I', position: { x: 71, y: 136, z: 0 },
        state: 'pending', wait_reason: 'insufficient_materials', remaining_ticks: 2, enqueue_tick: 99,
      },
      {
        id: 'c-2', player_id: 'p1', mecha_id: 'u-41', building_type: 'solar_panel',
        position: { x: 10, y: 12, z: 0 },
        state: 'in_progress', remaining_ticks: 1, enqueue_tick: 98,
      },
    ],
    logistics_stations: [{
      building_id: 'b-9', building_type: 'logistics_station', owner_id: 'p1',
      position: { x: 5, y: 5, z: 0 }, drone_ids: ['d-1', 'd-2'], ship_ids: [],
      state: { inventory: { iron_ingot: 40 } },
    }],
    logistics_drones: [
      { id: 'd-1', owner_id: 'p1', station_id: 'b-9', capacity: 100, speed: 4, status: 'in_flight',
        position: { x: 0, y: 0, z: 0 }, remaining_ticks: 3, travel_ticks: 5 },
      { id: 'd-2', owner_id: 'p1', station_id: 'b-9', capacity: 100, speed: 4, status: 'idle',
        position: { x: 0, y: 0, z: 0 }, remaining_ticks: 0, travel_ticks: 5 },
    ],
  } as never;

  it('渲染 construction_tasks（id/类型/坐标/机甲/state/wait_reason/剩余 tick）', () => {
    const out = fmtPlanetRuntime(runtime);
    assert.match(out, /Construction tasks \(2\)/);
    assert.match(out, /c-1\s+传送带 Mk\.I\s+71,136\s+u-40\s+pending\s+insufficient_materials/);
    assert.match(out, /c-2\s+solar_panel\s+10,12\s+u-41\s+in_progress/);
  });

  it('--mine 只看自己机甲的任务', () => {
    const out = fmtPlanetRuntime(runtime, { mineOnly: true, myMechaId: 'u-40' });
    assert.match(out, /Construction tasks \(1 mine, 2 total\)/);
    assert.match(out, /c-1/);
    assert.doesNotMatch(out, /c-2/);
  });

  it('物流摘要：站点表 + 运输器按状态计数', () => {
    const out = fmtPlanetRuntime(runtime);
    assert.match(out, /stations=1\s+drones=2/);
    assert.match(out, /drones idle:1 in_flight:1/);
    assert.match(out, /b-9/);
    assert.match(out, /iron_ingot:40/);
  });
});
