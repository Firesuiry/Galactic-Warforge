import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import type { ApiClient } from '../api.js';
import type { CatalogView, PlanetInspectView, PlanetNetworksView, PlanetSceneView, StateSummary } from '../types.js';

import { cmdCatalog } from './catalog.js';
import { fmtCatalogBuildings, fmtCatalogRecipes, fmtCatalogTechs } from './catalog-format.js';
import { cmdInspect, cmdNetworks, cmdScene, inferInspectKind } from './query.js';
import { fmtInspect, fmtNetworks, fmtScene } from './scene-format.js';
import { centeredWindow, resolvePlanetContext } from './scene-context.js';

const FIXTURE = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/query-fixtures.json'),
  'utf8',
)) as {
  catalog: CatalogView;
  scene: PlanetSceneView;
  inspect_building: PlanetInspectView;
  networks: PlanetNetworksView;
};

const completed = new Set(['dyson_sphere_program']);

const summary = {
  tick: 1,
  active_planet_id: 'planet-1-9',
  surface: { topology: 'cube_sphere', face_size: 32 },
  map_width: 96,
  map_height: 64,
  players: {
    p1: {
      player_id: 'p1',
      is_alive: true,
      focus_planet_id: 'planet-1-2',
      tech: { player_id: 'p1', completed_techs: { dyson_sphere_program: 1 } },
      mechas: [{
        unit_id: 'u-40', planet_id: 'planet-1-1', operator: 'p1', alive: true, respawn_at_tick: 0,
        position: { x: 49, y: 134, z: 0 }, inventory: {}, inventory_slots_used: 0,
        inventory_slots_total: 40, operate_range: 18, concurrent_tasks: 2,
        construction_active: 0, construction_pending: 0,
      }],
    },
  },
} as unknown as StateSummary;

function fakeApi(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  return {
    getAuth: () => ({ playerId: 'p1', issuerId: 'p1', issuerType: 'player' }),
    fetchSummary: async () => summary,
    fetchCatalog: async () => FIXTURE.catalog,
    fetchPlanet: async (planetId: string) => ({ planet_id: planetId, map_width: 864, map_height: 576 }),
    fetchPlanetScene: async () => FIXTURE.scene,
    fetchPlanetInspect: async () => FIXTURE.inspect_building,
    fetchPlanetNetworks: async () => FIXTURE.networks,
    ...overrides,
  } as unknown as ApiClient;
}

describe('catalog tables', () => {
  it('marks buildings unlocked when any unlock_tech is completed', () => {
    const out = fmtCatalogBuildings(FIXTURE.catalog, { completed });
    assert.match(out, /arc_smelter/);
    assert.match(out, /3x3/);
    assert.match(out, /circuit_board×4/);
    assert.match(out, /dyson_sphere_program\s+yes/);
  });

  it('filters by keyword against id and Chinese name', () => {
    assert.match(fmtCatalogBuildings(FIXTURE.catalog, { keyword: '风', completed }), /wind_turbine/);
    assert.doesNotMatch(fmtCatalogBuildings(FIXTURE.catalog, { keyword: '风', completed }), /arc_smelter/);
    assert.match(fmtCatalogBuildings(FIXTURE.catalog, { keyword: 'no-such', completed }), /没有匹配的建筑/);
  });

  it('filters recipes by handcraft and building', () => {
    const handcraft = fmtCatalogRecipes(FIXTURE.catalog, { handcraftOnly: true, completed });
    assert.match(handcraft, /gear/);
    assert.match(handcraft, /smelt_iron/);
    const onlySmelter = fmtCatalogRecipes(FIXTURE.catalog, { building: 'arc_smelter', completed });
    assert.match(onlySmelter, /smelt_iron/);
    assert.doesNotMatch(onlySmelter, /\ngear\s/);
  });

  it('lists only techs whose prerequisites are all done for --available', () => {
    const available = fmtCatalogTechs(FIXTURE.catalog, 'available', completed);
    assert.match(available, /electromagnetism/);
    assert.doesNotMatch(available, /dyson_sphere_program/);
    const done = fmtCatalogTechs(FIXTURE.catalog, 'done', completed);
    assert.match(done, /dyson_sphere_program/);
    assert.doesNotMatch(done, /electromagnetism/);
  });
});

describe('scene defaults and formatting', () => {
  it('resolves the planet from my mecha, then focus, then active', () => {
    assert.equal(resolvePlanetContext(summary, 'p1', 'p1').planetId, 'planet-1-1');
    assert.equal(resolvePlanetContext(summary, 'p1', 'someone-else').planetId, 'planet-1-2');
    assert.equal(resolvePlanetContext(summary, 'p2', 'p2').planetId, 'planet-1-9');
  });

  it('centers a 48x48 window on the mecha and clamps to the atlas', () => {
    assert.deepEqual(centeredWindow({ position: { x: 49, y: 134 } }, 48, 864, 576), { x: 25, y: 110, width: 48, height: 48 });
    assert.deepEqual(centeredWindow({ position: { x: 1, y: 1 } }, 48, 96, 64), { x: 0, y: 0, width: 48, height: 48 });
    assert.deepEqual(centeredWindow({ position: { x: 95, y: 63 } }, 48, 96, 64), { x: 48, y: 16, width: 48, height: 48 });
    assert.deepEqual(centeredWindow(undefined, 48, 20, 16), { x: 0, y: 0, width: 20, height: 16 });
  });

  it('renders buildings, grouped resources and units with the mecha operator', () => {
    const out = fmtScene(FIXTURE.scene, { operators: new Map([['u-40', 'p1']]) });
    assert.match(out, /Buildings \(3\)/);
    assert.match(out, /b-101\s+conveyor_belt_mk1\s+63,144\s+1x1\s+running/);
    assert.match(out, /Resources \(4 kinds, 16 cells\)/);
    assert.match(out, /coal\s+4\s+\d+,\d+\.\.\d+,\d+\s+planet-1-1-res-1693/);
    assert.match(out, /iron_ore\s+4\s+/);
    assert.match(out, /u-40\s+executor\s+49,134\s+p1\s+p1/);
  });

  it('truncates long sections and points at --json', () => {
    const out = fmtScene(FIXTURE.scene, { limit: 1 });
    assert.match(out, /showing 1 of 3/);
    assert.match(out, /--json/);
  });
});

describe('inspect', () => {
  it('infers the entity kind from the id prefix', () => {
    assert.equal(inferInspectKind('b-55'), 'building');
    assert.equal(inferInspectKind('u-40'), 'unit');
    assert.equal(inferInspectKind('planet-1-1-res-1693'), 'resource');
    assert.equal(inferInspectKind('res-12'), 'resource');
    assert.equal(inferInspectKind('1:2'), 'sector');
    assert.equal(inferInspectKind('nope'), undefined);
  });

  it('summarizes state, inventory, production and active alerts', () => {
    const out = fmtInspect(FIXTURE.inspect_building);
    assert.match(out, /arc_smelter/);
    assert.match(out, /state\s+running/);
    assert.match(out, /production\s+recipe=smelt_iron\s+remaining=\d+\s+pending=iron_ingot×1/);
    assert.match(out, /inventory\s+iron_ore×2/);
    assert.match(out, /alerts\s+input_shortage,throughput_drop/);
  });

  it('parses compact and legacy argument forms without a planet', async () => {
    const calls: Array<{ planetId: string; entityKind: string; entityId?: string }> = [];
    const api = fakeApi({
      fetchPlanetInspect: async (planetId: string, params: { entityKind: string; entityId?: string }) => {
        calls.push({ planetId, entityKind: params.entityKind, entityId: params.entityId });
        return FIXTURE.inspect_building;
      },
    });
    const ctx = { api, issuerId: 'p1' };
    assert.match(await cmdInspect(['b-55'], ctx), /arc_smelter/);
    await cmdInspect(['planet-1-1', 'building', 'b-55'], ctx);
    await cmdInspect(['planet-1-1', 'b-55'], ctx);
    assert.deepEqual(calls.map((call) => call.planetId), ['planet-1-1', 'planet-1-1', 'planet-1-1']);
    assert.ok(calls.every((call) => call.entityKind === 'building' && call.entityId === 'b-55'));
  });

  it('rejects ids whose kind cannot be inferred', async () => {
    const out = await cmdInspect(['mystery-id'], { api: fakeApi(), issuerId: 'p1' });
    assert.match(out, /无法从 id 推断类型/);
  });
});

describe('scene argument parsing', () => {
  it('does not treat x as the planet when the planet is omitted', async () => {
    const calls: Array<{ planetId: string; request: unknown }> = [];
    const api = fakeApi({
      fetchPlanetScene: async (planetId: string, request: unknown) => {
        calls.push({ planetId, request });
        return FIXTURE.scene;
      },
    });
    await cmdScene(['40', '130', '16', '12'], { api, issuerId: 'p1' });
    assert.equal(calls[0].planetId, 'planet-1-1');
    assert.deepEqual(calls[0].request, { x: 40, y: 130, width: 16, height: 12 });
  });

  it('defaults to a 48x48 window around my mecha', async () => {
    const calls: Array<{ planetId: string; request: unknown }> = [];
    const api = fakeApi({
      fetchPlanetScene: async (planetId: string, request: unknown) => {
        calls.push({ planetId, request });
        return FIXTURE.scene;
      },
    });
    await cmdScene([], { api, issuerId: 'p1' });
    assert.equal(calls[0].planetId, 'planet-1-1');
    assert.deepEqual(calls[0].request, { x: 25, y: 110, width: 48, height: 48 });
  });

  it('prints raw JSON with --json', async () => {
    const out = await cmdScene(['planet-1-1', '40', '130', '16', '12', '--json'], { api: fakeApi(), issuerId: 'p1' });
    assert.match(out, /"planet_id": "planet-1-1"/);
  });
});

describe('networks', () => {
  it('lists supply, demand, node count and shortage', () => {
    const out = fmtNetworks(FIXTURE.networks);
    assert.match(out, /b-103\s+p1\s+30\s+29\s+1\s+19\s+no/);
    assert.match(out, /Coverage \(4 consumers/);
  });

  it('defaults to the mecha planet', async () => {
    const planets: string[] = [];
    const api = fakeApi({
      fetchPlanetNetworks: async (planetId: string) => {
        planets.push(planetId);
        return FIXTURE.networks;
      },
    });
    await cmdNetworks([], { api, issuerId: 'p1' });
    assert.deepEqual(planets, ['planet-1-1']);
  });
});
