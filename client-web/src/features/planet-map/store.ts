import { create } from 'zustand';

import type { AlertEntry, GameEventDetail } from '@shared/types';
import type { Direction } from '@shared/api';
import type { SseStatus } from '@shared/sse';

import type { PlanetLayerKey, SelectedEntity, TilePoint } from '@/features/planet-map/model';
import { mergeRecentAlerts, mergeRecentEvents } from '@/features/planet-map/model';

/**
 * 地图交互模式：决定地图点击的语义。
 * - inspect：默认，点选查看详情
 * - build：建造模式，悬停显示幽灵 footprint，点击直接下达建造命令
 * - move：为指定单位选择移动目标点
 * - attack：为指定单位选择攻击目标
 */
export type PlanetInteractionMode =
  | { kind: 'inspect' }
  | { kind: 'build'; buildingType: string; recipeId?: string; direction: Direction }
  | { kind: 'move'; unitId: string }
  | { kind: 'attack'; unitId: string };

export const INSPECT_MODE: PlanetInteractionMode = { kind: 'inspect' };

export interface PlanetZoomLevel {
  label: string;
  mode: 'overview' | 'scene';
  scale: number;
  overviewStep?: number;
  tileSize?: number;
}

export const PLANET_ZOOM_LEVELS: PlanetZoomLevel[] = [
  {
    label: '1px/100tile',
    mode: 'overview',
    scale: 0.01,
    overviewStep: 100,
  },
  {
    label: '1px/20tile',
    mode: 'overview',
    scale: 0.05,
    overviewStep: 20,
  },
  {
    label: '1px/4tile',
    mode: 'overview',
    scale: 0.25,
    overviewStep: 4,
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
    label: '32px',
    mode: 'scene',
    scale: 32,
    tileSize: 32,
  },
];
export const DEFAULT_PLANET_ZOOM_INDEX = 6;
export const DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX = DEFAULT_PLANET_ZOOM_INDEX;
/** "回家"视角缩放档：PLANET_ZOOM_LEVELS[8] = 32px/tile，首次进入/⌂ 聚焦基地时使用。 */
export const PLANET_HOME_ZOOM_INDEX = 8;
/** scene 档缺省 tile 边长（px/tile），与默认缩放档一致。 */
export const DEFAULT_PLANET_SCENE_TILE_SIZE = 8;
export const MAX_PLANET_OVERVIEW_CELLS_PER_AXIS = 128;
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
  return `${zoomLevel.label} (实际 1px/${actualStep}tile)`;
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
  /** 聚焦时一并切到的缩放档（如"回家"用 32px/tile）；缺省保持当前档。 */
  zoomIndex?: number;
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
  interactionMode: PlanetInteractionMode;
  recentEvents: GameEventDetail[];
  recentAlerts: AlertEntry[];
  sseStatus: SseStatus;
  lastEventId: string;
  lastFullSyncAt: number | null;
  debugOpen: boolean;
  focusRequest: FocusRequest | null;
  zoomRequest: ZoomRequest | null;
  mapProjection: PlanetMapProjection;
}

interface PlanetViewActions {
  resetForPlanet: (planetId: string) => void;
  resetCamera: () => void;
  toggleLayer: (layer: PlanetLayerKey) => void;
  setHoveredTile: (tile: TilePoint | null) => void;
  setSelected: (selection: SelectedEntity | null) => void;
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
  requestFocus: (position: TilePoint, zoomIndex?: number) => void;
  consumeFocusRequest: (nonce: number) => void;
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

function createInitialState(planetId = ''): PlanetViewState {
  return {
    planetId,
    layers: createDefaultLayers(),
    camera: createDefaultCamera(),
    sceneWindow: createDefaultSceneWindow(),
    hoveredTile: null,
    selected: null,
    interactionMode: INSPECT_MODE,
    recentEvents: [],
    recentAlerts: [],
    sseStatus: 'idle',
    lastEventId: '',
    lastFullSyncAt: null,
    debugOpen: false,
    focusRequest: null,
    zoomRequest: null,
    mapProjection: { viewportWidth: 0, viewportHeight: 0, tileSize: 0 },
  };
}

export const usePlanetViewStore = create<PlanetViewStore>()((set) => ({
  ...createInitialState(),
  resetForPlanet: (planetId) => {
    set({
      ...createInitialState(planetId),
    });
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
  setSelected: (selected) => {
    set({ selected });
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
  requestFocus: (position, zoomIndex) => {
    set(() => ({
      focusRequest: {
        nonce: Date.now(),
        position,
        ...(zoomIndex === undefined
          ? {}
          : {
            zoomIndex: Math.min(
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
    ...createInitialState(),
    resetForPlanet: usePlanetViewStore.getState().resetForPlanet,
    resetCamera: usePlanetViewStore.getState().resetCamera,
    toggleLayer: usePlanetViewStore.getState().toggleLayer,
    setHoveredTile: usePlanetViewStore.getState().setHoveredTile,
    setSelected: usePlanetViewStore.getState().setSelected,
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
    requestFocus: usePlanetViewStore.getState().requestFocus,
    consumeFocusRequest: usePlanetViewStore.getState().consumeFocusRequest,
    requestZoom: usePlanetViewStore.getState().requestZoom,
    consumeZoomRequest: usePlanetViewStore.getState().consumeZoomRequest,
    setMapProjection: usePlanetViewStore.getState().setMapProjection,
  });
}
