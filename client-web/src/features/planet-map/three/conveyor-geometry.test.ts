import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import type { Building, BuildingFractionationState, BuildingSprayCoaterState, LogisticsStationState, PortDirection, SplitterConfig } from '@shared/types';
import { ConveyorGeometry, conveyorCaps, conveyorPaths, groundOccupancy,
  BELT_BASE_LIFT, BELT_BODY_BOTTOM, BELT_BODY_HALF, BELT_DECK_HALF, BELT_DECK_TOP, BELT_RAIL_OUTER, BELT_RAIL_TOP,
  BELT_TOTAL_WIDTH } from './conveyor-geometry';
import { BELT_LEVEL_HEIGHT, MAX_BELT_ELEVATION } from '../logistics-tier';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';

const opposite: Record<SurfaceDirection,SurfaceDirection> = { north:'south', east:'west', south:'north', west:'east' };
const belt = (id:string,x:number,y:number,output:SurfaceDirection = 'east',input:SurfaceDirection = opposite[output],owner = 'p',type = 'conveyor_belt_mk1',elevation = 0):Building => ({
  id, type, position:{x,y,z:0}, owner_id:owner, conveyor:{input,output,...(elevation ? {elevation} : {})},
} as Building);
const elevated = (id:string,x:number,y:number,output:SurfaceDirection,elevation:number,input:SurfaceDirection = opposite[output],type = 'conveyor_belt_mk1') =>
  belt(id,x,y,output,input,'p',type,elevation);
const machine = (x: number, y: number, direction: PortDirection, owner = 'p', offset = { x: 0, y: 0 }): Building => ({
  id: 'machine', type: 'arc_smelter', position: { x, y, z: 0 }, owner_id: owner, storage: {},
  runtime: { params: { io_ports: [{ id: 'port', direction, offset, capacity: 1 }] } },
} as Building);
const splitter = (x: number, y: number, config: SplitterConfig = { input_directions: ['west'], output_directions: ['east', 'north', 'south'] }): Building => ({
  ...belt('splitter', x, y), type: 'splitter',
  splitter: { ...config, input_cursor: 0, output_cursor: 0, transferred_items: 0, last_transfer_tick: 0 },
});
const smelter = (x:number,y:number):Building => ({
  id:'block', type:'arc_smelter', position:{x,y,z:0}, owner_id:'p', storage:{},
  runtime:{ params:{ footprint:{ width:1, height:1 } } },
} as Building);

/** 世界坐标点：格心局部 (east, south) 偏移 + 离带体基准的高度（cell）。 */
function localPoint(tile:{x:number,y:number}, faceSize:number, east:number, south:number, height:number, radius=100) {
  const size = surfaceTileSize(radius, faceSize), frame = tileFrame(tile, faceSize);
  return tileNormal(tile, faceSize).multiplyScalar(radius + size * (BELT_BASE_LIFT + height))
    .addScaledVector(frame.east, size * east).addScaledVector(frame.south, size * south);
}
/** 命中点相对带体基准的高度（cell）。 */
function hitHeight(point: THREE.Vector3, faceSize:number, radius=100) {
  const size = surfaceTileSize(radius, faceSize);
  return (point.length() - (radius + size * BELT_BASE_LIFT)) / size;
}
function rayDown(renderer: ConveyorGeometry, point: THREE.Vector3) {
  const normal = point.clone().normalize();
  const ray = new THREE.Raycaster(point.clone().addScaledVector(normal, 1), normal.negate());
  return ray.intersectObject(renderer.group, true);
}
/** 结构层（非带面）三角形数。 */
function structureVertices(renderer: ConveyorGeometry) {
  return renderer.group.children
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && !child.name.startsWith('conveyor-deck'))
    .reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0);
}

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
      // 带体基准离球面 = BELT_BASE_LIFT（第 19 轮压到 .045，与建筑底座同一地面；旧值 .19 已废）。
      expect(paths[0].point(.5).length()).toBeCloseTo(100+surfaceTileSize(100,16)*BELT_BASE_LIFT,10);
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

  it('renders a side merge as one main path plus a T branch, not a second path through the main belt', () => {
    const buildings = [belt('a',5,5), belt('b',6,5), belt('c',6,4,'south'), belt('parallel',5,6)];
    const paths = conveyorPaths(buildings,16);
    const main = paths.filter(path => path.building.id === 'b');
    // 第 19 轮：侧汇不再画成第二条穿过主带的路径——主带只有一条路径（西→东）。
    expect(main).toHaveLength(1);
    expect([main[0].input, main[0].output]).toEqual(['west','east']);
    expect(main[0].connected.has('north')).toBe(true);
    expect(paths.find(path=>path.building.id==='a')!.connected.has('south')).toBe(false);
    expect(paths.find(path=>path.building.id==='parallel')!.connected.size).toBe(0);

    // T 形接头：主带在汇入侧的侧栏开口，支带带面伸进开口。
    const renderer = new ConveyorGeometry();
    renderer.refresh(buildings,16);
    renderer.group.updateMatrixWorld(true);
    const probe = (east:number, south:number) => {
      const hits = rayDown(renderer, localPoint({x:6,y:5},16,east,south,.2));
      expect(hits.length, `probe ${east},${south}`).toBeGreaterThan(0);
      return { height: hitHeight(hits[0].point,16), tile: renderer.resolveHit(hits[0]) };
    };
    // 北侧支带带面（主带带面半宽之外）：命中 .09 的带面，而不是 .128 的侧栏。
    expect(probe(0, -.36)).toEqual({ height: expect.closeTo(BELT_DECK_TOP, 2), tile: { x: 6, y: 5 } });
    // 支带带面末端的小舌（MERGE_DECK_TONGUE）盖住主带带面外的暗边。
    expect(probe(0, -.30).height).toBeCloseTo(BELT_DECK_TOP, 2);
    // 汇入侧侧栏被切开：侧栏中线位置没有 .128 的侧栏。
    expect(probe(0, -.2775).height).toBeLessThan(BELT_DECK_TOP);
    // 开口之外（西侧）侧栏仍在；南侧（没有汇入）侧栏也在。
    expect(probe(-.4, -.2775).height).toBeCloseTo(BELT_RAIL_TOP, 2);
    expect(probe(0, .2775).height).toBeCloseTo(BELT_RAIL_TOP, 2);
    renderer.dispose();
  });

  // 疑似源码 bug（conveyor-geometry.ts `port(direction, distance)` + `MERGE_DECK_TONGUE`）：
  // 支带内端按「图集格坐标」偏移 BELT_DECK_HALF=.24（`tile = position + dx*reach`），但带面半宽
  // 是**局部切平面坐标**。球面 tan 映射下 .24 格图集距离在局部坐标里约 .337，支带带面停在
  // 主带带面边缘（局部 .24）之外约 .097 格；.05 格的小舌只补到局部 .29，接缝处仍有约 .05 格
  // （世界 .035 格）没有带面（射线打到机身底面 −.02，近景是一条暗缝）。
  // 期望：支带带面延伸到主带带面边缘（局部 .24）并与主带带面无缝相接。
  it.todo('seamlessly joins the T-branch deck to the main deck edge (currently a ~.05 cell gap at s=-.24..-.29)');
});

describe('DSP belt profile', () => {
  it('uses the contracted low profile: sunken dark deck, low metal rails, no tall cap', () => {
    expect(BELT_DECK_TOP).toBe(.09);
    expect(BELT_DECK_HALF).toBe(.24);
    expect(BELT_RAIL_TOP).toBe(.128);
    expect(BELT_RAIL_OUTER).toBe(.30);
    expect(BELT_BODY_HALF).toBe(.30);
    expect(BELT_BODY_BOTTOM).toBe(-.02);
    // 总宽 .60 略窄于格宽 .86，格间留缝。
    expect(BELT_TOTAL_WIDTH).toBeCloseTo(.60, 10);
    expect(BELT_TOTAL_WIDTH).toBeLessThan(.86);
    // 侧栏只比带面高 .038（契约 .03–.04），远景读成低矮金属带而不是水槽。
    expect(BELT_RAIL_TOP - BELT_DECK_TOP).toBeCloseTo(.038, 10);
    expect(BELT_RAIL_TOP).toBeLessThan(.15);
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

  it('builds the profile at the contracted cell heights (deck sits .09 above the belt base)', () => {
    const renderer = new ConveyorGeometry(), buildings = [belt('a',5,7), belt('b',6,7)];
    renderer.refresh(buildings, 16);
    const size = surfaceTileSize(100,16), base = 100 + size * BELT_BASE_LIFT;
    const bounds = renderer.group.children.map(child => {
      const positions = (child as THREE.Mesh).geometry.getAttribute('position');
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        const radius = (Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)) - base) / size;
        min = Math.min(min, radius); max = Math.max(max, radius);
      }
      return { min, max };
    });
    // 三段结构（石墨机身/中灰侧壁/亮金属侧栏）合起来从机身底面 -.02 到侧栏顶 .128。
    const structure = bounds.slice(0, 3);
    expect(Math.min(...structure.map(bound => bound.min))).toBeCloseTo(BELT_BODY_BOTTOM, 2);
    expect(Math.max(...structure.map(bound => bound.max))).toBeCloseTo(BELT_RAIL_TOP, 2);
    // 带面是独立 mesh：整层贴在同一高度 .09（滚动贴图走 UV，不加几何体）。
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
    // 侧栏中线（±.2775）上打向下的射线：弯道内侧/外侧都不能出现缺口。
    for (const side of [-1, 1]) for (let i = 0; i <= 20; i++) {
      const t = .08 + (i / 20) * .84;
      const point = turn.point(t), up = point.clone().normalize();
      const origin = point.clone().addScaledVector(turn.side(t), side * .2775 * size)
        .addScaledVector(up, (BELT_RAIL_TOP + .02) * size);
      const hits = new THREE.Raycaster(origin, up.clone().negate()).intersectObject(renderer.group, true);
      expect(hits.length, `t=${t} side=${side}`).toBeGreaterThan(0);
      // 弯道中段必须命中转弯格自身的侧栏（两端格边界附近会命中相邻带，不在此断言）。
      if (t > .12 && t < .88) {
        expect(hitHeight(hits[0].point, 16)).toBeCloseTo(BELT_RAIL_TOP, 2);
        expect(renderer.resolveHit(hits[0])).toEqual({ x: 6, y: 5 });
      }
    }
    renderer.dispose();
  });
});

describe('multi-layer belts (contract §3.3)', () => {
  it('connects belts on the same elevated layer', () => {
    const paths = conveyorPaths([elevated('a',5,5,'east',1), elevated('b',6,5,'east',1)],16);
    expect(paths[0].connected.has('east')).toBe(true);
    expect(paths[1].connected.has('west')).toBe(true);
    // 同层两端高度相同（都在 1 层），边界点重合。
    expect(paths[0].point(1).distanceTo(paths[1].point(0))).toBeLessThan(1e-10);
    expect(hitHeight(paths[0].point(1),16)).toBeCloseTo(BELT_LEVEL_HEIGHT, 6);
  });

  it('ramps a straight line ±1 layer and shares the exact boundary point (continuous height)', () => {
    const buildings = [belt('ground',5,5,'east'), elevated('up',6,5,'east',1), elevated('high',7,5,'east',1), belt('down',8,5,'east')];
    const paths = conveyorPaths(buildings,16);
    const [ground, up, high, down] = ['ground','up','high','down'].map(id => paths.find(path => path.building.id === id)!);
    expect(ground.connected.has('east')).toBe(true);
    expect(up.connected.has('west')).toBe(true);
    expect(up.connected.has('east')).toBe(true);
    expect(down.connected.has('west')).toBe(true);
    // 坡道两端共享边界点：相邻两格同位置、同高度（两层均值 .25 格）。
    for (const [a,b,height] of [[ground,up,BELT_LEVEL_HEIGHT / 2],[up,high,BELT_LEVEL_HEIGHT],[high,down,BELT_LEVEL_HEIGHT / 2]] as const) {
      expect(a.point(1).distanceTo(b.point(0))).toBeLessThan(1e-10);
      expect(hitHeight(a.point(1),16)).toBeCloseTo(height, 6);
    }
    // 坡道高度沿 Bézier 连续变化（起点 < 中点 < 终点），不是台阶。
    expect(hitHeight(up.point(.5),16)).toBeGreaterThan(hitHeight(up.point(0),16));
    expect(hitHeight(up.point(.5),16)).toBeLessThan(hitHeight(up.point(1),16));
    expect(hitHeight(down.point(.5),16)).toBeGreaterThan(hitHeight(down.point(1),16));
    expect(hitHeight(down.point(.5),16)).toBeLessThan(hitHeight(down.point(0),16));
  });

  it('does not ramp on turns, across 2 layers, or onto a non-straight neighbor', () => {
    // 转弯：高架带输出方向不是直行延续。
    const turn = conveyorPaths([belt('ground',5,5,'east'), elevated('bend',6,5,'south',1)],16);
    expect(turn[0].connected.size).toBe(0);
    // 跨 2 层不连。
    const jump = conveyorPaths([belt('ground',5,5,'east'), elevated('sky',6,5,'east',2)],16);
    expect(jump[0].connected.size).toBe(0);
    // 高架带同层优先：同格既有地面带又有 1 层带时，地面带接地面带（端点高度 0）。
    const same = conveyorPaths([belt('a',5,5,'east'), belt('ground',6,5,'east'), elevated('high',6,5,'east',1)],16);
    expect(same.find(path => path.building.id === 'a')!.connected.has('east')).toBe(true);
    expect(same.find(path => path.building.id === 'high')!.connected.size).toBe(0);
    expect(hitHeight(same.find(path => path.building.id === 'a')!.point(1),16)).toBeCloseTo(0, 6);
  });

  it('crosses a ground line and an elevated line without leaking items between them', () => {
    // 立体交叉：地面横线（西→东）穿过交叉格；竖线 0→1→1→0 跨过去。
    const buildings = [
      belt('cross-ground',6,5,'east'),
      belt('west',5,5,'east'), belt('east',7,5,'east'),
      belt('south-ground',6,6,'south'), elevated('cross-high',6,5,'south',1),
      elevated('north-high',6,4,'south',1), belt('north-ground',6,3,'south'),
    ];
    const paths = conveyorPaths(buildings,16);
    const byId = (id:string) => paths.find(path => path.building.id === id)!;
    expect([...byId('west').connected].sort()).toEqual(['east']);
    expect([...byId('cross-ground').connected].sort()).toEqual(['east','west']);
    expect([...byId('east').connected].sort()).toEqual(['west']);
    expect([...byId('north-ground').connected].sort()).toEqual(['south']);
    expect([...byId('north-high').connected].sort()).toEqual(['north','south']);
    expect([...byId('cross-high').connected].sort()).toEqual(['north','south']);
    expect([...byId('south-ground').connected].sort()).toEqual(['north']);
    // 交叉格上两条带各自独立：地面横线全程贴地，竖线在高架层（北端 .5、南端坡道降到 .25）。
    expect(hitHeight(byId('cross-ground').point(0),16)).toBeCloseTo(0, 6);
    expect(hitHeight(byId('cross-ground').point(.5),16)).toBeCloseTo(0, 6);
    expect(hitHeight(byId('cross-ground').point(1),16)).toBeCloseTo(0, 6);
    expect(hitHeight(byId('cross-high').point(0),16)).toBeCloseTo(BELT_LEVEL_HEIGHT, 6);
    expect(hitHeight(byId('cross-high').point(1),16)).toBeCloseTo(BELT_LEVEL_HEIGHT / 2, 6);
    expect(hitHeight(byId('cross-high').point(.5),16)).toBeGreaterThan(.3);
  });

  it('only pillars elevated spans when the ground below is free', () => {
    const high = elevated('high',5,5,'east',1);
    // groundOccupancy：地面建筑展开 footprint，高架带不占地面。
    const occupancy = groundOccupancy([high, belt('ground',6,5,'east'), { ...smelter(8,8), runtime: { params: { footprint: { width: 2, height: 2 } } } } as Building],16);
    expect(occupancy.has('5:5')).toBe(false);
    expect(occupancy.has('6:5')).toBe(true);
    for (const cell of ['8:8','9:8','8:9','9:9']) expect(occupancy.has(cell), cell).toBe(true);
    // 高架格地面空着 → 立柱；压在地面建筑/带子上方 → 不立柱。
    const free = new ConveyorGeometry(); free.refresh([high],16);
    const covered = new ConveyorGeometry(); covered.refresh([high, smelter(5,5)],16);
    const withPillars = structureVertices(free), withoutPillars = structureVertices(covered);
    // 立柱 30 顶点（中灰）+ 底座/横托 60 顶点（石墨）。
    expect(withPillars - withoutPillars).toBe(90);
    free.dispose(); covered.dispose();
  });

  it('picks the exact stacked belt via resolveBuilding (same tile, different layers)', () => {
    const buildings = [belt('ground',5,5,'east'), elevated('high',5,5,'east',2)];
    const renderer = new ConveyorGeometry();
    renderer.refresh(buildings,16);
    const deck = renderer.group.children.find(child => child.name === 'conveyor-deck-mk1') as THREE.Mesh;
    expect(deck).toBeTruthy();
    const index = deck.geometry.getAttribute('tileIndex');
    const heights: Record<number, number[]> = { 0: [], 1: [] };
    const triangleFor: Record<number, number> = {};
    for (let triangle = 0; triangle < index.count / 3; triangle++) {
      const tile = index.getX(triangle * 3);
      if (tile !== 0 && tile !== 1) continue;
      triangleFor[tile] ??= triangle;
      const positions = deck.geometry.getAttribute('position');
      for (let corner = 0; corner < 3; corner++) {
        const vertex = triangle * 3 + corner;
        heights[tile].push(hitHeight(new THREE.Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)),16));
      }
    }
    // 地面带带面 .09，2 层高架带带面 .09 + 2 × .5。
    expect(Math.max(...heights[0])).toBeCloseTo(BELT_DECK_TOP, 2);
    expect(Math.max(...heights[1])).toBeCloseTo(BELT_DECK_TOP + 2 * BELT_LEVEL_HEIGHT, 2);
    const hit = (tile:number) => ({ object: deck, faceIndex: triangleFor[tile], distance: 1, point: new THREE.Vector3() });
    expect(renderer.resolveHit(hit(0))).toEqual({ x: 5, y: 5 });
    expect(renderer.resolveHit(hit(1))).toEqual({ x: 5, y: 5 });
    expect(renderer.resolveBuilding(hit(0))).toBe('ground');
    expect(renderer.resolveBuilding(hit(1))).toBe('high');
    // 最高层常量与客户端一致。
    expect(MAX_BELT_ELEVATION).toBe(4);
    renderer.dispose();
  });
});

describe('three-tier decks (contract §4.2)', () => {
  it('names one deck mesh per tier and scrolls them at 1 : 2 : 5', () => {
    const renderer = new ConveyorGeometry();
    renderer.refresh([belt('a',5,5,'east','west','p','conveyor_belt_mk1'),
      belt('b',7,5,'east','west','p','conveyor_belt_mk2'), belt('c',9,5,'east','west','p','conveyor_belt_mk3')],16);
    const decks = renderer.group.children.filter(child => child.name.startsWith('conveyor-deck'));
    expect(decks.map(child => child.name).sort()).toEqual(['conveyor-deck-mk1','conveyor-deck-mk2','conveyor-deck-mk3']);
    const maps = [1,2,3].map(tier => ((renderer.group.children.find(child => child.name === `conveyor-deck-mk${tier}`) as THREE.Mesh)
      .material as THREE.MeshStandardMaterial).map!);
    expect(maps.every(Boolean)).toBe(true);
    maps.forEach(map => map.offset.x = 0);
    // update(0) 不动。
    renderer.update(0);
    expect(maps.map(map => map.offset.x)).toEqual([0,0,0]);
    // 每档按自己的 beltVisualSpeed 滚动：.8 / 1.6 / 4.0 格/秒（.1s → .08 / .16 / .4 格）。
    renderer.update(.1);
    expect(maps[0].offset.x).toBeCloseTo(-.08, 6);
    expect(maps[1].offset.x).toBeCloseTo(-.16, 6);
    expect(maps[2].offset.x).toBeCloseTo(-.4, 6);
    expect(Math.abs(maps[1].offset.x / maps[0].offset.x)).toBeCloseTo(2, 6);
    expect(Math.abs(maps[2].offset.x / maps[0].offset.x)).toBeCloseTo(5, 6);
    // offset 循环在 (-1, 0]，长时间运行不丢精度。
    for (let i = 0; i < 10; i++) renderer.update(.25);
    for (const map of maps) { expect(map.offset.x).toBeLessThanOrEqual(0); expect(map.offset.x).toBeGreaterThan(-1); }
    renderer.dispose();
  });

  it('only creates deck meshes for tiers present in the network', () => {
    const renderer = new ConveyorGeometry();
    renderer.refresh([belt('a',5,5,'east','west','p','conveyor_belt_mk2')],16);
    expect(renderer.group.children.filter(child => child.name.startsWith('conveyor-deck')).map(child => child.name)).toEqual(['conveyor-deck-mk2']);
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

  it('keeps the network at three structure draws plus one deck per used tier, and picks the correct original tile', () => {
    const renderer=new ConveyorGeometry();
    const buildings=Array.from({length:10},(_,i)=>belt(String(i),i+2,7));
    expect(renderer.refresh(buildings,16)).toBe(true);
    // 三段结构 + 一段带体带面（箭头全部走 UV 滚动，不新增每格几何体）。
    expect(renderer.group.children).toHaveLength(4);
    const deck = renderer.group.children.find(child => child.name === 'conveyor-deck-mk1') as THREE.Mesh;
    expect(deck.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((deck.material as THREE.MeshStandardMaterial).map).toBeTruthy();
    expect((deck.material as THREE.MeshStandardMaterial).emissiveMap).toBeTruthy();
    const mesh=renderer.group.children[0] as THREE.Mesh;
    const indices=mesh.geometry.getAttribute('tileIndex');
    const triangle=Array.from({length:indices.count/3},(_,i)=>i).find(i=>indices.getX(i*3)===7)!;
    expect(renderer.resolveHit({object:mesh,faceIndex:triangle,distance:1,point:new THREE.Vector3()})).toEqual({x:9,y:7});
    renderer.group.updateMatrixWorld(true);
    const normal = tileNormal({x:9,y:7},16);
    const ray = new THREE.Raycaster(normal.clone().multiplyScalar(110),normal.clone().negate());
    const hits = ray.intersectObject(renderer.group,true);
    expect(hits.length).toBeGreaterThan(0);
    expect(renderer.resolveHit(hits.find(hit => hit.object === mesh)!)).toEqual({x:9,y:7});
    expect(renderer.refresh(buildings.map(b=>({...b,conveyor:{...b.conveyor!,buffer:[{item_id:'iron_ore',quantity:3}]}})),16)).toBe(false);
    expect(renderer.group.children[0]).toBe(mesh);
    expect(renderer.refresh([],16)).toBe(true);
    expect(renderer.group.children).toHaveLength(0);
    renderer.dispose();
  });
});
