import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import type { Building, PortDirection, SplitterConfig } from '@shared/types';
import { ConveyorGeometry, conveyorPaths } from './conveyor-geometry';
import { surfaceTileSize, tileNormal } from './projection';

const opposite: Record<SurfaceDirection,SurfaceDirection> = { north:'south', east:'west', south:'north', west:'east' };
const belt = (id:string,x:number,y:number,output:SurfaceDirection = 'east',input:SurfaceDirection = opposite[output],owner = 'p'):Building => ({
  id, type:'conveyor_belt_mk1', position:{x,y,z:0}, owner_id:owner, conveyor:{input,output},
} as Building);
const machine = (x: number, y: number, direction: PortDirection, owner = 'p', offset = { x: 0, y: 0 }): Building => ({
  id: 'machine', type: 'arc_smelter', position: { x, y, z: 0 }, owner_id: owner, storage: {},
  runtime: { params: { io_ports: [{ id: 'port', direction, offset, capacity: 1 }] } },
} as Building);
const splitter = (x: number, y: number, config: SplitterConfig = { input_directions: ['west'], output_directions: ['east', 'north', 'south'] }): Building => ({
  ...belt('splitter', x, y), type: 'splitter',
  splitter: { ...config, input_cursor: 0, output_cursor: 0, transferred_items: 0, last_transfer_tick: 0 },
});

describe('continuous surface conveyor paths', () => {
  it('joins every configured splitter branch and leaves closed or reversed ports capped', () => {
    const hub = splitter(6, 6);
    const paths = conveyorPaths([belt('in', 5, 6), hub, belt('east', 7, 6), belt('south', 6, 7, 'south'), belt('north', 6, 5, 'north')], 16);
    const branches = paths.filter(path => path.building.id === 'splitter');
    expect(branches).toHaveLength(3);
    for (const branch of branches) {
      expect(branch.point(0).distanceTo(paths.find(p => p.building.id === 'in')!.point(1))).toBeLessThan(1e-10);
      expect(branch.point(1).distanceTo(paths.find(p => p.building.id === branch.output)!.point(0))).toBeLessThan(1e-10);
    }
    const closed = splitter(6, 6, { input_directions: ['west'], output_directions: ['east'] });
    const south = conveyorPaths([closed, belt('south', 6, 7, 'north')], 16).find(p => p.building.id === 'south')!;
    expect(south.connected.size).toBe(0);
    expect(conveyorPaths([splitter(6, 6), machine(7, 6, 'input')], 16).every(p => !p.connected.has('east'))).toBe(true);
  });

  it('curves out of a real miner port and reaches the receiving factory base', () => {
    const paths = conveyorPaths([belt('a', 5, 5), belt('b', 6, 5),
      machine(5, 6, 'output'), { ...machine(7, 5, 'input'), id: 'factory' }], 16);
    expect(paths[0].input).toBe('south');
    expect(paths[0].point(0).clone().normalize().distanceTo(tileNormal({ x: 5, y: 5.64 }, 16))).toBeLessThan(1e-10);
    expect(paths[0].point(1).distanceTo(paths[1].point(0))).toBeLessThan(1e-10);
    expect(paths[1].connected.has('east')).toBe(true);
    expect(paths[1].point(1).clone().normalize().distanceTo(tileNormal({ x: 6.64, y: 5 }, 16))).toBeLessThan(1e-10);
  });

  it('does not invent machine connections through reversed, hostile or absent ports', () => {
    for (const neighbor of [machine(6, 5, 'output'), machine(6, 5, 'input', 'enemy'),
      { ...machine(6, 5, 'input'), storage: undefined },
      { ...machine(6, 5, 'input'), runtime: { ...machine(6, 5, 'input').runtime, params: { ...machine(6, 5, 'input').runtime.params, io_ports: [] } } }]) {
      expect(conveyorPaths([belt('a', 5, 5), neighbor], 16)[0].connected.size).toBe(0);
    }
  });

  it('finds offset machine ports and ports across rotated cube seams', () => {
    expect(conveyorPaths([belt('a', 5, 5), machine(6, 4, 'input', 'p', { x: 0, y: 1 })], 16)[0].connected.has('east')).toBe(true);
    for (let face = 0; face < 6; face++) for (const direction of Object.keys(opposite) as SurfaceDirection[]) {
      const x = face % 3 * 16 + (direction === 'east' ? 15 : direction === 'west' ? 0 : 7);
      const y = Math.floor(face / 3) * 16 + (direction === 'south' ? 15 : direction === 'north' ? 0 : 7);
      const next = surfaceStep({ x, y }, direction, 16);
      const path = conveyorPaths([belt('a', x, y, direction), machine(next.tile.x, next.tile.y, 'input')], 16)[0];
      expect(path.connected.has(direction)).toBe(true);
    }
  });
  it('joins a line at exact cell boundaries at both narrow and wide surface cells', () => {
    for (const [x,y] of [[1,1],[8,8],[14,7]]) {
      const paths = conveyorPaths([belt('a',x,y),belt('b',x+1,y)],16);
      expect(paths[0].point(1).distanceTo(paths[1].point(0))).toBeLessThan(1e-10);
      expect(paths[0].side(1).dot(paths[1].side(0))).toBeCloseTo(1,9);
      expect(paths[0].connected.has('east')).toBe(true);
      expect(paths[0].point(.5).length()).toBeCloseTo(100+surfaceTileSize(100,16)*.19,10);
    }
  });

  it('turns into the actual incoming neighbor without drawing a phantom straight extension', () => {
    const paths = conveyorPaths([belt('a',5,5),belt('b',6,5,'south'),belt('c',6,6,'south')],16);
    const turn = paths.find(path=>path.building.id==='b')!;
    expect([turn.input,turn.output]).toEqual(['west','south']);
    expect(turn.point(0).distanceTo(paths[0].point(1))).toBeLessThan(1e-10);
    expect(turn.point(1).distanceTo(paths[2].point(0))).toBeLessThan(1e-10);
    expect([...turn.connected].sort()).toEqual(['south','west']);
    const midpoint = turn.point(.5).normalize();
    expect(midpoint.distanceTo(tileNormal({x:6,y:5},16))).toBeGreaterThan(.001);
  });

  it('joins all 24 rotated cube seams with matching rail cross sections', () => {
    const size=16;
    for(let face=0;face<6;face++) for(const direction of Object.keys(opposite) as SurfaceDirection[]) {
      const x=face%3*size+(direction==='east'?size-1:direction==='west'?0:7);
      const y=Math.floor(face/3)*size+(direction==='south'?size-1:direction==='north'?0:7);
      const next=surfaceStep({x,y},direction,size);
      const paths=conveyorPaths([belt('a',x,y,direction),belt('b',next.tile.x,next.tile.y,next.direction)],size);
      const a=paths[0],b=paths[1];
      expect(a.point(1).distanceTo(b.point(0))).toBeLessThan(1e-10);
      expect(a.side(1).dot(b.side(0))).toBeCloseTo(1,8);
    }
  });

  it('caps missing, hidden, hostile and incompatible neighbors within their own tiles', () => {
    const source=belt('a',7,7);
    for(const neighbors of [[],[belt('b',8,7,'east','west','enemy')],[belt('b',8,7,'west')],[belt('b',8,7,'south','east')]]) {
      const path=conveyorPaths([source,...neighbors],16)[0];
      expect(path.connected.size).toBe(0);
      expect(path.point(1).clone().normalize().distanceTo(tileNormal({x:7.36,y:7},16))).toBeLessThan(1e-10);
    }
  });

  it('supports real side merges and separate parallel lanes without connecting them', () => {
    const paths=conveyorPaths([belt('a',5,5),belt('b',6,5),belt('c',6,4,'south'),belt('parallel',5,6)],16);
    const merge=paths.filter(path=>path.building.id==='b');
    expect(merge).toHaveLength(2);
    expect(merge.map(path=>path.input).sort()).toEqual(['north','west']);
    expect(paths.find(path=>path.building.id==='a')!.connected.has('south')).toBe(false);
    expect(paths.find(path=>path.building.id==='parallel')!.connected.size).toBe(0);
  });
});

describe('conveyor rendering batches', () => {
  it('rebuilds endpoints after a machine is added or removed without inventory churn', () => {
    const renderer = new ConveyorGeometry(), lane = belt('belt', 5, 5), factory = machine(6, 5, 'input');
    renderer.refresh([lane], 16);
    const before = renderer.group.children[0];
    expect(renderer.refresh([lane, factory], 16)).toBe(true);
    expect(renderer.group.children[0]).not.toBe(before);
    expect(renderer.refresh([lane, { ...factory, storage: { inventory: { iron_ingot: 3 } } }], 16)).toBe(false);
    expect(renderer.refresh([lane], 16)).toBe(true);
    renderer.dispose();
  });
  it('keeps the whole network at three draws and picks the correct original tile', () => {
    const renderer=new ConveyorGeometry();
    const buildings=Array.from({length:10},(_,i)=>belt(String(i),i+2,7));
    expect(renderer.refresh(buildings,16)).toBe(true);
    expect(renderer.group.children).toHaveLength(3);
    const mesh=renderer.group.children[0] as THREE.Mesh;
    const indices=mesh.geometry.getAttribute('tileIndex');
    const triangle=Array.from({length:indices.count/3},(_,i)=>i).find(i=>indices.getX(i*3)===7)!;
    expect(renderer.resolveHit({object:mesh,faceIndex:triangle,distance:1,point:new THREE.Vector3()})).toEqual({x:9,y:7});
    renderer.group.updateMatrixWorld(true);
    const normal = tileNormal({x:9,y:7},16);
    const ray = new THREE.Raycaster(normal.clone().multiplyScalar(110),normal.clone().negate());
    const hits = ray.intersectObject(renderer.group,true);
    expect(hits.length).toBeGreaterThan(0);
    expect(renderer.resolveHit(hits[0])).toEqual({x:9,y:7});
    expect(renderer.refresh(buildings.map(b=>({...b,conveyor:{...b.conveyor!,buffer:[{item_id:'iron_ore',quantity:3}]}})),16)).toBe(false);
    expect(renderer.group.children[0]).toBe(mesh);
    expect(renderer.refresh([],16)).toBe(true);
    expect(renderer.group.children).toHaveLength(0);
    renderer.dispose();
  });
});
