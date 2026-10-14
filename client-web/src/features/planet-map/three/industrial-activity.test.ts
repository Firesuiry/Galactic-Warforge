import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building } from '@shared/types';
import type { PlanetThreeData } from '../planet-three-scene';
import { collectActivity, itemColor, IndustrialActivity, BELT_CARGO_CELL, BELT_CARGO_MAX_PER_STACK } from './industrial-activity';
import { getItemColorValue } from '../item-colors';
import { tileNormal, surfaceTileSize } from './projection';

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

  it('uses current bot positions directly and emits no flight trail for docked or stranded bots', () => {
    const data = fixture();
    const position = { x: 1, y: 2, z: 1 };
    data.runtime = { logistics_bots: [
      { id: 'moving', status: 'in_flight', position, target_pos: { x: 3, y: 2 }, remaining_ticks: 1, travel_ticks: 10 },
      { id: 'idle', status: 'idle', position },
      { id: 'stranded', status: 'stranded', position },
      { id: 'waiting', status: 'waiting_unload', position },
    ] } as unknown as PlanetThreeData['runtime'];
    const sources = collectActivity(data);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: 'bot-flight:moving', altitude: 1.05 });
    expect(sources[0].normal!.distanceTo(tileNormal(position, 4))).toBeLessThan(1e-10);
    data.fog!.visible![2][1] = false;
    expect(collectActivity(data)).toHaveLength(0);
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
    // 一堆 12 件画 BELT_CARGO_MAX_PER_STACK 个小方块（不是一件一个满格大方块）。
    expect(cargo.count).toBe(BELT_CARGO_MAX_PER_STACK);
    activity.destroy(); expect(world.children).toHaveLength(0);
  });

  it('draws one small cube per item up to the cap, each BELT_CARGO_CELL wide', () => {
    const data = fixture(); const building = factory();
    building.conveyor!.buffer = [{ item_id: 'iron_ore', quantity: 2 }, { item_id: 'gear', quantity: 9 }];
    data.planet.buildings!.b = building;
    const world = new THREE.Group(); const activity = new IndustrialActivity(world);
    activity.update(data); activity.animate(.1, 0);
    const cargo = world.children[0].children[0] as THREE.InstancedMesh;
    // 2 件 → 2 个，9 件（超上限）→ BELT_CARGO_MAX_PER_STACK 个。
    expect(cargo.count).toBe(2 + BELT_CARGO_MAX_PER_STACK);
    const size = surfaceTileSize(100, 4);
    const scale = new THREE.Vector3();
    for (let i = 0; i < cargo.count; i++) {
      const matrix = new THREE.Matrix4().fromArray(cargo.instanceMatrix.array, i * 16);
      matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      // 方块边长 = 0.3 cell：远小于 0.52 cell 的带宽，一格内可见多个。
      // instanceMatrix 是 Float32，比较放到 1e-5 的相对精度即可。
      expect(scale.x).toBeCloseTo(size * BELT_CARGO_CELL, 5);
      expect(scale.x).toBeLessThan(size * .52);
    }
    activity.destroy();
  });

  it('writes each belt cube the item colour in sRGB, and keeps the cargo material non-metallic', () => {
    const data = fixture(); const building = factory();
    // 目录只按大类给色（矿石同色、材料同色），带上必须用 item-colors 的逐物品色。
    data.catalog!.items = [
      { id: 'iron_ingot', color: '#74c0fc' }, { id: 'copper_ingot', color: '#74c0fc' }, { id: 'gear', color: '#74c0fc' },
    ] as never;
    building.conveyor!.buffer = [{ item_id: 'iron_ingot', quantity: 1 }, { item_id: 'copper_ingot', quantity: 1 }, { item_id: 'gear', quantity: 1 }];
    data.planet.buildings!.b = building;
    const world = new THREE.Group(); const activity = new IndustrialActivity(world);
    activity.update(data); activity.animate(.1, 0);
    const cargo = world.children[0].children[0] as THREE.InstancedMesh;
    const material = cargo.material as THREE.MeshStandardMaterial;
    // 金属度过高时实例色几乎全部来自环境反射，浅色物品（铁块/石材）会被压成同一种白。
    expect(material.metalness).toBeLessThanOrEqual(.1);
    const read = (index: number) => {
      const c = new THREE.Color(); cargo.getColorAt(index, c);
      return c.getHexString();
    };
    // 实例色必须与 item-colors 的 hex 同色（sRGB → 线性只做一次转换，不能两次或零次）。
    // 期望值取自配色表本身（而不是把 hex 抄在这里）：换色时测试跟着走，
    // 真正断言的是「目录色被忽略、走的是 item-colors、且只转了一次 sRGB」。
    expect(read(0)).toBe(itemColor(getItemColorValue('iron_ingot', '#74c0fc')).getHexString());
    expect(read(1)).toBe(itemColor(getItemColorValue('copper_ingot', '#74c0fc')).getHexString());
    expect(read(2)).toBe(itemColor(getItemColorValue('gear', '#74c0fc')).getHexString());
    expect(new Set([read(0), read(1), read(2)]).size).toBe(3);
    activity.destroy();
  });
});
