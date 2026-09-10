import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPlanetSurface, updatePlanetSurface, updatePlanetSurfaceTime, disposePlanetSurface } from './three/terrain';
import { IndustrialModels } from './three/industrial-models';
import { createSpace } from './three/space';
import { tileNormal, normalTile } from './three/projection';
import { createSurfaceDressing } from './three/surface-dressing';
import { createLocalSurface } from './three/local-surface';
import { IndustrialActivity } from './three/industrial-activity';
import { StaticBatches } from './three/static-batches';
import { DynamicBatches } from './three/dynamic-batches';
import { assessBuildTiles } from './build-workflow';
import type { CatalogView, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView, Position } from '@shared/types';
import { getBuildingFootprint, getFogState, getTerrainTile, type PlanetLayerVisibility, type PlanetRenderView, type SelectedEntity, type TilePoint } from './model';
import type { PlanetInteractionMode } from './store';

export interface PlanetThreeData {
  planet: PlanetRenderView;
  fog?: FogMapView | PlanetSceneView;
  overview?: PlanetOverviewView;
  runtime?: PlanetRuntimeView;
  networks?: PlanetNetworksView;
  catalog?: CatalogView;
  playerId?: string;
}
export interface PlanetThreeInteraction {
  selected: SelectedEntity | null;
  hoveredTile: TilePoint | null;
  interactionMode: PlanetInteractionMode;
  layers: PlanetLayerVisibility;
}
const RADIUS = 100;
const FRONT = new THREE.Vector3(0, 0, 1);
/** Presentation only: all entities and terrain are sourced from player-visible server views. */
export class PlanetThreeScene {
  private readonly scene = new THREE.Scene();
  private readonly world = new THREE.Group();
  private readonly content = new THREE.Group();
  private readonly marks = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 1, 3000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly surface: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly observer: ResizeObserver;
  private data?: PlanetThreeData;
  private interaction?: PlanetThreeInteraction;
  private frame = 0;
  private destroyed = false;
  private altitude = 300;
  private down: { x: number; y: number; moved: boolean } | null = null;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly industrial = new IndustrialModels();
  private readonly staticBatches = new StaticBatches();
  private readonly dynamicBatches = new DynamicBatches();
  private readonly activity = new IndustrialActivity(this.world, RADIUS);
  private readonly sunlight = new THREE.DirectionalLight(0xffe5c1, 3.5);
  private dressing?: THREE.Group;
  private dressingSignature = '';
  private localSurface: ReturnType<typeof createLocalSurface> = null;
  private localSurfaceKey = '';
  private groundView = false;
  private tilt = .65;
  private readonly moving = new Map<string, { group: THREE.Group; target: THREE.Vector3; signature: string; baseScale: THREE.Vector3 }>();
  private readonly staticEntities = new Map<string, { group: THREE.Group; signature: string }>();
  private readonly linkSignatures = new Map<string, string>();
  private frozen = new URLSearchParams(window.location.search).has('freeze');
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly groupByLayer = new Map<string, THREE.Group>();
  private lastTime = 0;


  constructor(private readonly host: HTMLElement, private readonly onPick: (tile: TilePoint) => void, private readonly onHover: (tile: TilePoint | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor('#030912');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .32;
    room.dispose(); pmrem.dispose();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .32, .45, 2.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.renderer.domElement.setAttribute('aria-label', '3D 行星地图：拖动旋转，滚轮缩放，点击地块操作');
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.scene.add(this.world);
    this.world.add(this.content, this.marks);
    this.surface = createPlanetSurface(RADIUS);
    this.surface.receiveShadow = true;
    this.world.add(this.surface);
    this.scene.add(new THREE.HemisphereLight(0xb6dafa, 0x384044, .75));
    this.sunlight.position.set(-100, 140, 230);
    this.sunlight.target.position.set(0, 0, RADIUS);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(2048, 2048);
    this.sunlight.shadow.bias = -.00015;
    this.sunlight.shadow.normalBias = .035;
    this.sunlight.shadow.camera.near = 1;
    this.sunlight.shadow.camera.far = 500;
    this.scene.add(this.sunlight, this.sunlight.target);
    const rim = new THREE.DirectionalLight(0x719dc7, .75);
    rim.position.set(100, -60, -70);
    this.scene.add(rim);
    const { sky, atmosphere } = createSpace(RADIUS);
    this.scene.add(sky); this.world.add(atmosphere);
    this.updateCamera();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    canvas.addEventListener('pointerleave', this.pointerLeave);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    this.animate(0);
  }

  setData(data: PlanetThreeData) {
    this.data = data;
    updatePlanetSurface(this.surface, data);
    const localKey = JSON.stringify([data.planet.map_width, data.planet.map_height, 'bounds' in data.planet ? data.planet.bounds : null]);
    if (localKey !== this.localSurfaceKey) {
      if (this.localSurface) { this.world.remove(this.localSurface); this.localSurface.geometry.dispose(); }
      this.localSurface = createLocalSurface(data.planet, RADIUS, this.surface.material);
      if (this.localSurface) this.world.add(this.localSurface);
      this.localSurfaceKey = localKey;
    }
    const dressingSignature = JSON.stringify([data.planet.terrain, 'bounds' in data.planet ? data.planet.bounds : null,
      Object.values(data.planet.buildings ?? {}).map(b => [b.position, getBuildingFootprint(b)]), data.fog?.visible]);
    if (dressingSignature !== this.dressingSignature) {
      this.dressing?.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
      if (this.dressing) this.world.remove(this.dressing);
      this.dressing = createSurfaceDressing(data, RADIUS);
      this.dressing.visible = this.groundView;
      this.world.add(this.dressing);
      this.dressingSignature = dressingSignature;
    }
    this.buildEntities();
    this.activity.update(data);
    this.updateMarks();
  }

  setInteraction(interaction: PlanetThreeInteraction) {
    this.interaction = interaction;
    for (const [layer, group] of this.groupByLayer) group.visible = interaction.layers[layer as keyof PlanetLayerVisibility] ?? true;
    this.updateMarks();
    this.renderer.domElement.style.cursor = interaction.interactionMode.kind === 'inspect' ? 'grab' : 'crosshair';
  }

  private normal(x: number, y: number) {
    const p = this.data!.planet;
    return tileNormal({ x, y }, p.map_width, p.map_height);
  }

  private tileFromNormal(n: THREE.Vector3): TilePoint | null {
    return this.data ? normalTile(n, this.data.planet.map_width, this.data.planet.map_height) : null;
  }

  private tileScale() {
    const p = this.data?.planet;
    return p ? Math.min(2 * Math.PI * RADIUS / p.map_width, Math.PI * RADIUS / p.map_height) : 1;
  }

  private known(position: TilePoint) {
    if (!this.data) return false;
    const fog = this.data.fog ?? ('bounds' in this.data.planet ? this.data.planet : undefined);
    return fog ? getFogState(fog, Math.round(position.x), Math.round(position.y)).explored : getTerrainTile(this.data.planet, Math.round(position.x), Math.round(position.y)) !== 'unknown';
  }

  private visible(position: TilePoint) {
    if (!this.data) return false;
    const fog = this.data.fog ?? ('bounds' in this.data.planet ? this.data.planet : undefined);
    return fog ? getFogState(fog, Math.round(position.x), Math.round(position.y)).visible : this.known(position);
  }

  private geometry(kind: string) {
    if (!this.geometries.has(kind)) {
      const geometry = kind === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 12) : kind === 'cone' ? new THREE.ConeGeometry(0.5, 1, 6) : kind === 'orb' ? new THREE.IcosahedronGeometry(0.5, 1) : new THREE.BoxGeometry(1, 1, 1);
      this.geometries.set(kind, geometry);
    }
    return this.geometries.get(kind)!;
  }

  private material(color: string, emissive = false) {
    const key = color + emissive;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: emissive ? 0.35 : 0.58, metalness: 0.45, emissive: emissive ? color : '#000000', emissiveIntensity: emissive ? 1.3 : 0 }));
    return this.materials.get(key)!;
  }

  private part(parent: THREE.Group, kind: string, color: string, size: [number, number, number], position: [number, number, number], glow = false) {
    const mesh = new THREE.Mesh(this.geometry(kind), this.material(color, glow));
    mesh.scale.set(...size);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }

  private layer(name: string) {
    let group = this.groupByLayer.get(name);
    if (!group) {
      group = new THREE.Group();
      group.visible = this.interaction?.layers[name as keyof PlanetLayerVisibility] ?? true;
      this.content.add(group);
      this.groupByLayer.set(name, group);
    }
    return group;
  }

  private place(group: THREE.Group, position: Position | TilePoint, layer: string, scale = 1) {
    const n = this.normal(position.x, position.y);
    group.position.copy(n).multiplyScalar(RADIUS + this.tileScale() * 0.025);
    const east = this.normal(position.x + .001, position.y).sub(n).normalize();
    const south = new THREE.Vector3().crossVectors(east, n).normalize();
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, n, south));
    // Longitude cells shrink near the poles. Fit models within their authoritative tile.
    const p = this.data!.planet;
    const eastSpan = 2 * Math.PI * RADIUS / p.map_width * Math.max(.025, Math.sqrt(Math.max(0, 1 - Math.pow(1 - 2 * (position.y + .5) / p.map_height, 2))));
    const latitudeRadius = Math.sqrt(Math.max(.0001, 1 - Math.pow(1 - 2 * (position.y + .5) / p.map_height, 2)));
    const northSpan = 2 * RADIUS / (p.map_height * latitudeRadius);
    const size = Math.min(eastSpan, northSpan);
    group.scale.multiplyScalar(size * scale);
    group.userData.tile = { x: Math.round(position.x), y: Math.round(position.y) };
    this.layer(layer).add(group);
  }

  private buildEntities() {
    if (!this.data) return;
    const { planet, playerId, runtime, networks } = this.data;
    const dimensions = [planet.map_width, planet.map_height];
    const staticKeys = new Set<string>();
    // Only rendering inputs enter the signature. Production inventories, health,
    // research progress and network allocation do not change a model's structure.
    const retain = (key: string, appearance: unknown[], create: () => THREE.Group) => {
      staticKeys.add(key);
      const signature = JSON.stringify([dimensions, ...appearance]);
      const previous = this.staticEntities.get(key);
      if (previous?.signature === signature) return;
      if (previous) this.removeModel(previous.group);
      this.staticEntities.set(key, { signature, group: create() });
    };
    for (const building of Object.values(planet.buildings ?? {})) {
      if (!(building.owner_id === playerId || this.visible(building.position))) continue;
      const footprint = getBuildingFootprint(building);
      retain(`building:${building.id}`, [building.type, building.owner_id === playerId, building.position.x, building.position.y, footprint], () => {
        const group = this.industrial.building(building.type, footprint.width * .86, footprint.height * .86, building.owner_id === playerId);
        this.place(group, { x: building.position.x + (footprint.width - 1) / 2, y: building.position.y + (footprint.height - 1) / 2 }, 'buildings');
        group.userData.tile = { x: Math.round(building.position.x), y: Math.round(building.position.y) };
        return group;
      });
    }
    for (const building of Object.values(planet.buildings ?? {})) {
      const model = this.staticEntities.get(`building:${building.id}`)?.group;
      if (model) model.userData.industryActive = building.runtime?.state === 'running';
    }
    for (const resource of planet.resources ?? []) {
      if (!this.known(resource.position)) continue;
      retain(`resource:${resource.kind}:${resource.position.x}:${resource.position.y}`, [resource.kind, resource.position.x, resource.position.y], () => {
        const group = this.industrial.resource(resource.kind);
        this.place(group, resource.position, 'resources');
        return group;
      });
    }
    for (const task of runtime?.construction_tasks ?? []) {
      if (!this.known(task.position)) continue;
      retain(`construction:${task.id}`, [task.position.x, task.position.y, task.building_type], () => {
        const group = new THREE.Group();
        for (let x = -1; x <= 1; x += 2) for (let z = -1; z <= 1; z += 2) this.part(group, 'box', '#ffc46b', [0.035, 0.65, 0.035], [x * 0.35, 0.35, z * 0.35], true);
        this.place(group, task.position, 'construction');
        return group;
      });
    }
    for (const [key, entry] of this.staticEntities) {
      if (!staticKeys.has(key)) { this.removeModel(entry.group); this.staticEntities.delete(key); }
    }
    const batchEntries = [...this.staticEntities.values()].map(({ group }) => ({
      root: group, layer: group.parent!, tile: group.userData.tile as TilePoint,
    }));
    this.staticBatches.refresh(batchEntries);
    this.dynamicBatches.refresh(batchEntries);

    const movingKeys = new Set<string>();
    const move = (id: string, type: string, own: boolean, position: Position, layer: string, scale: number, airborne = false) => {
      movingKeys.add(id);
      this.trackMotion(id, type, own, position, layer, scale, airborne);
    };
    for (const unit of Object.values(planet.units ?? {})) {
      if (unit.owner_id === playerId || this.visible(unit.position)) move(`unit:${unit.id}`, unit.type, unit.owner_id === playerId, unit.position, 'units', .72);
    }
    const logisticsLinks: { from: Position; to: Position }[] = [];
    for (const drone of [...(runtime?.logistics_drones ?? []), ...(runtime?.logistics_ships ?? [])]) {
      if (!this.visible(drone.position)) continue;
      move(`logistics:${drone.id}`, 'ship', true, drone.position, 'logistics', .45, drone.status !== 'idle');
      if (drone.status !== 'idle' && drone.target_pos) logisticsLinks.push({ from: drone.position, to: drone.target_pos });
    }
    for (const enemy of runtime?.enemy_forces ?? []) {
      if (this.visible(enemy.position)) move(`enemy:${enemy.id}`, enemy.type, false, enemy.position, 'threat', 1);
    }
    for (const [id, entry] of this.moving) {
      if (!movingKeys.has(id)) { this.removeModel(entry.group); this.moving.delete(id); }
    }
    this.syncLinks('logistics', '#7dc5d2', logisticsLinks);
    this.syncLinks('power', '#ffd37c', (networks?.power_links ?? []).map(link => ({ from: link.from_position, to: link.to_position })));
    this.syncLinks('pipelines', '#76baef', (networks?.pipeline_segments ?? []).map(link => ({ from: link.from_position, to: link.to_position })));
  }

  private removeModel(group: THREE.Group) {
    this.industrial.releaseAnimations(group);
    group.removeFromParent();
    // Model geometry/material are cached and shared by the asset library.
  }

  private trackMotion(id: string, type: string, own: boolean, position: Position, layer: string, scale: number, airborne: boolean) {
    const signature = JSON.stringify([type, own, layer]);
    let entry = this.moving.get(id);
    if (entry && entry.signature !== signature) { this.removeModel(entry.group); this.moving.delete(id); entry = undefined; }
    const previousPosition = entry?.group.position.clone();
    if (!entry) {
      const group = this.industrial.unit(type, own);
      entry = { group, target: new THREE.Vector3(), signature, baseScale: group.scale.clone() };
      this.moving.set(id, entry);
    }
    const group = entry.group;
    group.scale.copy(entry.baseScale);
    this.place(group, position, layer, scale);
    if (airborne) group.position.normalize().multiplyScalar(RADIUS + this.tileScale() * .4);
    entry.target.copy(group.position);
    if (previousPosition && !this.frozen && previousPosition.distanceTo(entry.target) < RADIUS) group.position.copy(previousPosition);
  }

  private syncLinks(layer: string, color: string, links: { from: Position; to: Position }[]) {
    const visible = links.filter(link => this.known(link.from) && this.known(link.to));
    const signature = JSON.stringify([this.data!.planet.map_width, this.data!.planet.map_height,
      visible.map(link => [link.from.x, link.from.y, link.to.x, link.to.y])]);
    if (this.linkSignatures.get(layer) === signature) return;
    this.linkSignatures.set(layer, signature);
    const group = this.layer(layer);
    for (const child of [...group.children]) {
      if (!(child instanceof THREE.Line)) continue;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => material.dispose());
      child.removeFromParent();
    }
    for (const link of visible) this.link(link.from, link.to, color, layer);
  }

  private link(from: Position, to: Position, color: string, layer: string) {
    if (!this.known(from) || !this.known(to)) return;
    const a = this.normal(from.x, from.y), b = this.normal(to.x, to.y);
    const points = Array.from({ length: 17 }, (_, i) => a.clone().lerp(b, i / 16).normalize().multiplyScalar(RADIUS + this.tileScale() * 0.18));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    this.layer(layer).add(line);
  }

  private updateMarks() {
    this.marks.traverse((o) => { if (o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.marks.clear();
    if (!this.data || !this.interaction) return;
    const add = (tile: TilePoint, color: string) => {
      const points: THREE.Vector3[] = [];
      const offsets = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]];
      offsets.forEach(([x, y]) => points.push(this.normal(tile.x + x, tile.y + y).multiplyScalar(RADIUS + this.tileScale() * 0.06)));
      this.marks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: true })));
    };
    if (this.interaction.layers.selection && this.interaction.selected) add(this.interaction.selected.position, '#fff1a8');
    if (this.interaction.hoveredTile) {
      const tile = this.interaction.hoveredTile;
      if (this.interaction.interactionMode.kind === 'build') {
        const assessment = assessBuildTiles(this.data.catalog, this.interaction.interactionMode.buildingType, this.data.planet, { ...tile, z: 0 });
        const footprint = assessment?.footprint ?? { width: 1, height: 1 };
        for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
          const p = { x: tile.x + dx, y: tile.y + dy };
          add(p, assessment?.buildable && this.visible(p) ? '#5ef7a1' : '#ff6666');
        }
      } else add(tile, this.interaction.interactionMode.kind === 'attack' ? '#ff6666' : '#5ef7dc');
    }
    if (this.interaction.layers.grid && 'bounds' in this.data.planet) {
      const b = this.data.planet.bounds;
      const stride = Math.max(1, Math.ceil(Math.max(b.width, b.height) / 64));
      const points: THREE.Vector3[] = [];
      for (let y = b.y; y <= b.y + b.height; y += stride) for (let x = b.x; x < b.x + b.width; x += stride) points.push(this.normal(x - 0.5, y - 0.5).multiplyScalar(RADIUS + 0.001), this.normal(Math.min(x + stride, b.x + b.width) - 0.5, y - 0.5).multiplyScalar(RADIUS + 0.001));
      for (let x = b.x; x <= b.x + b.width; x += stride) for (let y = b.y; y < b.y + b.height; y += stride) points.push(this.normal(x - 0.5, y - 0.5).multiplyScalar(RADIUS + 0.001), this.normal(x - 0.5, Math.min(y + stride, b.y + b.height) - 0.5).multiplyScalar(RADIUS + 0.001));
      this.marks.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#85bec6', transparent: true, opacity: 0.16 })));
    }
  }

  focus(tile: TilePoint, close = true) {
    if (!this.data) return;
    this.world.quaternion.setFromUnitVectors(this.normal(tile.x, tile.y), FRONT);
    this.groundView = true;
    this.altitude = close ? Math.min(75, Math.max(this.tileScale() * 9, .08)) : Math.min(75, Math.max(this.tileScale() * 10, .1));
    this.updateCamera();
  }
  orbit() { this.groundView = false; this.altitude = 300; this.updateCamera(); }
  setTilt(value: number) { this.tilt = THREE.MathUtils.clamp(value, 0, 1.1); this.groundView = true; this.updateCamera(); }
  project(tile: TilePoint) {
    if (!this.data) return null;
    this.world.updateMatrixWorld(true);
    const normal = this.normal(tile.x, tile.y).applyQuaternion(this.world.quaternion);
    const point = normal.clone().multiplyScalar(RADIUS);
    const facing = normal.dot(this.camera.position.clone().sub(point)) > 0;
    point.project(this.camera);
    return { x: (point.x + 1) / 2 * this.host.clientWidth, y: (1 - point.y) / 2 * this.host.clientHeight, visible: facing && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 };
  }
  zoom(factor: number) {
    if (!(factor > 0)) return;
    this.altitude = THREE.MathUtils.clamp(this.altitude / factor, Math.max(this.tileScale() * 2.5, 0.03), 430);
    if (this.altitude > 190) this.groundView = false;
    else if (this.altitude < 130) this.groundView = true;
    this.updateCamera();
  }
  private updateCamera() {
    this.camera.near = Math.max(0.0001, this.altitude * 0.05);
    this.camera.updateProjectionMatrix();
    if (this.dressing) this.dressing.visible = this.groundView;
    const tilt = this.groundView ? this.tilt : 0;
    this.camera.position.set(0, -Math.sin(tilt) * this.altitude, RADIUS + Math.cos(tilt) * this.altitude);
    this.camera.lookAt(0, 0, this.groundView ? RADIUS : 0);
    const range = Math.min(150, Math.max(2, this.altitude * .75));
    this.sunlight.shadow.normalBias = Math.min(.035, this.tileScale() * .015);
    const shadowCamera = this.sunlight.shadow.camera;
    shadowCamera.left = -range; shadowCamera.right = range;
    shadowCamera.top = range; shadowCamera.bottom = -range;
    shadowCamera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
  getCenterTile() {
    return this.data ? this.tileFromNormal(FRONT.clone().applyQuaternion(this.world.quaternion.clone().invert())) : null;
  }
  capture() {
    this.composer.render();
    return this.renderer.domElement;
  }
  private resize = () => {
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
  private pick(event: PointerEvent) {
    if (!this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    this.world.updateMatrixWorld(true);
    if (this.interaction?.interactionMode.kind === 'build' || this.interaction?.interactionMode.kind === 'move') {
      const point = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), RADIUS), new THREE.Vector3());
      return point ? this.tileFromNormal(this.world.worldToLocal(point).normalize()) : null;
    }
    const hits = this.raycaster.intersectObjects([this.surface, this.content], true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      let object: THREE.Object3D | null = hit.object;
      let hidden = false;
      while (object && object !== this.world) { if (!object.visible) hidden = true; object = object.parent; }
      if (hidden) continue;
      const batchTile = this.staticBatches.resolveHit(hit) ?? this.dynamicBatches.resolveHit(hit);
      if (batchTile) return batchTile;
      object = hit.object;
      while (object && object !== this.world) { if (object.userData.tile) return object.userData.tile as TilePoint; object = object.parent; }
      if (hit.object === this.surface || hit.object.userData.terrain) {
        const exact = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), RADIUS), new THREE.Vector3());
        return this.tileFromNormal(this.world.worldToLocal(exact ?? hit.point.clone()).normalize());
      }
    }
    return null;
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.down = { x: event.clientX, y: event.clientY, moved: false };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.down) {
      const dx = event.clientX - this.down.x, dy = event.clientY - this.down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3 || this.down.moved) {
        this.down.moved = true;
        const sensitivity = Math.min(0.006, this.altitude / Math.max(this.host.clientHeight, 1) / RADIUS * 0.9);
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * sensitivity, dx * sensitivity, 0));
        this.world.quaternion.premultiply(rotation);
        this.down.x = event.clientX; this.down.y = event.clientY;
        this.onHover(null);
      }
    } else this.onHover(this.pick(event));
  };
  private pointerUp = (event: PointerEvent) => {
    if (this.down && !this.down.moved) { const tile = this.pick(event); if (tile) this.onPick(tile); }
    this.down = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private pointerCancel = () => { this.down = null; };
  private pointerLeave = () => { this.onHover(null); };
  private wheel = (event: WheelEvent) => { event.preventDefault(); this.zoom(Math.exp(-event.deltaY * 0.0015)); };
  private animate = (time: number) => {
    if (this.destroyed) return;
    const dt = Math.min((time - this.lastTime) / 1000, 0.05); this.lastTime = time;
    if (!document.hidden && !this.frozen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.industrial.animate(time / 1000, dt);
    if (!document.hidden) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.dynamicBatches.update({ paused: this.frozen || reducedMotion });
      if (!this.frozen && !reducedMotion) updatePlanetSurfaceTime(this.surface, time / 1000);
      this.activity.animate(dt, time / 1000, { paused: this.frozen, reducedMotion, buildings: this.interaction?.layers.buildings, logistics: this.interaction?.layers.logistics, power: this.interaction?.layers.power });
      for (const { group, target } of this.moving.values()) {
        const radius = target.length();
        group.position.lerp(target, 1 - Math.exp(-dt * 12)).normalize().multiplyScalar(radius);
      }
      this.composer.render();
    }
    this.frame = requestAnimationFrame(this.animate);
  };
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerup', this.pointerUp);
    canvas.removeEventListener('pointercancel', this.pointerCancel);
    canvas.removeEventListener('pointerleave', this.pointerLeave);
    canvas.removeEventListener('wheel', this.wheel);
    this.staticBatches.dispose();
    this.dynamicBatches.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => materials.add(m)); } });
    this.geometries.forEach((g) => geometries.add(g));
    this.materials.forEach((m) => materials.add(m));
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
    this.activity.destroy(); this.industrial.dispose(); disposePlanetSurface(this.surface); this.environment.dispose(); this.bloom.dispose(); this.composer.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); canvas.remove();
  }
}
