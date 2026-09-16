import * as THREE from 'three';
import type { ConveyorDirection } from '@shared/types';
import type { PlanetThreeData } from '../planet-three-scene';
import { getFogState, type TilePoint } from '../model';
import { tileNormal, tileFrame, surfaceTileSize } from './projection';
import { conveyorPaths, type ConveyorPath } from './conveyor-geometry';
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
}

/** No synthetic production: these fields come from Building runtime/conveyor and runtime logistics views. */
export function collectActivity(data: PlanetThreeData): ActivitySource[] {
  const sources: ActivitySource[] = [];
  const fog = data.fog ?? ('bounds' in data.planet ? data.planet : undefined);
  const visible = (position: TilePoint) => Boolean(fog && getFogState(fog, Math.round(position.x), Math.round(position.y)).visible);
  const itemColors = new Map(data.catalog?.items?.map(item => [item.id, item.color]));
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
        color: itemColors.get(stack.item_id) ?? '#d8ae67' });
    }
    if (!running) continue;
    const functions = building.runtime.functions;
    if ((functions?.energy?.output_per_tick ?? 0) > 0) sources.push({ ...base, id: `${building.id}:energy`, kind: 'energy', color: '#bfe7ff' });
    const definition = definitions.get(building.type);
    const resource = resources.get(`${building.position.x}:${building.position.y}`);
    // Mirrors rules.go mineResource: finite/renewable require remaining stock;
    // decay resources (oil) depend on current yield, not remaining stock. Running
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
  stackIndex: number;
  stackCount: number;
  prior?: THREE.Vector3;
  path?: ConveyorPath;
}
const LIMIT = 4096;

/** Two draw calls at most: instanced physical cargo plus a single soft particle cloud. */
export class IndustrialActivity {
  private readonly group = new THREE.Group();
  private readonly cargo = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: .64, metalness: .25 }), LIMIT);
  private readonly particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions = new Float32Array(LIMIT * 3);
  private readonly colors = new Float32Array(LIMIT * 3);
  private readonly sizes = new Float32Array(LIMIT);
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private entries: SourcePosition[] = [];
  private observations = new Map<string, THREE.Vector3>();
  private time = 0;
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
    const paths = new Map(conveyorPaths(buildings, faceSize, this.radius).map(path => [path.building.id, path]));
    const counts = new Map<string, number>();
    for (const source of sources) if (source.kind === 'cargo') {
      const key = `${source.position.x}:${source.position.y}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const indices = new Map<string, number>();
    this.entries = sources.map(source => {
      const normal = source.normal ?? tileNormal(source.position, faceSize);
      const { east, south } = tileFrame(source.position, faceSize);
      const tangent = source.direction === 'north' ? south.negate() : source.direction === 'south' ? south
        : source.direction === 'west' ? east.negate() : east;
      const size = surfaceTileSize(this.radius, faceSize);
      const key = `${source.position.x}:${source.position.y}`;
      const stackIndex = indices.get(key) ?? 0;
      if (source.kind === 'cargo') indices.set(key, stackIndex + 1);
      const prior = this.observations.get(source.id);
      if (source.kind === 'flight') nextObservations.set(source.id, normal.clone());
      return { source, color: new THREE.Color(source.color), normal, tangent, size, stackIndex, stackCount: counts.get(key) ?? 1,
        path: source.buildingId ? paths.get(source.buildingId) : undefined,
        prior: source.kind === 'flight' && prior && prior.distanceToSquared(normal) > 1e-12 ? prior : undefined };
    });
    if (newSnapshot) { this.observations = nextObservations; this.snapshotAge = 0; this.lastTick = tick; }
  }

  animate(dt: number, _time: number, options: ActivityOptions = {}) {
    if (!options.paused && !options.reducedMotion) this.time += Math.min(Math.max(dt, 0), .1);
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
      const phase = (this.time * .55 + entry.stackIndex / entry.stackCount) % 1;
      if (source.kind === 'cargo') {
        const moving = source.active && source.direction && !['auto', ''].includes(source.direction);
        const offset = (moving ? phase : (entry.stackIndex + .5) / entry.stackCount) - .5;
        if (entry.path) this.position.copy(entry.path.point(offset + .5)).addScaledVector(normal, size * .1);
        else this.position.copy(normal).multiplyScalar(this.radius + size * .29).addScaledVector(tangent, offset * size * .95);
        this.rotation.setFromUnitVectors(this.up, normal);
        this.scale.setScalar(size * Math.min(.16, .5 / entry.stackCount));
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
