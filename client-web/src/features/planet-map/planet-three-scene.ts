import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
const TERRAIN: Record<string, string> = {
  buildable: '#397565', blocked: '#5a636d',
  plains: '#397565', plain: '#397565', grass: '#397565', grassland: '#397565',
  forest: '#23594c', water: '#103c58', ocean: '#103c58', sea: '#103c58',
  mountain: '#737f86', mountains: '#737f86', rock: '#737f86', desert: '#ac9264',
  sand: '#ac9264', ice: '#a0c1ca', snow: '#a0c1ca', lava: '#a24c37', swamp: '#4d6150',
};

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
  private texture?: THREE.CanvasTexture;
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly groupByLayer = new Map<string, THREE.Group>();
  private readonly animations: THREE.Object3D[] = [];
  private lastTime = 0;
  private readonly models = new Map<string, THREE.Group>();

  constructor(private readonly host: HTMLElement, private readonly onPick: (tile: TilePoint) => void, private readonly onHover: (tile: TilePoint | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor('#030912');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.setAttribute('aria-label', '3D 行星地图：拖动旋转，滚轮缩放，点击地块操作');
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.scene.add(this.world);
    this.world.add(this.content, this.marks);
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 192, 128), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.87, metalness: 0.13 }));
    this.world.add(this.surface);
    this.scene.add(new THREE.AmbientLight(0x8babcf, 1.2));
    const sun = new THREE.DirectionalLight(0xffe3b8, 3.1);
    sun.position.set(-180, 130, 230);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x3b9dff, 1.1);
    rim.position.set(130, -70, -120);
    this.scene.add(rim);
    this.addSky();
    this.loadModels();
    this.camera.position.set(0, 0, RADIUS + this.altitude);
    this.camera.lookAt(0, 0, 0);
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

  private loadModels() {
    const loader = new GLTFLoader();
    for (const name of ['hangar_roundA', 'hangar_largeA', 'machine_generator', 'satelliteDish', 'craft_cargoA', 'rover', 'turret_single']) {
      loader.load(`/assets/space/${name}.glb`, (gltf) => {
        if (this.destroyed) { gltf.scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose()); } }); return; }
        this.models.set(name, gltf.scene);
        if (this.data) this.buildEntities();
      }, undefined, () => { /* Procedural models remain available when assets fail. */ });
    }
  }
  private applyModel(group: THREE.Group, name: string, width: number, depth: number) {
    const source = this.models.get(name);
    if (!source) return;
    const model = source.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = Math.min(width / Math.max(size.x, 0.01), depth / Math.max(size.z, 0.01));
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale + 0.10, -center.z * scale);
    group.clear();
    this.part(group, 'box', '#263b4a', [width, 0.10, depth], [0, 0.05, 0]);
    group.add(model);
  }
  private addSky() {
    const positions: number[] = [];
    const colors: number[] = [];
    // Deterministic decorative sky; these points do not represent game entities.
    for (let i = 0; i < 1500; i++) {
      const a = i * 2.39996323;
      const y = 1 - (i + 0.5) / 750;
      const r = Math.sqrt(1 - y * y);
      positions.push(Math.cos(a) * r * 1900, y * 1900, Math.sin(a) * r * 1900);
      const c = new THREE.Color(i % 7 === 0 ? '#9dcfff' : i % 11 === 0 ? '#ffe1b0' : '#b7c8dc');
      colors.push(c.r, c.g, c.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2.2, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.82 })));
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.018, 96, 64), new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color('#2498e5') } },
      vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){vec4 p=modelViewMatrix*vec4(position,1.0); vPosition=p.xyz; vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vPosition; void main(){float rim=pow(1.0-max(dot(normalize(vNormal),normalize(-vPosition)),0.0),3.5); gl_FragColor=vec4(glowColor,rim*0.58);}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.world.add(atmosphere);
  }

  setData(data: PlanetThreeData) {
    this.data = data;
    this.buildTerrain();
    this.buildEntities();
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
    const longitude = ((x + 0.5) / p.map_width) * Math.PI * 2;
    const latitude = ((y + 0.5) / p.map_height) * Math.PI;
    return new THREE.Vector3(-Math.cos(longitude) * Math.sin(latitude), Math.cos(latitude), Math.sin(longitude) * Math.sin(latitude));
  }

  private tileFromNormal(n: THREE.Vector3): TilePoint | null {
    if (!this.data) return null;
    const p = this.data.planet;
    const u = ((Math.atan2(n.z, -n.x) / (2 * Math.PI)) + 1) % 1;
    return { x: Math.min(p.map_width - 1, Math.floor(u * p.map_width)), y: Math.min(p.map_height - 1, Math.floor(Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)) / Math.PI * p.map_height)) };
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

  private buildTerrain() {
    if (!this.data) return;
    const { planet, overview } = this.data;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(2048, Math.max(256, planet.map_width));
    canvas.height = Math.min(1024, Math.max(128, planet.map_height));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#101c2c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const draw = (x: number, y: number, w: number, h: number, terrain: string, visible: boolean) => {
      if (terrain === 'unknown') return;
      const color = new THREE.Color(TERRAIN[terrain] ?? '#486d67');
      if (!visible) color.multiplyScalar(0.42);
      ctx.fillStyle = `#${color.getHexString()}`;
      ctx.fillRect(x / planet.map_width * canvas.width, y / planet.map_height * canvas.height, Math.ceil(w / planet.map_width * canvas.width), Math.ceil(h / planet.map_height * canvas.height));
    };
    overview?.terrain?.forEach((row, y) => row.forEach((terrain, x) => {
      if (overview.explored?.[y]?.[x]) draw(x * overview.step, y * overview.step, overview.step, overview.step, terrain, Boolean(overview.visible?.[y]?.[x]));
    }));
    const bounds = 'bounds' in planet ? planet.bounds : { x: 0, y: 0 };
    planet.terrain?.forEach((row, y) => row.forEach((terrain, x) => {
      const position = { x: bounds.x + x, y: bounds.y + y };
      if (this.known(position)) draw(position.x, position.y, 1, 1, terrain, this.visible(position));
    }));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.surface.material.map = texture;
    this.surface.material.needsUpdate = true;
    this.texture?.dispose();
    this.texture = texture;
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
    group.quaternion.setFromUnitVectors(UP, n);
    group.scale.setScalar(this.tileScale() * scale);
    group.userData.tile = { x: Math.round(position.x), y: Math.round(position.y) };
    this.layer(layer).add(group);
  }

  private buildEntities() {
    if (!this.data) return;
    // Shared meshes survive refresh; only network line geometry belongs to an individual snapshot.
    this.content.traverse((object) => { if (object instanceof THREE.Line || (object instanceof THREE.Mesh && object.userData.transient)) { object.geometry.dispose(); const m = object.material; if (Array.isArray(m)) m.forEach((entry) => entry.dispose()); else m.dispose(); } });
    this.content.clear();
    this.groupByLayer.clear();
    this.animations.length = 0;
    const { planet, playerId, runtime, networks } = this.data;
    this.buildDetailTerrain();
    for (const building of Object.values(planet.buildings ?? {})) {
      if (!(building.owner_id === playerId || this.visible(building.position))) continue;
      const g = new THREE.Group();
      const own = building.owner_id === playerId;
      const accent = own ? '#48ded2' : '#ff7965';
      const footprint = getBuildingFootprint(building);
      const width = Math.max(0.7, footprint.width * 0.8);
      const depth = Math.max(0.7, footprint.height * 0.8);
      this.part(g, 'box', '#233343', [width, 0.12, depth], [0, 0.06, 0]);
      const type = building.type as string;
      if (/solar/.test(type)) {
        this.part(g, 'box', '#bec8cf', [0.12, 0.35, 0.12], [0, 0.23, 0]);
        const panel = this.part(g, 'box', '#2468a6', [width * 0.95, 0.04, depth * 0.85], [0, 0.42, 0]);
        panel.rotation.x = -0.3;
        for (let i = -1; i <= 1; i++) this.part(g, 'box', '#72c7e8', [0.018, 0.025, depth * 0.8], [i * width * 0.28, 0.45, 0], true);
      } else if (/wind/.test(type)) {
        this.part(g, 'cylinder', '#c5d3d7', [0.10, 1.25, 0.10], [0, 0.72, 0]);
        const rotor = new THREE.Group(); rotor.position.set(0, 1.28, 0.10); g.add(rotor);
        for (let i = 0; i < 3; i++) { const blade = new THREE.Group(); blade.rotation.z = i * Math.PI * 2 / 3; rotor.add(blade); this.part(blade, 'box', '#e2e9e4', [0.085, 0.48, 0.035], [0, 0.22, 0]); }
        this.animations.push(rotor);
      } else if (/belt|conveyor|sorter|pipeline/.test(type)) {
        this.part(g, 'box', '#506173', [width * 0.85, 0.14, depth], [0, 0.19, 0]);
        for (let i = -1; i <= 1; i++) this.part(g, 'box', accent, [width * 0.65, 0.025, 0.06], [0, 0.27, i * depth * 0.28], true);
      } else if (/tower|station|base|hub|lab|research/.test(type)) {
        this.part(g, 'cylinder', '#afb9bf', [width * 0.65, 0.72, depth * 0.65], [0, 0.48, 0]);
        this.part(g, 'cylinder', accent, [width * 0.72, 0.055, depth * 0.72], [0, 0.77, 0], true);
        this.part(g, 'cylinder', '#324454', [width * 0.38, 0.35, depth * 0.38], [0, 0.98, 0]);
        this.part(g, 'cone', '#d7d5c4', [width * 0.46, 0.22, depth * 0.46], [0, 1.23, 0]);
        this.part(g, 'cylinder', accent, [0.04, 0.42, 0.04], [0, 1.47, 0], true);
      } else {
        this.part(g, 'box', '#a8b3bc', [width * 0.76, 0.45, depth * 0.76], [0, 0.35, 0]);
        this.part(g, 'box', '#344959', [width * 0.84, 0.13, depth * 0.84], [0, 0.64, 0]);
        this.part(g, 'box', accent, [width * 0.62, 0.06, 0.035], [0, 0.47, depth * 0.385], true);
        this.part(g, 'cylinder', '#4d6679', [width * 0.19, 0.48, depth * 0.19], [width * 0.25, 0.86, 0]);
        this.part(g, 'cylinder', '#efb962', [width * 0.2, 0.045, depth * 0.2], [width * 0.25, 1.11, 0], true);
      }
      const modelName = /base|hub/.test(type) ? 'hangar_roundA' : /turret|defense/.test(type) ? 'turret_single' : /lab|research|radar/.test(type) ? 'satelliteDish' : /generator|thermal/.test(type) ? 'machine_generator' : /factory|assembler|depot|storage|smelt/.test(type) ? 'hangar_largeA' : '';
      this.applyModel(g, modelName, width, depth);
      this.place(g, building.position, 'buildings');
    }
    for (const resource of planet.resources ?? []) {
      if (!this.known(resource.position)) continue;
      const g = new THREE.Group();
      const color = /iron/.test(resource.kind) ? '#8eb9cf' : /copper/.test(resource.kind) ? '#e59658' : /coal|oil/.test(resource.kind) ? '#454956' : '#a383cf';
      for (let i = 0; i < 3; i++) { const crystal = this.part(g, 'orb', color, [0.23, 0.25 + i * 0.10, 0.25], [(i - 1) * 0.18, 0.17, i % 2 * 0.14]); crystal.rotation.y = i; }
      this.place(g, resource.position, 'resources');
    }
    for (const unit of Object.values(planet.units ?? {})) {
      if (!(unit.owner_id === playerId || this.visible(unit.position))) continue;
      const g = this.ship(unit.owner_id === playerId ? '#65ecff' : '#ff776b');
      this.applyModel(g, /ship|craft|drone/.test(unit.type) ? 'craft_cargoA' : 'rover', 0.75, 0.9);
      this.place(g, unit.position, 'units', 0.75);
    }
    for (const drone of [...(runtime?.logistics_drones ?? []), ...(runtime?.logistics_ships ?? [])]) {
      if (!this.visible(drone.position)) continue;
      const g = this.ship('#ffcd75'); this.applyModel(g, 'craft_cargoA', 0.8, 0.8);
      this.place(g, drone.position, 'logistics', 0.45);
    }
    for (const task of runtime?.construction_tasks ?? []) {
      if (!this.known(task.position)) continue;
      const g = new THREE.Group();
      for (let x = -1; x <= 1; x += 2) for (let z = -1; z <= 1; z += 2) this.part(g, 'box', '#ffc46b', [0.035, 0.65, 0.035], [x * 0.35, 0.35, z * 0.35], true);
      this.place(g, task.position, 'construction');
    }
    for (const enemy of runtime?.enemy_forces ?? []) {
      if (this.visible(enemy.position)) this.place(this.ship('#ff665c'), enemy.position, 'threat');
    }
    for (const link of networks?.power_links ?? []) this.link(link.from_position, link.to_position, '#ffd37c', 'power');
    for (const link of networks?.pipeline_segments ?? []) this.link(link.from_position, link.to_position, '#76baef', 'pipelines');
  }

  private buildDetailTerrain() {
    if (!this.data) return;
    const { planet } = this.data;
    if (!('bounds' in planet) || (planet.map_width <= 2048 && planet.map_height <= 1024)) return;
    const positions: number[] = [], colors: number[] = [];
    const b = planet.bounds;
    planet.terrain?.forEach((row, iy) => row.forEach((terrain, ix) => {
      const x = b.x + ix, y = b.y + iy;
      if (!this.known({ x, y }) || terrain === 'unknown') return;
      const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([dx, dy]) => this.normal(x + dx, y + dy).multiplyScalar(RADIUS + this.tileScale() * 0.005));
      const color = new THREE.Color(TERRAIN[terrain] ?? '#486d67');
      color.multiplyScalar((this.visible({ x, y }) ? 1 : 0.42) * (0.94 + ((x * 7 + y * 13) % 11) * 0.009));
      for (const i of [0, 2, 1, 0, 3, 2]) { positions.push(...corners[i].toArray()); colors.push(color.r, color.g, color.b); }
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    mesh.userData.transient = true;
    mesh.userData.terrain = true;
    this.layer('terrain').add(mesh);
  }
  private ship(color: string) {
    const g = new THREE.Group();
    this.part(g, 'box', '#d2dbe1', [0.27, 0.20, 0.56], [0, 0.40, 0]);
    this.part(g, 'box', '#476578', [0.64, 0.06, 0.25], [0, 0.39, 0.04]);
    this.part(g, 'orb', color, [0.16, 0.1, 0.12], [0, 0.52, -0.12], true);
    this.part(g, 'box', color, [0.18, 0.08, 0.1], [0, 0.40, 0.33], true);
    return g;
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
    this.altitude = close ? Math.min(90, Math.max(this.tileScale() * 18, 0.1)) : 300;
    this.updateCamera();
  }
  orbit() { this.altitude = 300; this.updateCamera(); }
  project(tile: TilePoint) {
    if (!this.data) return null;
    this.world.updateMatrixWorld(true);
    const normal = this.normal(tile.x, tile.y).applyQuaternion(this.world.quaternion);
    const point = normal.clone().multiplyScalar(RADIUS + this.tileScale() * 0.1);
    const facing = normal.dot(this.camera.position.clone().sub(point)) > 0;
    point.project(this.camera);
    return { x: (point.x + 1) / 2 * this.host.clientWidth, y: (1 - point.y) / 2 * this.host.clientHeight, visible: facing && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 };
  }
  zoom(factor: number) {
    if (!(factor > 0)) return;
    this.altitude = THREE.MathUtils.clamp(this.altitude / factor, Math.max(this.tileScale() * 2.5, 0.03), 430);
    this.updateCamera();
  }
  private updateCamera() {
    this.camera.near = Math.max(0.0001, this.altitude * 0.05);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 0, RADIUS + this.altitude);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }
  getCenterTile() {
    return this.data ? this.tileFromNormal(FRONT.clone().applyQuaternion(this.world.quaternion.clone().invert())) : null;
  }
  capture() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }
  private resize = () => {
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
  private pick(event: PointerEvent) {
    if (!this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    this.world.updateMatrixWorld(true);
    const hits = this.raycaster.intersectObjects([this.surface, this.content], true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      let object: THREE.Object3D | null = hit.object;
      let hidden = false;
      while (object && object !== this.world) { if (!object.visible) hidden = true; object = object.parent; }
      if (hidden) continue;
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
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) for (const rotor of this.animations) rotor.rotation.z += dt * 1.8;
    this.renderer.render(this.scene, this.camera);
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
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => materials.add(m)); } });
    this.models.forEach((model) => model.traverse((o) => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => materials.add(m)); } }));
    this.geometries.forEach((g) => geometries.add(g));
    this.materials.forEach((m) => materials.add(m));
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
    this.texture?.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); canvas.remove();
  }
}
