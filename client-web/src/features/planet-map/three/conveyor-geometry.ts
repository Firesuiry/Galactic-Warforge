import * as THREE from 'three';
import { surfaceFace, surfaceOffset, surfaceStep, type SurfaceDirection } from '@shared/surface';
import type { Building, ConveyorDirection, PortDirection } from '@shared/types';
import type { TilePoint } from '../model';
import { beltChevronTexture } from './logistics-marks';
import { surfaceTileSize, tileNormal } from './projection';

const directions: SurfaceDirection[] = ['north', 'east', 'south', 'west'];
const opposite: Record<SurfaceDirection, SurfaceDirection> = { north: 'south', east: 'west', south: 'north', west: 'east' };
const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;
const cardinal = (direction: ConveyorDirection | undefined): direction is SurfaceDirection => directions.includes(direction as SurfaceDirection);
const key = (tile: TilePoint) => `${tile.x}:${tile.y}`;
const isTransportBuilding = (building: Pick<Building, 'type' | 'conveyor'>) => Boolean(building.conveyor && (building.type.startsWith('conveyor_belt_') || building.type === 'automatic_piler' || building.type === 'splitter'));

export interface ConveyorPath {
  building: Building;
  input: SurfaceDirection;
  output: SurfaceDirection;
  connected: ReadonlySet<SurfaceDirection>;
  /** Surface-space centerline; both adjacent tiles return the exact same boundary point. */
  point: (fraction: number) => THREE.Vector3;
  side: (fraction: number) => THREE.Vector3;
}

/** The server accepts side merges unless input explicitly specifies a turn. */
function allowsInput(building: Building, direction: SurfaceDirection) {
  if (building.splitter) return building.splitter.input_directions.includes(direction);
  const { input, output } = building.conveyor!;
  if (cardinal(input) && input !== output && (!cardinal(output) || input !== opposite[output])) return direction === input;
  return direction !== output;
}

/** Callers pass ONLY player-owned or currently visible buildings. Never infer an unseen belt. */
export function conveyorPaths(buildings: readonly Building[], faceSize: number, radius = 100): ConveyorPath[] {
  const belts = buildings.filter(building => isTransportBuilding(building));
  const byTile = new Map(belts.map(building => [key(building.position), building]));
  const inputs = new Map<string, SurfaceDirection[]>(), outputs = new Map<string, SurfaceDirection[]>();
  const machinePorts = new Map<string, Set<SurfaceDirection>>();
  for (const building of belts) {
    inputs.set(building.id, []); outputs.set(building.id, []);
    machinePorts.set(building.id, new Set());
  }
  // Match server transport ownership, carried seam directions and allowed inputs.
  for (const building of belts) for (const direction of directions) {
    const output = building.conveyor!.output;
    if (building.splitter ? !building.splitter.output_directions.includes(direction) : cardinal(output) && output !== direction) continue;
    const step = surfaceStep(building.position, direction, faceSize);
    const neighbor = byTile.get(key(step.tile));
    if (!neighbor || neighbor.owner_id !== building.owner_id || !allowsInput(neighbor, opposite[step.direction])) continue;
    if (!building.splitter && !cardinal(output) && !neighbor.splitter && cardinal(neighbor.conveyor!.output) && neighbor.conveyor!.output === opposite[step.direction]) continue;
    outputs.get(building.id)!.push(direction);
    inputs.get(neighbor.id)!.push(opposite[step.direction]);
  }
  // Building I/O is real transport too. Match its public ports and ownership,
  // including offset ports and rotated cube seams, instead of capping the belt
  // short of a connected miner, factory or depot. Sorters keep their arm gap.
  for (const machine of buildings) {
    if (isTransportBuilding(machine)) continue;
    const ports: { offset: TilePoint; direction: PortDirection; side?: SurfaceDirection }[] = [];
    const fractionation = machine.fractionation, coater = machine.spray_coater;
    if (machine.logistics_station) {
      for (const [side, port] of Object.entries(machine.logistics_station.belt_ports ?? {})) {
        if (port) ports.push({ offset: { x: 0, y: 0 }, direction: port.mode, side: side as SurfaceDirection });
      }
    } else if (fractionation) {
      ports.push({ offset: { x: 0, y: 0 }, direction: 'input', side: fractionation.input_direction },
        { offset: { x: 0, y: 0 }, direction: 'output', side: fractionation.hydrogen_direction },
        { offset: { x: 0, y: 0 }, direction: 'output', side: fractionation.deuterium_direction });
    } else if (coater) {
      ports.push({ offset: { x: 0, y: 0 }, direction: 'input', side: coater.input_direction },
        { offset: { x: 0, y: 0 }, direction: 'input', side: coater.reagent_direction },
        { offset: { x: 0, y: 0 }, direction: 'output', side: coater.output_direction });
    } else if (machine.storage) ports.push(...(machine.runtime?.params?.io_ports ?? []));
    for (const port of ports) {
      const origin = surfaceOffset(machine.position, port.offset.x, port.offset.y, faceSize);
      for (const direction of port.side ? [port.side] : directions) {
        const step = surfaceStep(origin, direction, faceSize);
        const belt = byTile.get(key(step.tile));
        if (!belt || belt.splitter || belt.owner_id !== machine.owner_id) continue;
        const towardMachine = opposite[step.direction];
        const feedsMachine = port.direction !== 'output' && (belt.conveyor!.output === towardMachine
          || Boolean(port.side && belt.conveyor!.output === 'auto'));
        const feedsBelt = port.direction !== 'input' && allowsInput(belt, towardMachine);
        if (!feedsMachine && !feedsBelt) continue;
        const list = (feedsMachine ? outputs : inputs).get(belt.id)!;
        if (!list.includes(towardMachine)) list.push(towardMachine);
        machinePorts.get(belt.id)!.add(towardMachine);
      }
    }
  }
  const paths: ConveyorPath[] = [];
  for (const building of belts) {
    const incoming = inputs.get(building.id)!, outgoing = outputs.get(building.id)!;
    const output = cardinal(building.conveyor!.output) ? building.conveyor!.output : outgoing[0] ?? 'east';
    const input = incoming[0] ?? (cardinal(building.conveyor!.input) && building.conveyor!.input !== output ? building.conveyor!.input : opposite[output]);
    const connected = new Set([...incoming, ...outgoing]);
    const routes: [SurfaceDirection, SurfaceDirection][] = building.splitter
      ? building.splitter.input_directions.flatMap(start => building.splitter!.output_directions.map(end => [start, end] as [SurfaceDirection, SurfaceDirection]))
      : [[input, output]];
    if (!building.splitter) {
      for (const port of incoming.slice(1)) if (port !== output) routes.push([port, output]);
      for (const port of outgoing) if (port !== output && port !== input) routes.push([input, port]);
    }
    for (const [start, end] of routes) {
      const face = surfaceFace(building.position, faceSize);
      const port = (direction: SurfaceDirection) => {
        const [dx, dy] = offsets[direction];
        const distance = machinePorts.get(building.id)!.has(direction) ? .64 : connected.has(direction) ? .5 : .36;
        const tile = { x: building.position.x + dx * distance, y: building.position.y + dy * distance };
        const normal = tileNormal(tile, faceSize, face);
        const side = tileNormal({ x: tile.x - dy * .001, y: tile.y + dx * .001 }, faceSize, face).sub(tileNormal({ x: tile.x + dy * .001, y: tile.y - dx * .001 }, faceSize, face)).normalize();
        return { normal, side };
      };
      const a = port(start), b = port(end), center = tileNormal(building.position, faceSize);
      const height = radius + surfaceTileSize(radius, faceSize) * .19;
      // Quadratic turns meet straight neighbor sections tangentially; normalization
      // follows the sphere instead of cutting a chord below its surface.
      const point = (t: number) => a.normal.clone().multiplyScalar((1-t)**2).addScaledVector(center, 2*t*(1-t)).addScaledVector(b.normal, t*t).normalize().multiplyScalar(height);
      const side = (t: number) => {
        const p = point(t), tangent = point(Math.min(1, t + .0001)).sub(point(Math.max(0, t - .0001))).normalize();
        const lateral = new THREE.Vector3().crossVectors(p.clone().normalize(), tangent).normalize();
        if (t === 0 || t === 1) {
          const edge = (t === 0 ? a.side : b.side).clone();
          return edge.multiplyScalar(edge.dot(lateral) < 0 ? -1 : 1);
        }
        return lateral;
      };
      paths.push({ building, input: start, output: end, connected, point, side });
    }
  }
  return paths;
}

interface MeshBuffer { positions: number[]; tiles: number[]; uvs: number[] }

/** Three merged draws for the entire visible network, with triangle-to-tile picking. */
export class ConveyorGeometry {
  readonly group = new THREE.Group();
  private signature = '';
  private tiles: TilePoint[] = [];
  private scroll = 0;
  private readonly materials = [
    new THREE.MeshStandardMaterial({ color: '#26363e', roughness: .8, metalness: .25 }),
    new THREE.MeshStandardMaterial({ color: '#c1cacc', roughness: .4, metalness: .7 }),
    new THREE.MeshStandardMaterial({ color: '#d7a353', roughness: .48, metalness: .6 }),
  ];
  /** 带体顶面的流向 chevron 贴图材质（map.offset 沿带滚动 = 流向动画；1 次重复 = 1 格）。 */
  private readonly surfaceMaterial = new THREE.MeshBasicMaterial({
    map: beltChevronTexture(), transparent: true, depthWrite: false, toneMapped: false,
  });

  constructor() {
    this.group.name = 'continuous-conveyors';
    this.surfaceMaterial.polygonOffset = true;
    this.surfaceMaterial.polygonOffsetFactor = -2;
  }

  /**
   * 流向滚动：offset 以「格」为单位，与 2D 货物圆点同一套速度口径（planet-logistics-flow）。
   * 停止/冻结时传入 0，箭头静止（不闪）。只有可见带体参与。
   */
  update(deltaSeconds: number, speedTilesPerSecond = 0) {
    if (deltaSeconds <= 0 || speedTilesPerSecond <= 0) return;
    // 带体 UV 的 v 指向横向，u 指向流向；负号让 chevron 朝下游方向滚动。
    const map = this.surfaceMaterial.map;
    if (map) map.offset.x = (map.offset.x - deltaSeconds * speedTilesPerSecond) % 1;
  }

  refresh(buildings: readonly Building[], faceSize: number, radius = 100) {
    const belts = buildings.filter(building => isTransportBuilding(building));
    const signature = JSON.stringify([faceSize, radius, buildings.map(b => [b.id, b.owner_id, b.position, b.type,
      b.conveyor?.input, b.conveyor?.output, b.splitter?.input_directions, b.splitter?.output_directions,
      b.logistics_station?.belt_ports,
      b.fractionation && [b.fractionation.input_direction, b.fractionation.hydrogen_direction, b.fractionation.deuterium_direction],
      b.spray_coater && [b.spray_coater.input_direction, b.spray_coater.output_direction, b.spray_coater.reagent_direction],
      Boolean(b.storage), b.runtime?.params?.io_ports])]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.clear();
    const paths = conveyorPaths(buildings, faceSize, radius), size = surfaceTileSize(radius, faceSize);
    const buffers: MeshBuffer[] = this.materials.map(() => ({ positions: [], tiles: [], uvs: [] }));
    const surface: MeshBuffer = { positions: [], tiles: [], uvs: [] };
    this.tiles = belts.map(building => ({ x: building.position.x, y: building.position.y }));
    const indices = new Map(belts.map((building, index) => [building.id, index]));
    const quad = (buffer: MeshBuffer, tile: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      u0 = 0, u1 = 1, v0 = 0, v1 = 1) => {
      const corners: [THREE.Vector3, number, number][] = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [a, u0, v0], [c, u1, v1], [d, u0, v1]];
      for (const [point, u, v] of corners) {
        buffer.positions.push(point.x, point.y, point.z);
        buffer.uvs.push(u, v);
        buffer.tiles.push(tile);
      }
    };
    for (const path of paths) {
      const tile = indices.get(path.building.id)!;
      const point = (t: number, side: number, height: number) => {
        const p = path.point(t);
        return p.clone().addScaledVector(path.side(t), side * size).addScaledVector(p.clone().normalize(), height * size);
      };
      const ribbon = (buffer: MeshBuffer, lo: number, hi: number, bottom: number, top: number, start = 0, end = 1, steps = path.input === opposite[path.output] ? 4 : 12) => {
        for (let i=0; i<steps; i++) {
          const a = start + (end-start)*i/steps, b = start + (end-start)*(i+1)/steps;
          quad(buffer,tile,point(a,lo,top),point(b,lo,top),point(b,hi,top),point(a,hi,top));
          quad(buffer,tile,point(a,lo,bottom),point(b,lo,bottom),point(b,lo,top),point(a,lo,top));
          quad(buffer,tile,point(a,hi,top),point(b,hi,top),point(b,hi,bottom),point(a,hi,bottom));
        }
        for (const t of [start,end]) quad(buffer,tile,point(t,lo,bottom),point(t,lo,top),point(t,hi,top),point(t,hi,bottom));
      };
      ribbon(buffers[0], -.26,.26,-.075,0);
      for (const sign of [-1,1]) {
        ribbon(buffers[1], sign*.285-.025,sign*.285+.025,-.035,.065);
        ribbon(buffers[2], sign*.285-.027,sign*.285+.027,.065,.078);
      }
      // Transverse metal slats expose belt direction even in a frozen screenshot.
      for (let i=0;i<10;i++) ribbon(buffers[1],-.245,.245,.001,.012,(i+.18)/10,(i+.38)/10,1);
      // 顶面流向贴图：起点=输入端口、终点=输出端口，UV.u 沿流向（1 次重复 = 1 格）。
      // 转角拆成两段、u 各占半格，避免在弯道处把 chevron 拉长。
      const turning = path.input !== path.output && path.input !== opposite[path.output];
      const sections: [number, number, number, number][] = turning ? [[0, .5, 0, .5], [.5, 1, .5, 1]] : [[0, 1, 0, 1]];
      for (const [start, end, uStart, uEnd] of sections) {
        for (let i=0; i<8; i++) {
          const a = start + (end-start)*i/8, b = start + (end-start)*(i+1)/8;
          const ua = uStart + (uEnd-uStart)*i/8, ub = uStart + (uEnd-uStart)*(i+1)/8;
          quad(surface, tile, point(a,-.25,.013), point(b,-.25,.013), point(b,.25,.013), point(a,.25,.013), ua, ub);
        }
      }
    }
    buffers.forEach((buffer,index) => {
      if (!buffer.positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions,3));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(buffer.tiles,1));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry,this.materials[index]);
      mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    });
    if (surface.positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(surface.uvs, 2));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(surface.tiles, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.surfaceMaterial);
      mesh.renderOrder = 6;
      this.group.add(mesh);
    }
    return true;
  }

  resolveHit(hit: THREE.Intersection): TilePoint | null {
    if (hit.object.parent !== this.group || !(hit.object instanceof THREE.Mesh) || hit.faceIndex == null) return null;
    const index = hit.object.geometry.getAttribute('tileIndex').getX(hit.faceIndex*3);
    return this.tiles[index] ? { ...this.tiles[index] } : null;
  }

  private clear() {
    for (const child of [...this.group.children]) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      child.removeFromParent();
    }
  }
  dispose() {
    this.clear();
    this.materials.forEach(material => material.dispose());
    this.surfaceMaterial.dispose();
    this.group.removeFromParent();
  }
}
