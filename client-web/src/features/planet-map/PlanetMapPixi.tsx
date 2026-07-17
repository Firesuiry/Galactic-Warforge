import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Application } from 'pixi.js';
import { useShallow } from 'zustand/react/shallow';

import type { CatalogView, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView } from '@shared/types';

import { PixiStage } from '@/engine/PixiStage';
import { subscribeBattleEvents } from '@/engine/battle-events';
import {
  buildSceneWindow,
  centerCameraAxisOffset,
  clamp,
  clampCameraAxisOffset,
  getViewportTileBounds,
  type PlanetRenderView,
  resolveFocusCameraAxisOffset,
  resolveSelectionAtTile,
  selectionLabel,
  type TilePoint,
  toTilePoint,
} from '@/features/planet-map/model';
import {
  createAnimationFrameValueScheduler,
  describeSceneRenderSimplifications,
  getSceneRenderDetailPolicy,
} from '@/features/planet-map/render';
import { assessBuildTiles } from '@/features/planet-map/build-workflow';
import { PlanetScene } from '@/features/planet-map/planet-scene';
import { collectVisibleEntities } from '@/features/planet-map/visible-entities';
import { useImperativeCameraTransform } from '@/features/planet-map/useImperativeCameraTransform';
import { PlanetEntityLayer } from '@/features/planet-map/PlanetEntityLayer';
import {
  DEFAULT_PLANET_ZOOM_INDEX,
  DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX,
  getPlanetRenderTileSize,
  getPlanetZoomLevel,
  getPlanetZoomStatusLabel,
  isPlanetOverviewZoom,
  PLANET_ZOOM_LEVELS,
  usePlanetViewStore,
} from '@/features/planet-map/store';
import { useSessionSnapshot } from '@/hooks/use-session';

/**
 * 行星地图截图捕获句柄：替代旧 PlanetMapCanvas 透出的 HTMLCanvasElement。
 * - clientWidth/clientHeight：分享链接/视口 JSON 的视口换算（等价旧 canvas.clientWidth）。
 * - captureScreenshot：用 Pixi extract 把当前舞台（底图+实体+交互叠加）抓成 canvas 供 PNG 导出。
 */
export interface PlanetMapCapture {
  clientWidth: number;
  clientHeight: number;
  captureScreenshot: () => HTMLCanvasElement | null;
}

interface PlanetMapPixiProps {
  catalog?: CatalogView;
  fog?: FogMapView | PlanetSceneView;
  networks?: PlanetNetworksView;
  overview?: PlanetOverviewView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  onCanvasReady?: (capture: PlanetMapCapture | null) => void;
  /** build/move/attack 模式下的地图点击（inspect 模式不会触发）。 */
  onInteractTile?: (tile: TilePoint) => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

const MIN_VIEWPORT_WIDTH = 240;
const MIN_VIEWPORT_HEIGHT = 240;

function getViewportDefaults(): ViewportSize {
  return {
    width: 960,
    height: 640,
  };
}

function createInitialCamera(viewport: ViewportSize, planet: PlanetRenderView, zoomIndex: number) {
  const tileSize = getPlanetRenderTileSize(zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
  const worldWidth = planet.map_width * tileSize;
  const worldHeight = planet.map_height * tileSize;
  // 小图轴（世界像素 < 视口）居中显示；大图轴留 32px 边距从顶左开始。
  return {
    offsetX: worldWidth < viewport.width ? centerCameraAxisOffset(worldWidth, viewport.width) : 32,
    offsetY: worldHeight < viewport.height ? centerCameraAxisOffset(worldHeight, viewport.height) : 32,
  };
}

function centerCameraOnTile(viewport: ViewportSize, planet: PlanetRenderView, zoomIndex: number, x: number, y: number) {
  const tileSize = getPlanetRenderTileSize(zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
  // 小图轴整图已在视口内，聚焦退化为整图居中；大图轴聚焦到目标 tile。
  return {
    offsetX: resolveFocusCameraAxisOffset(planet.map_width * tileSize, viewport.width, (viewport.width / 2) - ((x + 0.5) * tileSize)),
    offsetY: resolveFocusCameraAxisOffset(planet.map_height * tileSize, viewport.height, (viewport.height / 2) - ((y + 0.5) * tileSize)),
  };
}

function pointToTile(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  offsetX: number,
  offsetY: number,
  tileSize: number,
  planet: PlanetRenderView,
) {
  const x = Math.floor((clientX - rect.left - offsetX) / tileSize);
  const y = Math.floor((clientY - rect.top - offsetY) / tileSize);
  if (x < 0 || y < 0 || x >= planet.map_width || y >= planet.map_height) {
    return null;
  }
  return { x, y };
}

function areTilePointsEqual(left: TilePoint | null, right: TilePoint | null) {
  return (left?.x ?? null) === (right?.x ?? null)
    && (left?.y ?? null) === (right?.y ?? null);
}

interface CameraPatch {
  offsetX: number;
  offsetY: number;
  zoomIndex: number;
  ready: boolean;
}

function areCameraPatchesEqual(left: CameraPatch, right: CameraPatch) {
  return left.offsetX === right.offsetX
    && left.offsetY === right.offsetY
    && left.zoomIndex === right.zoomIndex
    && left.ready === right.ready;
}

/**
 * 行星地图主视图（Pixi 版）：底图/实体/交互叠加全部走 Pixi（planet-scene.ts），
 * 交互命中仍走 pointToTile 的 tile 换算；语义实体层（PlanetEntityLayer）以 ghost 形式保留
 * （opacity:0 + pointer-events:none，DevTools/agent 可定位，视觉由 Pixi 承担）。
 */
export function PlanetMapPixi({ catalog, fog, networks, overview, planet, runtime, onCanvasReady, onInteractTile }: PlanetMapPixiProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const entityLayerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PlanetScene | null>(null);
  const dragStateRef = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const previousZoomIndexRef = useRef(DEFAULT_PLANET_ZOOM_INDEX);
  const [viewport, setViewport] = useState<ViewportSize>(getViewportDefaults);
  const [pixiApp, setPixiApp] = useState<Application | null>(null);
  // ?freeze=1 冻结动效（单位直接落位），供截图测试与确定性渲染（与星图 freeze 同一约定）。
  const frozen = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('freeze'),
    [],
  );

  const {
    camera,
    focusRequest,
    zoomRequest,
    hoveredTile,
    interactionMode,
    layers,
    selected,
    consumeFocusRequest,
    consumeZoomRequest,
    exitInteractionMode,
    requestFocus,
    setCamera,
    setSceneWindow,
    setHoveredTile,
    setSelected,
    setMapProjection,
  } = usePlanetViewStore(useShallow((state) => ({
    camera: state.camera,
    focusRequest: state.focusRequest,
    zoomRequest: state.zoomRequest,
    hoveredTile: state.hoveredTile,
    interactionMode: state.interactionMode,
    layers: state.layers,
    selected: state.selected,
    consumeFocusRequest: state.consumeFocusRequest,
    consumeZoomRequest: state.consumeZoomRequest,
    exitInteractionMode: state.exitInteractionMode,
    requestFocus: state.requestFocus,
    setCamera: state.setCamera,
    setSceneWindow: state.setSceneWindow,
    setHoveredTile: state.setHoveredTile,
    setSelected: state.setSelected,
    setMapProjection: state.setMapProjection,
  })));
  const session = useSessionSnapshot();

  const zoomLevel = getPlanetZoomLevel(camera.zoomIndex);
  const overviewMode = isPlanetOverviewZoom(camera.zoomIndex);
  const tileSize = getPlanetRenderTileSize(camera.zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
  // 建造模式自动叠加网格（不改用户开关，退出建造即恢复）；手动勾选仍然生效。
  const sceneLayers = useMemo(
    () => (interactionMode.kind === 'build' && !layers.grid ? { ...layers, grid: true } : layers),
    [interactionMode.kind, layers],
  );
  useImperativeCameraTransform(entityLayerRef, camera.offsetX, camera.offsetY, tileSize);
  const viewportBounds = useMemo(
    () => getViewportTileBounds(planet, camera, tileSize, viewport.width, viewport.height),
    [camera, planet, tileSize, viewport.height, viewport.width],
  );
  const detailPolicy = useMemo(() => getSceneRenderDetailPolicy(tileSize), [tileSize]);
  const simplificationMessages = useMemo(
    () => {
      if (overviewMode) {
        return [];
      }
      return describeSceneRenderSimplifications(detailPolicy).filter((message) => {
        if (message === '细网格已简化') {
          return sceneLayers.grid;
        }
        if (message === '迷雾已合并') {
          return sceneLayers.fog;
        }
        if (message === '建筑与单位已简化') {
          return sceneLayers.buildings || sceneLayers.units;
        }
        return true;
      });
    },
    [detailPolicy, sceneLayers, overviewMode],
  );
  const sceneZoomStatusLabel = zoomLevel.mode === 'scene' && zoomLevel.tileSize !== undefined && zoomLevel.tileSize !== tileSize
    ? `${zoomLevel.label} (实际 ${tileSize}px/tile)`
    : `${tileSize}px/tile`;
  const hoverScheduler = useMemo(
    () => createAnimationFrameValueScheduler<TilePoint | null>({
      commit: (tile) => {
        setHoveredTile(tile);
      },
      getCurrentValue: () => usePlanetViewStore.getState().hoveredTile,
      isEqual: areTilePointsEqual,
    }),
    [setHoveredTile],
  );
  // 拖拽/滚轮的高频 setCamera 走 rAF 合帧：N 次 pointermove/scroll 在同一帧只提交一次相机状态。
  const cameraScheduler = useMemo(
    () => createAnimationFrameValueScheduler<CameraPatch>({
      commit: (value) => {
        setCamera(value);
      },
      getCurrentValue: () => {
        const current = usePlanetViewStore.getState().camera;
        return {
          offsetX: current.offsetX,
          offsetY: current.offsetY,
          zoomIndex: current.zoomIndex,
          ready: current.ready,
        };
      },
      isEqual: areCameraPatchesEqual,
    }),
    [setCamera],
  );
  const visibleEntities = useMemo(
    () => collectVisibleEntities(planet, runtime, networks, viewportBounds),
    [planet, runtime, networks, viewportBounds],
  );

  useEffect(() => {
    if (!viewportRef.current) {
      return undefined;
    }

    function updateViewport() {
      const rect = viewportRef.current?.getBoundingClientRect();
      setViewport({
        width: Math.max(MIN_VIEWPORT_WIDTH, Math.floor(rect?.width || 0) || getViewportDefaults().width),
        height: Math.max(MIN_VIEWPORT_HEIGHT, Math.floor(rect?.height || 0) || getViewportDefaults().height),
      });
    }

    updateViewport();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateViewport());
      resizeObserver.observe(viewportRef.current);
    } else {
      window.addEventListener('resize', updateViewport);
    }

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  const handlePixiReady = useCallback((app: Application) => {
    const scene = new PlanetScene(app, { frozen });
    sceneRef.current = scene;
    setPixiApp(app);
    if (import.meta.env.DEV) {
      // 开发模式暴露给 Playwright/控制台做画布内定位
      (window as unknown as { __planetScene?: PlanetScene }).__planetScene = scene;
    }
    // 战斗事件总线 → 场景特效（damage_applied 开火/飘字/受击闪白）；卸载退订防重复演出
    const unsubscribe = subscribeBattleEvents((event) => scene.handleBattleEvent(event));
    return () => {
      unsubscribe();
      sceneRef.current = null;
      setPixiApp(null);
      scene.destroy();
    };
  }, [frozen]);

  // Pixi app 就绪后把截图捕获句柄透传给页面（PNG 导出 / 分享链接的视口换算）。
  useEffect(() => {
    if (!onCanvasReady) {
      return undefined;
    }
    if (!pixiApp) {
      onCanvasReady(null);
      return undefined;
    }
    const app = pixiApp;
    onCanvasReady({
      clientWidth: viewport.width,
      clientHeight: viewport.height,
      captureScreenshot: () => {
        try {
          return app.renderer.extract.canvas(app.stage) as HTMLCanvasElement;
        } catch {
          return null;
        }
      },
    });
    return () => {
      onCanvasReady(null);
    };
  }, [onCanvasReady, pixiApp, viewport]);

  // ---------- 数据 → Pixi 场景 ----------

  useEffect(() => {
    sceneRef.current?.setBase({ planet, fog, overview, overviewMode, layers: sceneLayers });
  }, [planet, fog, overview, overviewMode, sceneLayers, pixiApp]);

  useEffect(() => {
    sceneRef.current?.setCamera({
      offsetX: camera.offsetX,
      offsetY: camera.offsetY,
      tileSize,
      zoomIndex: camera.zoomIndex,
    });
  }, [camera.offsetX, camera.offsetY, camera.zoomIndex, tileSize, pixiApp]);

  useEffect(() => {
    sceneRef.current?.setEntities({
      visible: visibleEntities,
      catalog,
      playerId: session.playerId,
      detailPolicy,
      layers: sceneLayers,
      overviewMode,
    });
  }, [visibleEntities, catalog, session.playerId, detailPolicy, sceneLayers, overviewMode, pixiApp]);

  useEffect(() => {
    const buildAssessment = !overviewMode && interactionMode.kind === 'build' && hoveredTile
      ? assessBuildTiles(catalog, interactionMode.buildingType, planet, {
          x: hoveredTile.x,
          y: hoveredTile.y,
          z: 0,
        })
      : undefined;
    sceneRef.current?.setInteraction({
      hoveredTile,
      selected,
      mode: interactionMode,
      buildAssessment,
      selectionVisible: sceneLayers.selection,
      overview,
      overviewMode,
      viewportBounds,
    });
  }, [catalog, hoveredTile, interactionMode, sceneLayers.selection, overview, overviewMode, planet, selected, viewportBounds, pixiApp]);

  useEffect(() => () => {
    hoverScheduler.cancel();
    cameraScheduler.cancel();
  }, [hoverScheduler, cameraScheduler]);

  useEffect(() => {
    if (!camera.ready) {
      const nextCamera = createInitialCamera(viewport, planet, camera.zoomIndex);
      setCamera({
        ...nextCamera,
        ready: true,
      });
    }
  }, [camera.ready, camera.zoomIndex, planet.map_height, planet.map_width, setCamera, viewport]);

  // 小图轴居中维护：视口/缩放档变化后，世界像素小于视口的轴重新居中。
  // 首次（挂载）运行跳过——挂载定位归初始相机/聚焦 effect（二者对小图轴同样居中）；
  // 读 getState 而非依赖 camera，避免拖拽过程中来回触发。
  const recenterKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const recenterKey = `${viewport.width}x${viewport.height}:${tileSize}:${planet.map_width}x${planet.map_height}`;
    if (recenterKeyRef.current === null || recenterKeyRef.current === recenterKey) {
      recenterKeyRef.current = recenterKey;
      return;
    }
    recenterKeyRef.current = recenterKey;
    const current = usePlanetViewStore.getState().camera;
    if (!current.ready) {
      return;
    }
    const worldWidth = planet.map_width * tileSize;
    const worldHeight = planet.map_height * tileSize;
    const patch: { offsetX?: number; offsetY?: number } = {};
    if (worldWidth < viewport.width) {
      const centered = centerCameraAxisOffset(worldWidth, viewport.width);
      if (current.offsetX !== centered) {
        patch.offsetX = centered;
      }
    }
    if (worldHeight < viewport.height) {
      const centered = centerCameraAxisOffset(worldHeight, viewport.height);
      if (current.offsetY !== centered) {
        patch.offsetY = centered;
      }
    }
    if (patch.offsetX !== undefined || patch.offsetY !== undefined) {
      setCamera(patch);
    }
  }, [planet.map_width, planet.map_height, setCamera, tileSize, viewport]);

  useEffect(() => {
    if (!camera.ready || overviewMode) {
      return;
    }
    const nextSceneWindow = buildSceneWindow(planet, camera, tileSize, viewport.width, viewport.height);
    setSceneWindow(nextSceneWindow);
  }, [camera, overviewMode, planet, setSceneWindow, tileSize, viewport.height, viewport.width]);

  // 把主画布的像素视口与 tile 边长发布到 store（仅在 resize/zoom 时变更），
  // 供 minimap 等页级组件计算视口矩形；setter 自带去重，不会触发额外重渲染。
  useEffect(() => {
    setMapProjection({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      tileSize,
    });
  }, [setMapProjection, tileSize, viewport.height, viewport.width]);

  useEffect(() => {
    const previousZoomMode = getPlanetZoomLevel(previousZoomIndexRef.current).mode;
    if (camera.ready && previousZoomMode !== zoomLevel.mode && zoomLevel.mode === 'overview') {
      const nextCamera = createInitialCamera(viewport, planet, camera.zoomIndex);
      setCamera({
        ...nextCamera,
        ready: true,
      });
    }
    previousZoomIndexRef.current = camera.zoomIndex;
  }, [camera.ready, camera.zoomIndex, planet, setCamera, viewport, zoomLevel.mode]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    const targetZoomIndex = overviewMode ? DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX : camera.zoomIndex;
    const nextCamera = centerCameraOnTile(
      viewport,
      planet,
      targetZoomIndex,
      focusRequest.position.x,
      focusRequest.position.y,
    );
    setCamera({
      ...nextCamera,
      zoomIndex: targetZoomIndex,
      ready: true,
    });
    consumeFocusRequest(focusRequest.nonce);
  }, [camera.zoomIndex, consumeFocusRequest, focusRequest, overviewMode, planet, setCamera, viewport]);

  // 统一缩放入口：±按钮/档位按钮经 store 的 zoomRequest 到达（anchor=null → 视口中心）。
  useEffect(() => {
    if (!zoomRequest) {
      return;
    }
    applyZoomAtIndex(
      zoomRequest.zoomIndex,
      zoomRequest.anchor?.x ?? viewport.width / 2,
      zoomRequest.anchor?.y ?? viewport.height / 2,
    );
    consumeZoomRequest(zoomRequest.nonce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomRequest, consumeZoomRequest]);

  // 缩放快捷键：+/- 以视口中心为锚走同一入口（输入框聚焦时不抢按键）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === '+' || event.key === '=') {
        applyZoomAtIndex(camera.zoomIndex + 1, viewport.width / 2, viewport.height / 2);
      } else if (event.key === '-') {
        applyZoomAtIndex(camera.zoomIndex - 1, viewport.width / 2, viewport.height / 2);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, viewport, planet, cameraScheduler]);

  function updateHoveredTile(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(clientX, clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    hoverScheduler.schedule(tile);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (overviewMode) {
      return;
    }
    dragStateRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: camera.offsetX,
      offsetY: camera.offsetY,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (dragState) {
      const deltaX = event.clientX - dragState.pointerX;
      const deltaY = event.clientY - dragState.pointerY;
      // 小图轴钳位：地图中心不允许被拖出视口（data-camera-offset 语义不变，值反映钳位后的偏移）。
      cameraScheduler.schedule({
        offsetX: clampCameraAxisOffset(planet.map_width * tileSize, viewport.width, dragState.offsetX + deltaX),
        offsetY: clampCameraAxisOffset(planet.map_height * tileSize, viewport.height, dragState.offsetY + deltaY),
        zoomIndex: camera.zoomIndex,
        ready: true,
      });
      return;
    }
    updateHoveredTile(event.clientX, event.clientY);
  }

  function handlePointerUp() {
    dragStateRef.current = null;
  }

  function handlePointerLeave() {
    dragStateRef.current = null;
    hoverScheduler.schedule(null);
  }

  /**
   * 统一缩放出口：滚轮/±按钮/档位按钮/快捷键都经这里提交"离散档位 + 锚点守恒 offset"
   * （zoom-to-cursor；anchorX/anchorY 为视口内像素坐标）。数据层 zoomIndex 立即落库，
   * 渲染层补间由 Pixi 场景按 zoomIndex 变化驱动（?freeze=1 瞬切）。
   */
  function applyZoomAtIndex(nextZoomIndex: number, anchorX: number, anchorY: number) {
    const clampedIndex = clamp(nextZoomIndex, 0, PLANET_ZOOM_LEVELS.length - 1);
    if (clampedIndex === camera.zoomIndex) {
      return;
    }
    const currentTileSize = getPlanetRenderTileSize(camera.zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
    const nextTileSize = getPlanetRenderTileSize(clampedIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
    const worldX = (anchorX - camera.offsetX) / currentTileSize;
    const worldY = (anchorY - camera.offsetY) / currentTileSize;

    cameraScheduler.schedule({
      zoomIndex: clampedIndex,
      offsetX: clampCameraAxisOffset(planet.map_width * nextTileSize, viewport.width, anchorX - worldX * nextTileSize),
      offsetY: clampCameraAxisOffset(planet.map_height * nextTileSize, viewport.height, anchorY - worldY * nextTileSize),
      ready: true,
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    applyZoomAtIndex(
      camera.zoomIndex + (event.deltaY < 0 ? 1 : -1),
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(event.clientX, event.clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    if (!tile) {
      return;
    }
    // build/move/attack 模式：点击 = 下达指令，不改变选中
    if (interactionMode.kind !== 'inspect') {
      onInteractTile?.(tile);
      return;
    }
    const selection = overviewMode ? null : resolveSelectionAtTile(planet, tile.x, tile.y);
    setSelected(selection ?? {
      kind: 'tile',
      position: {
        x: tile.x,
        y: tile.y,
        z: 0,
      },
    });
  }

  /** 右键/Esc 退出当前交互模式（回到点选）。 */
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (interactionMode.kind !== 'inspect') {
      event.preventDefault();
      exitInteractionMode();
    }
  }

  useEffect(() => {
    if (interactionMode.kind === 'inspect') {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitInteractionMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitInteractionMode, interactionMode.kind]);

  function handleDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(event.clientX, event.clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    if (!tile) {
      return;
    }
    if (overviewMode) {
      const nextCamera = centerCameraOnTile(viewport, planet, DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX, tile.x, tile.y);
      setCamera({
        ...nextCamera,
        zoomIndex: DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX,
        ready: true,
      });
      setSelected({
        kind: 'tile',
        position: {
          x: tile.x,
          y: tile.y,
          z: 0,
        },
      });
      return;
    }
    requestFocus(tile);
  }

  return (
    <div className="planet-map-canvas">
      {/*
        交互面（surface）：Pixi canvas 的容器，同时承载指针事件与 data-camera-* 探测属性
        （Playwright 用 data-camera-offset-x/y 与 data-tile-size 做 tile→屏幕坐标换算）。
      */}
      <div
        aria-label="行星地图"
        className={interactionMode.kind === 'inspect'
          ? 'planet-map-canvas__viewport planet-map-canvas__surface'
          : `planet-map-canvas__viewport planet-map-canvas__surface planet-map-canvas__surface--${interactionMode.kind}`}
        data-camera-offset-x={camera.offsetX}
        data-camera-offset-y={camera.offsetY}
        data-tile-size={tileSize}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        ref={viewportRef}
        role="img"
      >
        <PixiStage className="planet-map-canvas__pixi" onReady={handlePixiReady} />
        {/*
          语义实体层（ghost）：带 data-entity-* 的只读 DOM，供 DevTools/agent 定位；
          opacity:0 + pointer-events:none（Playwright 对 opacity:0 仍判 visible），
          视觉完全由 Pixi 承担，点击穿透回 surface 的 pointToTile 命中逻辑。
        */}
        <div className="entity-layer entity-layer--ghost" ref={entityLayerRef} aria-hidden="true">
          <PlanetEntityLayer
            catalog={catalog}
            playerId={session.playerId}
            tileSize={tileSize}
            detailPolicy={detailPolicy}
            overviewMode={overviewMode}
            selected={selected}
            layers={layers}
            visible={visibleEntities}
          />
        </div>
      </div>
      <div className="planet-map-canvas__status">
        <span>{overviewMode ? `缩放 ${getPlanetZoomStatusLabel(camera.zoomIndex, planet.map_width, planet.map_height)}` : `缩放 ${sceneZoomStatusLabel}`}</span>
        <span>
          Hover {hoveredTile ? `(${hoveredTile.x}, ${hoveredTile.y})` : '-'}
        </span>
        {interactionMode.kind === 'build' ? (
          <span className="planet-map-canvas__mode">建造模式：点击放置 · 右键/Esc 取消</span>
        ) : null}
        {interactionMode.kind === 'move' ? (
          <span className="planet-map-canvas__mode">移动模式：点击目标点 · 右键/Esc 取消</span>
        ) : null}
        {interactionMode.kind === 'attack' ? (
          <span className="planet-map-canvas__mode planet-map-canvas__mode--attack">攻击模式：点击目标 · 右键/Esc 取消</span>
        ) : null}
        <span>{selectionLabel(selected)}</span>
        {simplificationMessages.length > 0 ? <span>低缩放简化</span> : null}
        {simplificationMessages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </div>
    </div>
  );
}
