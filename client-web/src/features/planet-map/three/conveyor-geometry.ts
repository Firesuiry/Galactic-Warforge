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

/**
 * DSP 式带体剖面（单位 cell，带体中心线 x=0、地面基准 y=0）。
 *
 * 低矮机身 + 两侧浅色抬起的护栏 + 亮金属护栏顶盖 + 深色滚动带面：
 * 远景读成「一条有亮边的低带」，近景能看清护栏与横向带条。所有部件共用同一剖面常量，
 * 相邻两格在端口处才能严丝合缝（端口距离统一 .5，见 conveyorPaths）。
 */
export const BELT_BODY_HALF = .30;        // 底部机身半宽
export const BELT_BODY_BOTTOM = -.02;     // 机身底面（略入地）
export const BELT_RAIL_INNER = .255;      // 侧护栏内壁
export const BELT_RAIL_OUTER = .30;       // 侧护栏外壁（= 机身外沿）
export const BELT_RAIL_TOP = .15;         // 侧护栏顶（顶盖下沿）
export const BELT_CAP_INNER = .245;       // 护栏顶盖内沿（略向内悬出）
export const BELT_CAP_OUTER = .31;        // 护栏顶盖外沿
export const BELT_CAP_TOP = .17;          // 护栏顶盖上表面
export const BELT_DECK_HALF = .235;       // 带面半宽
export const BELT_DECK_TOP = .105;        // 带面上表面（物品坐在这个高度）
export const BELT_CHAMFER_TOP = .12;      // 拦边斜角上沿（接护栏内壁）
/** 带体总宽（含顶盖），略窄于 1 cell 的 .86 建筑占地。 */
export const BELT_TOTAL_WIDTH = BELT_CAP_OUTER * 2;

export interface ConveyorPath {
  building: Building;
  input: SurfaceDirection;
  output: SurfaceDirection;
  connected: ReadonlySet<SurfaceDirection>;
  /** Surface-space centerline; both adjacent tiles return the exact same boundary point. */
  point: (fraction: number) => THREE.Vector3;
  side: (fraction: number) => THREE.Vector3;
}

/**
 * 端盖只画在真正的端点：输入/输出方向和邻居（或建筑端口）断开时封口，
 * 连接方向透传给邻居带体（相邻两格端口严丝合缝，不能有夹在中间的挡板）。
 */
export function conveyorCaps(path: ConveyorPath) {
  return { start: !path.connected.has(path.input), end: !path.connected.has(path.output) };
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
        // 端口距离统一 .5（格边界）；只有建筑 IO 端口才探进邻居格 .64。
        // 断开的一端也落在格边界上：一格带体就是一整格，端点由端盖封口。
        const distance = machinePorts.get(building.id)!.has(direction) ? .64 : .5;
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

/**
 * 带体剖面：从带面边缘向外、再向下到底面中心的一条折线（右半边）。
 * 顺序即「沿实体边界行走」方向（内侧在左），因此每个四边形 (t0p0,t1p0,t1p1,t0p1)
 * 的绕序天然给出朝外的法线。左半边镜像 + 反向即可。
 */
const PROFILE: readonly { material: number; from: readonly [number, number]; to: readonly [number, number] }[] = [
  { material: 2, from: [BELT_DECK_HALF, BELT_DECK_TOP], to: [BELT_RAIL_INNER, BELT_CHAMFER_TOP] }, // 拦边斜角 alloy
  { material: 0, from: [BELT_RAIL_INNER, BELT_CHAMFER_TOP], to: [BELT_RAIL_INNER, BELT_RAIL_TOP] }, // 护栏内壁 graphite
  { material: 2, from: [BELT_RAIL_INNER, BELT_RAIL_TOP], to: [BELT_CAP_INNER, BELT_RAIL_TOP] },      // 顶盖内悬空面
  { material: 2, from: [BELT_CAP_INNER, BELT_RAIL_TOP], to: [BELT_CAP_INNER, BELT_CAP_TOP] },        // 顶盖内壁
  { material: 2, from: [BELT_CAP_INNER, BELT_CAP_TOP], to: [BELT_CAP_OUTER, BELT_CAP_TOP] },          // 顶盖顶面（亮金属边）
  { material: 2, from: [BELT_CAP_OUTER, BELT_CAP_TOP], to: [BELT_CAP_OUTER, BELT_RAIL_TOP] },        // 顶盖外壁
  { material: 2, from: [BELT_CAP_OUTER, BELT_RAIL_TOP], to: [BELT_RAIL_OUTER, BELT_RAIL_TOP] },      // 顶盖外悬空面
  { material: 1, from: [BELT_RAIL_OUTER, BELT_RAIL_TOP], to: [BELT_RAIL_OUTER, .02] },               // 护栏外壁 ceramic 浅色
  { material: 0, from: [BELT_RAIL_OUTER, .02], to: [BELT_RAIL_OUTER, BELT_BODY_BOTTOM] },            // 机身外壁 graphite
  { material: 0, from: [BELT_RAIL_OUTER, BELT_BODY_BOTTOM], to: [0, BELT_BODY_BOTTOM] },             // 机身底面
];

/** 端盖轮廓（[横向, 高度]）：带面 + 右半边剖面 + 左半边镜像，闭合后三角化封口。 */
function capContour(): [number, number][] {
  const contour: [number, number][] = [[0, BELT_DECK_TOP], [BELT_DECK_HALF, BELT_DECK_TOP]];
  for (const part of PROFILE) contour.push([part.to[0], part.to[1]]);
  for (let index = PROFILE.length - 1; index >= 0; index--) contour.push([-PROFILE[index].from[0], PROFILE[index].from[1]]);
  return contour;
}

/** Three merged draws for the entire visible network, with triangle-to-tile picking. */
export class ConveyorGeometry {
  readonly group = new THREE.Group();
  private signature = '';
  private tiles: TilePoint[] = [];
  // 金属度都压得偏低：metalness 高的竖面背离太阳时会黑成一条缝（试玩 1018 反馈：
  // 顶盖外侧被读成「弯道缺口」），这三块是结构件，颜色要稳定可读、只留一点金属光泽。
  private readonly materials = [
    // 机身/内壁/端盖：深色石墨。
    new THREE.MeshStandardMaterial({ color: '#26363e', roughness: .62, metalness: .22, side: THREE.DoubleSide }),
    // 护栏外侧：浅色陶瓷（DSP 的浅色护栏）。
    new THREE.MeshStandardMaterial({ color: '#b6c1bb', roughness: .5, metalness: .12, side: THREE.DoubleSide }),
    // 护栏顶盖/斜角：亮金属边（远景的第一识别特征）。
    new THREE.MeshStandardMaterial({ color: '#c6d0d2', roughness: .34, metalness: .26, side: THREE.DoubleSide }),
  ];
  /** 带面：深色底 + 每格 2 条横向浅色 slat + 极弱中心 chevron，沿带滚动 = 流向。 */
  private readonly surfaceMaterial = new THREE.MeshBasicMaterial({
    map: beltChevronTexture(), transparent: false, depthWrite: true, toneMapped: false,
  });

  constructor() {
    this.group.name = 'continuous-conveyors';
    this.surfaceMaterial.polygonOffset = true;
    this.surfaceMaterial.polygonOffsetFactor = -2;
  }

  /**
   * 流向滚动：offset 以「格」为单位，与 2D 货物圆点同一套速度口径（planet-logistics-flow）。
   * 停止/冻结时传入 0，带条静止（不闪）。只有可见带体参与。
   */
  update(deltaSeconds: number, speedTilesPerSecond = 0) {
    if (deltaSeconds <= 0 || speedTilesPerSecond <= 0) return;
    // 带体 UV 的 u 沿流向，负号让带条向下游滚动。
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
    const deck: MeshBuffer = { positions: [], tiles: [], uvs: [] };
    this.tiles = belts.map(building => ({ x: building.position.x, y: building.position.y }));
    const indices = new Map(belts.map((building, index) => [building.id, index]));
    const append = (buffer: MeshBuffer, tile: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
      u0 = 0, u1 = 1, v0 = 0, v1 = 1) => {
      const corners: [THREE.Vector3, number, number][] = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [a, u0, v0], [c, u1, v1], [d, u0, v1]];
      for (const [point, u, v] of corners) {
        buffer.positions.push(point.x, point.y, point.z);
        buffer.uvs.push(u, v);
        buffer.tiles.push(tile);
      }
    };
    const contour = capContour();
    const capTriangles = THREE.ShapeUtils.triangulateShape(contour.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const path of paths) {
      const tile = indices.get(path.building.id)!;
      const straight = path.input === opposite[path.output];
      // 转弯 16 段：弯道上的护栏/带面按曲线细分，外侧护栏不会出现折角缺口。
      const steps = straight ? 4 : 16;
      // 端盖只在真正的端点：连接方向（含建筑端口）不封口。
      const caps = conveyorCaps(path);
      const frames = Array.from({ length: steps + 1 }, (_, index) => {
        const t = index / steps, p = path.point(t);
        return { p, up: p.clone().normalize(), side: path.side(t) };
      });
      const tangentAt = (index: number) => frames[Math.min(steps, index + 1)].p.clone().sub(frames[Math.max(0, index - 1)].p).normalize();
      const at = (index: number, lateral: number, height: number) => frames[index].p.clone()
        .addScaledVector(frames[index].side, lateral * size).addScaledVector(frames[index].up, height * size);
      for (const part of PROFILE) for (const sign of [1, -1] as const) {
        const from: [number, number] = [part.from[0] * sign, part.from[1]];
        const to: [number, number] = [part.to[0] * sign, part.to[1]];
        // 左半边把折线方向反过来，绕序仍然朝外。
        const [p0, p1] = sign > 0 ? [from, to] : [to, from];
        for (let index = 0; index < steps; index++) {
          append(buffers[part.material], tile,
            at(index, p0[0], p0[1]), at(index + 1, p0[0], p0[1]),
            at(index + 1, p1[0], p1[1]), at(index, p1[0], p1[1]));
        }
      }
      // 深色带面：UV.u 沿流向（1 次重复 = 1 格），UV.v 横跨带面（滚动贴图见 logistics-marks）。
      for (let index = 0; index < steps; index++) {
        append(deck, tile,
          at(index, -BELT_DECK_HALF, BELT_DECK_TOP), at(index + 1, -BELT_DECK_HALF, BELT_DECK_TOP),
          at(index + 1, BELT_DECK_HALF, BELT_DECK_TOP), at(index, BELT_DECK_HALF, BELT_DECK_TOP),
          index / steps, (index + 1) / steps, 0, 1);
      }
      // 端点封口：整块剖面板。缩进 .004 格，两端带体对头时不会 z-fight。
      for (const [edge, capped] of [[0, caps.start], [steps, caps.end]] as const) {
        if (!capped) continue;
        const frame = frames[edge], tangent = tangentAt(edge).multiplyScalar(edge === 0 ? -1 : 1);
        const center = frame.p.clone().addScaledVector(tangent, -.004 * size);
        const place = (lateral: number, height: number) => center.clone()
          .addScaledVector(frame.side, lateral * size).addScaledVector(frame.up, height * size);
        for (const triangle of capTriangles) {
          let a = place(contour[triangle[0]][0], contour[triangle[0]][1]);
          let b = place(contour[triangle[1]][0], contour[triangle[1]][1]);
          let c = place(contour[triangle[2]][0], contour[triangle[2]][1]);
          // 端盖法线朝带体外侧（顶点绕序按需求翻面）。
          if (new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).dot(tangent) < 0) [b, c] = [c, b];
          buffers[0].positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          buffers[0].tiles.push(tile, tile, tile);
          buffers[0].uvs.push(0, 0, 0, 0, 0, 0);
        }
      }
    }
    buffers.forEach((buffer, index) => {
      if (!buffer.positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(buffer.tiles, 1));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.materials[index]);
      mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    });
    if (deck.positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(deck.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(deck.uvs, 2));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(deck.tiles, 1));
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
