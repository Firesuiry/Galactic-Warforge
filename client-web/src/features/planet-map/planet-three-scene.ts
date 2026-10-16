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
import { tileNormal, tileQuad, normalTile, tileFrame, surfaceTileSize } from './three/projection';
import { ghostArrowGeometry, ghostArrowTransform } from './three/ghost-arrow';
import { createSurfaceDressing } from './three/surface-dressing';
import { createLocalSurface } from './three/local-surface';
import { IndustrialActivity } from './three/industrial-activity';
import { StaticBatches } from './three/static-batches';
import { DynamicBatches } from './three/dynamic-batches';
import { ConveyorGeometry } from './three/conveyor-geometry';
import { LogisticsDirectionMarks, directionArrowTexture, disposeLogisticsTextures } from './three/logistics-marks';
import { beltItemSpeedTilesPerSec } from './planet-logistics-flow';
import { logisticsArrows, stepTile, buildGhostDirection, isSorterBuilding, sorterGhostDirections, type CardinalDirection } from './logistics-direction';
import { logisticsFlightNormal } from './three/logistics-flight';
import { syncSorterAnimation } from './three/sorter-animation';
import { assessBuildTiles } from './build-workflow';
import { PointerPress } from './pointer-press';
import type { Building, CatalogView, FogMapView, ItemInventory, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView, Position, Unit } from '@shared/types';
import { getBuildingCatalogEntry, getBuildingFootprint, getFogState, getItemCatalogEntry, getItemDisplayName, getTerrainTile, type PlanetLayerVisibility, type PlanetRenderView, type SelectedEntity, type TilePoint } from './model';
import { getItemColorValue } from './item-colors';
import { isOwnStalledBuilding } from './power-status';
import { FACTION_COLOR, unitFaction, type UnitFaction } from './rts-commands';
import { describeAutoHaul, haulPhaseLabel, transportCargo, transportHaulMode, transportHaulTask } from './transport-haul';
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
/** 分拣器 ghost 的取货端（背面）箭头颜色：与放货端（琥珀）区分。 */
const GHOST_TAKE_COLOR = '#6ee7f7';
/** 建造 ghost 的默认箭头色（放货端 / 传送带流向）。 */
const GHOST_ARROW_COLOR = '#ffd76a';
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
  /** 左键按下/抬起与指针捕获（画布外抬起、捕获丢失等异常序列的兜底收尾）。 */
  private readonly press: PointerPress;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly industrial = new IndustrialModels();
  private readonly staticBatches = new StaticBatches();
  private readonly dynamicBatches = new DynamicBatches();
  private readonly conveyors = new ConveyorGeometry();
  /** 分拣器/分流器顶面方向箭头（全网络合并 1 draw）+ 过滤物品标签。 */
  private readonly logisticsMarks = new LogisticsDirectionMarks();
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
  /** 缺电/停机建筑头顶的 billboard 角标（试玩 1010 F）：按建筑 id 复用，随数据增删。 */
  private readonly powerAlertMarks = new Map<string, THREE.Sprite>();
  private readonly powerAlertMarksGroup = new THREE.Group();
  private staticMarksSignature = '';
  /** 地表标记共享材质（按颜色/透明度缓存，色带几何每次重建、材质复用）。 */
  private readonly markMaterials = new Map<string, THREE.MeshBasicMaterial>();
  /** 运输机器人往返路线（选中时画起点→终点虚线）：签名驱动的独立层。 */
  private readonly haulRoutes = new THREE.Group();
  private haulRouteSignature = '';
  /** 阶段胶囊标签：随机器人移动每帧重贴位置（只重建于路线签名变化时）。 */
  private haulLabels: { sprite: THREE.Sprite; unitId: string }[] = [];
  /** 补给光环材质：动画循环里做缓慢呼吸。 */
  private readonly auraMaterials = new Set<THREE.MeshBasicMaterial>();
  /** 右键/军团命令落点反馈（涟漪/准星）。 */
  private readonly commandMarkers = new CommandMarkerMeshes(this.world, tile => this.data ? this.normal(tile.x, tile.y) : null, RADIUS, () => this.tileScale());
  private readonly unsubscribeCommandMarkers = subscribeCommandMarkers(spec => { if (!this.destroyed) this.commandMarkers.spawn(spec); });
  /** 建造 ghost 朝向箭头（传送带/分拣器/带旋转的建筑）：跟随悬停格，2D/3D 同一套方向推导。 */
  private readonly ghostMarks = new THREE.Group();
  /** 拖拽铺带路径（PlanetMapThree 拖动时写入）：ghost 逐格显示方向，松手清空。 */
  private beltDragPath: TilePoint[] = [];

  setBeltDragPath(tiles: readonly TilePoint[] | null) {
    this.beltDragPath = tiles ? tiles.map(tile => ({ ...tile })) : [];
    this.updateBuildGhost();
  }
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
    this.world.add(this.powerAlertMarksGroup);
    this.world.add(this.logisticsMarks.group, this.ghostMarks, this.haulRoutes);
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
    this.press = new PointerPress(this.renderer.domElement, (event, tap) => {
      if (tap) { const tile = this.pick(event); if (tile) this.onPick(tile); }
    });
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerleave', this.pointerLeave);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    // 左键按下/抬起状态与指针捕获由 PointerPress 统一收尾（画布外抬起、捕获丢失、window blur
    // 都不会让按下状态粘住——粘住会让之后所有点击被当成拖拽，见 pointer-press.ts）。
    this.press.attach();
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

  /** 可见传送带的代表吞吐（视觉流速近似，与 2D 货物圆点同源）。 */
  private beltThroughput(): number {
    const buildings = this.data?.planet.buildings ?? {};
    let throughput = 0;
    for (const building of Object.values(buildings)) {
      if (!building.conveyor) continue;
      throughput = Math.max(throughput, building.conveyor.throughput ?? 1);
    }
    return throughput || 1;
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
    // 细分网格：模型局部单位 = 1 cell（`building(w, d)` 的 .86 就是格内留缝），
    // 场景侧只按 tileScale 统一缩放，不乘 footprint——否则 5×5 的 HQ 会被放大成 25 格。
    const visibleBuildings = Object.values(planet.buildings ?? {}).filter(building => building.owner_id === playerId || this.visible(building.position));
    this.conveyors.refresh(visibleBuildings, planet.surface.face_size, RADIUS);
    this.layer('buildings').add(this.conveyors.group);
    // 分拣器/分流器顶面箭头：方向取自服务端 sorter/splitter 配置，合并成 1 个 draw。
    this.logisticsMarks.refresh(visibleBuildings, planet.surface.face_size, RADIUS);
    this.logisticsMarks.refreshLabels(visibleBuildings, planet.surface.face_size, RADIUS, itemId => {
      const entry = getItemCatalogEntry(this.data?.catalog, itemId);
      const name = getItemDisplayName(this.data?.catalog, itemId);
      if (!name) return null;
      return { text: name.slice(0, 1), color: entry?.color || '#ffc76a' };
    });
    this.layer('logistics').add(this.logisticsMarks.group);
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
    this.syncPowerAlertMarks(visibleBuildings);
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
        // 细分网格：单位占 1 cell（士兵站在小格里，不再占旧的一大格），模型按 cell 的 .72 缩放。
        move(`unit:${unit.id}`, unit.type, faction, unit.position, 'units', .72);
        // 血条（C2）：头顶 billboard，受击比例实时更新，按阵营着色；中立黑雾头顶挂「中立」标签
        this.syncUnitBar(this.moving.get(`unit:${unit.id}`), unit, faction);
        // 运输机器人车顶货物方块：载货期间（装货/运送/卸货）都显示，颜色取物品配色表。
        const robot = this.moving.get(`unit:${unit.id}`)?.group.getObjectByName('transport-robot-cargo');
        if (robot instanceof THREE.Mesh) {
          const cargo = transportCargo(unit);
          robot.visible = Boolean(cargo);
          if (cargo) {
            // 货箱材质是这台机器人独有的（IndustrialModels.unit 里为运输机器人单独克隆），
            // 直接写色不会波及底盘/全场铜件——共享材质池被写色过一次，全场都会跟着变。
            const material = robot.material as THREE.MeshStandardMaterial;
            material.color.set(getItemColorValue(cargo.item_id, getItemCatalogEntry(this.data.catalog, cargo.item_id)?.color));
          }
        }
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

  /**
   * 缺电/停机建筑头顶的 billboard 角标（试玩 1010 F）：黄底黑闪电 + 红斜杠，
   * 与 2D 视图的缺电角标同一语义。己方建筑才画；随数据出现/消失。
   */
  private syncPowerAlertMarks(buildings: Building[]) {
    const playerId = this.data?.playerId;
    const material = this.powerAlertMaterial();
    const live = new Set<string>();
    for (const building of buildings) {
      if (!isOwnStalledBuilding(building, playerId ?? '')) continue;
      live.add(building.id);
      let sprite = this.powerAlertMarks.get(building.id);
      if (!sprite) {
        sprite = new THREE.Sprite(material);
        sprite.renderOrder = 23;
        this.powerAlertMarksGroup.add(sprite);
        this.powerAlertMarks.set(building.id, sprite);
      }
      // 角标按格宽取 0.42：与单位数量徽标同一量级，醒目但不盖住建筑本体。
      const mark = this.tileScale() * .42;
      sprite.scale.set(mark, mark, 1);
      const normal = this.normal(building.position.x, building.position.y);
      const height = Math.max(.8, getBuildingFootprint(building).height * .86);
      sprite.position.copy(normal).multiplyScalar(RADIUS + this.tileScale() * (height + .45));
    }
    for (const [id, sprite] of this.powerAlertMarks) {
      if (!live.has(id)) { sprite.removeFromParent(); this.powerAlertMarks.delete(id); }
    }
  }

  /** 缺电角标共享材质（懒建，destroy 时统一释放）。 */
  private powerAlertMaterial() {
    let material = this.spriteMaterials.get('power-alert');
    if (material) return material;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      const center = size / 2;
      context.beginPath();
      context.arc(center, center, size * 0.46, 0, Math.PI * 2);
      context.fillStyle = 'rgba(255, 176, 32, 0.95)';
      context.fill();
      context.lineWidth = size * 0.06;
      context.strokeStyle = 'rgba(18, 12, 4, 0.9)';
      context.stroke();
      const bolt = size * 0.56;
      context.beginPath();
      context.moveTo(center + 0.16 * bolt, center - 0.5 * bolt);
      context.lineTo(center - 0.24 * bolt, center + 0.04 * bolt);
      context.lineTo(center + 0.02 * bolt, center + 0.04 * bolt);
      context.lineTo(center - 0.14 * bolt, center + 0.5 * bolt);
      context.lineTo(center + 0.26 * bolt, center - 0.06 * bolt);
      context.lineTo(center, center - 0.06 * bolt);
      context.closePath();
      context.fillStyle = 'rgba(24, 16, 2, 0.96)';
      context.fill();
      context.lineCap = 'round';
      context.lineWidth = size * 0.1;
      context.strokeStyle = 'rgba(12, 8, 6, 0.9)';
      context.beginPath(); context.moveTo(size * 0.2, size * 0.82); context.lineTo(size * 0.84, size * 0.2); context.stroke();
      context.lineWidth = size * 0.055;
      context.strokeStyle = 'rgba(255, 86, 70, 0.98)';
      context.beginPath(); context.moveTo(size * 0.2, size * 0.82); context.lineTo(size * 0.84, size * 0.2); context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.spriteMaterials.set('power-alert', material);
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
    // 四角 = 相邻 cell 中心方向（tileQuad）：框就是 1 cell，不多不少。
    const loop = tileQuad(tile, size);
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
    // 选中建筑：按**整个占地**画选中框（细分网格后 3×3/5×5 建筑必须整块高亮，
    // 只框左上 1 cell 会让玩家以为选错了格）。
    if (this.interaction.layers.selection && this.interaction.selected?.kind === 'building') {
      const building = this.data.planet.buildings?.[this.interaction.selected.id];
      if (building) {
        const footprint = getBuildingFootprint(building);
        for (let dy = 0; dy < footprint.height; dy++) for (let dx = 0; dx < footprint.width; dx++) {
          add(surfaceOffset(building.position, dx, dy, this.data.planet.surface.face_size), '#ffd166');
        }
      }
    }
    // 运输机器人：选中时画起点→终点虚线（可一次多选，同一路线只画一条）。
    this.updateHaulRoutes();
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
    this.updateBuildGhost();
  }

  /** 建造预览的朝向箭头 + 拖拽铺带时每格路径方向。 */
  private updateBuildGhost() {
    this.clearMarks(this.ghostMarks);
    const mode = this.interaction?.interactionMode;
    const hovered = this.interaction?.hoveredTile;
    if (!this.data || !this.interaction || !mode || mode.kind !== 'build' || !hovered) return;
    // 分拣器：取（背面）→ 放（正面）两端箭头，方向由 rotation 决定（第 16 轮契约）。
    const sorterRoutes = sorterGhostDirections(mode.buildingType, mode.rotation);
    const direction = buildGhostDirection(mode.buildingType, mode.direction, mode.rotation);
    if (!direction && !sorterRoutes) return;
    // 拖拽铺带：整条路径逐格画方向；否则只画悬停格（分拣器 ghost 抬高一点压在顶面）。
    const tiles = mode.buildingType.startsWith('conveyor_belt') && this.beltDragPath.length > 0 ? this.beltDragPath : [hovered];
    const elevated = isSorterBuilding({ type: mode.buildingType });
    if (sorterRoutes) {
      // 取货端（背面）与放货端（正面）各缩到 0.62 并沿各自方向推离格心 0.26 格，
      // 两支箭头分开摆在前后半格——都压格心会糊成一个「叉」。
      for (const tile of tiles) {
        this.ghostArrow(tile, sorterRoutes.from, elevated, GHOST_TAKE_COLOR, .62, .26);
        this.ghostArrow(tile, sorterRoutes.to, elevated, GHOST_ARROW_COLOR, .62, .26);
      }
      return;
    }
    for (const tile of tiles) this.ghostArrow(tile, direction!, elevated);
  }

  /**
   * 运输机器人任务虚线：选中（单选或多选集合）的机器人若有当前任务（自动模式的
   * 派单任务或固定路线），画起点建筑 → 终点建筑的贴地虚线（同一条任务只画一次，
   * 颜色取机器人阵营色），并在机器人旁挂一颗中文胶囊（自动模式：「自动：送 铁矿 → 电弧熔炉」）。
   * 签名只含端点、阵营与文案，数据刷新不重建几何。
   */
  private updateHaulRoutes() {
    const planet = this.data?.planet;
    const interaction = this.interaction;
    if (!planet || !interaction || !interaction.layers.selection) {
      if (this.haulRouteSignature !== '') { this.clearMarks(this.haulRoutes); this.haulRouteSignature = ''; this.haulLabels = []; }
      return;
    }
    const selectedIds = new Set<string>(interaction.selectedUnits ?? []);
    if (interaction.selected?.kind === 'unit') selectedIds.add(interaction.selected.id);
    const routes: { from: Position | null; to: Position; color: string; label: string; unitId: string }[] = [];
    const seen = new Set<string>();
    for (const id of selectedIds) {
      const unit = planet.units?.[id];
      const task = transportHaulTask(unit);
      if (!task || !unit) continue;
      const key = `${task.from_building_id}->${task.to_building_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const to = planet.buildings?.[task.to_building_id];
      if (!to) continue;
      // 自动模式车上带货改派时没有取货端：只画终点与胶囊。
      const from = task.from_building_id ? planet.buildings?.[task.from_building_id] : undefined;
      if (task.from_building_id && !from) continue;
      const mode = transportHaulMode(unit);
      const label = mode === 'auto'
        ? describeAutoHaul(unit, (itemId) => this.data?.catalog?.items?.find((item) => item.id === itemId)?.name ?? itemId,
            (buildingId) => {
              const building = planet.buildings?.[buildingId];
              return building ? this.data?.catalog?.buildings?.find((entry) => entry.id === building.type)?.name ?? building.type : undefined;
            })
        : haulPhaseLabel(task.phase);
      routes.push({
        from: from ? from.position : null,
        to: to.position,
        color: `#${FACTION_COLOR[unitFaction(unit, this.data?.playerId, this.data?.darkFogHostile ?? false)].toString(16).padStart(6, '0')}`,
        label,
        unitId: id,
      });
    }
    const signature = JSON.stringify(routes.map(route => [route.from?.x ?? -1, route.from?.y ?? -1, route.to.x, route.to.y, route.color, route.label]));
    if (signature === this.haulRouteSignature) return;
    this.haulRouteSignature = signature;
    this.clearMarks(this.haulRoutes);
    this.haulLabels = [];
    const size = this.tileScale();
    for (const route of routes) {
      const b = this.normal(route.to.x, route.to.y);
      if (route.from) {
        const a = this.normal(route.from.x, route.from.y);
        // 贴地弧线：沿球面插值并抬 0.12 格，避免埋进地形/建筑底座。
        const points = Array.from({ length: 33 }, (_, i) => a.clone().lerp(b, i / 32).normalize().multiplyScalar(RADIUS + size * .12));
        // 虚线：LineDashedMaterial 需要 computeLineDistances，段长按 cell 尺寸给。
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({
          color: route.color, dashSize: size * .55, gapSize: size * .35, transparent: true, opacity: .95, depthWrite: false, toneMapped: false,
        }));
        line.computeLineDistances();
        line.renderOrder = 18;
        this.haulRoutes.add(line);
      }
      // 端点建筑占地框：有取货端就框两端，改派任务只框终点。
      const endpoints = route.from ? [route.from, route.to] : [route.to];
      for (const endpoint of endpoints) {
        this.haulRoutes.add(this.tileOutline({ x: Math.round(endpoint.x), y: Math.round(endpoint.y) }, route.color));
      }
      // 任务中文（自动模式「自动：送 铁矿 → 电弧熔炉」/ 固定路线阶段）：机器人旁的小号
      // 胶囊标签（字号与单位名牌同量级）；位置每帧跟着机器人走（见 updateHaulLabels）。
      if (route.label) {
        const sprite = new THREE.Sprite(this.haulLabelMaterial(route.label));
        sprite.renderOrder = 24;
        // 胶囊锚点在左端：贴着机器人向右展开，像单位名牌一样不盖住机器人本体。
        sprite.center.set(0, .5);
        sprite.scale.set(size * Math.max(.64, route.label.length * .19), size * .16, 1);
        this.haulRoutes.add(sprite);
        this.haulLabels.push({ sprite, unitId: route.unitId });
      }
    }
    this.updateHaulLabels();
  }

  /** 阶段标签跟随机器人（移动组每帧插值，标签也每帧贴到它头顶右侧）。 */
  private updateHaulLabels() {
    if (this.haulLabels.length === 0) return;
    const size = this.tileScale();
    for (const { sprite, unitId } of this.haulLabels) {
      const group = this.moving.get(`unit:${unitId}`)?.group;
      if (!group) { sprite.visible = false; continue; }
      sprite.visible = true;
      // 高度对齐单位名牌（血条 0.73 cell、中立标签 0.92 cell），贴在机器人右上方。
      sprite.position.copy(group.position).normalize().multiplyScalar(RADIUS + size * .95);
    }
  }

  /** 阶段标签共享材质：按文本缓存（阶段只有 6 种，画布一次）。 */
  private haulLabelMaterial(text: string) {
    const key = `haul-label:${text}`;
    const cached = this.spriteMaterials.get(key);
    if (cached) return cached;
    // 画布比例 16:4 = 世界 0.64×0.16 cell；字号占画布高约 45%，
    // 与 3D 单位名牌（0.6×0.25 cell 的「中立」标签）同一量级。
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'rgba(10, 22, 26, 0.86)';
      context.strokeStyle = 'rgba(145, 255, 112, 0.9)';
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect?.(3, 3, 250, 58, 14);
      context.fill();
      context.stroke();
      context.font = '600 30px "PingFang SC", "Microsoft YaHei", sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#dffcf6';
      context.fillText(text, 128, 34);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    this.spriteMaterials.set(key, material);
    return material;
  }

  /**
   * 一个朝 direction 的箭头（贴格中心，指示物流输出侧）；分拣器取货端用另一色区分。
   * `scale` 缩小整支箭头、`along` 沿 direction 把箭头推离格心——分拣器用这两个参数把
   * 「背面取货 / 正面放货」两支箭头分开摆在格子的前后半格，叠在格心只会糊成一个叉。
   * 平铺姿态与四向可见性见 `three/ghost-arrow`（PlaneGeometry 不转就会立起来侧对相机）。
   */
  private ghostArrow(
    tile: TilePoint,
    direction: CardinalDirection,
    elevated = false,
    color = '#ffd76a',
    scale = 1,
    along = 0,
  ) {
    const size = this.tileScale();
    const mesh = new THREE.Mesh(
      ghostArrowGeometry(size, scale),
      new THREE.MeshBasicMaterial({ map: directionArrowTexture(), color, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    const { position, quaternion } = ghostArrowTransform(tile, direction, this.data!.planet.surface.face_size, RADIUS, {
      size,
      lift: elevated ? .18 : .1,
      along,
    });
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    mesh.renderOrder = 20;
    this.ghostMarks.add(mesh);
  }

  focus(tile: TilePoint, close = true) {
    if (!this.data) return;
    this.world.quaternion.setFromUnitVectors(this.normal(tile.x, tile.y), FRONT);
    this.groundView = true;
    // 聚焦高度按格宽定：约 16 格高时地面视角能看清半径 ~15 格（建筑仍可辨），
    // 旧的 9 格只看得到 5 格内，远一点的格子都点不到（试玩 1011 D）。
    this.altitude = close ? Math.min(75, Math.max(this.tileScale() * 16, .08)) : Math.min(75, Math.max(this.tileScale() * 18, .1));
    this.updateCamera();
  }
  orbit() { this.groundView = false; this.altitude = 300; this.updateCamera(); }
  /** 是否处于地面视角（全球视角下不需要「未探索区域」这类贴地提示）。 */
  isGroundView() { return this.groundView; }
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
  private pick(event: { clientX: number; clientY: number }) {
    return this.pickAtCoords(event.clientX, event.clientY);
  }
  private pointerMove = (event: PointerEvent) => {
    const press = this.press.press;
    if (press) {
      const dx = event.clientX - press.x, dy = event.clientY - press.y;
      if (Math.abs(dx) + Math.abs(dy) > 3 || press.moved) {
        this.press.markMoved(event.clientX, event.clientY);
        const sensitivity = Math.min(0.006, this.altitude / Math.max(this.host.clientHeight, 1) / RADIUS * 0.9);
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * sensitivity, dx * sensitivity, 0));
        this.world.quaternion.premultiply(rotation);
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
    if (this.destroyed || !this.hoverPoint || this.press.press?.moved) return;
    this.emitHover(this.pickAtCoords(this.hoverPoint.x, this.hoverPoint.y));
  };
  private emitHover(tile: TilePoint | null) {
    if (tile?.x === this.lastHover?.x && tile?.y === this.lastHover?.y) return;
    this.lastHover = tile;
    this.onHover(tile);
  }
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
      // 传送带流向箭头沿带滚动：速度与 2D 货物圆点同一口径；无货/冻结时静止。
      this.conveyors.update(
        this.frozen || reducedMotion ? 0 : dt,
        this.frozen || reducedMotion || !(this.interaction?.layers.logistics ?? true) ? 0 : beltItemSpeedTilesPerSec(this.beltThroughput()),
      );
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
      // 阶段标签贴机器人（机器人移动是每帧插值的，标签跟着走才不脱节）。
      this.updateHaulLabels();
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
    this.press.detach();
    canvas.removeEventListener('pointermove', this.pointerMove);
    canvas.removeEventListener('pointerleave', this.pointerLeave);
    canvas.removeEventListener('wheel', this.wheel);
    this.staticBatches.dispose();
    this.dynamicBatches.dispose();
    this.conveyors.dispose();
    this.logisticsMarks.dispose();
    this.clearMarks(this.ghostMarks);
    this.ghostMarks.removeFromParent();
    disposeLogisticsTextures();
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
