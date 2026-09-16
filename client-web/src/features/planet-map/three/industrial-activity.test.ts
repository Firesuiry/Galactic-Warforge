import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building } from '@shared/types';
import type { PlanetThreeData } from '../planet-three-scene';
import { collectActivity, IndustrialActivity } from './industrial-activity';

function fixture(): PlanetThreeData {
  return {
    planet: { planet_id: 'p', surface: {topology:'cube_sphere',face_size:4}, map_width: 12, map_height: 8, buildings: {}, units: {}, resources: [], terrain: [] },
    catalog: { buildings: [{ id: 'arc_smelter', requires_resource_node: false }] },
    fog: { planet_id: 'p', surface: {topology:'cube_sphere',face_size:4}, map_width: 12, map_height: 8, visible: Array.from({ length: 4 }, () => [true, true, true, true]), explored: [] },
  } as unknown as PlanetThreeData;
}
function factory(state = 'running'): Building {
  return { id: 'b', type: 'arc_smelter', position: { x: 1, y: 1, z: 0 }, owner_id: 'p1',
    runtime: { state, functions: { production: { throughput: 1 }, collect: { yield_per_tick: 1 }, energy: { output_per_tick: 1 } } },
    production: { remaining_ticks: 5 }, conveyor: { output: 'east', input: 'west', buffer: [{ item_id: 'iron_ore', quantity: 12 }] },
  } as unknown as Building;
}

describe('authoritative industrial activity', () => {
  it.each(['idle', 'paused', 'no_power', 'error'])('%s buildings retain actual stationary cargo but never emit production effects', state => {
    const data = fixture(); data.planet.buildings!.b = factory(state);
    expect(collectActivity(data)).toMatchObject([{ kind: 'cargo', active: false, itemId: 'iron_ore', quantity: 12 }]);
    expect(collectActivity(data)).toHaveLength(1);
  });
  it('requires visible tiles and an active recipe for furnace heat', () => {
    const data = fixture(); const building = factory(); data.planet.buildings!.b = building;
    expect(collectActivity(data).map(source => source.kind)).toEqual(['cargo', 'energy', 'mining', 'heat']);
    building.production!.remaining_ticks = 0;
    expect(collectActivity(data).some(source => source.kind === 'heat')).toBe(false);
    data.fog!.visible![1][1] = false;
    expect(collectActivity(data)).toEqual([]);
  });
  it('never invents conveyor inventory or idle logistics flights', () => {
    const data = fixture(); const building = factory(); building.conveyor!.buffer = [];
    data.planet.buildings!.b = building;
    data.runtime = { tick: 1, logistics_drones: [
      { id: 'idle', status: 'idle', position: { x: 1, y: 1 } },
      { id: 'active', status: 'in_flight', position: { x: 2, y: 1 } },
      { id: 'hidden', status: 'takeoff', position: { x: 3, y: 1 } },
    ] } as unknown as PlanetThreeData['runtime'];
    data.fog!.visible![1][3] = false;
    const sources = collectActivity(data);
    expect(sources.filter(source => source.kind === 'cargo')).toEqual([]);
    expect(sources.filter(source => source.kind === 'flight')).toMatchObject([{ id: 'flight:active', position: { x: 2, y: 1 } }]);
    expect(sources.filter(source => source.kind === 'flight')).toHaveLength(1);
  });

  it('hides interplanetary flights and remote exhaust, and keeps cargo waits still', () => {
    const data = fixture();
    const base = { status: 'in_flight', position: { x: 1, y: 1, z: 0 }, target_pos: { x: 2, y: 1, z: 0 }, remaining_ticks: 5, travel_ticks: 10 };
    data.runtime = { logistics_ships: [
      { ...base, id: 'departing', current_planet_id: 'p', target_planet_id: 'remote' },
      { ...base, id: 'remote', current_planet_id: 'remote', target_planet_id: 'p' },
      { ...base, id: 'waiting', current_planet_id: 'p', target_planet_id: 'p', status: 'waiting_unload' },
      { ...base, id: 'local', current_planet_id: 'p', target_planet_id: 'p' },
    ] } as unknown as PlanetThreeData['runtime'];
    const sources = collectActivity(data);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('flight:local');
    expect(sources[0].normal?.length()).toBeCloseTo(1);
  });

  it.each([
    ['finite', 0, 8, false], ['finite', 20, 0, false], ['finite', 20, 8, true],
    ['renewable', 0, 8, false], ['renewable', 20, 8, true],
    ['decay', 0, 0, false], ['decay', 0, 8, true], ['unknown', 20, 8, false],
  ])('resource-dependent running collector: %s remaining=%s yield=%s emits=%s', (behavior, remaining, currentYield, emits) => {
    const data = fixture(); data.planet.buildings!.b = factory();
    data.catalog!.buildings![0].requires_resource_node = true;
    data.planet.resources = [{ id: 'ore', planet_id: 'p', kind: 'iron_ore', position: { x: 1, y: 1, z: 0 },
      behavior: String(behavior), remaining: Number(remaining), current_yield: Number(currentYield) }];
    expect(collectActivity(data).some(source => source.kind === 'mining')).toBe(emits);
  });
  it('does not invent production for a missing node or unknown catalog, while independent collectors still work', () => {
    const data = fixture(); data.planet.buildings!.b = factory();
    expect(collectActivity(data).some(source => source.kind === 'mining')).toBe(true);
    data.catalog!.buildings![0].requires_resource_node = true;
    expect(collectActivity(data).some(source => source.kind === 'mining')).toBe(false);
    data.catalog = undefined;
    expect(collectActivity(data).some(source => source.kind === 'mining')).toBe(false);
  });

  it('freezes cargo on pause and immediately removes stopped production effects', () => {
    const data = fixture(); data.planet.buildings!.b = factory();
    const world = new THREE.Group(); const activity = new IndustrialActivity(world);
    activity.update(data); activity.animate(.1, 0);
    const cargo = world.children[0].children[0] as THREE.InstancedMesh;
    const particles = world.children[0].children[1] as THREE.Points;
    const previous = cargo.instanceMatrix.array.slice(0, 16);
    activity.animate(.5, 20, { paused: true });
    expect(cargo.instanceMatrix.array.slice(0, 16)).toEqual(previous);
    data.planet.buildings!.b.runtime.state = 'idle';
    activity.update(data); activity.animate(.1, 21);
    expect(particles.geometry.drawRange.count).toBe(0);
    expect(cargo.count).toBe(1);
    activity.destroy(); expect(world.children).toHaveLength(0);
  });
});
