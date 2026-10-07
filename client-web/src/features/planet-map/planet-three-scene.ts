import { resolveSelectionPosition } from './model';
import { surfaceFace, surfaceOffset } from '@shared/surface';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPlanetSurface, updatePlanetSurface, updatePlanetSurfaceTime, disposePlanetSurface } from './three/terrain';
import { IndustrialModels } from './three/industrial-models';
import { CombatEffects, specsFromCombatEvent, type CombatPoint } from './three/combat-effects';
import { createSpace } from './three/space';
import { parseRenderQuality, renderQualitySettings, type PlanetRenderQuality } from './three/render-quality';
import { tileNormal, normalTile, tileFrame, surfaceTileSize } from './three/projection';
import { createSurfaceDressing } from './three/surface-dressing';
import { createLocalSurface } from './three/local-surface';
import { IndustrialActivity } from './three/industrial-activity';
import { StaticBatches } from './three/static-batches';
import { DynamicBatches } from './three/dynamic-batches';
import { ConveyorGeometry } from './three/conveyor-geometry';
import { logisticsFlightNormal } from './three/logistics-flight';
import { syncSorterAnimation } from './three/sorter-animation';
import { assessBuildTiles } from './build-workflow';
import type { CatalogView, FogMapView, ItemInventory, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView, Position, Unit } from '@shared/types';
import { getBuildingFootprint, getFogState, getTerrainTile, type PlanetLayerVisibility, type PlanetRenderView, type SelectedEntity, type TilePoint } from './model';
import { FACTION_COLOR, unitFaction, type UnitFaction } from './rts-commands';
import { subscribeCommandMarkers } from './command-markers';
import { CommandMarkerMeshes } from './three/command-marker-meshes';
import { circleLoop, discGeometry, ribbonGeometry } from './three/surface-ribbon';
import type { BattleEvent } from '@/engine/battle-events';
import type { PlanetInteractionMode } from './store';

export interface PlanetThreeData {
  planet: PlanetRenderView;
  fog?: FogMapView | PlanetSceneView;
  overview?: PlanetOverviewView;
  runtime?: PlanetRuntimeView;
  networks?: PlanetNetworksView;
  catalog?: CatalogView;
  playerId?: string;
  /** 黑雾是否对当前玩家敌对（summary 玩家 dark_fog.hostile）：决定黑雾单位涂装。 */
  darkFogHostile?: boolean;
  /** 玩家背包：建造预览缺料时标红。 */
  inventory?: ItemInventory;
}
export interface PlanetThreeInteraction {
  selected: SelectedEntity | null;
  /** 多选单位（框选/编队/双击同类）：每个单位画一个选中标记。 */
  selectedUnits?: string[];
  hoveredTile: TilePoint | null;
  interactionMode: PlanetInteractionMode;
  layers: PlanetLayerVisibility;
}
const RADIUS = 100;
const HOVER_PICK_MS = 70;
const refIds = new WeakMap<object, number>();
let nextRefId = 1;
/** 对象引用 → 稳定编号（签名里代替大数组内容）。 */
function refId(value: object | undefined | null) {
  if (!value) return 0;
  let id = refIds.get(value);
  if (!id) { id = nextRefId++; refIds.set(value, id); }
  return id;
}
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
  private readonly conveyors = new ConveyorGeometry();
  private readonly activity = new IndustrialActivity(this.world, RADIUS);
  private readonly sunlight = new THREE.DirectionalLight(0xffe5c1, 3.5);
  private dressing?: THREE.Group;
  private dressingSignature = '';
  private localSurface: ReturnType<typeof createLocalSurface> = null;
  private localSurfaceKey = '';
  private groundView = false;
  private tilt = .65;
  private readonly moving = new Map<string, { group: THREE.Group; target: THREE.Vector3; signature: string; baseScale: THREE.Vector3; bar?: { bg: THREE.Sprite; fg: THREE.Sprite; tag?: THREE.Sprite } }>();
  private readonly staticEntities = new Map<string, { group: THREE.Group; signature: string }>();
  private readonly linkSignatures = new Map<string, string>();
  private frozen = new URLSearchParams(window.location.search).has('freeze');
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly groupByLayer = new Map<string, THREE.Group>();
  private lastTime = 0;
  private quality = parseRenderQuality(new URLSearchParams(window.location.search).get('quality'));
  /** C2 战斗演出：弹道/枪口/命中/飘字/护盾波纹/爆炸/残骸（挂 world 随星球旋转）。 */
  private readonly combat = new CombatEffects(this.world, () => this.tileScale());
  /** 战斗事件总线 seq 去重（StrictMode 双挂载/多重转发只演出一次，同 2D planet-scene）。 */
  private lastBattleSeq = 0;
  /** 炮塔转向跟踪：模型拆出的独立炮管组 + 当前/目标偏航角。 */
  private turretAims: { id: string; group: THREE.Group; barrel: THREE.Object3D; yaw: number; targetYaw: number }[] = [];
  private aimRetargetAt = 0;
  /** 单位头顶 billboard 共享材质（destroy 时统一释放）。 */
  private readonly spriteMaterials = new Map<string, THREE.SpriteMaterial>();
  /** 低频变化的地表标记（补给光环、网格），按签名重建；hover/选中不触发。 */
  private readonly staticMarks = new THREE.Group();
  private staticMarksSignature = '';
  /** 地表标记共享材质（按颜色/透明度缓存，色带几何每次重建、材质复用）。 */
  private readonly markMaterials = new Map<string, THREE.MeshBasicMaterial>();
  /** 补给光环材质：动画循环里做缓慢呼吸。 */
  private readonly auraMaterials = new Set<THREE.MeshBasicMaterial>();
  /** 右键/军团命令落点反馈（涟漪/准星）。 */
  private readonly commandMarkers = new CommandMarkerMeshes(this.world, tile => this.data ? this.normal(tile.x, tile.y) : null, RADIUS, () => this.tileScale());
  private readonly unsubscribeCommandMarkers = subscribeCommandMarkers(spec => { if (!this.destroyed) this.commandMarkers.spawn(spec); });
  /** 悬停拾取节流：射线检测较重，指针移动只记录坐标，最多每 HOVER_PICK_MS 拾取一次。 */
  private hoverPoint: { x: number; y: number } | null = null;
  private hoverTimer = 0;
  private lastHover: TilePoint | null = null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly motionScratch = { from: new THREE.Vector3(), to: new THREE.Vector3(), up: new THREE.Vector3(), rotation: new THREE.Quaternion(), identity: new THREE.Quaternion() };


  constructor(private readonly host: HTMLElement, private readonly onPick: (tile: TilePoint) => void, private readonly onHover: (tile: TilePoint | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    const quality = renderQualitySettings(this.quality, window.innerWidth, window.devicePixelRatio, this.renderer.capabilities.maxSamples);
    this.renderer.setPixelRatio(quality.pixelRatio);
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
    // Default-canvas antialiasing does not reach postprocessing render targets.
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.samples });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .32, .45, 2.5);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.renderer.domElement.setAttribute('aria-label', '3D 行星地图：拖动旋转，滚轮缩放，点击地块操作');
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.scene.add(this.world);
    this.world.add(this.content, this.staticMarks, this.marks);
    this.surface = createPlanetSurface(RADIUS);
    this.surface.receiveShadow = true;
    this.world.add(this.surface);
    this.scene.add(new THREE.HemisphereLight(0xb6dafa, 0x384044, .75));
    this.sunlight.position.set(-100, 140, 230);
    this.sunlight.target.position.set(0, 0, RADIUS);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sunlight.shadow.bias = -.00015;
    this.sunlight.shadow.normalBias = .035;
    this.sunlight.shadow.camera.near = 1;
    this.sunlight.shadow.camera.far = 500;
    this.scene.add(this.sunlight, this.sunlight.target);
    const rim = new THREE.DirectionalLight(0x719dc7, .75);
    rim.position.set(100, -60, -70);
    this.scene.add(rim);
    const { sky, atmosphere } = createSpace(RADIUS, this.sunlight.position.clone().sub(this.sunlight.target.position).normalize());
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

  getQuality() { return this.quality; }

  setQuality(quality: PlanetRenderQuality) {
    this.quality = quality;
    this.resize();
  }

  private updateQuality() {
    const settings = renderQualitySettings(this.quality, window.innerWidth, window.devicePixelRatio, this.renderer.capabilities.maxSamples);
    if (this.renderer.getPixelRatio() !== settings.pixelRatio) {
      this.renderer.setPixelRatio(settings.pixelRatio);
      this.composer.setPixelRatio(settings.pixelRatio);
    }
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples !== settings.samples) {
        target.samples = settings.samples;
        target.dispose();
      }
    }
    if (this.sunlight.shadow.mapSize.x !== settings.shadowMapSize) {
      this.sunlight.shadow.map?.dispose();
      this.sunlight.shadow.map = null;
      this.sunlight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.sunlight.shadow.needsUpdate = true;
    }
    this.bloom.enabled = settings.bloom;
  }

  setData(data: PlanetThreeData) {
    this.data = data;
    updatePlanetSurface(this.surface, data);
    const localKey = JSON.stringify([data.planet.map_width, data.planet.map_height, 'bounds' in data.planet ? [data.planet.bounds, data.planet.surface_patches?.map(p => [p.bounds, p.height?.length ?? 0]), data.planet.height?.length ?? 0] : null]);
    if (localKey !== this.localSurfaceKey) {
      if (this.localSurface) { this.world.remove(this.localSurface); this.localSurface.geometry.dispose(); }
      this.localSurface = createLocalSurface(data.planet, RADIUS, this.surface.material);
      if (this.localSurface) this.world.add(this.localSurface);
      this.localSurfaceKey = localKey;
    }
    // 地形/迷雾大数组按引用比较（查询层结构共享保证未变时引用不变），避免每次实时更新都序列化整张地形。
    const dressingSignature = JSON.stringify([refId(data.planet.terrain), 'bounds' in data.planet ? [data.planet.bounds, refId(data.planet.surface_patches)] : null,
      Object.values(data.planet.buildings ?? {}).map(b => [b.position, getBuildingFootprint(b)]), refId(data.fog?.visible)]);
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
    return tileNormal({ x, y }, p.surface.face_size);
  }

  private tileFromNormal(n: THREE.Vector3): TilePoint | null {
    return this.data ? normalTile(n, this.data.planet.surface.face_size) : null;
  }

  private tileScale() {
    const p = this.data?.planet;
    return p ? surfaceTileSize(RADIUS, p.surface.face_size) : 1;
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
    const { east, south } = tileFrame(position, this.data!.planet.surface.face_size);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, n, south));
    const size = this.tileScale();
    group.scale.multiplyScalar(size * scale);
    group.userData.tile = { x: Math.round(position.x), y: Math.round(position.y) };
    this.layer(layer).add(group);
  }

  private buildEntities() {
    if (!this.data) return;
    const { planet, playerId, runtime, networks } = this.data;
    const visibleBuildings = Object.values(planet.buildings ?? {}).filter(building => building.owner_id === playerId || this.visible(building.position));
    this.conveyors.refresh(visibleBuildings, planet.surface.face_size, RADIUS);
    this.layer('buildings').add(this.conveyors.group);
    const dimensions = [planet.surface.face_size];
    const staticKeys = new Set<string>();
    const occupiedTiles = new Set<string>();
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
    for (const building of visibleBuildings) {
      const footprint = getBuildingFootprint(building);
      const host = building.distributor ? planet.buildings?.[building.distributor.host_building_id] : undefined;
      const placement = host ?? building;
      const placementFootprint = getBuildingFootprint(placement);
      const mountHeight = host ? .59 * Math.max(.8, Math.min(placementFootprint.width, placementFootprint.height) * .86 * .72) : 0;
      for (let y = 0; y < footprint.height; y++) for (let x = 0; x < footprint.width; x++) {
        const tile = surfaceOffset(building.position, x, y, planet.surface.face_size);
        occupiedTiles.add(`${tile.x}:${tile.y}`);
      }
      if (building.conveyor && building.type.startsWith('conveyor_belt_')) continue;
      retain(`building:${building.id}`, [building.type, building.owner_id === playerId, building.position, footprint, building.rotation, building.conveyor?.output, host?.position, placementFootprint], () => {
        const group = this.industrial.building(building.type, footprint.width * .86, footprint.height * .86, building.owner_id === playerId);
        this.place(group, placement.position, 'buildings');
        group.rotateY(-Number(building.rotation ?? 0) * Math.PI / 180);
        const center = new THREE.Vector3();
        for(let y=0;y<placementFootprint.height;y++) for(let x=0;x<placementFootprint.width;x++) {
          const cell=surfaceOffset(placement.position,x,y,planet.surface.face_size);
          center.add(this.normal(cell.x,cell.y));
        }
        group.position.copy(center.normalize()).multiplyScalar(RADIUS+this.tileScale()*(.025+mountHeight));
        group.userData.tile = { x: Math.round(building.position.x), y: Math.round(building.position.y) };
        return group;
      });
    }
    for (const building of Object.values(planet.buildings ?? {})) {
      const model = this.staticEntities.get(`building:${building.id}`)?.group;
      if (model) model.userData.industryActive = building.runtime?.state === 'running';
      if (model && (building.sorter || /sorter/.test(building.type))) syncSorterAnimation(model, building, ('tick' in planet ? planet.tick : runtime?.tick) ?? 0, planet.surface.face_size, RADIUS);
    }
    // 炮塔转向跟踪（C2）：重建可转向炮管列表（保留已有偏航角，模型重建时不跳变）。
    const previousAims = new Map(this.turretAims.map((aim) => [aim.id, aim]));
    this.turretAims = [];
    for (const building of visibleBuildings) {
      if (!/turret|missile|cannon|defense/.test(building.type)) continue;
      const model = this.staticEntities.get(`building:${building.id}`)?.group;
      const barrel = model?.getObjectByName('turret-barrel');
      if (!model || !barrel) continue;
      const previous = previousAims.get(building.id);
      this.turretAims.push({ id: building.id, group: model, barrel, yaw: previous?.yaw ?? 0, targetYaw: previous?.targetYaw ?? 0 });
    }
    for (const resource of planet.resources ?? []) {
      if (!this.known(resource.position)) continue;
      const covered = occupiedTiles.has(`${resource.position.x}:${resource.position.y}`);
      retain(`resource:${resource.kind}:${resource.position.x}:${resource.position.y}`, [resource.kind, resource.position.x, resource.position.y, covered], () => {
        const group = this.industrial.resource(resource.kind);
        // Keep the deposit visible at ground level without hiding the belt deck
        // or moving sorter arm. Removing the building restores the outcrop.
        if (covered) group.scale.y *= .1;
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
    const move = (id: string, type: string, faction: UnitFaction, position: Position, layer: string, scale: number, airborne = false, normal?: THREE.Vector3, altitude?: number) => {
      movingKeys.add(id);
      this.trackMotion(id, type, faction, position, layer, scale, airborne, normal, altitude);
    };
    const fogHostile = this.data.darkFogHostile ?? false;
    const ownership = (ownerId: string): UnitFaction => ownerId === playerId ? 'own' : 'enemy';
    for (const unit of Object.values(planet.units ?? {})) {
      if (unit.owner_id === playerId || this.visible(unit.position)) {
        const faction = unitFaction(unit, playerId, fogHostile);
        move(`unit:${unit.id}`, unit.type, faction, unit.position, 'units', .72);
        // 血条（C2）：头顶 billboard，受击比例实时更新，按阵营着色；中立黑雾头顶挂「中立」标签
        this.syncUnitBar(this.moving.get(`unit:${unit.id}`), unit, faction);
      }
    }
    const logisticsLinks: { from: Position; to: Position }[] = [];
    for (const drone of [...(runtime?.logistics_drones ?? []), ...(runtime?.logistics_ships ?? [])]) {
      if (!this.visible(drone.position)) continue;
      if ('current_planet_id' in drone && drone.current_planet_id && drone.current_planet_id !== planet.planet_id) continue;
      const interplanetary = 'target_planet_id' in drone && drone.target_planet_id && drone.target_planet_id !== planet.planet_id;
      // An interplanetary vessel has left this surface during its cruise phase.
      if (interplanetary && drone.status === 'in_flight') continue;
      const airborne = ['takeoff', 'in_flight', 'landing'].includes(drone.status);
      move(`logistics:${drone.id}`, 'ship', ownership(drone.owner_id), drone.position, 'logistics', .45, airborne,
        interplanetary ? undefined : logisticsFlightNormal(drone, planet.surface.face_size));
      if (!interplanetary && ['takeoff', 'in_flight', 'landing'].includes(drone.status) && drone.target_pos) logisticsLinks.push({ from: drone.position, to: drone.target_pos });
    }
    for (const bot of runtime?.logistics_bots ?? []) {
      // Idle robots are stored inside their dock. Positions already advance on the server.
      if (bot.status === 'idle' || !this.visible(bot.position)) continue;
      const airborne = ['takeoff', 'in_flight', 'landing'].includes(bot.status);
      const id = `logistics-bot:${bot.id}`;
      move(id, 'logistics_bot', ownership(bot.owner_id), bot.position, 'logistics', .6, airborne, undefined,
        bot.status === 'stranded' ? .035 : bot.status === 'in_flight' ? 1.05 : .66);
      const model = this.moving.get(id)!.group;
      model.userData.industryActive = airborne;
      const cargo = model.getObjectByName('logistics-bot-cargo');
      if (cargo) {
        cargo.visible = Object.values(bot.cargo ?? {}).some(quantity => quantity > 0);
        cargo.userData.inventory = { ...bot.cargo };
      }
      if (airborne && bot.target_pos) logisticsLinks.push({ from: bot.position, to: bot.target_pos });
    }
    for (const enemy of runtime?.enemy_forces ?? []) {
      if (this.visible(enemy.position)) move(`enemy:${enemy.id}`, enemy.type, fogHostile ? 'fog_hostile' : 'fog_neutral', enemy.position, 'threat', 1);
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
    // Model geometry/material are cached and shared by the asset library; bar/tag sprites use shared materials.
  }

  /** 头顶 billboard 共享材质：血条底色、各阵营血条色、「中立」标签（全部单位复用，不随单位创建/销毁）。 */
  private spriteMaterial(key: 'bar-bg' | UnitFaction | 'neutral-tag') {
    let material = this.spriteMaterials.get(key);
    if (material) return material;
    // 深度测试开启（不写深度）：球体背面的单位血条/标签不再透过星球显示。
    if (key === 'bar-bg') material = new THREE.SpriteMaterial({ color: 0x11161f, transparent: true, opacity: 0.78, depthWrite: false });
    else if (key === 'neutral-tag') {
      const canvas = document.createElement('canvas');
      canvas.width = 96; canvas.height = 40;
      const context = canvas.getContext('2d');
      if (context && typeof context.fillText === 'function') {
        context.fillStyle = 'rgba(28,22,40,0.82)';
        context.strokeStyle = 'rgba(185,166,230,0.9)';
        context.lineWidth = 2;
        context.beginPath(); context.roundRect?.(3, 3, 90, 34, 8); context.fill(); context.stroke();
        context.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
        context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillStyle = '#d9cdf5';
        context.fillText('中立', 48, 21);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    } else material = new THREE.SpriteMaterial({ color: FACTION_COLOR[key], transparent: true, depthWrite: false });
    this.spriteMaterials.set(key, material);
    return material;
  }

  /** 单位头顶 billboard：受损时显示血条（阵营色），中立黑雾常驻「中立」标签。 */
  private syncUnitBar(entry: { group: THREE.Group; bar?: { bg: THREE.Sprite; fg: THREE.Sprite; tag?: THREE.Sprite } } | undefined, unit: Unit, faction: UnitFaction) {
    if (!entry) return;
    if (!entry.bar) {
      const bg = new THREE.Sprite(this.spriteMaterial('bar-bg'));
      const fg = new THREE.Sprite(this.spriteMaterial(faction));
      bg.renderOrder = 20;
      fg.renderOrder = 21;
      bg.center.set(0.5, 0.5);
      fg.center.set(0, 0.5);
      bg.scale.set(0.84, 0.1, 1);
      bg.position.set(0, 1.02, 0);
      fg.position.set(-0.4, 1.02, 0);
      entry.group.add(bg, fg);
      entry.bar = { bg, fg };
    }
    const ratio = Math.max(0, Math.min(unit.hp / Math.max(unit.max_hp, 1), 1));
    entry.bar.fg.material = this.spriteMaterial(faction);
    entry.bar.fg.scale.set(Math.max(0.8 * ratio, 0.001), 0.07, 1);
    const damaged = ratio < 0.999;
    entry.bar.bg.visible = damaged;
    entry.bar.fg.visible = damaged;
    if (faction === 'fog_neutral' && !entry.bar.tag) {
      const tag = new THREE.Sprite(this.spriteMaterial('neutral-tag'));
      tag.renderOrder = 22;
      tag.scale.set(0.6, 0.25, 1);
      tag.position.set(0, 1.28, 0);
      entry.group.add(tag);
      entry.bar.tag = tag;
    }
    if (entry.bar.tag) entry.bar.tag.visible = faction === 'fog_neutral';
  }

  /**
   * 消费一条战斗事件总线事件（C2：damage_applied → 弹道/枪口/命中/飘字/护盾波纹；
   * entity_destroyed → 爆炸/残骸）。seq 去重与 2D 一致；frozen 模式不演出。
   */
  handleBattleEvent(event: BattleEvent) {
    if (this.destroyed || this.frozen) return;
    if (event.seq <= this.lastBattleSeq) return;
    this.lastBattleSeq = event.seq;
    this.combat.spawnSpecs(specsFromCombatEvent(event, (entityId) => this.resolveCombatPoint(entityId)));
  }

  /** 实体 id → 战斗演出锚点（建筑取模型位置，单位取平滑后的实时位置；小队未在 3D 渲染，解析为 null）。 */
  private resolveCombatPoint(entityId: string | undefined | null): CombatPoint | null {
    if (!entityId || !this.data) return null;
    const playerId = this.data.playerId;
    const ownerOf = (ownerId: string | undefined): CombatPoint['owner'] => (
      ownerId === playerId ? 'own' : ownerId === 'dark_fog' ? 'darkfog' : 'enemy'
    );
    const building = this.staticEntities.get(`building:${entityId}`)?.group;
    if (building) {
      const data = this.data.planet.buildings?.[entityId];
      return { x: building.position.x, y: building.position.y, z: building.position.z, owner: ownerOf(data?.owner_id), kind: 'building' };
    }
    const unit = this.moving.get(`unit:${entityId}`)?.group;
    if (unit) {
      const data = this.data.planet.units?.[entityId];
      return { x: unit.position.x, y: unit.position.y, z: unit.position.z, owner: ownerOf(data?.owner_id), kind: 'unit' };
    }
    const enemy = this.moving.get(`enemy:${entityId}`)?.group;
    if (enemy) {
      return { x: enemy.position.x, y: enemy.position.y, z: enemy.position.z, owner: 'darkfog', kind: 'unit' };
    }
    return null;
  }

  /** 炮塔转向：每 0.3s 重选最近敌对目标，逐帧平滑转到目标方位（无目标保持当前朝向）。 */
  private updateTurretAims(dt: number, now: number) {
    if (this.turretAims.length === 0 || !this.data) return;
    if (now >= this.aimRetargetAt) {
      this.aimRetargetAt = now + 300;
      const playerId = this.data.playerId;
      const hostiles: THREE.Vector3[] = [];
      for (const unit of Object.values(this.data.planet.units ?? {})) {
        if (unit.owner_id !== playerId && unit.hp > 0) hostiles.push(this.normal(unit.position.x, unit.position.y).multiplyScalar(RADIUS));
      }
      for (const force of this.data.runtime?.enemy_forces ?? []) {
        hostiles.push(this.normal(force.position.x, force.position.y).multiplyScalar(RADIUS));
      }
      const maxRange = this.tileScale() * 26;
      for (const aim of this.turretAims) {
        let best: THREE.Vector3 | null = null;
        let bestDistance = maxRange;
        for (const hostile of hostiles) {
          const distance = hostile.distanceTo(aim.group.position);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = hostile;
          }
        }
        if (best) {
          const local = best.clone().sub(aim.group.position).applyQuaternion(aim.group.quaternion.clone().invert());
          aim.targetYaw = Math.atan2(local.x, local.z);
        }
      }
    }
    for (const aim of this.turretAims) {
      // 最短角差插值（~5rad/s 上限），避免 180° 反转抽搐
      let delta = aim.targetYaw - aim.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      aim.yaw += THREE.MathUtils.clamp(delta, -dt * 5, dt * 5);
      aim.barrel.rotation.y = aim.yaw;
    }
  }

  private trackMotion(id: string, type: string, faction: UnitFaction, position: Position, layer: string, scale: number, airborne: boolean, normal?: THREE.Vector3, altitude?: number) {
    const signature = JSON.stringify([type, faction, layer]);
    let entry = this.moving.get(id);
    if (entry && entry.signature !== signature) { this.removeModel(entry.group); this.moving.delete(id); entry = undefined; }
    const previousPosition = entry?.group.position.clone();
    if (!entry) {
      const group = this.industrial.unit(type, faction);
      entry = { group, target: new THREE.Vector3(), signature, baseScale: group.scale.clone() };
      this.moving.set(id, entry);
    }
    const group = entry.group;
    group.scale.copy(entry.baseScale);
    this.place(group, position, layer, scale);
    if (normal) {
      group.position.copy(normal).multiplyScalar(RADIUS + this.tileScale() * .025);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    }
    if (airborne) group.position.normalize().multiplyScalar(RADIUS + this.tileScale() * .4);
    if (altitude !== undefined) group.position.normalize().multiplyScalar(RADIUS + this.tileScale() * altitude);
    entry.target.copy(group.position);
    if (previousPosition && !this.frozen && previousPosition.distanceTo(entry.target) < RADIUS) group.position.copy(previousPosition);
  }

  private syncLinks(layer: string, color: string, links: { from: Position; to: Position }[]) {
    const visible = links.filter(link => this.known(link.from) && this.known(link.to));
    const signature = JSON.stringify([this.data!.planet.surface.face_size,
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

  /** 地表标记共享材质（userData.shared：清理标记时只释放几何）。 */
  private markMaterial(color: string, opacity: number, aura = false) {
    const key = `${color}:${opacity}:${aura}`;
    let material = this.markMaterials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      material.userData.shared = true;
      material.userData.baseOpacity = opacity;
      this.markMaterials.set(key, material);
      if (aura) this.auraMaterials.add(material);
    }
    return material;
  }

  /** 地块描边：贴地色带（WebGL 线宽恒 1px，近景几乎看不见）。 */
  private tileOutline(tile: TilePoint, color: string) {
    const size = this.data!.planet.surface.face_size;
    const face = surfaceFace(tile, size);
    const loop = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => tileNormal({ x: tile.x + x, y: tile.y + y }, size, face));
    const mesh = new THREE.Mesh(ribbonGeometry(loop, RADIUS + this.tileScale() * 0.06, this.tileScale() * 0.045), this.markMaterial(color, 0.95));
    mesh.renderOrder = 12;
    return mesh;
  }

  private clearMarks(group: THREE.Group) {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) if (!material.userData.shared) material.dispose();
      } else if (o instanceof THREE.Sprite && !o.material.userData.shared) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    group.clear();
  }

  /** 补给光环与网格：只在其输入变化时重建（hover/选中变化不触发）。 */
  private updateStaticMarks() {
    const data = this.data!, layers = this.interaction!.layers;
    const auras: { x: number; y: number; radius: number; color: string }[] = [];
    if (layers.logistics) {
      for (const b of Object.values(data.planet.buildings ?? {})) {
        const radius = data.catalog?.buildings?.find(d => d.id === b.type)?.supply_radius ?? 0;
        if (b.owner_id === data.playerId && b.hp > 0 && radius > 0) auras.push({ x: b.position.x, y: b.position.y, radius, color: b.runtime?.state === 'running' ? '#5ff0b0' : '#e0727f' });
      }
      for (const u of Object.values(data.planet.units ?? {})) {
        const radius = data.catalog?.world_units?.find(d => d.id === u.type)?.supply_radius ?? 0;
        if (u.owner_id === data.playerId && u.hp > 0 && u.type === 'supply_truck' && radius > 0) auras.push({ x: Math.round(u.position.x), y: Math.round(u.position.y), radius, color: '#7dc5f4' });
      }
    }
    const grids = layers.grid && 'bounds' in data.planet ? [data.planet.bounds, ...(data.planet.surface_patches ?? []).map(p => p.bounds)] : [];
    const size = data.planet.surface.face_size;
    const signature = JSON.stringify([size, auras, grids]);
    if (signature === this.staticMarksSignature) return;
    this.staticMarksSignature = signature;
    this.clearMarks(this.staticMarks);
    const ts = this.tileScale();
    for (const aura of auras) {
      // 补给光环：粗色带外圈（呼吸）+ 极淡填充，远景也能一眼看出覆盖范围。
      const center = this.normal(aura.x, aura.y);
      const { east, south } = tileFrame(aura, size);
      const loop = circleLoop(center, east, south, aura.radius * ts / RADIUS, 96);
      const fill = new THREE.Mesh(discGeometry(loop, center, RADIUS + ts * .05), this.markMaterial(aura.color, .07));
      const edge = new THREE.Mesh(ribbonGeometry(loop, RADIUS + ts * .09, Math.max(ts * .16, .02)), this.markMaterial(aura.color, .85, true));
      fill.renderOrder = 10; edge.renderOrder = 11;
      this.staticMarks.add(fill, edge);
    }
    for (const b of grids) {
      const stride = Math.max(1, Math.ceil(Math.max(b.width, b.height) / 64));
      const points: THREE.Vector3[] = [];
      for (let y = b.y; y < b.y + b.height; y += stride) for (let x = b.x; x < b.x + b.width; x += stride) {
        const face = surfaceFace({ x, y }, size);
        const right = Math.min(x + stride, (face % 3 + 1) * size, b.x + b.width);
        const bottom = Math.min(y + stride, (Math.floor(face / 3) + 1) * size, b.y + b.height);
        const corners = [[x-.5,y-.5],[right-.5,y-.5],[right-.5,bottom-.5],[x-.5,bottom-.5]];
        const normals = corners.map(([cx,cy]) => tileNormal({x:cx,y:cy}, size, face).multiplyScalar(RADIUS+.001));
        for(let i=0;i<4;i++) points.push(normals[i],normals[(i+1)%4]);
      }
      this.staticMarks.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#85bec6', transparent: true, opacity: 0.16 })));
    }
  }

  private updateMarks() {
    this.clearMarks(this.marks);
    if (!this.data || !this.interaction) return;
    this.updateStaticMarks();
    const add = (tile: TilePoint, color: string) => {
      this.marks.add(this.tileOutline(tile, color));
    };
    const selectedPosition = resolveSelectionPosition(this.data.planet, this.interaction.selected);
    if (this.interaction.layers.selection && selectedPosition) add(selectedPosition, '#fff1a8');
    // 多选单位：每个单位一个选中标记（主选中环之外追加）
    if (this.interaction.layers.selection) {
      for (const unitId of this.interaction.selectedUnits ?? []) {
        if (this.interaction.selected?.kind === 'unit' && this.interaction.selected.id === unitId) continue;
        const unit = this.data.planet.units?.[unitId];
        if (unit) add({ x: Math.round(unit.position.x), y: Math.round(unit.position.y) }, '#9ef7c9');
      }
    }
    if (this.interaction.hoveredTile) {
      const tile = this.interaction.hoveredTile;
      if (this.interaction.interactionMode.kind === 'build') {
        const assessment = assessBuildTiles(this.data.catalog, this.interaction.interactionMode.buildingType, this.data.planet, { ...tile, z: 0 }, this.data.playerId, this.interaction.interactionMode.rotation, this.data.inventory);
        const footprint = assessment?.footprint ?? { width: 1, height: 1 };
        for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
          const p = surfaceOffset(tile, dx, dy, this.data.planet.surface.face_size);
          add(p, assessment?.buildable && this.visible(p) ? '#5ef7a1' : '#ff6666');
        }
      } else add(tile, this.interaction.interactionMode.kind === 'attack' ? '#ff6666' : '#5ef7dc');
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
    this.updateQuality();
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
  /** 屏幕坐标 → tile 拾取（右键情境指令/双击选同类等 React 侧交互用）。 */
  pickAt(clientX: number, clientY: number) {
    return this.pickAtCoords(clientX, clientY);
  }
  private pickAtCoords(clientX: number, clientY: number) {
    if (!this.data) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    this.world.updateMatrixWorld(true);
    // 落点类命令只关心地面格：直接与数学球面求交，不受实体遮挡、迷雾或未知格影响。
    const mode = this.interaction?.interactionMode;
    if (mode && (mode.kind === 'build' || mode.kind === 'move' || mode.kind === 'squad_order' || mode.kind === 'theater_zone' || (mode.kind === 'unit_order' && mode.order !== 'guard'))) {
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
      const batchTile = this.conveyors.resolveHit(hit) ?? this.staticBatches.resolveHit(hit) ?? this.dynamicBatches.resolveHit(hit);
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
  private pick(event: PointerEvent) {
    return this.pickAtCoords(event.clientX, event.clientY);
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
        this.emitHover(null);
      }
    } else {
      this.hoverPoint = { x: event.clientX, y: event.clientY };
      if (!this.hoverTimer) this.hoverTimer = window.setTimeout(this.flushHover, HOVER_PICK_MS);
    }
  };
  /** 节流后的悬停拾取：只在格子变化时通知，避免每次指针移动都触发 store 更新与标记重建。 */
  private flushHover = () => {
    this.hoverTimer = 0;
    if (this.destroyed || !this.hoverPoint || this.down?.moved) return;
    this.emitHover(this.pickAtCoords(this.hoverPoint.x, this.hoverPoint.y));
  };
  private emitHover(tile: TilePoint | null) {
    if (tile?.x === this.lastHover?.x && tile?.y === this.lastHover?.y) return;
    this.lastHover = tile;
    this.onHover(tile);
  }
  private pointerUp = (event: PointerEvent) => {
    if (this.down && !this.down.moved) { const tile = this.pick(event); if (tile) this.onPick(tile); }
    this.down = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private pointerCancel = () => { this.down = null; };
  private pointerLeave = () => { this.hoverPoint = null; this.emitHover(null); };
  private wheel = (event: WheelEvent) => { event.preventDefault(); this.zoom(Math.exp(-event.deltaY * 0.0015)); };
  private animate = (time: number) => {
    if (this.destroyed) return;
    const dt = Math.min((time - this.lastTime) / 1000, 0.05); this.lastTime = time;
    const reducedMotion = this.reducedMotion.matches;
    if (!document.hidden && !this.frozen && !reducedMotion) this.industrial.animate(time / 1000, dt);
    if (!document.hidden) {
      this.dynamicBatches.update({ paused: this.frozen || reducedMotion });
      if (!this.frozen && !reducedMotion) updatePlanetSurfaceTime(this.surface, time / 1000);
      this.activity.animate(dt, time / 1000, { paused: this.frozen, reducedMotion, buildings: this.interaction?.layers.buildings, logistics: this.interaction?.layers.logistics, power: this.interaction?.layers.power });
      if (!this.frozen) {
        this.combat.update(dt * 1000);
        this.commandMarkers.update(dt * 1000);
        this.updateTurretAims(dt, time);
      }
      // 补给光环缓慢呼吸（2.4s 周期），减弱运动时保持常亮。
      const breath = this.frozen || reducedMotion ? 1 : .78 + .22 * Math.sin(time / 1000 * 2.6);
      for (const material of this.auraMaterials) material.opacity = material.userData.baseOpacity * breath;
      // 单位沿球面平滑趋近目标位置（复用临时向量，交战时几百个单位每帧不产生垃圾对象）。
      const amount = 1 - Math.exp(-dt * 12);
      const { from, to, up, rotation, identity } = this.motionScratch;
      for (const { group, target } of this.moving.values()) {
        if (group.position.distanceToSquared(target) < 1e-10) continue;
        const radius = target.length();
        from.copy(group.position).normalize(); to.copy(target).normalize();
        rotation.setFromUnitVectors(from, to).slerp(identity, 1 - amount);
        group.position.copy(from.applyQuaternion(rotation)).multiplyScalar(radius);
        up.set(0, 1, 0).applyQuaternion(group.quaternion);
        group.quaternion.premultiply(rotation.setFromUnitVectors(up, to.copy(group.position).normalize()));
      }
      this.composer.render();
    }
    this.frame = requestAnimationFrame(this.animate);
  };
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.hoverTimer);
    this.unsubscribeCommandMarkers();
    this.commandMarkers.dispose();
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
    this.conveyors.dispose();
    this.combat.dispose();
    this.spriteMaterials.forEach((material) => { material.map?.dispose(); material.dispose(); });
    this.spriteMaterials.clear();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => materials.add(m)); } });
    this.geometries.forEach((g) => geometries.add(g));
    this.materials.forEach((m) => materials.add(m));
    this.markMaterials.forEach((m) => materials.add(m));
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose());
    this.activity.destroy(); this.industrial.dispose(); disposePlanetSurface(this.surface); this.environment.dispose(); this.bloom.dispose(); this.composer.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); canvas.remove();
  }
}
