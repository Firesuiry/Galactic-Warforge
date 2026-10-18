import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import type { Building, BuildingFractionationState, BuildingSprayCoaterState, LogisticsStationState, PortDirection, SplitterConfig } from '@shared/types';
import { ConveyorGeometry, conveyorCaps, conveyorPaths,
  BELT_BODY_BOTTOM, BELT_BODY_HALF, BELT_CAP_TOP, BELT_DECK_HALF, BELT_DECK_TOP, BELT_RAIL_OUTER, BELT_RAIL_TOP,
  BELT_TOTAL_WIDTH } from './conveyor-geometry';
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
  it('connects only configured station ports and refreshes wiring without inventory churn', () => {
    const station = { ...machine(6, 6, 'both'), type: 'planetary_logistics_station', storage: undefined,
      logistics_station: { belt_ports: { west: { mode: 'input', item_id: 'iron_ore' }, east: { mode: 'output', item_id: 'iron_ore' } } } as LogisticsStationState };
    const neighbors = [belt('west', 5, 6), belt('east', 7, 6), belt('north', 6, 5, 'south')];
    const paths = conveyorPaths([station, ...neighbors], 16);
    expect(paths.find(p => p.building.id === 'west')!.connected.has('east')).toBe(true);
    expect(paths.find(p => p.building.id === 'east')!.connected.has('west')).toBe(true);
    expect(paths.find(p => p.building.id === 'north')!.connected.size).toBe(0);
    expect(conveyorPaths([station, belt('reversed', 5, 6, 'west')], 16)[0].connected.size).toBe(0);
    expect(conveyorPaths([{ ...station, owner_id: 'enemy' }, ...neighbors], 16).every(p => p.connected.size === 0)).toBe(true);
    const renderer = new ConveyorGeometry();
    renderer.refresh([station, ...neighbors], 16);
    expect(renderer.refresh([{ ...station, logistics_station: { ...station.logistics_station, energy: 30, inventory: { iron_ore: 20 } } }, ...neighbors], 16)).toBe(false);
    expect(renderer.refresh([{ ...station, logistics_station: { ...station.logistics_station, belt_ports: {} } }, ...neighbors], 16)).toBe(true);
    renderer.dispose();
  });

  it('joins only the real directional fractionator and coater ports', () => {
    const neighbors = [belt('west', 5, 6), belt('east', 7, 6), belt('north', 6, 5, 'south'), belt('south', 6, 7, 'south')];
    const fraction = { ...machine(6, 6, 'both'), type: 'fractionator', storage: undefined,
      fractionation: { input_direction: 'west', hydrogen_direction: 'east', deuterium_direction: 'south' } as BuildingFractionationState };
    const paths = conveyorPaths([fraction, ...neighbors], 16);
    expect(paths.find(p => p.building.id === 'west')!.connected.has('east')).toBe(true);
    expect(paths.find(p => p.building.id === 'east')!.connected.has('west')).toBe(true);
    expect(paths.find(p => p.building.id === 'south')!.connected.has('north')).toBe(true);
    expect(paths.find(p => p.building.id === 'north')!.connected.size).toBe(0);
    const coater = { ...machine(6, 6, 'both'), type: 'spray_coater',
      spray_coater: { input_direction: 'west', output_direction: 'east', reagent_direction: 'north' } as BuildingSprayCoaterState };
    const coating = conveyorPaths([coater, ...neighbors], 16);
    expect(coating.find(p => p.building.id === 'north')!.connected.has('south')).toBe(true);
    expect(coating.find(p => p.building.id === 'south')!.connected.size).toBe(0);
    const automatic = { ...neighbors[0], conveyor: { ...neighbors[0].conveyor!, output: 'auto' as const } };
    expect(conveyorPaths([fraction, automatic], 16)[0].connected.has('east')).toBe(true);
    expect(conveyorPaths([coater, automatic], 16)[0].connected.has('east')).toBe(true);
    expect(conveyorPaths([machine(6, 6, 'input'), automatic], 16)[0].connected.size).toBe(0);
  });

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

  it('caps missing, hidden, hostile and incompatible neighbors at the cell boundary', () => {
    const source=belt('a',7,7);
    for(const neighbors of [[],[belt('b',8,7,'east','west','enemy')],[belt('b',8,7,'west')],[belt('b',8,7,'south','east')]]) {
      const path=conveyorPaths([source,...neighbors],16)[0];
      expect(path.connected.size).toBe(0);
      // 断开的一端也落在格边界（.5）：一格带体就是一整格，端点由端盖封口。
      expect(path.point(1).clone().normalize().distanceTo(tileNormal({x:7.5,y:7},16))).toBeLessThan(1e-10);
      expect(conveyorCaps(path)).toEqual({ start: true, end: true });
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

describe('DSP belt profile', () => {
  it('uses the contracted cross section: low body, raised light rails, bright caps, sunken dark deck', () => {
    expect(BELT_DECK_TOP).toBe(.105);
    expect(BELT_DECK_HALF).toBe(.235);
    expect(BELT_RAIL_TOP).toBe(.15);
    expect(BELT_CAP_TOP).toBe(.17);
    expect(BELT_RAIL_OUTER).toBe(.30);
    expect(BELT_BODY_HALF).toBe(.30);
    expect(BELT_BODY_BOTTOM).toBe(-.02);
    // 总宽 .62 略窄于格宽 .86，格间留缝。
    expect(BELT_TOTAL_WIDTH).toBeCloseTo(.62, 10);
    expect(BELT_TOTAL_WIDTH).toBeLessThan(.86);
    // 带面比护栏顶低、比机身底面高：物品坐在带面上、被两侧护栏框住。
    expect(BELT_DECK_TOP).toBeLessThan(BELT_RAIL_TOP);
    expect(BELT_RAIL_TOP).toBeLessThan(BELT_CAP_TOP);
    expect(BELT_RAIL_OUTER).toBeGreaterThan(BELT_DECK_HALF);
  });

  it('caps only true endpoints: connected lines and turns stay open', () => {
    const line = conveyorPaths([belt('a',5,5), belt('b',6,5)],16);
    expect(line.map(conveyorCaps)).toEqual([{ start: true, end: false }, { start: false, end: true }]);
    // 转弯两端都接着带体：不许画端盖（否则近景里弯角处会看到夹板）。
    const turn = conveyorPaths([belt('a',5,5), belt('b',6,5,'south'), belt('c',6,6,'south')],16);
    expect(conveyorCaps(turn.find(path => path.building.id === 'b')!)).toEqual({ start: false, end: false });
    // 建筑端口也算连接（不封口），机器侧端口探到 .64。
    const minerLine = conveyorPaths([belt('a',5,5), machine(5,6,'output')],16);
    expect(minerLine[0].input).toBe('south');
    expect(conveyorCaps(minerLine[0])).toEqual({ start: false, end: true });
    expect(minerLine[0].point(0).clone().normalize().distanceTo(tileNormal({ x: 5, y: 5.64 }, 16))).toBeLessThan(1e-10);
  });

  it('builds the profile at the contracted cell heights (deck sits .105 above the belt centreline)', () => {
    const renderer = new ConveyorGeometry(), buildings = [belt('a',5,7), belt('b',6,7)];
    renderer.refresh(buildings, 16);
    const size = surfaceTileSize(100,16), base = 100 + size * .19;
    const bounds = renderer.group.children.map(child => {
      const positions = (child as THREE.Mesh).geometry.getAttribute('position');
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        const radius = (Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)) - base) / size;
        min = Math.min(min, radius); max = Math.max(max, radius);
      }
      return { min, max };
    });
    // 三段结构（石墨机身/陶瓷护栏/合金顶盖）合起来从机身底面 -.02 到护栏顶盖 .17。
    const structure = bounds.slice(0, 3);
    expect(Math.min(...structure.map(bound => bound.min))).toBeCloseTo(BELT_BODY_BOTTOM, 2);
    expect(Math.max(...structure.map(bound => bound.max))).toBeCloseTo(BELT_CAP_TOP, 2);
    // 带面是第 4 层独立 mesh：整层贴在同一高度 .105（滚动贴图走 UV，不加几何体）。
    expect(bounds[3].min).toBeCloseTo(BELT_DECK_TOP, 2);
    expect(bounds[3].max).toBeCloseTo(BELT_DECK_TOP, 2);
    renderer.dispose();
  });

  it('keeps the outer rail continuous through a turn (no gap at the corner)', () => {
    const renderer = new ConveyorGeometry(), size = surfaceTileSize(100,16);
    const buildings = [belt('a',5,5), belt('b',6,5,'south'), belt('c',6,6,'south')];
    renderer.refresh(buildings, 16);
    renderer.group.updateMatrixWorld(true);
    const turn = conveyorPaths(buildings,16).find(path => path.building.id === 'b')!;
    // 顶盖中线（±.2775）上打 17 条向下的射线：每个采样点都必须有护栏命中，
    // 弯道外侧不能出现缺口，且拾取仍回到转弯格自身。
    for (const side of [-1, 1]) for (let i = 0; i <= 16; i++) {
      const t = .04 + (i / 16) * .92;
      const point = turn.point(t), up = point.clone().normalize();
      const origin = point.clone().addScaledVector(turn.side(t), side * .2775 * size)
        .addScaledVector(up, (BELT_CAP_TOP + .02) * size);
      const hits = new THREE.Raycaster(origin, up.clone().negate()).intersectObject(renderer.group, true);
      expect(hits.length, `t=${t} side=${side}`).toBeGreaterThan(0);
      expect(renderer.resolveHit(hits[0])).toEqual({ x: 6, y: 5 });
    }
    renderer.dispose();
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
  it('keeps the whole network at three draws plus one flow-texture surface, and picks the correct original tile', () => {
    const renderer=new ConveyorGeometry();
    const buildings=Array.from({length:10},(_,i)=>belt(String(i),i+2,7));
    expect(renderer.refresh(buildings,16)).toBe(true);
    // 三段结构 + 一段带体顶面流向贴图（流向 chevron 全部走 UV 滚动，不新增每格几何体）。
    expect(renderer.group.children).toHaveLength(4);
    const surface = renderer.group.children[3] as THREE.Mesh;
    expect(surface.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((surface.material as THREE.MeshBasicMaterial).map).toBeTruthy();
    const mesh=renderer.group.children[0] as THREE.Mesh;
    const indices=mesh.geometry.getAttribute('tileIndex');
    const triangle=Array.from({length:indices.count/3},(_,i)=>i).find(i=>indices.getX(i*3)===7)!;
    expect(renderer.resolveHit({object:mesh,faceIndex:triangle,distance:1,point:new THREE.Vector3()})).toEqual({x:9,y:7});
    renderer.group.updateMatrixWorld(true);
    const normal = tileNormal({x:9,y:7},16);
    const ray = new THREE.Raycaster(normal.clone().multiplyScalar(110),normal.clone().negate());
    const hits = ray.intersectObject(renderer.group,true);
    expect(hits.length).toBeGreaterThan(0);
    // 拾取必须命中结构层（顶面流向层是独立 mesh，resolveHit 只认它自己的 tileIndex）。
    expect(renderer.resolveHit(hits.find(hit => hit.object === mesh)!)).toEqual({x:9,y:7});
    expect(renderer.refresh(buildings.map(b=>({...b,conveyor:{...b.conveyor!,buffer:[{item_id:'iron_ore',quantity:3}]}})),16)).toBe(false);
    expect(renderer.group.children[0]).toBe(mesh);
    expect(renderer.refresh([],16)).toBe(true);
    expect(renderer.group.children).toHaveLength(0);
    renderer.dispose();
  });

  it('scrolls the flow texture with belt speed and freezes when idle', () => {
    const renderer = new ConveyorGeometry();
    renderer.refresh(Array.from({length:3},(_,i)=>belt(String(i),i+2,7)),16);
    const map = (renderer.group.children[3] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.map!;
    const before = map.offset.x;
    renderer.update(1, 0);
    expect(map.offset.x).toBe(before);
    renderer.update(1, 0.25);
    expect(map.offset.x).toBeCloseTo(before - 0.25, 6);
    renderer.update(1, 0.25);
    expect(map.offset.x).toBeCloseTo(before - 0.5, 6);
    // 偏移量循环在 [-1, 0)，长时间运行不会丢精度。
    for (let i = 0; i < 10; i++) renderer.update(1, 0.25);
    expect(map.offset.x).toBeLessThanOrEqual(0);
    expect(map.offset.x).toBeGreaterThan(-1);
    renderer.dispose();
  });
});
