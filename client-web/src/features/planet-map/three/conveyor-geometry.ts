import * as THREE from 'three';
import { surfaceFace, surfaceOffset, surfaceStep, type SurfaceDirection } from '@shared/surface';
import type { Building, ConveyorDirection, PortDirection } from '@shared/types';
import type { TilePoint } from '../model';
import { getBuildingFootprint } from '../model';
import { BELT_LEVEL_HEIGHT, MAX_BELT_ELEVATION, beltElevation, beltVisualSpeed, logisticsTier, occupiesGround } from '../logistics-tier';
import { beltDeckTexture } from './logistics-marks';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';

const directions: SurfaceDirection[] = ['north', 'east', 'south', 'west'];
const opposite: Record<SurfaceDirection, SurfaceDirection> = { north: 'south', east: 'west', south: 'north', west: 'east' };
const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;
const cardinal = (direction: ConveyorDirection | undefined): direction is SurfaceDirection => directions.includes(direction as SurfaceDirection);
const key = (tile: TilePoint, elevation = 0) => `${tile.x}:${tile.y}@${elevation}`;
const isPureBelt = (building: Pick<Building, 'type'>) => building.type.startsWith('conveyor_belt_');
const isTransportBuilding = (building: Pick<Building, 'type' | 'conveyor'>) => Boolean(building.conveyor && (isPureBelt(building) || building.type === 'automatic_piler' || building.type === 'splitter'));

/**
 * DSP 式带体剖面（第 19 轮，单位 cell，带体中心线 x=0、带体基准 y=0）。
 *
 * DSP 的带子是**低矮的金属带体**：两侧只比带面高一点点的金属边，带面上滚动分档色箭头。
 * 第 18 轮的高白护栏 + 白横条读成「水槽」，本轮压矮：侧栏只比带面高 .038，侧栏顶一条亮金属边
 * 是远景的识别线，带面上的档位色 chevron 是流向与档位的识别。
 */
export const BELT_BODY_HALF = .30;        // 带体外沿半宽
export const BELT_BODY_BOTTOM = -.02;     // 带体底面（略入地）
export const BELT_SKIRT_HALF = .285;      // 底部收边（向内收一点，侧面不显方盒）
export const BELT_SKIRT_TOP = .035;       // 收边上沿 = 侧壁下沿
export const BELT_RAIL_INNER = .255;      // 侧栏内沿
export const BELT_RAIL_OUTER = .30;       // 侧栏外沿
export const BELT_RAIL_TOP = .128;        // 侧栏顶（亮金属边）
export const BELT_DECK_HALF = .24;        // 带面半宽
export const BELT_DECK_TOP = .09;         // 带面上表面（物品坐在这个高度）
/** 带体总宽，略窄于 1 cell 的 .86 建筑占地。 */
export const BELT_TOTAL_WIDTH = BELT_RAIL_OUTER * 2;
/** 带体基准离球面半径的高度：底面 = .045 − .02 = .025，与建筑底座同一地面（旧值 .19 让带子悬空 .17 格）。 */
export const BELT_BASE_LIFT = .045;
/** 侧面汇入开口的半宽（= 支带外沿半宽）：主带侧栏在这段被切开。 */
const MERGE_OPENING_HALF = BELT_RAIL_OUTER;
/** 支带带面探进主带带面的长度（盖住主带带面边缘的深色边带）。 */
const MERGE_DECK_TONGUE = .05;

export interface ConveyorPath {
  building: Building;
  input: SurfaceDirection;
  output: SurfaceDirection;
  connected: ReadonlySet<SurfaceDirection>;
  /** 本格所在层（0 = 地面）。 */
  elevation: number;
  /** Surface-space centerline (incl. elevation/ramps); both adjacent tiles return the exact same boundary point. */
  point: (fraction: number) => THREE.Vector3;
  side: (fraction: number) => THREE.Vector3;
}

/** 一条带的下游/上游链接：方向是本格自己的面内方向，elevation 是对端所在层。 */
interface BeltLink { direction: SurfaceDirection; elevation: number }

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

/**
 * 带与带之间的链接（第 19 轮契约 §3.3，与服务端同一算法）：
 *
 * 1. 同层：邻格同一层的运输建筑接受这一侧输入 → 连；
 * 2. 坡道（同层没连上时，源是任意运输建筑）：邻格 a−1、a+1 层的**纯传送带**，且它的输出方向就是本次行进方向
 *    （直行延续，坡道上不转弯、不侧汇）并接受来自背后的输入 → 连；
 * 3. 否则死头。
 *
 * 地面层（0）之外只有纯传送带；分流器/集装机/建筑 IO 都只在地面层。
 */
function resolveBeltLinks(belts: readonly Building[], faceSize: number) {
  const byLayer = new Map<string, Building>();
  for (const building of belts) byLayer.set(key(building.position, beltElevation(building)), building);
  const inputs = new Map<string, BeltLink[]>(), outputs = new Map<string, BeltLink[]>();
  for (const building of belts) { inputs.set(building.id, []); outputs.set(building.id, []); }
  for (const building of belts) {
    const elevation = beltElevation(building);
    const output = building.conveyor!.output;
    for (const direction of directions) {
      if (building.splitter ? !building.splitter.output_directions.includes(direction) : cardinal(output) && output !== direction) continue;
      const step = surfaceStep(building.position, direction, faceSize);
      const back = opposite[step.direction];
      let target: Building | undefined;
      const level = byLayer.get(key(step.tile, elevation));
      if (level && level.owner_id === building.owner_id && allowsInput(level, back)
        // auto 输出不回灌给正对着自己输出的邻居。
        && !(!building.splitter && !cardinal(output) && !level.splitter && cardinal(level.conveyor!.output) && level.conveyor!.output === back)) {
        target = level;
      } else {
        // 源不限（分流器/集装机/auto 带都能接坡道），只约束目标 B 是直行延续的纯传送带（服务端 conveyorDownstreamAt）。
        for (const ramp of [elevation - 1, elevation + 1]) {
          if (ramp < 0 || ramp > MAX_BELT_ELEVATION) continue;
          const candidate = byLayer.get(key(step.tile, ramp));
          if (!candidate || !isPureBelt(candidate) || candidate.owner_id !== building.owner_id) continue;
          if (candidate.conveyor!.output !== step.direction || !allowsInput(candidate, back)) continue;
          target = candidate;
          break;
        }
      }
      if (!target) continue;
      outputs.get(building.id)!.push({ direction, elevation: beltElevation(target) });
      inputs.get(target.id)!.push({ direction: back, elevation });
    }
  }
  return { inputs, outputs };
}

/** Callers pass ONLY player-owned or currently visible buildings. Never infer an unseen belt. */
export function conveyorPaths(buildings: readonly Building[], faceSize: number, radius = 100): ConveyorPath[] {
  return conveyorLayout(buildings, faceSize, radius).paths;
}

interface SideMerge { path: ConveyorPath; direction: SurfaceDirection }

/** 路线 + 侧面汇入（汇入只在同层，渲染成 T 形接头，不再画成一条穿过主带的弯道）。 */
function conveyorLayout(buildings: readonly Building[], faceSize: number, radius = 100) {
  const belts = buildings.filter(building => isTransportBuilding(building));
  const { inputs, outputs } = resolveBeltLinks(belts, faceSize);
  const groundBelts = new Map(belts.filter(building => beltElevation(building) === 0).map(building => [`${building.position.x}:${building.position.y}`, building]));
  const machinePorts = new Map<string, Set<SurfaceDirection>>(belts.map(building => [building.id, new Set()]));
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
        const belt = groundBelts.get(`${step.tile.x}:${step.tile.y}`);
        if (!belt || belt.splitter || belt.owner_id !== machine.owner_id) continue;
        const towardMachine = opposite[step.direction];
        const feedsMachine = port.direction !== 'output' && (belt.conveyor!.output === towardMachine
          || Boolean(port.side && belt.conveyor!.output === 'auto'));
        const feedsBelt = port.direction !== 'input' && allowsInput(belt, towardMachine);
        if (!feedsMachine && !feedsBelt) continue;
        const list = (feedsMachine ? outputs : inputs).get(belt.id)!;
        if (!list.some(link => link.direction === towardMachine)) list.push({ direction: towardMachine, elevation: 0 });
        machinePorts.get(belt.id)!.add(towardMachine);
      }
    }
  }
  const paths: ConveyorPath[] = [];
  const merges: SideMerge[] = [];
  const size = surfaceTileSize(radius, faceSize);
  const base = radius + size * BELT_BASE_LIFT;
  for (const building of belts) {
    const incoming = inputs.get(building.id)!, outgoing = outputs.get(building.id)!;
    const elevation = beltElevation(building);
    const output = cardinal(building.conveyor!.output) ? building.conveyor!.output : outgoing[0]?.direction ?? 'east';
    const incomingDirections = incoming.map(link => link.direction);
    const configured = building.conveyor!.input;
    // 主输入：直行优先（背后来的），其次是显式配置的转弯输入，再其次第一条汇入；其余同层汇入都是侧面汇入。
    const main = incomingDirections.includes(opposite[output]) ? opposite[output]
      : cardinal(configured) && incomingDirections.includes(configured) ? configured
      : incomingDirections[0] ?? (cardinal(configured) && configured !== output ? configured : opposite[output]);
    const connected = new Set([...incomingDirections, ...outgoing.map(link => link.direction)]);
    const linkedElevation = (direction: SurfaceDirection) =>
      [...incoming, ...outgoing].find(link => link.direction === direction)?.elevation ?? elevation;
    const routes: [SurfaceDirection, SurfaceDirection][] = building.splitter
      ? building.splitter.input_directions.flatMap(start => building.splitter!.output_directions.map(end => [start, end] as [SurfaceDirection, SurfaceDirection]))
      : [[main, output]];
    const sides: SurfaceDirection[] = [];
    if (!building.splitter) {
      for (const port of incomingDirections) if (port !== main && port !== output && !sides.includes(port)) sides.push(port);
      for (const link of outgoing) if (link.direction !== output && link.direction !== main) routes.push([main, link.direction]);
    }
    const face = surfaceFace(building.position, faceSize);
    const heightOf = (level: number) => level * BELT_LEVEL_HEIGHT;
    const port = (direction: SurfaceDirection, distance?: number) => {
      const [dx, dy] = offsets[direction];
      // 端口距离统一 .5（格边界）；只有建筑 IO 端口才探进邻居格 .64。
      // 断开的一端也落在格边界上：一格带体就是一整格，端点由端盖封口。
      const reach = distance ?? (machinePorts.get(building.id)!.has(direction) ? .64 : .5);
      const tile = { x: building.position.x + dx * reach, y: building.position.y + dy * reach };
      const normal = tileNormal(tile, faceSize, face);
      const side = tileNormal({ x: tile.x - dy * .001, y: tile.y + dx * .001 }, faceSize, face).sub(tileNormal({ x: tile.x + dy * .001, y: tile.y - dx * .001 }, faceSize, face)).normalize();
      // 坡道：端口高度取两层的均值，相邻两格在边界处同高同斜率。
      return { normal, side, height: (heightOf(elevation) + heightOf(linkedElevation(direction))) / 2 };
    };
    const center = tileNormal(building.position, faceSize);
    const centerHeight = heightOf(elevation);
    const makePath = (start: SurfaceDirection, end: SurfaceDirection, a: ReturnType<typeof port>, b: ReturnType<typeof port>, control: THREE.Vector3, controlHeight: number): ConveyorPath => {
      // Quadratic turns meet straight neighbor sections tangentially; normalization
      // follows the sphere instead of cutting a chord below its surface. Height follows
      // the same Bézier so ramps stay tangent-continuous across cell boundaries.
      const point = (t: number) => {
        const lift = (1 - t) ** 2 * a.height + 2 * t * (1 - t) * controlHeight + t * t * b.height;
        return a.normal.clone().multiplyScalar((1 - t) ** 2).addScaledVector(control, 2 * t * (1 - t)).addScaledVector(b.normal, t * t)
          .normalize().multiplyScalar(base + lift * size);
      };
      const side = (t: number) => {
        const p = point(t), tangent = point(Math.min(1, t + .0001)).sub(point(Math.max(0, t - .0001))).normalize();
        const lateral = new THREE.Vector3().crossVectors(p.clone().normalize(), tangent).normalize();
        if (t === 0 || t === 1) {
          const edge = (t === 0 ? a.side : b.side).clone();
          return edge.multiplyScalar(edge.dot(lateral) < 0 ? -1 : 1);
        }
        return lateral;
      };
      return { building, input: start, output: end, connected, elevation, point, side };
    };
    for (const [start, end] of routes) paths.push(makePath(start, end, port(start), port(end), center, centerHeight));
    // 侧面汇入：从格边界直伸到主带带面边缘（T 形接头），主带在这一侧的侧栏开口。
    for (const direction of sides) {
      const a = port(direction);
      // 支带内端在**局部切平面**里离主带中心线 BELT_DECK_HALF（带面半宽也是按局部量的）；
      // 按图集格坐标偏移 .24 在 tan 映射下会停在主带带面边缘之外，接缝露出一道暗缝。
      const inward = a.normal.clone().sub(center);
      inward.addScaledVector(center, -inward.dot(center)).normalize();
      const b = { normal: center.clone().multiplyScalar(base).addScaledVector(inward, BELT_DECK_HALF * size).normalize(), side: a.side, height: centerHeight };
      const control = a.normal.clone().add(b.normal).normalize();
      merges.push({ direction, path: makePath(direction, opposite[direction], a, b, control, centerHeight) });
    }
  }
  return { paths, merges, belts };
}

interface MeshBuffer { positions: number[]; tiles: number[]; uvs: number[] }
type Profile = readonly { material: number; from: readonly [number, number]; to: readonly [number, number] }[];

/**
 * 带体剖面：从带面边缘向外、再向下到底面中心的一条折线（右半边）。
 * 顺序即「沿实体边界行走」方向（内侧在左），因此每个四边形 (t0p0,t1p0,t1p1,t0p1)
 * 的绕序天然给出朝外的法线。左半边镜像 + 反向即可。
 * 材质：0 深色机身 / 1 中灰金属侧壁 / 2 亮金属侧栏顶边。
 */
const RAIL_PROFILE: Profile = [
  { material: 0, from: [BELT_DECK_HALF, BELT_DECK_TOP], to: [BELT_RAIL_INNER, BELT_RAIL_TOP] },        // 侧栏内斜面
  { material: 2, from: [BELT_RAIL_INNER, BELT_RAIL_TOP], to: [BELT_RAIL_OUTER, BELT_RAIL_TOP] },       // 侧栏顶边
  { material: 1, from: [BELT_RAIL_OUTER, BELT_RAIL_TOP], to: [BELT_RAIL_OUTER, BELT_SKIRT_TOP] },      // 侧壁
];
const BODY_PROFILE: Profile = [
  { material: 0, from: [BELT_RAIL_OUTER, BELT_SKIRT_TOP], to: [BELT_SKIRT_HALF, BELT_BODY_BOTTOM] },  // 底部收边
  { material: 0, from: [BELT_SKIRT_HALF, BELT_BODY_BOTTOM], to: [0, BELT_BODY_BOTTOM] },             // 底面
];
const PROFILE: Profile = [...RAIL_PROFILE, ...BODY_PROFILE];

/** 端盖轮廓（[横向, 高度]）：带面 + 右半边剖面 + 左半边镜像，闭合后三角化封口。 */
function capContour(): [number, number][] {
  const contour: [number, number][] = [[0, BELT_DECK_TOP], [BELT_DECK_HALF, BELT_DECK_TOP]];
  for (const part of PROFILE) contour.push([part.to[0], part.to[1]]);
  for (let index = PROFILE.length - 1; index >= 0; index--) contour.push([-PROFILE[index].from[0], PROFILE[index].from[1]]);
  return contour;
}
/** 支带侧栏在汇入端的小端盖（只封侧栏截面，带面敞开接主带）。 */
function railCapContour(): [number, number][] {
  return [[BELT_DECK_HALF, BELT_DECK_TOP], [BELT_RAIL_INNER, BELT_RAIL_TOP], [BELT_RAIL_OUTER, BELT_RAIL_TOP], [BELT_RAIL_OUTER, BELT_SKIRT_TOP], [BELT_DECK_HALF, BELT_SKIRT_TOP]];
}

/** 立柱/底座/横托的 5 个面（底面朝地不画），角点按 (±along, ±up, ±across) 排。 */
type Corner = [number, number, number];
const BOX_FACES: [Corner, Corner, Corner, Corner][] = [
  [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]], [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]],
  [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]], [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]],
  [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]],
];

/** 档位 → 带面 mesh 序号（每档一张滚动贴图，滚速 1 : 2 : 5）。 */
const DECK_TIERS = [1, 2, 3] as const;
/** 建造预览（ghost）色：与分拣器 ghost、可放置描边同一系绿。 */
export const CONVEYOR_GHOST_COLOR = '#7df7b0';

/** Merged draws for the entire visible network (3 structure + ≤3 tier decks), with triangle-to-tile picking. */
export class ConveyorGeometry {
  readonly group = new THREE.Group();
  private signature = '';
  private tiles: TilePoint[] = [];
  private ids: string[] = [];
  // 金属度压低：metalness 高的竖面背离太阳时会黑成一条缝（1018 反馈），结构件要颜色稳定可读。
  private readonly materials: THREE.MeshStandardMaterial[];
  /** 带面：深色底 + 档位色 chevron（贴图同时作 emissiveMap，箭头微微自发光）。 */
  private readonly deckMaterials: THREE.MeshStandardMaterial[];

  /** `ghost`：建造预览用的半透明绿色带体（拖拽铺带时整条路径按将要建成的样子画，含坡道/桥墩）。 */
  constructor(private readonly options: { ghost?: boolean } = {}) {
    this.group.name = options.ghost ? 'conveyor-ghost' : 'continuous-conveyors';
    const ghost = (opacity: number) => ({ color: CONVEYOR_GHOST_COLOR, transparent: true, opacity, depthWrite: false, roughness: .5, metalness: .1 });
    this.materials = options.ghost
      ? [.28, .36, .55].map(opacity => new THREE.MeshStandardMaterial({ ...ghost(opacity), side: THREE.DoubleSide }))
      : [
        // 机身/内斜面/底面/端盖：深石墨。
        new THREE.MeshStandardMaterial({ color: '#2a3338', roughness: .6, metalness: .25, side: THREE.DoubleSide }),
        // 侧壁 + 支撑柱：中灰金属。
        new THREE.MeshStandardMaterial({ color: '#6f7d84', roughness: .58, metalness: .28, side: THREE.DoubleSide }),
        // 侧栏顶边：亮色哑光（远景的识别线）。不能太光滑：太阳镜面高光会冲过 bloom 阈值，
        // 屏幕一侧（背着太阳的那半边视线）的整段带栏会糊成一片白光。
        new THREE.MeshStandardMaterial({ color: '#b9c4c8', roughness: .62, metalness: .12, side: THREE.DoubleSide }),
      ];
    this.deckMaterials = DECK_TIERS.map(tier => {
      const map = beltDeckTexture(tier);
      const material = options.ghost
        ? new THREE.MeshStandardMaterial({ ...ghost(.6), map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: .35 })
        : new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: .55, roughness: .58, metalness: .12 });
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      return material;
    });
  }

  /**
   * 带面箭头滚动：每档按 `beltVisualSpeed` 自己的速度（1 : 2 : 5），offset 单位是「格」。
   * DSP 的带子不耗电：堵住时货停、带面照转；只有冻结/减弱动效（delta=0）时静止。
   */
  update(deltaSeconds: number) {
    if (deltaSeconds <= 0) return;
    DECK_TIERS.forEach((tier, index) => {
      const map = this.deckMaterials[index].map;
      // 带体 UV 的 u 沿流向，负号让箭头向下游滚动。
      if (map) map.offset.x = (map.offset.x - deltaSeconds * beltVisualSpeed(`conveyor_belt_mk${tier}`)) % 1;
    });
  }

  refresh(buildings: readonly Building[], faceSize: number, radius = 100) {
    const signature = JSON.stringify([faceSize, radius, buildings.map(b => [b.id, b.owner_id, b.position, b.type,
      b.conveyor?.input, b.conveyor?.output, b.conveyor?.elevation, b.splitter?.input_directions, b.splitter?.output_directions,
      b.logistics_station?.belt_ports,
      b.fractionation && [b.fractionation.input_direction, b.fractionation.hydrogen_direction, b.fractionation.deuterium_direction],
      b.spray_coater && [b.spray_coater.input_direction, b.spray_coater.output_direction, b.spray_coater.reagent_direction],
      Boolean(b.storage), b.runtime?.params?.io_ports])]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.clear();
    const { paths, merges, belts } = conveyorLayout(buildings, faceSize, radius);
    const size = surfaceTileSize(radius, faceSize);
    const buffers: MeshBuffer[] = this.materials.map(() => ({ positions: [], tiles: [], uvs: [] }));
    const decks: MeshBuffer[] = DECK_TIERS.map(() => ({ positions: [], tiles: [], uvs: [] }));
    this.tiles = belts.map(building => ({ x: building.position.x, y: building.position.y }));
    this.ids = belts.map(building => building.id);
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
    const triangle = (buffer: MeshBuffer, tile: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      buffer.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      buffer.tiles.push(tile, tile, tile);
      buffer.uvs.push(0, 0, 0, 0, 0, 0);
    };
    const contour = capContour();
    const capTriangles = THREE.ShapeUtils.triangulateShape(contour.map(([x, y]) => new THREE.Vector2(x, y)), []);
    const railContour = railCapContour();
    const railTriangles = THREE.ShapeUtils.triangulateShape(railContour.map(([x, y]) => new THREE.Vector2(x, y)), []);
    // 每格的侧面汇入方向：主带在这些方向上的侧栏要开口。
    const openings = new Map<string, SurfaceDirection[]>();
    for (const merge of merges) {
      const list = openings.get(merge.path.building.id) ?? [];
      list.push(merge.direction); openings.set(merge.path.building.id, list);
    }
    const groundTiles = groundOccupancy(buildings, faceSize);
    type Ribbon = { path: ConveyorPath; tile: number; steps: number; capStart: boolean; capEnd: boolean;
      railCapEnd?: boolean; deck: number; uScale?: number; deckTongue?: number; cut?: (local: THREE.Vector2) => boolean };
    const ribbon = ({ path, tile, steps, capStart, capEnd, railCapEnd, deck, uScale = 1, deckTongue = 0, cut }: Ribbon) => {
      const frames = Array.from({ length: steps + 1 }, (_, index) => {
        const t = index / steps, p = path.point(t);
        return { p, up: p.clone().normalize(), side: path.side(t) };
      });
      const tangentAt = (index: number) => frames[Math.min(steps, index + 1)].p.clone().sub(frames[Math.max(0, index - 1)].p).normalize();
      const at = (index: number, lateral: number, height: number) => frames[index].p.clone()
        .addScaledVector(frames[index].side, lateral * size).addScaledVector(frames[index].up, height * size);
      // 主带侧栏开口判定用格内平面坐标（east/south，单位 cell）。
      const frame = tileFrame(path.building.position, faceSize);
      const origin = tileNormal(path.building.position, faceSize).multiplyScalar(radius + size * BELT_BASE_LIFT);
      const local = (point: THREE.Vector3) => {
        const offset = point.clone().sub(origin);
        return new THREE.Vector2(offset.dot(frame.east) / size, offset.dot(frame.south) / size);
      };
      for (const part of PROFILE) for (const sign of [1, -1] as const) {
        const from: [number, number] = [part.from[0] * sign, part.from[1]];
        const to: [number, number] = [part.to[0] * sign, part.to[1]];
        // 左半边把折线方向反过来，绕序仍然朝外。
        const [p0, p1] = sign > 0 ? [from, to] : [to, from];
        const rail = RAIL_PROFILE.includes(part);
        for (let index = 0; index < steps; index++) {
          const a = at(index, p0[0], p0[1]), b = at(index + 1, p0[0], p0[1]);
          const c = at(index + 1, p1[0], p1[1]), d = at(index, p1[0], p1[1]);
          if (rail && cut?.(local(a.clone().add(c).multiplyScalar(.5)))) continue;
          append(buffers[part.material], tile, a, b, c, d);
        }
      }
      // 带面：UV.u 沿流向（每格 0→1，相邻格无缝），UV.v 横跨带面（滚动贴图见 logistics-marks）。
      for (let index = 0; index < steps; index++) {
        append(decks[deck], tile,
          at(index, -BELT_DECK_HALF, BELT_DECK_TOP), at(index + 1, -BELT_DECK_HALF, BELT_DECK_TOP),
          at(index + 1, BELT_DECK_HALF, BELT_DECK_TOP), at(index, BELT_DECK_HALF, BELT_DECK_TOP),
          index / steps * uScale, (index + 1) / steps * uScale, 0, 1);
      }
      // 支带带面再往主带带面里探一小段（略抬高）：盖住主带带面边缘的深色边带，接缝处不留一道黑线。
      if (deckTongue > 0) {
        const last = frames[steps], forward = tangentAt(steps).multiplyScalar(deckTongue * size);
        const edge = (lateral: number, ahead: boolean) => last.p.clone().add(ahead ? forward : new THREE.Vector3())
          .addScaledVector(last.side, lateral * size).addScaledVector(last.up, (BELT_DECK_TOP + .002) * size);
        append(decks[deck], tile, edge(-BELT_DECK_HALF, false), edge(-BELT_DECK_HALF, true), edge(BELT_DECK_HALF, true), edge(BELT_DECK_HALF, false),
          uScale, uScale + deckTongue, 0, 1);
      }
      const capAt = (edge: number, shape: [number, number][], triangles: number[][], mirror: boolean) => {
        const frameAt = frames[edge], tangent = tangentAt(edge).multiplyScalar(edge === 0 ? -1 : 1);
        // 缩进 .004 格，两端带体对头时不会 z-fight。
        const center = frameAt.p.clone().addScaledVector(tangent, -.004 * size);
        for (const sign of mirror ? [1, -1] : [1]) {
          const place = (lateral: number, height: number) => center.clone()
            .addScaledVector(frameAt.side, sign * lateral * size).addScaledVector(frameAt.up, height * size);
          for (const tri of triangles) {
            const a = place(shape[tri[0]][0], shape[tri[0]][1]);
            let b = place(shape[tri[1]][0], shape[tri[1]][1]);
            let c = place(shape[tri[2]][0], shape[tri[2]][1]);
            // 端盖法线朝带体外侧（顶点绕序按需求翻面）。
            if (new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).dot(tangent) < 0) [b, c] = [c, b];
            triangle(buffers[0], tile, a, b, c);
          }
        }
      };
      if (capStart) capAt(0, contour, capTriangles, false);
      if (capEnd) capAt(steps, contour, capTriangles, false);
      if (railCapEnd) capAt(steps, railContour, railTriangles, true);
      return frames;
    };
    for (const path of paths) {
      const tile = indices.get(path.building.id)!;
      const straight = path.input === opposite[path.output];
      const cuts = path.building.splitter ? [] : openings.get(path.building.id) ?? [];
      // 有侧面汇入的格加密到 .05 格一段，开口两端正好落在段边界上；弯道 16 段避免护栏折角。
      const steps = cuts.length ? (straight ? 20 : 24) : straight ? 4 : 16;
      const caps = conveyorCaps(path);
      const cut = cuts.length ? (point: THREE.Vector2) => cuts.some(direction => {
        const [dx, dy] = offsets[direction];
        const along = point.x * dx + point.y * dy, across = Math.abs(point.x * dy - point.y * dx);
        return along > .05 && across < MERGE_OPENING_HALF - 1e-4;
      }) : undefined;
      const deck = DECK_TIERS.indexOf(tierOf(path.building));
      const frames = ribbon({ path, tile, steps, capStart: caps.start, capEnd: caps.end, deck, cut });
      if (path.elevation > 0) pillars(path, frames, size);
    }
    for (const merge of merges) {
      const tile = indices.get(merge.path.building.id)!;
      // 支带：u 只走 .5 − .24 = .26 格，箭头尺寸与整格一致，并接上游带体的相位。
      ribbon({ path: merge.path, tile, steps: 4, capStart: false, capEnd: false, railCapEnd: true,
        deck: DECK_TIERS.indexOf(tierOf(merge.path.building)), uScale: .5 - BELT_DECK_HALF, deckTongue: MERGE_DECK_TONGUE });
    }
    // 高架带支撑柱：地面空着才立（被地面带/分拣器/建筑占着的格子不立）。
    function pillars(path: ConveyorPath, frames: { p: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3 }[], cell: number) {
      if (groundTiles.has(`${path.building.position.x}:${path.building.position.y}`)) return;
      const mid = frames[Math.floor(frames.length / 2)];
      const tangent = frames[frames.length - 1].p.clone().sub(frames[0].p).normalize();
      const bottom = mid.p.clone().addScaledVector(mid.up, -(mid.p.length() - (radius + cell * BELT_BASE_LIFT)));
      const top = mid.p.clone().addScaledVector(mid.up, BELT_BODY_BOTTOM * cell);
      const tile = indices.get(path.building.id)!;
      const box = (center: THREE.Vector3, along: number, across: number, high: number, material: number) => {
        const x = tangent.clone().multiplyScalar(along / 2 * cell), z = mid.side.clone().multiplyScalar(across / 2 * cell);
        const y = mid.up.clone().multiplyScalar(high / 2 * cell);
        const corner = (sx: number, sy: number, sz: number) => center.clone().addScaledVector(x, sx).addScaledVector(y, sy).addScaledVector(z, sz);
        for (const [a, b, c, d] of BOX_FACES) append(buffers[material], tile, corner(...a), corner(...b), corner(...c), corner(...d));
      };
      const height = top.distanceTo(bottom) / cell;
      // 细立柱 + 地面小底座 + 带体下的横托：DSP 高架带的「T 形支撑」。
      box(bottom.clone().lerp(top, .5), .075, .075, height, 1);
      box(bottom.clone().addScaledVector(mid.up, .015 * cell), .2, .2, .03, 0);
      box(top.clone().addScaledVector(mid.up, -.02 * cell), .1, .5, .04, 0);
    }
    buffers.forEach((buffer, index) => {
      if (!buffer.positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(buffer.tiles, 1));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.materials[index]);
      mesh.castShadow = mesh.receiveShadow = !this.options.ghost;
      if (this.options.ghost) mesh.renderOrder = 20;
      this.group.add(mesh);
    });
    decks.forEach((deck, index) => {
      if (!deck.positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(deck.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(deck.uvs, 2));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(deck.tiles, 1));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.deckMaterials[index]);
      mesh.name = `conveyor-deck-mk${DECK_TIERS[index]}`;
      mesh.receiveShadow = !this.options.ghost;
      mesh.renderOrder = this.options.ghost ? 21 : 6;
      this.group.add(mesh);
    });
    return true;
  }

  resolveHit(hit: THREE.Intersection): TilePoint | null {
    const index = this.hitIndex(hit);
    return index !== null && this.tiles[index] ? { ...this.tiles[index] } : null;
  }

  /** 命中的带子 id（同一格上可能叠着地面带与高架带，选中要精确到那一条）。 */
  resolveBuilding(hit: THREE.Intersection): string | null {
    const index = this.hitIndex(hit);
    return index !== null ? this.ids[index] ?? null : null;
  }

  private hitIndex(hit: THREE.Intersection): number | null {
    if (hit.object.parent !== this.group || !(hit.object instanceof THREE.Mesh) || hit.faceIndex == null) return null;
    return hit.object.geometry.getAttribute('tileIndex').getX(hit.faceIndex * 3);
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
    this.deckMaterials.forEach(material => material.dispose());
    this.group.removeFromParent();
  }
}

function tierOf(building: Pick<Building, 'type'>): 1 | 2 | 3 {
  const tier = logisticsTier(building.type);
  return tier === 'pile' ? 1 : tier;
}

/** 地面被占的格（footprint 展开），高架带下不立柱用。 */
export function groundOccupancy(buildings: readonly Building[], faceSize: number) {
  const tiles = new Set<string>();
  for (const building of buildings) {
    if (!occupiesGround(building)) continue;
    const footprint = getBuildingFootprint(building);
    for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
      const tile = surfaceOffset(building.position, dx, dy, faceSize);
      tiles.add(`${tile.x}:${tile.y}`);
    }
  }
  return tiles;
}
