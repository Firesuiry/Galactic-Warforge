import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createApiClient } from './api.js';

describe('refuel_mecha request serialization', () => {
  it('serializes executor target and fuel payload', async () => {
    let requestBody = '';
    const api = createApiClient({
      serverUrl: 'http://test.local',
      auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: async (_input, init) => {
        requestBody = String(init?.body ?? '');
        return { ok: true, json: async () => ({ accepted: true }) } as Response;
      },
    });
    await api.cmdRefuelMecha('executor-1', 'fuel-rod', 3);
    const request = JSON.parse(requestBody) as { issuer_id: string; commands: Array<{ type: string; target: Record<string, string>; payload: Record<string, unknown> }> };
    assert.equal(request.issuer_id, 'p1');
    assert.deepEqual(request.commands[0], {
      type: 'refuel_mecha',
      target: { layer: 'planet', entity_id: 'executor-1' },
      payload: { item_id: 'fuel-rod', quantity: 3 },
    });
  });
});


describe('personal mecha job request serialization', () => {
  it('sends resource IDs, recipe batch counts, and cancellation through distinct command payloads', async () => {
    const requests: Array<{ url: string; method?: string; body: Record<string, unknown> }> = [];
    const api = createApiClient({
      serverUrl: 'http://test.local',
      auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: async (input, init) => {
        requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
        return { ok: true, json: async () => ({ accepted: true }) } as Response;
      },
    });
    await api.cmdMineResource('executor-1', 'node:iron:4:5', 7);
    await api.cmdCraftItem('executor-1', 'magnetic_coil', 3);
    await api.cmdCancelMechaJob('executor-1');
    const target = { layer: 'planet', entity_id: 'executor-1' };
    assert.deepEqual(requests.map(request => request.body.commands), [
      [{ type: 'mine_resource', target, payload: { resource_id: 'node:iron:4:5', quantity: 7 } }],
      [{ type: 'craft_item', target, payload: { recipe_id: 'magnetic_coil', quantity: 3 } }],
      [{ type: 'cancel_mecha_job', target }],
    ]);
    for (const request of requests) {
      assert.equal(request.url, 'http://test.local/commands');
      assert.equal(request.method, 'POST');
      assert.equal(request.body.issuer_id, 'p1');
      assert.equal(request.body.issuer_type, 'player');
      assert.equal(typeof request.body.request_id, 'string');
    }
    assert.equal(new Set(requests.map(request => request.body.request_id)).size, 3);
  });
});


describe('splitter request serialization', () => {
  it('sends exact port priority and item filters and supports clearing optional settings', async () => {
    const commands: unknown[] = [];
    const api = createApiClient({ serverUrl: 'http://test.local', auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: async (_input, init) => {
        commands.push(...JSON.parse(String(init?.body)).commands);
        return { ok: true, json: async () => ({ accepted: true }) } as Response;
      } });
    await api.cmdConfigureSplitter('splitter-1', { input_directions: ['west'], output_directions: ['east', 'south'], output_priority: 'east', output_filters: { east: 'iron_ore' } });
    await api.cmdConfigureSplitter('splitter-1', { input_directions: ['north'], output_directions: ['south'], input_priority: '', output_priority: '', output_filters: {} });
    assert.deepEqual(commands, [
      { type: 'configure_splitter', target: { layer: 'planet', entity_id: 'splitter-1' }, payload: { input_directions: ['west'], output_directions: ['east', 'south'], output_priority: 'east', output_filters: { east: 'iron_ore' } } },
      { type: 'configure_splitter', target: { layer: 'planet', entity_id: 'splitter-1' }, payload: { input_directions: ['north'], output_directions: ['south'], input_priority: '', output_priority: '', output_filters: {} } },
    ]);
  });
});

describe('traffic monitor request serialization', () => {
  it('preserves numeric thresholds and boolean alarm disabling with empty binding', async () => {
    const commands: unknown[] = [];
    const api = createApiClient({ serverUrl: 'http://test.local', auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: async (_input, init) => { commands.push(...JSON.parse(String(init?.body)).commands); return { ok: true, json: async () => ({ accepted: true }) } as Response; } });
    const config = { target_belt_id: '', window_ticks: 10, minimum_items_per_tick: .5, alerts_enabled: false };
    await api.cmdConfigureTrafficMonitor('monitor', config);
    assert.deepEqual(commands, [{ type: 'configure_traffic_monitor', target: { layer: 'planet', entity_id: 'monitor' }, payload: config }]);
  });
});


describe('logistics station requests', () => {
  it('preserves omitted ports, explicit clearing and safe slot removal in the wire protocol', async () => {
    const commands: unknown[] = [];
    const api = createApiClient({ serverUrl: 'http://test.local', auth: { playerId: 'p1', playerKey: 'key' },
      fetchFn: async (_input, init) => { commands.push(...JSON.parse(String(init?.body)).commands); return { ok: true, json: async () => ({ accepted: true }) } as Response; } });
    await api.cmdInstallLogisticsVehicle('s', 'logistics_drone', 2);
    await api.cmdInstallLogisticsVehicle('s', 'logistics_vessel', 1, 'station');
    await api.cmdConfigureLogisticsStation('s', { droneCapacity: 3 });
    await api.cmdConfigureLogisticsStation('s', { beltPorts: {} });
    await api.cmdConfigureLogisticsStation('s', { beltPorts: { west: { mode: 'input', item_id: 'iron_ore' } } });
    await api.cmdConfigureLogisticsSlot('s', { scope: 'planetary', itemId: 'iron_ore', mode: 'none', localStorage: 0, remove: true });
    const target = { layer: 'planet', entity_id: 's' };
    assert.deepEqual(commands, [
      { type: 'install_logistics_vehicle', target, payload: { item_id: 'logistics_drone', quantity: 2, source: 'player' } },
      { type: 'install_logistics_vehicle', target, payload: { item_id: 'logistics_vessel', quantity: 1, source: 'station' } },
      { type: 'configure_logistics_station', target, payload: { drone_capacity: 3 } },
      { type: 'configure_logistics_station', target, payload: { belt_ports: {} } },
      { type: 'configure_logistics_station', target, payload: { belt_ports: { west: { mode: 'input', item_id: 'iron_ore' } } } },
      { type: 'configure_logistics_slot', target, payload: { scope: 'planetary', item_id: 'iron_ore', mode: 'none', local_storage: 0, remove: true } },
    ]);
  });
});
