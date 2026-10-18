import * as THREE from 'three';
import { surfaceStep } from '@shared/surface';
import type { ConveyorDirection } from '@shared/types';
import type { PlanetThreeData } from '../planet-three-scene';
import { getFogState, type TilePoint } from '../model';
import { getItemColorValue } from '../item-colors';
import { beltVisualSpeed, logisticsTier } from '../logistics-tier';
import { tileNormal, tileFrame, surfaceTileSize } from './projection';
import { conveyorPaths, BELT_DECK_TOP, type ConveyorPath } from './conveyor-geometry';
import { logisticsFlightNormal } from './logistics-flight';

export interface ActivityOptions {
  paused?: boolean;
  reducedMotion?: boolean;
  buildings?: boolean;
  logistics?: boolean;
  power?: boolean;
}
export interface ActivitySource {
  id: string;
  kind: 'cargo' | 'energy' | 'mining' | 'heat' | 'flight';
  position: TilePoint;
  active: boolean;
  direction?: ConveyorDirection;
  itemId?: string;
  quantity?: number;
  buildingId?: string;
  color: string;
  normal?: THREE.Vector3;
  altitude?: number;
  /** 该建的吞吐（服务端口径，诊断用；带上物品流速按档位走 beltVisualSpeed）。 */
  throughput?: number;
  /**
   * 带上有货但连续多少 tick 没动出去（服务端 conveyor.blocked_ticks 直出）。
   * 3D 物品用它判断「堵在输出端」，比只看 dead-end 拓扑更准：带子正对分拣器时
   * 拓扑上不连任何带体，但分拣器照样从带上取货，不能画成堵死。
   */
  blockedTicks?: number;
}

/**
 * 物品配色 hex → `THREE.Color`（线性工作色）。
 *
 * `new THREE.Color(hex)` 走的是 `setHex(hex, SRGBColorSpace)`（three r152+ 的默认），
 * 写进 `setColorAt` 前必须显式按 sRGB 解释一次；否则同一物品在带上（实例色）
 * 与详情面板色块（CSS）会是两个颜色。这里统一成一个入口，避免两处写法漂移。
 */
export function itemColor(hex: string): THREE.Color {
  if (typeof hex !== 'string') {
    throw new TypeError(`itemColor 只接受 hex 字符串，收到 ${Object.prototype.toString.call(hex)}：` +
      '把已经转换过的 THREE.Color 再传进来会做第二次 sRGB → 线性转换，浅色物品会被压成纯白。');
  }
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

/** No synthetic production: these fields come from Building runtime/conveyor and runtime logistics views. */
export function collectActivity(data: PlanetThreeData): ActivitySource[] {
  const sources: ActivitySource[] = [];
  const fog = data.fog ?? ('bounds' in data.planet ? data.planet : undefined);
  const visible = (position: TilePoint) => Boolean(fog && getFogState(fog, Math.round(position.x), Math.round(position.y)).visible);
  // 物品配色走客户端配色表（item-colors）：服务端目录只按大类给色，矿石/材料各自同色，
  // 细分网格后带上每格都要能分辨物品，不能再用目录色。目录色作为兜底。
  // 这里只产出 hex 字符串；sRGB → 线性的转换在 update() 里由 itemColor() 统一做一次
  // （转换两次会把线性值再当 sRGB 解释一遍，浅色物品直接裁到纯白）。
  const itemColors = new Map(data.catalog?.items?.map(item => [item.id, getItemColorValue(item.id, item.color)]));
  const definitions = new Map(data.catalog?.buildings?.map(building => [building.id, building]));
  const resources = new Map(data.planet.resources?.map(resource => [`${resource.position.x}:${resource.position.y}`, resource]));
  for (const building of Object.values(data.planet.buildings ?? {})) {
    if (!visible(building.position)) continue;
    const running = building.runtime?.state === 'running';
    const base = { position: building.position, active: running };
    // One cube per authoritative nonempty stack (quantity is retained, not multiplied into invented items).
    // Splitter buffers are enclosed; no authoritative per-item route is exposed,
    // so do not show their stock moving along an arbitrary branch.
    for (const [index, stack] of (building.type === 'splitter' ? [] : building.conveyor?.buffer ?? []).entries()) {
      if (stack.quantity > 0) sources.push({ ...base, id: `${building.id}:cargo:${index}`, kind: 'cargo',
        itemId: stack.item_id, quantity: stack.quantity, direction: building.conveyor?.output, buildingId: building.id,
        throughput: building.conveyor?.throughput, blockedTicks: building.conveyor?.blocked_ticks,
        color: itemColors.get(stack.item_id) ?? '#d8ae67' });
    }    if (!running) continue;
    const functions = building.runtime.functions;
    if ((functions?.energy?.output_per_tick ?? 0) > 0) sources.push({ ...base, id: `${building.id}:energy`, kind: 'energy', color: '#bfe7ff' });
    const definition = definitions.get(building.type);
    const resource = resources.get(`${building.position.x}:${building.position.y}`);
    // Mirrors rules.go mineResource: finite/renewable require remaining stock;
    // decay resources (oil) depend on current yield, not remaining. Running
    // only means powered: the server leaves an exhausted miner in that state.
    const resourceProducing = resource && (resource.current_yield ?? 0) > 0
      && (resource.behavior === 'decay' || (['finite', 'renewable'].includes(resource.behavior) && (resource.remaining ?? 0) > 0));
    const collecting = definition && (!definition.requires_resource_node || resourceProducing);
    if ((functions?.collect?.yield_per_tick ?? 0) > 0 && collecting) sources.push({ ...base, id: `${building.id}:mining`, kind: 'mining', color: '#e3bc7f' });
    // Recipe in progress, not merely an installed production module or cached input inventory.
    if (functions?.production && (building.production?.remaining_ticks ?? 0) > 0 && /smelt|furnace/.test(building.type)) {
      sources.push({ ...base, id: `${building.id}:heat`, kind: 'heat', color: '#ff9856' });
    }
  }
  for (const drone of [...(data.runtime?.logistics_drones ?? []), ...(data.runtime?.logistics_ships ?? [])]) {
    if ('current_planet_id' in drone && drone.current_planet_id && drone.current_planet_id !== data.planet.planet_id) continue;
    if ('target_planet_id' in drone && drone.target_planet_id && drone.target_planet_id !== data.planet.planet_id && drone.status === 'in_flight') continue;
    if (['takeoff', 'in_flight', 'landing'].includes(drone.status) && visible(drone.position)) sources.push({ id: `flight:${drone.id}`, kind: 'flight',
      position: drone.position, normal: logisticsFlightNormal(drone, data.planet.surface.face_size), active: true, color: '#9dcfff' });
  }
  for (const bot of data.runtime?.logistics_bots ?? []) {
    if (!['takeoff', 'in_flight', 'landing'].includes(bot.status) || !visible(bot.position)) continue;
    sources.push({ id: `bot-flight:${bot.id}`, kind: 'flight', position: bot.position,
      normal: tileNormal(bot.position, data.planet.surface.face_size), active: true, color: '#73f0d1',
      altitude: bot.status === 'in_flight' ? 1.05 : .66 });
  }
  return sources;
}

interface SourcePosition {
  source: ActivitySource;
  color: THREE.Color;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  size: number;
  /** 该方块在这一格带子上的序号（0 = 队首，离输出端最近）与这格画出的方块总数。 */
  cargoOrdinal: number;
  beltCargoCount: number;
  /** 带上货物堵住了：不前进，向输出端排队堆叠。 */
  blocked: boolean;
  prior?: THREE.Vector3;
  path?: ConveyorPath;
}
const LIMIT = 4096;
/**
 * 单格物料方块的目标边长（cell）：DSP 式「带上的小物件」——0.24 cell，远小于带面宽（0.47 cell），
 * 一格内密排 4 个、朝流动方向、坐在带面上。
 */
export const BELT_CARGO_CELL = .24;

function beltTier(type: string): 1 | 2 | 3 {
  const tier = logisticsTier(type);
  return tier === 'pile' ? 1 : tier;
}
/** 单堆最多画几个方块：一格 1 cell 的行程里 0.24 cell 的方块按 .25 间距密排，正好 4 个。 */
export const BELT_CARGO_MAX_PER_STACK = 4;
/** 物品中心离带体中心线的高度 = 带面顶 + 半边长（坐在带面上，不能陷进带面）。 */
const BELT_CARGO_LIFT = BELT_DECK_TOP + BELT_CARGO_CELL / 2;

/** Two draw calls at most: instanced physical cargo plus a single soft particle cloud. */
export class IndustrialActivity {
  private readonly group = new THREE.Group();
  // 带上方块用**非金属**材质：metalness .25 会让实例色几乎全部来自环境反射（env 强度 .32），
  // 铁块/石材这类浅色物品会被压成同一种白；固有色才是「一眼看出物品」的依据。
  private readonly cargo = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: .72, metalness: .05 }), LIMIT);
  private readonly particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions = new Float32Array(LIMIT * 3);
  private readonly colors = new Float32Array(LIMIT * 3);
  private readonly sizes = new Float32Array(LIMIT);
  private readonly matrix = new THREE.Matrix4();
  private readonly frame = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly flowTangent = new THREE.Vector3();
  private readonly flowSide = new THREE.Vector3();
  private entries: SourcePosition[] = [];
  private observations = new Map<string, THREE.Vector3>();
  private time = 0;
  /**
   * 每档一条共享的带面行程（格）：同档带子同一相位，直段上物品才连成一条密排的流；
   * 速度与带面箭头滚速同源（`beltVisualSpeed`，1 : 2 : 5），物品看起来是「贴在带面上走」。
   */
  private readonly beltTravel: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  private readonly slopeUp = new THREE.Vector3();
  private snapshotAge = 0;
  private lastTick: number | undefined;

  constructor(world: THREE.Group, private readonly radius = 100) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float particleSize; varying vec3 tint; void main(){ tint=color; vec4 view=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*view; gl_PointSize=clamp(particleSize*650./max(.01,-view.z),1.,24.); }`,
      fragmentShader: `varying vec3 tint; void main(){ float r=length(gl_PointCoord-.5)*2.; if(r>1.) discard; gl_FragColor=vec4(tint,pow(1.-r,2.)*.7); }`,
    });
    this.particles = new THREE.Points(geometry, material);
    this.particles.frustumCulled = false;
    this.cargo.frustumCulled = false;
    this.cargo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cargo.count = 0;
    geometry.setDrawRange(0, 0);
    this.group.name = 'authoritative-industrial-activity';
    this.group.add(this.cargo, this.particles);
    world.add(this.group);
  }

  update(data: PlanetThreeData) {
    const faceSize = data.planet.surface.face_size;
    const tick = data.runtime?.tick ?? ('tick' in data.planet ? data.planet.tick as number : undefined);
    const newSnapshot = tick !== this.lastTick;
    const nextObservations = new Map<string, THREE.Vector3>();
    const sources = collectActivity(data).slice(0, LIMIT);
    const fog = data.fog ?? ('bounds' in data.planet ? data.planet : undefined);
    const buildings = Object.values(data.planet.buildings ?? {}).filter(building =>
      building.owner_id === data.playerId || Boolean(fog && getFogState(fog, building.position.x, building.position.y).visible));
    const buildingTiles = new Set(Object.values(data.planet.buildings ?? {}).map(building => `${building.position.x}:${building.position.y}`));
    // 一条带子可能有多条路线（侧汇入/分拣器分支）；带上物品跟「主路线」走（第一条），
    // 否则同一格上的货物会在两条路线之间来回跳。
    const paths = new Map<string, ConveyorPath>();
    for (const path of conveyorPaths(buildings, faceSize, this.radius)) if (!paths.has(path.building.id)) paths.set(path.building.id, path);
    // 每格带子上画出的方块总数（堵住时按这个总数排队，队首贴输出端）。
    const cubeTotals = new Map<string, number>();
    for (const source of sources) if (source.kind === 'cargo') {
      // 同一格可能叠着地面带与高架带：按建筑 id 分开计数。
      const key = source.buildingId ?? `${source.position.x}:${source.position.y}`;
      cubeTotals.set(key, (cubeTotals.get(key) ?? 0) + Math.max(1, Math.min(source.quantity ?? 1, BELT_CARGO_MAX_PER_STACK)));
    }
    const ordinals = new Map<string, number>();
    const entries: SourcePosition[] = [];
    for (const source of sources) {
      const normal = source.normal ?? tileNormal(source.position, faceSize);
      const { east, south } = tileFrame(source.position, faceSize);
      const tangent = source.direction === 'north' ? south.negate() : source.direction === 'south' ? south
        : source.direction === 'west' ? east.negate() : east;
      const size = surfaceTileSize(this.radius, faceSize);
      // 同一格可能叠着地面带与高架带：按建筑 id 分开计数。
      const key = source.buildingId ?? `${source.position.x}:${source.position.y}`;
      const prior = this.observations.get(source.id);
      if (source.kind === 'flight') nextObservations.set(source.id, normal.clone());
      const path = source.buildingId ? paths.get(source.buildingId) : undefined;
      const base = { source, color: itemColor(source.color), normal, tangent, size, path,
        prior: source.kind === 'flight' && prior && prior.distanceToSquared(normal) > 1e-12 ? prior : undefined };
      if (source.kind !== 'cargo') { entries.push({ ...base, cargoOrdinal: 0, beltCargoCount: 1, blocked: false }); continue; }
      // 堵塞判定：停机、服务端 blocked_ticks（带上有货却一直没动出去）、或输出方向是
      // 死头（既没有连接的带体，也没有建筑能接货）。正对分拣器的带子拓扑上不连带体，
      // 但分拣器会从带上取货，不能画成堵死。
      const deadEnd = path !== undefined && !path.connected.has(path.output)
        && !buildingTiles.has(neighborTile(path, faceSize));
      const blocked = !source.active || (source.blockedTicks ?? 0) > 0 || deadEnd;
      const ordinal = ordinals.get(key) ?? 0;
      const quantity = Math.max(1, Math.min(source.quantity ?? 1, BELT_CARGO_MAX_PER_STACK));
      for (let cargoIndex = 0; cargoIndex < quantity; cargoIndex++) {
        entries.push({ ...base, cargoOrdinal: ordinal + cargoIndex, beltCargoCount: cubeTotals.get(key) ?? 1, blocked });
      }
      ordinals.set(key, ordinal + quantity);
    }
    this.entries = entries;
    if (newSnapshot) { this.observations = nextObservations; this.snapshotAge = 0; this.lastTick = tick; }
  }

  animate(dt: number, _time: number, options: ActivityOptions = {}) {
    const step = Math.min(Math.max(dt, 0), .1);
    if (!options.paused && !options.reducedMotion) {
      this.time += step;
      for (const tier of [1, 2, 3] as const) this.beltTravel[tier] = (this.beltTravel[tier] + step * beltVisualSpeed(`conveyor_belt_mk${tier}`)) % 1;
    }
    if (!options.paused) this.snapshotAge += Math.max(0, dt);
    let cargoCount = 0, particleCount = 0;
    const point = (position: THREE.Vector3, color: THREE.Color, size: number) => {
      if (particleCount >= LIMIT) return;
      position.toArray(this.positions, particleCount * 3);
      color.toArray(this.colors, particleCount * 3);
      this.sizes[particleCount++] = size;
    };
    for (const entry of this.entries) {
      const { source, color, normal, tangent, size } = entry;
      if (source.kind === 'flight' ? options.logistics === false : options.buildings === false) continue;
      if (source.kind === 'energy' && options.power === false) continue;
      if (source.kind === 'cargo') {
        const total = Math.max(1, entry.beltCargoCount);
        // 堵塞：不前进，向后堆到输出端：队首（ordinal 0）离输出端口最近。
        const phase = entry.blocked ? 1 - (entry.cargoOrdinal + .5) / total
          : (this.beltTravel[beltTier(entry.path?.building.type ?? '')] + entry.cargoOrdinal / total) % 1;
        if (entry.path) {
          const u = phase, p = entry.path.point(u);
          const up = p.clone().normalize();
          // 朝向随流向：弯道上用 u±ε 的切向，物品不能还是正南正北的方盒。
          const before = entry.path.point(Math.max(0, u - .002));
          const after = entry.path.point(Math.min(1, u + .002));
          this.flowTangent.copy(after).sub(before);
          if (this.flowTangent.lengthSq() < 1e-12) this.flowTangent.copy(entry.path.point(1)).sub(entry.path.point(0));
          this.flowTangent.normalize();
          // 坡道上切向带径向分量：物品跟着带面倾斜（局部 +X 沿流向、+Y 垂直带面），平段上退化成水平。
          this.flowSide.crossVectors(this.flowTangent, up).normalize();
          this.slopeUp.crossVectors(this.flowSide, this.flowTangent).normalize();
          this.position.copy(p).addScaledVector(this.slopeUp, size * BELT_CARGO_LIFT);
          this.frame.makeBasis(this.flowTangent, this.slopeUp, this.flowSide);
          this.rotation.setFromRotationMatrix(this.frame);
        } else {
          // 非带体建筑（conveyor buffer）：沿输出方向在地面上排开，堵住时同样堆到放货端。
          const moving = !entry.blocked && Boolean(source.direction) && !['auto', ''].includes(source.direction!);
          const offset = moving ? phase - .5 : .5 - (entry.cargoOrdinal + .5) / total;
          this.position.copy(normal).multiplyScalar(this.radius + size * .29).addScaledVector(tangent, offset * size * .95);
          this.rotation.setFromUnitVectors(this.up, normal);
        }
        this.scale.setScalar(size * BELT_CARGO_CELL);
        this.matrix.compose(this.position, this.rotation, this.scale);
        this.cargo.setMatrixAt(cargoCount, this.matrix);
        this.cargo.setColorAt(cargoCount++, color);
      } else if (source.kind === 'flight') {
        // Exhaust follows the authoritative flight phase. A short trail uses only observed displacement,
        // expires after one second without new state, and never predicts a target or creates cargo.
        point(this.position.copy(normal).multiplyScalar(this.radius + size * (source.altitude ?? .5)), color, size * .14);
        if (entry.prior && this.snapshotAge < 1 && !options.reducedMotion) for (let i = 1; i <= 4; i++) {
          point(this.position.copy(normal).lerp(entry.prior, i / 8).normalize().multiplyScalar(this.radius + size * (source.altitude ?? .5)), color, size * .12 * (1 - i / 5));
        }
      } else {
        const pulse = .7 + Math.sin(this.time * 2.8) * .3;
        const count = options.reducedMotion ? 1 : source.kind === 'energy' ? 2 : 3;
        for (let i = 0; i < count; i++) {
          const drift = (this.time * .35 + i / count) % 1;
          const height = source.kind === 'heat' ? .8 + drift * .65 : source.kind === 'mining' ? .2 + drift * .25 : .65 + i * .14;
          this.position.copy(normal).multiplyScalar(this.radius + size * height);
          if (source.kind !== 'energy') this.position.addScaledVector(tangent, Math.sin(i * 3 + this.time) * size * .1);
          point(this.position, color, size * (source.kind === 'heat' ? .3 : .14) * pulse);
        }
      }
    }
    this.cargo.count = cargoCount;
    this.cargo.instanceMatrix.needsUpdate = true;
    if (this.cargo.instanceColor) this.cargo.instanceColor.needsUpdate = true;
    for (const attribute of ['position', 'color', 'particleSize']) this.particles.geometry.getAttribute(attribute).needsUpdate = true;
    this.particles.geometry.setDrawRange(0, particleCount);
  }

  destroy() {
    this.group.removeFromParent();
    this.cargo.geometry.dispose();
    (this.cargo.material as THREE.Material).dispose();
    this.cargo.dispose();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
    this.entries = [];
    this.observations.clear();
  }
}

/** 带子在输出方向上的邻居格（处理旋转立方体接缝）。 */
function neighborTile(path: ConveyorPath, faceSize: number): string {
  const step = surfaceStep(path.building.position, path.output, faceSize);
  return `${step.tile.x}:${step.tile.y}`;
}
