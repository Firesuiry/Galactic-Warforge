import { create } from 'zustand';

import type { AlertEntry, GameEventDetail, WarTheaterZoneType } from '@shared/types';
import type { Direction } from '@shared/api';
import type { SseStatus } from '@shared/sse';

import type { PlanetLayerKey, SelectedEntity, TilePoint } from '@/features/planet-map/model';
import { mergeRecentAlerts, mergeRecentEvents } from '@/features/planet-map/model';

/**
 * 需要点选目标的单位指令模式（A 攻击移动 / P 巡逻 / G 守卫）。
 * 进入 unit_order 模式后点地/点目标即对当前选中单位下达对应 unit_order 命令。
 */
export type UnitOrderMode = 'attack_move' | 'patrol' | 'guard';

/**
 * 地图交互模式：决定地图点击的语义。
 * - inspect：默认，点选查看详情；有单位选中时右键=情境指令（点地移动/点敌攻击）
 * - build：建造模式，悬停显示幽灵 footprint，点击直接下达建造命令
 * - move：为当前选中单位（store.selectedUnits）选择移动目标点
 * - attack：为当前选中单位选择攻击目标
 * - unit_order：为当前选中单位选择 attack_move/patrol/guard 的目标点/目标实体
 * - haul（§4 运输机器人）：依次点起点建筑、终点建筑，选好物品后确认发 unit_order haul
 * - squad_order（3.4）：为军团选择 attack/defend/retreat 的目标点
 * - theater_zone（C4）：战区划定模式，左键拖拽矩形 → theater_define_zone（圆心+半径）
 */
export type PlanetInteractionMode =
  | { kind: 'inspect' }
  | { kind: 'build'; buildingType: string; recipeId?: string; direction: Direction; rotation?: 0 | 90 | 180 | 270 }
  | { kind: 'move' }
  | { kind: 'attack' }
  | { kind: 'unit_order'; order: UnitOrderMode }
  | { kind: 'haul'; fromBuildingId?: string; toBuildingId?: string; itemId?: string }
  | { kind: 'squad_order'; squadId: string; order: 'attack' | 'defend' | 'retreat' }
  | { kind: 'theater_zone'; theaterId: string; zoneType: WarTheaterZoneType };

export const INSPECT_MODE: PlanetInteractionMode = { kind: 'inspect' };

export interface PlanetZoomLevel {
  label: string;
  mode: 'overview' | 'scene';
  scale: number;
  overviewStep?: number;
  tileSize?: number;
}

/**
 * 缩放档（§4 细分网格后按 **cell** 重排）。
 *
 * 服务端 1 格 = 3×3 cell，因此同一视觉尺寸下 px/cell 只有旧 px/tile 的 1/3：
 * 旧默认 48px/tile 的观感 = 16px/cell。档位整体重排后：
 * - 概览档标签按 cell 记（1px/300cell ≈ 旧 1px/100tile）；
 * - scene 档从 1px/cell（远景）到 32px/cell（近景，1 cell = 32px，3×3 建筑 96px）。
 * 默认/回家档 = 16px/cell（建筑约 48px，传送带一格 16px，接近戴森球计划比例）。
 */
export const PLANET_ZOOM_LEVELS: PlanetZoomLevel[] = [
  {
    label: '1px/300cell',
    mode: 'overview',
    scale: 0.01,
    overviewStep: 300,
  },
  {
    label: '1px/60cell',
    mode: 'overview',
    scale: 0.05,
    overviewStep: 60,
  },
  {
    label: '1px/12cell',
    mode: 'overview',
    scale: 0.25,
    overviewStep: 12,
  },
  {
    label: '1px',
    mode: 'scene',
    scale: 1,
    tileSize: 1,
  },
  {
    label: '2px',
    mode: 'scene',
    scale: 2,
    tileSize: 2,
  },
  {
    label: '4px',
    mode: 'scene',
    scale: 4,
    tileSize: 4,
  },
  {
    label: '8px',
    mode: 'scene',
    scale: 8,
    tileSize: 8,
  },
  {
    label: '16px',
    mode: 'scene',
    scale: 16,
    tileSize: 16,
  },
  {
    label: '24px',
    mode: 'scene',
    scale: 24,
    tileSize: 24,
  },
  {
    label: '32px',
    mode: 'scene',
    scale: 32,
    tileSize: 32,
  },
];
/**
 * 默认缩放档：PLANET_ZOOM_LEVELS[7] = 16px/cell。
 * 1 cell 是传送带/单位的最小件，16px 时 3×3 熔炉 48px、5×5 HQ 80px，
 * 与旧「48px/tile」的观感一致（旧 1 tile = 新 3 cell）。
 */
export const DEFAULT_PLANET_ZOOM_INDEX = 7;
/** 概览双击进入 scene 的落点档：与回家档一致（16px/cell）。 */
export const DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX = DEFAULT_PLANET_ZOOM_INDEX;
/** "回家"视角缩放档：PLANET_ZOOM_LEVELS[7] = 16px/cell，大行星首次进入/⌂ 聚焦基地时使用。 */
export const PLANET_HOME_ZOOM_INDEX = 7;
/**
 * requestFocus 缩放哨兵：由渲染侧按"视口 × 地图尺寸"自适应选档（resolvePlanetFitZoomIndex）。
 * 小行星整图放大到 60-80% 占屏，大行星回落"回家"档（行为不变）。
 */
export const PLANET_FOCUS_FIT_ZOOM = -1;
/** 自适应选档的目标占屏比：地图内容占视口短边 ~70%（可接受区间 60-80%）。 */
export const PLANET_FIT_TARGET_OCCUPANCY = 0.7;
/**
 * 首次进入时的「能看清产线」下限（px/cell）。
 *
 * 试玩 1015 §6-7：288×288 的遭遇战行星在 16px/cell 回家档下整图 4608px，
 * 远超视口，只能看到基地附近十几格；整图缩到 70% 占屏要 ~3px/cell，
 * 那时 3×3 建筑只有 9px，看不清是什么。首次进入的取景目标是「基地 + 周围
 * 一屏产线」，所以选档优先保证每格至少这么多像素。
 */
export const MIN_PLANET_HOME_FOCUS_TILE_SIZE = 16;
/** scene 档缺省 cell 边长（px/cell），与默认缩放档一致。 */
export const DEFAULT_PLANET_SCENE_TILE_SIZE = 16;
export const MAX_PLANET_OVERVIEW_CELLS_PER_AXIS = 128;
/**
 * scene 档单轴可见 cell 上限。
 *
 * 细网格下面宽 288 cell（旧 96 tile），视口 1440px 时 16px/cell 正好 90 cell 全宽入画；
 * 再放大一档（24/32px）就要靠 /scene 窗口取景，窗口越小边缘实体越晚出现。
 * 320 保留「整面铺满 + 少量余量」的余量，同时把低分辨率档（1px/cell）的 /scene 请求
 * 限制在 320×320（服务端 maxSceneWindowSize=257 会自行再钳一次）。
 */
export const MAX_PLANET_SCENE_TILES_PER_AXIS = 320;

export function getPlanetZoomLevel(zoomIndex: number) {
  return PLANET_ZOOM_LEVELS[Math.min(Math.max(zoomIndex, 0), PLANET_ZOOM_LEVELS.length - 1)] ?? PLANET_ZOOM_LEVELS[DEFAULT_PLANET_ZOOM_INDEX];
}

export function getPlanetZoomScale(zoomIndex: number) {
  return getPlanetZoomLevel(zoomIndex).scale;
}

export function getPlanetZoomLabel(zoomIndex: number) {
  return getPlanetZoomLevel(zoomIndex).label;
}

export function getPlanetOverviewRequestStep(
  zoomIndex: number,
  mapWidth: number,
  mapHeight: number,
) {
  const zoomLevel = getPlanetZoomLevel(zoomIndex);
  if (zoomLevel.mode !== 'overview') {
    return undefined;
  }

  const requestedStep = Math.max(zoomLevel.overviewStep ?? 100, 1);
  if (mapWidth <= 0 || mapHeight <= 0) {
    return requestedStep;
  }

  const protectedStep = Math.max(
    Math.ceil(mapWidth / MAX_PLANET_OVERVIEW_CELLS_PER_AXIS),
    Math.ceil(mapHeight / MAX_PLANET_OVERVIEW_CELLS_PER_AXIS),
    1,
  );
  return Math.max(requestedStep, protectedStep);
}

export function getPlanetZoomStatusLabel(
  zoomIndex: number,
  mapWidth: number,
  mapHeight: number,
) {
  const zoomLevel = getPlanetZoomLevel(zoomIndex);
  if (zoomLevel.mode !== 'overview') {
    return zoomLevel.label;
  }

  const actualStep = getPlanetOverviewRequestStep(zoomIndex, mapWidth, mapHeight);
  if (!actualStep || actualStep === zoomLevel.overviewStep) {
    return zoomLevel.label;
  }
  return `${zoomLevel.label} (实际 1px/${actualStep}cell)`;
}

export function isPlanetOverviewZoom(zoomIndex: number) {
  return getPlanetZoomLevel(zoomIndex).mode === 'overview';
}

export function getPlanetRenderTileSize(
  zoomIndex: number,
  viewportWidth: number,
  viewportHeight: number,
  mapWidth: number,
  mapHeight: number,
) {
  const zoomLevel = getPlanetZoomLevel(zoomIndex);
  if (zoomLevel.mode === 'overview') {
    return Math.max(
      Math.min(
        viewportWidth / Math.max(mapWidth, 1),
        viewportHeight / Math.max(mapHeight, 1),
      ),
      0.01,
    );
  }

  const requestedTileSize = zoomLevel.tileSize ?? DEFAULT_PLANET_SCENE_TILE_SIZE;
  const protectedTileSize = Math.max(
    Math.ceil(viewportWidth / MAX_PLANET_SCENE_TILES_PER_AXIS),
    Math.ceil(viewportHeight / MAX_PLANET_SCENE_TILES_PER_AXIS),
    1,
  );
  return Math.max(requestedTileSize, protectedTileSize);
}

export function resolvePlanetZoomIndex(scale: number) {
  return PLANET_ZOOM_LEVELS.reduce((bestIndex, currentZoom, index) => (
    Math.abs(currentZoom.scale - scale) < Math.abs(PLANET_ZOOM_LEVELS[bestIndex].scale - scale)
      ? index
      : bestIndex
  ), DEFAULT_PLANET_ZOOM_INDEX);
}

/**
 * 小行星初始相机自适应选档（PLANET_FOCUS_FIT_ZOOM 的结算）：
 * - 大行星（整图放不进视口）行为不变，直接返回 fallback（回家档 16px/cell）；
 * - 小图在"整图可入视口、且每格 ≥ MIN_PLANET_HOME_FOCUS_TILE_SIZE"的 scene 档中，
 *   挑选占屏比（max(世界宽/视口宽, 世界高/视口高)）最接近 70% 的一档——
 *   离散翻倍档位无法精确命中 60-80% 区间时取最近可行解；
 * - 视口/地图尺寸异常时返回 fallback。
 */
export function resolvePlanetFitZoomIndex(
  viewportWidth: number,
  viewportHeight: number,
  mapWidth: number,
  mapHeight: number,
  fallbackZoomIndex = PLANET_HOME_ZOOM_INDEX,
) {
  if (viewportWidth <= 0 || viewportHeight <= 0 || mapWidth <= 0 || mapHeight <= 0) {
    return fallbackZoomIndex;
  }
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < PLANET_ZOOM_LEVELS.length; index += 1) {
    if (PLANET_ZOOM_LEVELS[index].mode !== 'scene') {
      continue;
    }
    const tileSize = getPlanetRenderTileSize(index, viewportWidth, viewportHeight, mapWidth, mapHeight);
    const worldWidth = mapWidth * tileSize;
    const worldHeight = mapHeight * tileSize;
    // 必须整图入视口（不触发环绕/裁切）；低于可读下限的档一律不选——整图缩到
    // 70% 占屏的档在 288×288 行星上是 3px/cell，3×3 建筑只有 9px，看不清（1015 §6-7）。
    if (worldWidth > viewportWidth || worldHeight > viewportHeight) {
      continue;
    }
    if (tileSize < MIN_PLANET_HOME_FOCUS_TILE_SIZE) {
      continue;
    }
    const occupancy = Math.max(worldWidth / viewportWidth, worldHeight / viewportHeight);
    const score = Math.abs(occupancy - PLANET_FIT_TARGET_OCCUPANCY);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  // 小图：选「整图入视口且每格 ≥ 16px」里最接近 70% 占屏的一档。
  if (bestIndex >= 0) {
    return bestIndex;
  }
  // 大行星（回家档下整图已超视口）：固定回家档，取景交给 base 聚焦 + 围绕视口的场景窗口
  // （16px/cell：3×3 熔炉 48px、5×5 HQ 80px，与旧「48px/tile」观感一致）。
  return fallbackZoomIndex;
}

export interface PlanetSceneWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 主地图画布的像素视口与当前 tile 边长。
 * 由 PlanetMapPixi 写入（仅在 resize/zoom 时变更），供 minimap 等页级组件
 * 计算视口矩形而不必嵌进 PlanetMapPixi 内部（保持拖拽热路径隔离）。
 */
export interface PlanetMapProjection {
  viewportWidth: number;
  viewportHeight: number;
  tileSize: number;
}

export interface PlanetLayerState {
  terrain: boolean;
  resources: boolean;
  buildings: boolean;
  units: boolean;
  fog: boolean;
  grid: boolean;
  selection: boolean;
  logistics: boolean;
  power: boolean;
  pipelines: boolean;
  construction: boolean;
  threat: boolean;
}

export interface PlanetCameraState {
  offsetX: number;
  offsetY: number;
  zoomIndex: number;
  ready: boolean;
}

interface FocusRequest {
  nonce: number;
  position: TilePoint;
  /** 聚焦时一并切到的缩放档（PLANET_FOCUS_FIT_ZOOM = 小行星自适应占屏）；缺省保持当前档。 */
  zoomIndex?: number;
}

/** 黑雾袭击预警（enemy_wave_incoming，E3）：小地图红线/主图标记/警报跳转共用。 */
export interface IncomingWave {
  /** 来源事件 id（去重键）。 */
  id: string;
  nestId: string;
  from: TilePoint;
  target: TilePoint | null;
  count: number;
  level: number;
  /** 本地记录时间（Date.now 时基），超时自动清理。 */
  at: number;
}

/** 来袭波次在图上的保留时长（ms）：足够玩家发现但不长期占位。 */
export const INCOMING_WAVE_TTL_MS = 45_000;
/** 编队数量上限（Ctrl+1..9）。 */
export const CONTROL_GROUP_COUNT = 9;

/**
 * 底部快捷栏收起态的持久化键。
 * 它是玩家的显示偏好而不是对局状态：刷新页面 / 切行星都不该弹回来，
 * 也不能像以前那样由「抽屉打开」单向下压后永久留在收起态。
 */
const BUILD_BAR_DOCKED_KEY = 'siliconworld-build-bar-docked';

function readDockedPreference(): boolean {
  try {
    return window.localStorage.getItem(BUILD_BAR_DOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDockedPreference(docked: boolean): void {
  try {
    window.localStorage.setItem(BUILD_BAR_DOCKED_KEY, docked ? '1' : '0');
  } catch {
    // 隐私模式等场景下忽略持久化失败
  }
}

/**
 * 缩放请求：所有缩放入口（滚轮/±按钮/档位按钮/快捷键）的统一通道。
 * anchor 为视口内像素坐标（zoom-to-cursor 锚点）；null = 视口中心。
 * 数据层档位仍是离散的（zoomIndex 立即落库），渲染层由 Pixi 场景做补间。
 */
interface ZoomRequest {
  nonce: number;
  zoomIndex: number;
  anchor: TilePoint | null;
}

interface PlanetViewState {
  planetId: string;
  layers: PlanetLayerState;
  camera: PlanetCameraState;
  sceneWindow: PlanetSceneWindow;
  hoveredTile: TilePoint | null;
  selected: SelectedEntity | null;
  /** 多选单位集合（命令目标：框选/编队/双击同类的结果；单选单位时长度=1）。 */
  selectedUnits: string[];
  /** 多选战斗小队集合（C4：combat_squads id 列表；右键部署/单位卡片的数据源）。 */
  selectedSquads: string[];
  /** Ctrl+1..9 编队（键位 1..9 → 单位 id 列表；成员可能已阵亡，消费侧按 planet 过滤）。 */
  controlGroups: Record<number, string[]>;
  /** 黑雾袭击预警（未过期）。 */
  incomingWaves: IncomingWave[];
  interactionMode: PlanetInteractionMode;
  recentEvents: GameEventDetail[];
  recentAlerts: AlertEntry[];
  sseStatus: SseStatus;
  lastEventId: string;
  lastFullSyncAt: number | null;
  debugOpen: boolean;
  /**
   * 调试模式（默认关闭）：控制左下图标列里的「调试」图标是否渲染。
   * 调试面板与图标都默认隐藏，Ctrl+Shift+D 切换（见 use-planet-rts-hotkeys）；
   * 不持久化——调试是会话内的临时视图，刷新后回到默认隐藏。
   */
  debugMode: boolean;
  /**
   * 底部快捷栏是否收起为一行把手（覆盖式抽屉打开时避免遮挡抽屉底部；
   * 也用于玩家手动收起）。持久化到 localStorage：它是玩家的显示偏好，
   * 刷新页面不该弹回来。
   */
  buildBarDocked: boolean;
  /** 桌面端是否展开分类页签（DSP 式快捷栏：收起只留一行图标格）。 */
  buildBarCategoriesOpen: boolean;
  /**
   * 个人制造（手搓）下拉框选中的配方 id。
   *
   * 存在 store 而不是 MechaControls 的 useState：详情面板会随「选中单位是否落在
   * 场景窗口内」卸载重挂，组件内 state 会丢，下拉框于是跳回第一个可用配方，
   * 玩家刚选的配方连同「开始制造」一起失效（试玩 1013 bug-1013-2）。
   */
  craftRecipeId: string;
  focusRequest: FocusRequest | null;
  zoomRequest: ZoomRequest | null;
  mapProjection: PlanetMapProjection;
  /**
   * 玩家的「家」（HQ 优先，见 resolveHomeTile），由行星页按**跨窗口累积**的己方实体算出。
   * 场景查询只返回镜头窗口内的实体：镜头在荒郊时窗口里没有基地，「聚焦基地/回到基地」
   * 若只看窗口数据就无家可回（试玩 1011 A）。
   */
  homeTile: TilePoint | null;
}

interface PlanetViewActions {
  resetForPlanet: (planetId: string) => void;
  resetCamera: () => void;
  toggleLayer: (layer: PlanetLayerKey) => void;
  setHoveredTile: (tile: TilePoint | null) => void;
  /** 收起/展开底部快捷栏（收起后只留一行把手）。 */
  setBuildBarDocked: (docked: boolean) => void;
  /** 展开/收起快捷栏的分类页签行（只影响桌面端布局）。 */
  setBuildBarCategoriesOpen: (open: boolean) => void;
  /** 记录玩家在手搓下拉框里选中的配方（跨详情面板卸载保留）。 */
  setCraftRecipeId: (recipeId: string) => void;
  setSelected: (selection: SelectedEntity | null) => void;
  /** 设置多选单位（框选/编队/双击同类；调用侧负责过滤己方与存活）。 */
  setSelectedUnits: (unitIds: string[]) => void;
  /** 设置多选战斗小队（C4：点选/列表选择；与 selectedUnits 互斥——选小队时清单位）。 */
  setSelectedSquads: (squadIds: string[]) => void;
  /** 记录 Ctrl+数字编队（index 1..9；空数组表示清除该编队）。 */
  setControlGroup: (index: number, unitIds: string[]) => void;
  /** 记录一条黑雾袭击预警（按事件 id 去重，超时条目顺带清理）。 */
  recordIncomingWave: (wave: IncomingWave) => void;
  setInteractionMode: (mode: PlanetInteractionMode) => void;
  /** 退出当前交互模式回到 inspect（Esc/右键）。 */
  exitInteractionMode: () => void;
  setCamera: (camera: Partial<PlanetCameraState>) => void;
  setSceneWindow: (sceneWindow: PlanetSceneWindow) => void;
  setLayers: (layers: Partial<PlanetLayerState>) => void;
  setZoomIndex: (zoomIndex: number) => void;
  setSseStatus: (status: SseStatus) => void;
  setLastEventId: (eventId: string) => void;
  markFullSync: () => void;
  hydrateRecentEvents: (events: GameEventDetail[]) => void;
  appendRecentEvent: (event: GameEventDetail) => void;
  hydrateRecentAlerts: (alerts: AlertEntry[]) => void;
  appendRecentAlert: (alert: AlertEntry) => void;
  toggleDebugOpen: () => void;
  /** 调试模式开关（Ctrl+Shift+D）：开启时同时展开调试面板。 */
  toggleDebugMode: () => void;
  requestFocus: (position: TilePoint, zoomIndex?: number) => void;
  consumeFocusRequest: (nonce: number) => void;
  setHomeTile: (tile: TilePoint | null) => void;
  /** 请求切到指定缩放档（anchor=null 时以视口中心为锚）。 */
  requestZoom: (zoomIndex: number, anchor?: TilePoint | null) => void;
  consumeZoomRequest: (nonce: number) => void;
  setMapProjection: (projection: PlanetMapProjection) => void;
}

export type PlanetViewStore = PlanetViewState & PlanetViewActions;

function createDefaultLayers(): PlanetLayerState {
  return {
    terrain: true,
    resources: true,
    buildings: true,
    units: true,
    fog: true,
    grid: false,
    selection: true,
    logistics: true,
    power: false,
    pipelines: false,
    construction: true,
    threat: false,
  };
}

function createDefaultCamera(): PlanetCameraState {
  return {
    offsetX: 0,
    offsetY: 0,
    zoomIndex: DEFAULT_PLANET_ZOOM_INDEX,
    ready: false,
  };
}

function createDefaultSceneWindow(): PlanetSceneWindow {
  return {
    x: 0,
    y: 0,
    width: 160,
    height: 160,
  };
}

/**
 * 对局身份/行星切换时的重置。
 *
 * 快捷栏收起态（buildBarDocked）是**显示偏好**而不是对局状态：它持久化在
 * localStorage，读档/换局/切行星都不该把它复位——否则玩家手动收起的快捷栏
 * 会在每次换局时弹回来。因此这里显式沿用当前值（createInitialState 读的是
 * 初始加载时的偏好快照）。
 */
function resetKeepingPreferences(planetId: string): PlanetViewState {
  return {
    ...createInitialState(planetId),
    buildBarDocked: usePlanetViewStore.getState().buildBarDocked,
  };
}

function createInitialState(planetId = ''): PlanetViewState {
  return {
    planetId,
    layers: createDefaultLayers(),
    camera: createDefaultCamera(),
    sceneWindow: createDefaultSceneWindow(),
    hoveredTile: null,
    selected: null,
    selectedUnits: [],
    selectedSquads: [],
    controlGroups: {},
    incomingWaves: [],
    interactionMode: INSPECT_MODE,
    recentEvents: [],
    recentAlerts: [],
    sseStatus: 'idle',
    lastEventId: '',
    lastFullSyncAt: null,
    debugOpen: false,
    debugMode: false,
    buildBarDocked: readDockedPreference(),
    buildBarCategoriesOpen: true,
    craftRecipeId: '',
    focusRequest: null,
    zoomRequest: null,
    mapProjection: { viewportWidth: 0, viewportHeight: 0, tileSize: 0 },
    homeTile: null,
  };
}

export const usePlanetViewStore = create<PlanetViewStore>()((set) => ({
  ...createInitialState(),
  resetForPlanet: (planetId) => {
    set(resetKeepingPreferences(planetId));
  },
  resetCamera: () => {
    set((state) => ({
      camera: {
        ...createDefaultCamera(),
        zoomIndex: state.camera.zoomIndex,
      },
    }));
  },
  toggleLayer: (layer) => {
    set((state) => ({
      layers: {
        ...state.layers,
        [layer]: !state.layers[layer],
      },
    }));
  },
  setHoveredTile: (hoveredTile) => {
    set({ hoveredTile });
  },
  setBuildBarDocked: (buildBarDocked) => {
    writeDockedPreference(buildBarDocked);
    set({ buildBarDocked });
  },
  setBuildBarCategoriesOpen: (buildBarCategoriesOpen) => {
    set({ buildBarCategoriesOpen });
  },
  setCraftRecipeId: (craftRecipeId) => {
    set({ craftRecipeId });
  },
  setSelected: (selected) => {
    set({ selected });
  },
  setSelectedUnits: (unitIds) => {
    set((state) => (
      state.selectedUnits.length === unitIds.length
      && state.selectedUnits.every((id, index) => id === unitIds[index])
        ? state
        // 单位与小队选择互斥：框选/编队单位时清空小队选择（右键语义唯一）。
        : { selectedUnits: unitIds, selectedSquads: [] }
    ));
  },
  setSelectedSquads: (squadIds) => {
    set((state) => (
      state.selectedSquads.length === squadIds.length
      && state.selectedSquads.every((id, index) => id === squadIds[index])
        ? state
        : { selectedSquads: squadIds, selectedUnits: [] }
    ));
  },
  setControlGroup: (index, unitIds) => {
    set((state) => {
      const controlGroups = { ...state.controlGroups };
      if (unitIds.length === 0) {
        delete controlGroups[index];
      } else {
        controlGroups[index] = unitIds;
      }
      return { controlGroups };
    });
  },
  recordIncomingWave: (wave) => {
    set((state) => {
      if (state.incomingWaves.some((entry) => entry.id === wave.id)) {
        return state;
      }
      const alive = state.incomingWaves.filter((entry) => wave.at - entry.at < INCOMING_WAVE_TTL_MS);
      return { incomingWaves: [...alive, wave].slice(-8) };
    });
  },
  setInteractionMode: (interactionMode) => {
    set({ interactionMode });
  },
  exitInteractionMode: () => {
    set({ interactionMode: INSPECT_MODE });
  },
  setCamera: (camera) => {
    set((state) => ({
      camera: {
        ...state.camera,
        ...camera,
      },
    }));
  },
  setSceneWindow: (sceneWindow) => {
    set((state) => (
      state.sceneWindow.x === sceneWindow.x
      && state.sceneWindow.y === sceneWindow.y
      && state.sceneWindow.width === sceneWindow.width
      && state.sceneWindow.height === sceneWindow.height
        ? state
        : { sceneWindow }
    ));
  },
  setLayers: (layers) => {
    set((state) => ({
      layers: {
        ...state.layers,
        ...layers,
      },
    }));
  },
  setZoomIndex: (zoomIndex) => {
    set((state) => ({
      camera: {
        ...state.camera,
        zoomIndex,
      },
    }));
  },
  setSseStatus: (sseStatus) => {
    set({ sseStatus });
  },
  setLastEventId: (lastEventId) => {
    set({ lastEventId });
  },
  markFullSync: () => {
    set({ lastFullSyncAt: Date.now() });
  },
  hydrateRecentEvents: (events) => {
    set((state) => ({
      recentEvents: mergeRecentEvents(state.recentEvents, events),
    }));
  },
  appendRecentEvent: (event) => {
    set((state) => ({
      recentEvents: mergeRecentEvents(state.recentEvents, [event]),
    }));
  },
  hydrateRecentAlerts: (alerts) => {
    set((state) => ({
      recentAlerts: mergeRecentAlerts(state.recentAlerts, alerts),
    }));
  },
  appendRecentAlert: (alert) => {
    set((state) => ({
      recentAlerts: mergeRecentAlerts(state.recentAlerts, [alert]),
    }));
  },
  toggleDebugOpen: () => {
    set((state) => ({
      debugOpen: !state.debugOpen,
    }));
  },
  toggleDebugMode: () => {
    set((state) => {
      const debugMode = !state.debugMode;
      return { debugMode, debugOpen: debugMode };
    });
  },
  requestFocus: (position, zoomIndex) => {
    set(() => ({
      focusRequest: {
        nonce: Date.now(),
        position,
        ...(zoomIndex === undefined
          ? {}
          : {
            // PLANET_FOCUS_FIT_ZOOM 哨兵原样透传（渲染侧结算），其余档位钳到合法区间。
            zoomIndex: zoomIndex === PLANET_FOCUS_FIT_ZOOM
              ? PLANET_FOCUS_FIT_ZOOM
              : Math.min(
                Math.max(zoomIndex, 0),
                PLANET_ZOOM_LEVELS.length - 1,
              ),
          }),
      },
    }));
  },
  consumeFocusRequest: (nonce) => {
    set((state) => (
      state.focusRequest?.nonce === nonce
        ? { focusRequest: null }
        : {}
    ));
  },
  setHomeTile: (tile) => {
    set((state) => (
      state.homeTile?.x === tile?.x && state.homeTile?.y === tile?.y ? {} : { homeTile: tile }
    ));
  },
  requestZoom: (zoomIndex, anchor = null) => {
    set(() => ({
      zoomRequest: {
        nonce: Date.now(),
        zoomIndex: Math.min(Math.max(zoomIndex, 0), PLANET_ZOOM_LEVELS.length - 1),
        anchor,
      },
    }));
  },
  consumeZoomRequest: (nonce) => {
    set((state) => (
      state.zoomRequest?.nonce === nonce
        ? { zoomRequest: null }
        : {}
    ));
  },
  setMapProjection: (projection) => {
    set((state) => {
      if (
        state.mapProjection.viewportWidth === projection.viewportWidth
        && state.mapProjection.viewportHeight === projection.viewportHeight
        && state.mapProjection.tileSize === projection.tileSize
      ) {
        return state;
      }
      return { mapProjection: projection };
    });
  },
}));

export function resetPlanetViewStore() {
  usePlanetViewStore.setState({
    // 收起态是持久化偏好：测试里 reset 不该把它拉回默认（与 resetForPlanet 同口径）。
    ...createInitialState(),
    buildBarDocked: false,
    resetForPlanet: usePlanetViewStore.getState().resetForPlanet,
    resetCamera: usePlanetViewStore.getState().resetCamera,
    toggleLayer: usePlanetViewStore.getState().toggleLayer,
    setHoveredTile: usePlanetViewStore.getState().setHoveredTile,
    setBuildBarDocked: usePlanetViewStore.getState().setBuildBarDocked,
    setBuildBarCategoriesOpen: usePlanetViewStore.getState().setBuildBarCategoriesOpen,
    setCraftRecipeId: usePlanetViewStore.getState().setCraftRecipeId,
    setSelected: usePlanetViewStore.getState().setSelected,
    setSelectedUnits: usePlanetViewStore.getState().setSelectedUnits,
    setSelectedSquads: usePlanetViewStore.getState().setSelectedSquads,
    setControlGroup: usePlanetViewStore.getState().setControlGroup,
    recordIncomingWave: usePlanetViewStore.getState().recordIncomingWave,
    setInteractionMode: usePlanetViewStore.getState().setInteractionMode,
    exitInteractionMode: usePlanetViewStore.getState().exitInteractionMode,
    setCamera: usePlanetViewStore.getState().setCamera,
    setSceneWindow: usePlanetViewStore.getState().setSceneWindow,
    setLayers: usePlanetViewStore.getState().setLayers,
    setZoomIndex: usePlanetViewStore.getState().setZoomIndex,
    setSseStatus: usePlanetViewStore.getState().setSseStatus,
    setLastEventId: usePlanetViewStore.getState().setLastEventId,
    markFullSync: usePlanetViewStore.getState().markFullSync,
    hydrateRecentEvents: usePlanetViewStore.getState().hydrateRecentEvents,
    appendRecentEvent: usePlanetViewStore.getState().appendRecentEvent,
    hydrateRecentAlerts: usePlanetViewStore.getState().hydrateRecentAlerts,
    appendRecentAlert: usePlanetViewStore.getState().appendRecentAlert,
    toggleDebugOpen: usePlanetViewStore.getState().toggleDebugOpen,
    toggleDebugMode: usePlanetViewStore.getState().toggleDebugMode,
    requestFocus: usePlanetViewStore.getState().requestFocus,
    consumeFocusRequest: usePlanetViewStore.getState().consumeFocusRequest,
    setHomeTile: usePlanetViewStore.getState().setHomeTile,
    requestZoom: usePlanetViewStore.getState().requestZoom,
    consumeZoomRequest: usePlanetViewStore.getState().consumeZoomRequest,
    setMapProjection: usePlanetViewStore.getState().setMapProjection,
  });
}
