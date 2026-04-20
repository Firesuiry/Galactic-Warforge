import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fmtSystemRuntime, fmtWarIndustry } from './format.js';

describe('warfare formatting', () => {
  it('renders contacts, blockades, landings and battle reports in system runtime output', () => {
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
      landing_operations: [{
        id: 'landing-1',
        owner_id: 'p1',
        task_force_id: 'tf-1',
        system_id: 'sys-1',
        planet_id: 'planet-1-1',
        stage: 'landing_window_open',
        result: 'pending',
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
    assert.match(out, /landing-1/);
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
        node_id: 'hub:hub-1',
        source_type: 'orbital_supply_port',
        label: 'Orbital Supply Port',
        inventory: { ammo: 5 },
      }],
    });

    assert.match(out, /Production Orders/);
    assert.match(out, /hub-1/);
    assert.match(out, /Supply Nodes/);
  });
});
