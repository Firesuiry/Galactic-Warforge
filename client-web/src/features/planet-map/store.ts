import { create } from 'zustand';

import type { AlertEntry, GameEventDetail } from '@shared/types';
import type { SseStatus } from '@shared/sse';

import type { PlanetLayerKey, SelectedEntity, TilePoint } from '@/features/planet-map/model';
import { mergeRecentAlerts, mergeRecentEvents } from '@/features/planet-map/model';

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
    label: '12px',
    mode: 'scene',
    scale: 12,
    tileSize: 12,
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
export const DEFAULT_PLANET_ZOOM_INDEX = 2;

export function getPlanetZoomLevel(zoomIndex: number) {
  return PLANET_ZOOM_LEVELS[Math.min(Math.max(zoomIndex, 0), PLANET_ZOOM_LEVELS.length - 1)] ?? PLANET_ZOOM_LEVELS[DEFAULT_PLANET_ZOOM_INDEX];
}

export function getPlanetZoomScale(zoomIndex: number) {
  return getPlanetZoomLevel(zoomIndex).scale;
}

export function getPlanetZoomLabel(zoomIndex: number) {
  return getPlanetZoomLevel(zoomIndex).label;
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
  return zoomLevel.tileSize ?? 12;
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
}

interface PlanetViewState {
  planetId: string;
  layers: PlanetLayerState;
  camera: PlanetCameraState;
  sceneWindow: PlanetSceneWindow;
  hoveredTile: TilePoint | null;
  selected: SelectedEntity | null;
  recentEvents: GameEventDetail[];
  recentAlerts: AlertEntry[];
  sseStatus: SseStatus;
  lastEventId: string;
  lastFullSyncAt: number | null;
  debugOpen: boolean;
  focusRequest: FocusRequest | null;
}

interface PlanetViewActions {
  resetForPlanet: (planetId: string) => void;
  resetCamera: () => void;
  toggleLayer: (layer: PlanetLayerKey) => void;
  setHoveredTile: (tile: TilePoint | null) => void;
  setSelected: (selection: SelectedEntity | null) => void;
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
  requestFocus: (position: TilePoint) => void;
  consumeFocusRequest: (nonce: number) => void;
}

export type PlanetViewStore = PlanetViewState & PlanetViewActions;

function createDefaultLayers(): PlanetLayerState {
  return {
    terrain: true,
    resources: true,
    buildings: true,
    units: true,
    fog: true,
    grid: true,
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
    recentEvents: [],
    recentAlerts: [],
    sseStatus: 'idle',
    lastEventId: '',
    lastFullSyncAt: null,
    debugOpen: false,
    focusRequest: null,
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
}));

export function resetPlanetViewStore() {
  usePlanetViewStore.setState({
    ...createInitialState(),
    resetForPlanet: usePlanetViewStore.getState().resetForPlanet,
    resetCamera: usePlanetViewStore.getState().resetCamera,
    toggleLayer: usePlanetViewStore.getState().toggleLayer,
    setHoveredTile: usePlanetViewStore.getState().setHoveredTile,
    setSelected: usePlanetViewStore.getState().setSelected,
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
  });
}
