import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PUBLIC_COMMAND_DEFINITIONS } from '../../../shared-client/src/command-catalog.js';

import { setAuth } from '../api.js';
import { fmtSummary } from '../format.js';
import { COMMANDS, dispatch } from './index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setAuth('', '');
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('public command CLI coverage', () => {
  it('registers a named verb for every shared public command', async () => {
    for (const definition of PUBLIC_COMMAND_DEFINITIONS) {
      assert.ok(definition.cliCommandName, `public command ${definition.id} missing CLI verb`);
      const name = definition.cliCommandName as string;
      assert.equal(typeof COMMANDS[name]?.handler, 'function', `CLI missing named handler for ${definition.id} as ${name}`);
      const help = await dispatch(`help ${name}`, { currentPlayer: 'p1', rl: {} });
      assert.doesNotMatch(help, /Unknown command/, help);
      assert.match(help, new RegExp(name));
    }

    const docs = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../docs/dev/客户端CLI.md'),
      'utf8',
    );
    for (const definition of PUBLIC_COMMAND_DEFINITIONS) {
      const name = definition.cliCommandName as string;
      assert.match(docs, new RegExp(`\\|\\s*\`${name}\``), `CLI docs missing named command ${name}`);
    }
  });

  it('parses a previously main-table-omitted command and serializes catalog type plus required fields', async () => {
    const definition = PUBLIC_COMMAND_DEFINITIONS.find((entry) => entry.cliCommandName === 'configure_traffic_monitor');
    assert.ok(definition, 'shared catalog must define configure_traffic_monitor');

    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return jsonResponse({
        accepted: true,
        request_id: 'req-traffic',
        enqueue_tick: 1,
        results: [{ command_index: 0, status: 'accepted', code: 'OK', message: 'ok' }],
      });
    }) as typeof fetch;
    setAuth('p1', 'key_player_1');

    const out = await dispatch(
      'configure_traffic_monitor monitor-1 belt-9 --window 12 --minimum 0.25 --alerts off',
      { currentPlayer: 'p1', rl: {} },
    );
    assert.match(out, /ACCEPTED/);
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/commands$/);
    const command = (posts[0].body.commands as Array<Record<string, unknown>>)[0];
    assert.equal(command.type, definition.apiCommandName);
    assert.deepEqual(command.target, { layer: definition.layer, entity_id: 'monitor-1' });
    assert.deepEqual(command.payload, {
      target_belt_id: 'belt-9',
      window_ticks: 12,
      minimum_items_per_tick: 0.25,
      alerts_enabled: false,
    });
  });
});

describe('observation query CLI paths', () => {
  it('sends summary, inspect, stats and catalog_commands to the real query endpoints', async () => {
    const gets: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      gets.push(url);
      if (url.includes('/state/summary')) {
        return jsonResponse({
          tick: 9,
          active_planet_id: 'planet-1-1',
          map_width: 48,
          map_height: 32,
          players: {
            p1: {
              player_id: 'p1',
              is_alive: true,
              resources: { minerals: 10, energy: 4 },
              inventory: { steel: 2, iron_ingot: 1 },
            },
          },
        });
      }
      if (url.includes('/state/stats')) {
        return jsonResponse({
          player_id: 'p1',
          tick: 9,
          production_stats: { total_output: 3, efficiency: 1, by_building_type: {}, by_item: { steel: 2 } },
          energy_stats: { generation: 1, consumption: 1, storage: 0, current_stored: 0, shortage_ticks: 0 },
          logistics_stats: { throughput: 0, avg_distance: 0, avg_travel_time: 0, deliveries: 0 },
          combat_stats: { units_lost: 0, enemies_killed: 0, threat_level: 0, highest_threat: 0 },
        });
      }
      if (url.includes('/catalog/commands')) {
        return jsonResponse({ version: 1, commands: [{ type: 'build' }] });
      }
      if (url.includes('/inspect')) {
        return jsonResponse({ entity_id: 'b-1', entity_kind: 'building' });
      }
      return jsonResponse({ error: `unexpected ${url}` }, 500);
    }) as typeof fetch;
    setAuth('p1', 'key_player_1');

    const ctx = { currentPlayer: 'p1', rl: {} };
    const summary = await dispatch('summary', ctx);
    const stats = await dispatch('stats', ctx);
    const catalog = await dispatch('catalog_commands', ctx);
    const inspect = await dispatch('inspect planet-1-1 building b-1', ctx);

    assert.match(gets[0] ?? '', /\/state\/summary$/);
    assert.match(gets[1] ?? '', /\/state\/stats$/);
    assert.match(gets[2] ?? '', /\/catalog\/commands$/);
    assert.match(gets[3] ?? '', /\/world\/planets\/planet-1-1\/inspect\?/);
    assert.match(gets[3] ?? '', /entity_kind=building/);
    assert.match(gets[3] ?? '', /entity_id=b-1/);
    assert.match(summary, /Tick:/);
    assert.match(summary, /steel:2/);
    assert.match(stats, /by_item=steel:2/);
    assert.match(catalog, /build/);
    assert.match(inspect, /"entity_id": "b-1"/);
  });
});

describe('summary inventory rendering', () => {
  it('prints player inventory so craft and transfer results are visible', () => {
    const out = fmtSummary({
      tick: 4,
      active_planet_id: 'planet-1-1',
      map_width: 8,
      map_height: 8,
      surface: { topology: 'cube_sphere', face_size: 4 },
      players: {
        p1: { player_id: 'p1', is_alive: true, executor: { unit_id: 'u-6' }, inventory: { steel: 1, coal: 0 } },
      },
    } as never);
    assert.match(out, /Inventory p1: steel:1/);
    assert.match(out, /u-6/);
    assert.doesNotMatch(out, /coal/);
  });
});
