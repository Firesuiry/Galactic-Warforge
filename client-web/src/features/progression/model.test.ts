import { describe, expect, it } from 'vitest';
import type { Building, CatalogView, PlanetSceneView, PlayerState, TechCatalogEntry } from '@shared/types';
import { buildColonyProgression, nextResearchTarget, type ProgressionInput } from './model';

const tech = (id: string, prerequisites: string[] = []): TechCatalogEntry => ({ id, name: id, category: 'main', type: 'main', level: 1, icon_key: id, color: '#fff', prerequisites });
const catalog: CatalogView = {
  techs: [tech('dyson_sphere_program'), tech('electromagnetism', ['dyson_sphere_program']), tech('basic_logistics_system', ['electromagnetism']), tech('interstellar_logistics', ['basic_logistics_system'])],
  buildings: ['wind_turbine', 'matrix_lab', 'interstellar_logistics_station'].map(id => ({ id, name: id, category: 'energy', subcategory: '', footprint: { width: 1, height: 1 }, build_cost: { minerals: 1, energy: 1 }, buildable: true, unlock_tech: [id === 'interstellar_logistics_station' ? 'interstellar_logistics' : 'dyson_sphere_program'], icon_key: id, color: '#fff' })),
};
function building(type: string, owner_id = 'p1'): Building {
  return { id: type, type, owner_id, hp: 100, max_hp: 100, level: 1, vision_range: 1, position: { x: 0, y: 0, z: 0 }, runtime: { state: 'running', params: { energy_consume: 0, energy_generate: 1, capacity: 1, maintenance_cost: { minerals: 0, energy: 0 }, footprint: { width: 1, height: 1 } } } };
}
const player: PlayerState = { player_id: 'p1', is_alive: true, tech: { player_id: 'p1', completed_techs: ['dyson_sphere_program'] } };
const planet = { planet_id: 'planet-1', system_id: 'system-1', buildings: {} } as PlanetSceneView;
const input: ProgressionInput = { catalog, player, planet };
const goal = (value: ProgressionInput, id: string) => buildColonyProgression(value).flatMap(stage => stage.goals).find(entry => entry.id === id)!;

describe('colony progression', () => {
  it('resolves catalog prerequisite chains and never treats absent or cyclic prerequisites as available', () => {
    expect(nextResearchTarget('interstellar_logistics', catalog.techs!, new Set(['dyson_sphere_program']))?.id).toBe('electromagnetism');
    expect(nextResearchTarget('a', [tech('a', ['b']), tech('b', ['a'])], new Set())).toBeUndefined();
    expect(nextResearchTarget('a', [tech('a', ['missing'])], new Set())).toBeUndefined();
  });

  it('offers unlocked builds and redirects locked buildings to their actual prerequisite route', () => {
    expect(goal(input, 'building:wind_turbine').action.to).toBe('/planet/planet-1?build=wind_turbine');
    expect(goal(input, 'building:interstellar_logistics_station').action.label).toContain('电磁学');
    expect(goal(input, 'building:interstellar_logistics_station').action.to).toContain('workflow=research');
    expect(goal({ ...input, catalog: {} }, 'building:wind_turbine').action.to).toBe('/tech');
  });

  it('requires actual owned surviving buildings and completed research', () => {
    const populated = { ...input, planet: { ...planet, buildings: { wind: building('wind_turbine'), lab: building('matrix_lab', 'enemy') } } };
    expect(goal(populated, 'building:wind_turbine').complete).toBe(true);
    expect(goal(populated, 'building:matrix_lab').complete).toBe(false);
    expect(buildColonyProgression(populated)[0].complete).toBe(false);
    populated.planet.buildings.lab = building('matrix_lab');
    expect(buildColonyProgression({ ...populated, player: { ...player, tech: { player_id: 'p1', completed_techs: ['electromagnetism'] } } })[0].complete).toBe(true);
    populated.planet.buildings.wind.hp = 0;
    expect(goal(populated, 'building:wind_turbine').complete).toBe(false);
  });

  it('only accepts running matrix recipes from the real catalog', () => {
    const lab = { ...building('matrix_lab'), production: { recipe_id: 'matrix_recipe', remaining_ticks: 2 } };
    const state: ProgressionInput = { ...input, planet: { ...planet, buildings: { lab } }, catalog: { ...catalog, recipes: [{ id: 'matrix_recipe', name: '矩阵', inputs: [], outputs: [{ item_id: 'energy_matrix', quantity: 1 }], duration: 1, energy_cost: 1, icon_key: '', color: '' }] } };
    expect(goal(state, 'matrix-production').complete).toBe(true);
    lab.production.remaining_ticks = 0;
    expect(goal(state, 'matrix-production').complete).toBe(false);
    lab.production.remaining_ticks = 2;
    lab.runtime.state = 'no_power';
    expect(goal(state, 'matrix-production').complete).toBe(false);
    lab.runtime.state = 'running';
    expect(goal({ ...state, catalog }, 'matrix-production').complete).toBe(false);
  });

  it('does not count another player or system stellar energy', () => {
    const systemRuntime = { system_id: 'system-1', discovered: true, available: true, solar_sail_orbit: { player_id: 'enemy', system_id: 'system-1', sails: [], total_energy: 500 } };
    expect(goal({ ...input, systemRuntime }, 'stellar-energy').complete).toBe(false);
    systemRuntime.solar_sail_orbit.player_id = 'p1';
    expect(goal({ ...input, systemRuntime }, 'stellar-energy').complete).toBe(true);
    expect(goal({ ...input, systemRuntime: { ...systemRuntime, system_id: 'system-2' } }, 'stellar-energy').complete).toBe(false);
    expect(goal({ ...input, systemRuntime: { ...systemRuntime, available: false } }, 'stellar-energy').complete).toBe(false);
  });

  it('keeps logistics goals incomplete when runtime is unavailable or belongs to another planet', () => {
    const runtime = { planet_id: 'planet-1', discovered: true, available: true, tick: 1, threat_level: 0, logistics_stations: [{ building_id: 'station', building_type: 'planetary_logistics_station', owner_id: 'p1', position: { x: 0, y: 0, z: 0 }, drone_ids: ['drone-1'], ship_ids: ['ship-1'] }] };
    expect(goal({ ...input, runtime }, 'logistics-drone').complete).toBe(true);
    expect(goal({ ...input, runtime }, 'logistics-ship').complete).toBe(true);
    expect(goal({ ...input, runtime: { ...runtime, available: false } }, 'logistics-ship').complete).toBe(false);
    expect(goal({ ...input, runtime: { ...runtime, planet_id: 'planet-2' } }, 'logistics-drone').complete).toBe(false);
  });
});
