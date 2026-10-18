import { create } from 'zustand';

import type { AlertEntry, GameEventDetail, WarTheaterZoneType } from '@shared/types';
import type { Direction } from '@shared/api';
import type { SseStatus } from '@shared/sse';

import type { PlanetLayerKey, SelectedEntity, TilePoint } from '@/features/planet-map/model';
import { mergeRecentAlerts, mergeRecentEvents } from '@/features/planet-map/model';
import { clampBeltElevation } from '@/features/planet-map/logistics-tier';

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
  | {
    kind: 'build';
    buildingType: string;
    recipeId?: string;
    direction: Direction;
    rotation?: 0 | 90 | 180 | 270;
    /**
     * 第 19 轮多层传送带（契约 §3.5）：目标高度 0–4，缺省 0。
     * 只对 conveyor_belt_* 生效；切换建筑类型时归零（`beginBuild`）。
     */
    elevation?: number;
  }
  | { kind: 'move' }
  | { kind: 'attack' }
  | { kind: 'unit_order'; order: UnitOrderMode }
  | { kind: 'haul'; fromBuildingId?: string; toBuildingId?: string; itemId?: string }
  | { kind: 'squad_order'; squadId: string; order: 'attack' | 'defend' | 'retreat' }
  | { kind: 'theater_zone'; theaterId: string; zoneType: WarTheaterZoneType };

export const INSPECT_MODE: PlanetInteractionMode = { kind: 'inspect' };

/**
 * 3D 行星页的总览请求口径（R20-D：2D 缩放档退役后只剩这一档）。
 *
 * 固定按 1px/12cell 请求总览；大图把步长抬高到「单轴不超过 MAX_PLANET_OVERVIEW_CELLS_PER_AXIS」，
 * 避免 288×288 的行星一次拉回 82944 个点。
 */
export const PLANET_OVERVIEW_STEP = 12;
export const MAX_PLANET_OVERVIEW_CELLS_PER_AXIS = 128;

export function getPlanetOverviewRequestStep(
  mapWidth: number,
  mapHeight: number,
): number {
  if (mapWidth <= 0 || mapHeight <= 0) {
    return PLANET_OVERVIEW_STEP;
  }
  const protectedStep = Math.max(
    Math.ceil(mapWidth / MAX_PLANET_OVERVIEW_CELLS_PER_AXIS),
    Math.ceil(mapHeight / MAX_PLANET_OVERVIEW_CELLS_PER_AXIS),
    1,
  );
  return Math.max(PLANET_OVERVIEW_STEP, protectedStep);
}

/** 总览步长的展示文案（步长被抬高时追加「实际 1px/Ncell」）。 */
export function getPlanetOverviewStepLabel(mapWidth: number, mapHeight: number): string {
  const actualStep = getPlanetOverviewRequestStep(mapWidth, mapHeight);
  return actualStep === PLANET_OVERVIEW_STEP
    ? '1px/12cell'
    : `1px/12cell (实际 1px/${actualStep}cell)`;
}

export interface PlanetSceneWindow {
  x: number;
  y: number;
  width: number;
  height: number;
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

interface FocusRequest {
  nonce: number;
  position: TilePoint;
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

interface PlanetViewState {
  planetId: string;
  layers: PlanetLayerState;
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
  /**
   * 玩家的「家」（HQ 优先，见 resolveHomeTile），由行星页按**跨窗口累积**的己方实体算出。
   * 场景查询只返回镜头窗口内的实体：镜头在荒郊时窗口里没有基地，「聚焦基地/回到基地」
   * 若只看窗口数据就无家可回（试玩 1011 A）。
   */
  homeTile: TilePoint | null;
}

interface PlanetViewActions {
  resetForPlanet: (planetId: string) => void;
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
  /** 进入建造模式：切换建筑类型时高度归零（同类型重进也归零，契约 §3.5）。 */
  beginBuild: (mode: Extract<PlanetInteractionMode, { kind: 'build' }>) => void;
  /** 升降建造目标高度（PageUp/PageDown 与建造栏 ▲▼ 共用）；非传送带建造模式忽略。 */
  adjustBuildElevation: (delta: number) => void;
  /** 退出当前交互模式回到 inspect（Esc/右键）。 */
  exitInteractionMode: () => void;
  setSceneWindow: (sceneWindow: PlanetSceneWindow) => void;
  setLayers: (layers: Partial<PlanetLayerState>) => void;
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
  requestFocus: (position: TilePoint) => void;
  consumeFocusRequest: (nonce: number) => void;
  setHomeTile: (tile: TilePoint | null) => void;
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
    homeTile: null,
  };
}

export const usePlanetViewStore = create<PlanetViewStore>()((set) => ({
  ...createInitialState(),
  resetForPlanet: (planetId) => {
    set(resetKeepingPreferences(planetId));
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
  beginBuild: (mode) => {
    // 切换建筑类型 → 高度归零：缺省字段即 0（不写 elevation:0，保持旧模式对象形状）。
    set({ interactionMode: { ...mode, elevation: undefined } });
  },
  adjustBuildElevation: (delta) => {
    set((state) => {
      const mode = state.interactionMode;
      if (mode.kind !== 'build' || !mode.buildingType.startsWith('conveyor_belt')) return state;
      const next = clampBeltElevation((mode.elevation ?? 0) + delta);
      if (next === (mode.elevation ?? 0)) return state;
      return { interactionMode: { ...mode, elevation: next === 0 ? undefined : next } };
    });
  },
  exitInteractionMode: () => {
    set({ interactionMode: INSPECT_MODE });
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
  requestFocus: (position) => {
    set(() => ({
      focusRequest: {
        nonce: Date.now(),
        position,
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
}));

export function resetPlanetViewStore() {
  usePlanetViewStore.setState({
    // 收起态是持久化偏好：测试里 reset 不该把它拉回默认（与 resetForPlanet 同口径）。
    ...createInitialState(),
    buildBarDocked: false,
    resetForPlanet: usePlanetViewStore.getState().resetForPlanet,
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
    beginBuild: usePlanetViewStore.getState().beginBuild,
    adjustBuildElevation: usePlanetViewStore.getState().adjustBuildElevation,
    exitInteractionMode: usePlanetViewStore.getState().exitInteractionMode,
    setSceneWindow: usePlanetViewStore.getState().setSceneWindow,
    setLayers: usePlanetViewStore.getState().setLayers,
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
  });
}
