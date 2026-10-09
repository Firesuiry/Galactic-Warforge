import { CUBE_FACES } from '@shared/surface';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Application } from 'pixi.js';
import { useShallow } from 'zustand/react/shallow';

import type { CatalogView, ItemInventory, CombatSquad, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView, WarTheaterView } from '@shared/types';

import { PixiStage } from '@/engine/PixiStage';
import { sfx } from '@/engine/audio';
import { subscribeBattleEvents } from '@/engine/battle-events';
import {
  buildSceneWindow,
  centerCameraAxisOffset,
  clamp,
  getViewportTileBounds,
  resolveCameraAxisOffset,
  type PlanetRenderView,
  resolveFocusCameraAxisOffset,
  resolveSelectionAtTile,
  selectionLabel,
  type TilePoint,
  toTilePoint,
  wrapMod,
} from '@/features/planet-map/model';
import { ownUnitsInTileRect, sameTypeOwnUnitsInView } from '@/features/planet-map/rts-commands';
import {
  theaterZoneFromDragRect,
  theaterZoneTypeLabel,
  type TheaterZoneGeometry,
} from '@/features/planet-map/squad-commands';
import { PlanetLegionLayer } from '@/features/planet-map/PlanetLegionLayer';
import { legionAliveMemberIds } from '@/features/planet-map/legion-model';
import { PlanetPowerAlertLayer } from '@/features/planet-map/PlanetPowerAlertLayer';
import { PlanetSquadLayer } from '@/features/planet-map/PlanetSquadLayer';
import { PlanetTheaterLayer } from '@/features/planet-map/PlanetTheaterLayer';
import {
  createAnimationFrameValueScheduler,
  describeSceneRenderSimplifications,
  getSceneRenderDetailPolicy,
} from '@/features/planet-map/render';
import { assessBuildTiles } from '@/features/planet-map/build-workflow';
import { PlanetScene } from '@/features/planet-map/planet-scene';
import { describeHover } from '@/features/planet-map/hover-info';
import { PlanetHoverTip } from '@/features/planet-map/PlanetHoverTip';
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
  PLANET_FOCUS_FIT_ZOOM,
  PLANET_ZOOM_LEVELS,
  resolvePlanetFitZoomIndex,
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
  /** 玩家背包：建造预览缺料时标红。 */
  inventory?: ItemInventory;
  fog?: FogMapView | PlanetSceneView;
  networks?: PlanetNetworksView;
  overview?: PlanetOverviewView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  /** C4：战斗小队（默认取 runtime.combat_squads，测试可显式注入）。 */
  squads?: CombatSquad[];
  /** C4：战区列表（zones 圆圈覆盖层 + 告警态）。 */
  theaters?: WarTheaterView[];
  onCanvasReady?: (capture: PlanetMapCapture | null) => void;
  /** build/move/attack/unit_order 模式下的地图点击（inspect 模式不会触发）。 */
  onInteractTile?: (tile: TilePoint) => void;
  /** inspect 模式右键情境指令（有批量命令下达时返回 true）。 */
  onContextTile?: (tile: TilePoint) => boolean;
  /** C4：theater_zone 模式拖拽矩形松手 → 战区圆几何（圆心+半径）。 */
  onDefineZone?: (zone: TheaterZoneGeometry) => void;
  /** 黑雾是否对当前玩家敌对（单位配色/悬停提示归属）。 */
  darkFogHostile?: boolean;
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
  let x = Math.floor((clientX - rect.left - offsetX) / tileSize);
  let y = Math.floor((clientY - rect.top - offsetY) / tileSize);
  // 环绕轴：任何屏幕位置都命中某个真实 tile（取模回绕）；非环绕轴维持出界判空。
  const wrapX = false;
  const wrapY = false;
  if (wrapX) {
    x = wrapMod(x, planet.map_width);
  } else if (x < 0 || x >= planet.map_width) {
    return null;
  }
  if (wrapY) {
    y = wrapMod(y, planet.map_height);
  } else if (y < 0 || y >= planet.map_height) {
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
export function PlanetMapPixi({ catalog, inventory, fog, networks, overview, planet, runtime, squads, theaters, onCanvasReady, onInteractTile, onContextTile, onDefineZone, darkFogHostile = false }: PlanetMapPixiProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const entityLayerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PlanetScene | null>(null);
  const dragStateRef = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  // 框选（marquee）：inspect 模式左键拖动出选择框；抬起时选中框内己方单位。
  const marqueeRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // 战区划定（C4）：theater_zone 模式左键拖出矩形；抬起时换算圆心+半径回调。
  const zoneDragRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null);
  const [zoneDragRect, setZoneDragRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // 框选/右键拖拽后抑制紧随的 click/contextmenu（避免刚框选完又被单击清空、刚平移完又下情境指令）。
  const suppressClickRef = useRef(false);
  const suppressContextRef = useRef(false);
  const previousZoomIndexRef = useRef(DEFAULT_PLANET_ZOOM_INDEX);
  const [viewport, setViewport] = useState<ViewportSize>(getViewportDefaults);
  // 视口是否已实测（挂载时 updateViewport 同步量过 DOM）：PLANET_FOCUS_FIT_ZOOM 的自适应
  // 选档必须等实测尺寸，否则会按默认 960×640 误选偏小档位（小图放大不足）。
  const [viewportMeasured, setViewportMeasured] = useState(false);
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
    selectedUnits,
    selectedSquads,
    incomingWaves,
    consumeFocusRequest,
    consumeZoomRequest,
    exitInteractionMode,
    requestFocus,
    setCamera,
    setSceneWindow,
    setHoveredTile,
    setSelected,
    setSelectedUnits,
    setSelectedSquads,
    setMapProjection,
  } = usePlanetViewStore(useShallow((state) => ({
    camera: state.camera,
    focusRequest: state.focusRequest,
    zoomRequest: state.zoomRequest,
    hoveredTile: state.hoveredTile,
    interactionMode: state.interactionMode,
    layers: state.layers,
    selected: state.selected,
    selectedUnits: state.selectedUnits,
    selectedSquads: state.selectedSquads,
    incomingWaves: state.incomingWaves,
    consumeFocusRequest: state.consumeFocusRequest,
    consumeZoomRequest: state.consumeZoomRequest,
    exitInteractionMode: state.exitInteractionMode,
    requestFocus: state.requestFocus,
    setCamera: state.setCamera,
    setSceneWindow: state.setSceneWindow,
    setHoveredTile: state.setHoveredTile,
    setSelected: state.setSelected,
    setSelectedUnits: state.setSelectedUnits,
    setSelectedSquads: state.setSelectedSquads,
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
      // 用布局尺寸（clientWidth/Height）而不是 getBoundingClientRect：路由转场
      // `.page-shell { animation: page-enter }` 会以 scale(0.992)→1 缩放整页，
      // 挂载时量到的 rect 是缩放后的亚像素宽度，被 floor 后写进 store 就再也不更新
      // （ResizeObserver 只报布局盒变化，不受祖先 transform 影响），导致同一页面
      // 在不同运行下相机 offset 落在 210 / 214 / 214.5（行星地图截图基线随之漂移）。
      const element = viewportRef.current;
      setViewport({
        width: Math.max(MIN_VIEWPORT_WIDTH, element?.clientWidth || getViewportDefaults().width),
        height: Math.max(MIN_VIEWPORT_HEIGHT, element?.clientHeight || getViewportDefaults().height),
      });
      setViewportMeasured(true);
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
      darkFogHostile,
      detailPolicy,
      layers: sceneLayers,
      overviewMode,
    });
  }, [visibleEntities, catalog, session.playerId, darkFogHostile, detailPolicy, sceneLayers, overviewMode, pixiApp]);

  // 悬停提示：build 模式与总览档不显示（hoveredTile 已 rAF 合帧）。
  const hoverInfo = useMemo(
    () => (hoveredTile && !overviewMode && interactionMode.kind !== 'build'
      ? describeHover({ planet, runtime, catalog, playerId: session.playerId, darkFogHostile }, hoveredTile)
      : null),
    [hoveredTile, overviewMode, interactionMode.kind, planet, runtime, catalog, session.playerId, darkFogHostile],
  );

  useEffect(() => {
    const buildAssessment = !overviewMode && interactionMode.kind === 'build' && hoveredTile
      ? assessBuildTiles(catalog, interactionMode.buildingType, planet, {
          x: hoveredTile.x,
          y: hoveredTile.y,
          z: 0,
        }, session.playerId, interactionMode.rotation, inventory, runtime)
      : undefined;
    sceneRef.current?.setInteraction({
      hoveredTile,
      selected,
      selectedUnits,
      mode: interactionMode,
      buildAssessment,
      catalog,
      selectionVisible: sceneLayers.selection,
      overview,
      overviewMode,
      viewportBounds,
    });
  }, [catalog, inventory, hoveredTile, interactionMode, sceneLayers.selection, overview, overviewMode, planet, selected, selectedUnits, viewportBounds, pixiApp]);

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
    // 自适应选档依赖实测视口：未实测时保留请求不消费，等 viewportMeasured 后本 effect 重跑。
    if (focusRequest.zoomIndex === PLANET_FOCUS_FIT_ZOOM && !viewportMeasured) {
      return;
    }
    // PLANET_FOCUS_FIT_ZOOM：按视口 × 地图尺寸自适应选档（小图 60-80% 占屏，大图回落回家档）。
    const targetZoomIndex = focusRequest.zoomIndex === PLANET_FOCUS_FIT_ZOOM
      ? resolvePlanetFitZoomIndex(viewport.width, viewport.height, planet.map_width, planet.map_height)
      : focusRequest.zoomIndex
        ?? (overviewMode ? DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX : camera.zoomIndex);
    const nextCamera = centerCameraOnTile(
      viewport,
      planet,
      targetZoomIndex,
      focusRequest.position.x,
      focusRequest.position.y,
    );
    const focusTileSize = getPlanetRenderTileSize(targetZoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
    setCamera({
      offsetX: resolveCameraAxisOffset(planet.map_width * focusTileSize, viewport.width, nextCamera.offsetX),
      offsetY: resolveCameraAxisOffset(planet.map_height * focusTileSize, viewport.height, nextCamera.offsetY),
      zoomIndex: targetZoomIndex,
      ready: true,
    });
    consumeFocusRequest(focusRequest.nonce);
  }, [camera.zoomIndex, consumeFocusRequest, focusRequest, overviewMode, planet, setCamera, viewport, viewportMeasured]);

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

  /** 视口像素坐标 → tile 浮点坐标（钳到地图内；框选角点换算用）。 */
  function clientToTileFloat(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    return {
      x: clamp((clientX - rect.left - camera.offsetX) / tileSize, 0, Math.max(planet.map_width - 1, 0)),
      y: clamp((clientY - rect.top - camera.offsetY) / tileSize, 0, Math.max(planet.map_height - 1, 0)),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (overviewMode) {
      return;
    }
    // 战区划定（C4）：theater_zone 模式左键拖动出区域矩形（优先于相机平移）。
    if (interactionMode.kind === 'theater_zone' && event.button === 0) {
      zoneDragRef.current = { startX: event.clientX, startY: event.clientY, active: false };
      return;
    }
    // 右键/中键拖动 = 平移相机（inspect 模式左键让位给框选）；非 inspect 模式左键拖动仍平移。
    if (event.button === 2 || event.button === 1 || interactionMode.kind !== 'inspect') {
      dragStateRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        offsetX: camera.offsetX,
        offsetY: camera.offsetY,
      };
      return;
    }
    if (event.button === 0) {
      marqueeRef.current = { startX: event.clientX, startY: event.clientY, active: false };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (dragState) {
      const deltaX = event.clientX - dragState.pointerX;
      const deltaY = event.clientY - dragState.pointerY;
      // 环绕轴自由平移（归一化到等价周期），非环绕轴维持旧钳位（地图中心不出视口）。
      cameraScheduler.schedule({
        offsetX: resolveCameraAxisOffset(planet.map_width * tileSize, viewport.width, dragState.offsetX + deltaX),
        offsetY: resolveCameraAxisOffset(planet.map_height * tileSize, viewport.height, dragState.offsetY + deltaY),
        zoomIndex: camera.zoomIndex,
        ready: true,
      });
      return;
    }
    const zoneDrag = zoneDragRef.current;
    if (zoneDrag) {
      if (!zoneDrag.active && Math.abs(event.clientX - zoneDrag.startX) + Math.abs(event.clientY - zoneDrag.startY) > 4) {
        zoneDrag.active = true;
      }
      if (zoneDrag.active) {
        setZoneDragRect({
          x0: Math.min(zoneDrag.startX, event.clientX),
          y0: Math.min(zoneDrag.startY, event.clientY),
          x1: Math.max(zoneDrag.startX, event.clientX),
          y1: Math.max(zoneDrag.startY, event.clientY),
        });
      }
      return;
    }
    const marquee = marqueeRef.current;
    if (marquee) {
      if (!marquee.active && Math.abs(event.clientX - marquee.startX) + Math.abs(event.clientY - marquee.startY) > 4) {
        marquee.active = true;
      }
      if (marquee.active) {
        setMarqueeRect({
          x0: Math.min(marquee.startX, event.clientX),
          y0: Math.min(marquee.startY, event.clientY),
          x1: Math.max(marquee.startX, event.clientX),
          y1: Math.max(marquee.startY, event.clientY),
        });
      }
      return;
    }
    updateHoveredTile(event.clientX, event.clientY);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStateRef.current) {
      // 右键拖动平移后抑制紧随的 contextmenu（情境指令/取消模式）。
      if (event.button === 2) {
        const moved = Math.abs(event.clientX - dragStateRef.current.pointerX) + Math.abs(event.clientY - dragStateRef.current.pointerY);
        if (moved > 4) {
          suppressContextRef.current = true;
        }
      }
      dragStateRef.current = null;
    }
    const zoneDrag = zoneDragRef.current;
    zoneDragRef.current = null;
    if (zoneDrag) {
      setZoneDragRect(null);
      if (zoneDrag.active) {
        suppressClickRef.current = true;
        const from = clientToTileFloat(zoneDrag.startX, zoneDrag.startY);
        const to = clientToTileFloat(event.clientX, event.clientY);
        if (from && to) {
          onDefineZone?.(theaterZoneFromDragRect(from, to));
        }
      }
      return;
    }
    const marquee = marqueeRef.current;
    marqueeRef.current = null;
    if (marquee?.active) {
      setMarqueeRect(null);
      suppressClickRef.current = true;
      const from = clientToTileFloat(marquee.startX, marquee.startY);
      const to = clientToTileFloat(event.clientX, event.clientY);
      if (from && to) {
        const ids = ownUnitsInTileRect(planet, session.playerId, {
          minX: Math.floor(Math.min(from.x, to.x)),
          minY: Math.floor(Math.min(from.y, to.y)),
          maxX: Math.floor(Math.max(from.x, to.x)),
          maxY: Math.floor(Math.max(from.y, to.y)),
        });
        applyUnitSelection(ids);
      }
      return;
    }
    setMarqueeRect(null);
  }

  /** 多选落库：单选时同步 selected（详情面板），多选/清空时 selected 置空（走底部多选条）。 */
  function applyUnitSelection(ids: string[]) {
    setSelectedUnits(ids);
    if (ids.length === 1) {
      const unit = planet.units?.[ids[0]];
      setSelected(unit ? { kind: 'unit', id: unit.id, position: unit.position } : null);
      if (unit) {
        sfx.uiClick();
      }
    } else {
      setSelected(null);
      if (ids.length > 1) {
        sfx.uiClick();
      }
    }
  }

  function handlePointerLeave() {
    dragStateRef.current = null;
    marqueeRef.current = null;
    zoneDragRef.current = null;
    setMarqueeRect(null);
    setZoneDragRect(null);
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
      offsetX: resolveCameraAxisOffset(planet.map_width * nextTileSize, viewport.width, anchorX - worldX * nextTileSize),
      offsetY: resolveCameraAxisOffset(planet.map_height * nextTileSize, viewport.height, anchorY - worldY * nextTileSize),
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
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(event.clientX, event.clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    if (!tile) {
      return;
    }
    // build/move/attack/unit_order 模式：点击 = 下达指令，不改变选中
    if (interactionMode.kind !== 'inspect') {
      onInteractTile?.(tile);
      return;
    }
    const selection = overviewMode ? null : resolveSelectionAtTile(planet, tile.x, tile.y, usePlanetViewStore.getState().selected);
    if (selection && (selection.kind === 'building' || selection.kind === 'unit')) {
      sfx.uiClick();
    }
    setSelected(selection ?? {
      kind: 'tile',
      position: {
        x: tile.x,
        y: tile.y,
        z: 0,
      },
    });
    // 单选单位同时进入多选集合（右键情境指令/快捷键以 selectedUnits 为命令目标）；
    // 点空白/建筑时清空单位与小队选择（互斥）。
    setSelectedUnits(selection?.kind === 'unit' ? [selection.id] : []);
    setSelectedSquads([]);
  }

  /** 点小队标记（C4）：shift=加选/减选；单选同步 selected（详情面板）与音效。 */
  function handleSelectSquad(squad: CombatSquad, additive: boolean) {
    if (squad.owner_id !== session.playerId) {
      setSelectedSquads([]);
      setSelected({ kind: 'squad', id: squad.id, position: squad.position });
      return;
    }
    if (additive) {
      const next = selectedSquads.includes(squad.id)
        ? selectedSquads.filter((id) => id !== squad.id)
        : [...selectedSquads, squad.id];
      setSelectedSquads(next);
      // 加选后恰好剩一个时同步详情面板，否则清掉单选详情（多选走底部选择条）。
      const remaining = next.length === 1
        ? (squads ?? runtime?.combat_squads ?? []).find((candidate) => candidate.id === next[0])
        : undefined;
      setSelected(remaining ? { kind: 'squad', id: remaining.id, position: remaining.position } : null);
      return;
    }
    setSelectedSquads([squad.id]);
    setSelected({ kind: 'squad', id: squad.id, position: squad.position });
  }

  /**
   * 右键：非 inspect 模式取消当前模式；inspect 模式有己方单位选中时下达情境指令
   * （点敌=批量攻击，点地=批量移动），无选中则不动作。
   */
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (suppressContextRef.current) {
      suppressContextRef.current = false;
      return;
    }
    if (interactionMode.kind !== 'inspect') {
      exitInteractionMode();
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(event.clientX, event.clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    if (tile) {
      onContextTile?.(tile);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (interactionMode.kind !== 'inspect') {
        exitInteractionMode();
        return;
      }
      // inspect 模式 Esc = 清空选择（RTS 惯例）
      const state = usePlanetViewStore.getState();
      if (state.selectedUnits.length > 0 || state.selectedSquads.length > 0 || state.selected) {
        setSelectedUnits([]);
        setSelectedSquads([]);
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitInteractionMode, interactionMode.kind, setSelected, setSelectedSquads, setSelectedUnits]);

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
      const focusTileSize = getPlanetRenderTileSize(DEFAULT_PLANET_OVERVIEW_FOCUS_ZOOM_INDEX, viewport.width, viewport.height, planet.map_width, planet.map_height);
      setCamera({
        offsetX: resolveCameraAxisOffset(planet.map_width * focusTileSize, viewport.width, nextCamera.offsetX),
        offsetY: resolveCameraAxisOffset(planet.map_height * focusTileSize, viewport.height, nextCamera.offsetY),
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
      setSelectedUnits([]);
      return;
    }
    // 双击单位 = 选中视口内全部同类己方单位（RTS 惯例）；其他位置保持聚焦行为
    const hit = resolveSelectionAtTile(planet, tile.x, tile.y);
    if (hit?.kind === 'unit') {
      const unit = planet.units?.[hit.id];
      if (unit && unit.owner_id === session.playerId) {
        applyUnitSelection(sameTypeOwnUnitsInView(planet, session.playerId, hit.id, viewportBounds));
        return;
      }
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
        data-map-height={planet.map_height}
        data-map-width={planet.map_width}
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
        <PlanetHoverTip containerRef={viewportRef} info={hoverInfo} />
        {/* 战区覆盖层（C4）：zones 圆圈 + 告警态（指针穿透，2D 战术视图专属） */}
        {overviewMode ? null : (
          <PlanetTheaterLayer
            offsetX={camera.offsetX}
            offsetY={camera.offsetY}
            planetId={planet.planet_id}
            theaters={theaters}
            tileSize={tileSize}
          />
        )}
        {/* 战斗小队标记层（C4）：点选小队（shift 加选），选中环由标记自绘 */}
        {overviewMode ? null : (
          <PlanetLegionLayer
            offsetX={camera.offsetX}
            offsetY={camera.offsetY}
            onSelectLegion={(legion) => usePlanetViewStore.getState().setSelectedUnits(legionAliveMemberIds(legion, planet.units))}
            playerId={session.playerId}
            squads={squads ?? runtime?.combat_squads}
            tileSize={tileSize}
            units={planet.units}
          />
        )}
        {overviewMode ? null : (
          <PlanetSquadLayer
            offsetX={camera.offsetX}
            offsetY={camera.offsetY}
            onSelectSquad={handleSelectSquad}
            playerId={session.playerId}
            selectedSquads={selectedSquads}
            squads={squads ?? runtime?.combat_squads}
            tileSize={tileSize}
          />
        )}
        {/* 缺电建筑标记（试玩 1010 F）：2D 视图缺电/停机建筑头顶常驻闪电划线角标 */}
        {overviewMode ? null : (
          <PlanetPowerAlertLayer
            networks={networks}
            offsetX={camera.offsetX}
            offsetY={camera.offsetY}
            planet={planet}
            playerId={session.playerId}
            tileSize={tileSize}
          />
        )}
        {marqueeRect ? (
          <div
            aria-hidden="true"
            className="planet-map-canvas__marquee"
            style={{
              left: marqueeRect.x0 - (viewportRef.current?.getBoundingClientRect().left ?? 0),
              top: marqueeRect.y0 - (viewportRef.current?.getBoundingClientRect().top ?? 0),
              width: marqueeRect.x1 - marqueeRect.x0,
              height: marqueeRect.y1 - marqueeRect.y0,
            }}
          />
        ) : null}
        {zoneDragRect ? (
          <div
            aria-hidden="true"
            className="planet-map-canvas__marquee planet-map-canvas__marquee--zone"
            data-testid="theater-zone-drag-rect"
            style={{
              left: zoneDragRect.x0 - (viewportRef.current?.getBoundingClientRect().left ?? 0),
              top: zoneDragRect.y0 - (viewportRef.current?.getBoundingClientRect().top ?? 0),
              width: zoneDragRect.x1 - zoneDragRect.x0,
              height: zoneDragRect.y1 - zoneDragRect.y0,
            }}
          />
        ) : null}
        {/* 来袭方向指示（C3）：黑雾波次 from→target 红线 + 目标闪烁标记（指针穿透）。 */}
        {incomingWaves.length > 0 ? (
          <div aria-hidden="true" className="planet-map-canvas__waves">
            <svg className="planet-map-canvas__waves-svg">
              {incomingWaves.map((wave) => {
                if (!wave.target) {
                  return null;
                }
                const fromX = camera.offsetX + (wave.from.x + 0.5) * tileSize;
                const fromY = camera.offsetY + (wave.from.y + 0.5) * tileSize;
                const toX = camera.offsetX + (wave.target.x + 0.5) * tileSize;
                const toY = camera.offsetY + (wave.target.y + 0.5) * tileSize;
                return (
                  <line
                    key={wave.id}
                    className="planet-map-canvas__wave-line"
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                  />
                );
              })}
            </svg>
            {incomingWaves.map((wave) => {
              const tile = wave.target ?? wave.from;
              return (
                <div
                  key={`${wave.id}:marker`}
                  className="planet-map-canvas__wave-marker"
                  style={{
                    left: camera.offsetX + (tile.x + 0.5) * tileSize,
                    top: camera.offsetY + (tile.y + 0.5) * tileSize,
                  }}
                />
              );
            })}
          </div>
        ) : null}
        <div aria-label="立方体六面展开边界" style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden'}}>
          {CUBE_FACES.map((face,index)=><div key={face.name} style={{position:'absolute',left:camera.offsetX+index%3*planet.map_width/3*tileSize,top:camera.offsetY+Math.floor(index/3)*planet.map_width/3*tileSize,width:planet.map_width/3*tileSize,height:planet.map_width/3*tileSize,border:'2px dashed #e0c173',boxSizing:'border-box',color:'#ffe9ad',padding:8,fontWeight:700}}>{face.name} 面</div>)}
        </div>
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
        <span>六面展开图 · 虚线两侧不一定相邻，跨面连接请使用球面视图</span>
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
        {interactionMode.kind === 'unit_order' ? (
          <span className="planet-map-canvas__mode planet-map-canvas__mode--attack">
            {interactionMode.order === 'attack_move' ? '攻击移动：点击目标点（沿途交战）' : interactionMode.order === 'patrol' ? '巡逻：点击巡逻目标点' : '守卫：点击要守卫的目标'} · 右键/Esc 取消
          </span>
        ) : null}
        {interactionMode.kind === 'theater_zone' ? (
          <span className="planet-map-canvas__mode planet-map-canvas__mode--zone">
            战区划定：{theaterZoneTypeLabel(interactionMode.zoneType)} · 左键拖拽矩形画出区域 · 右键/Esc 退出
          </span>
        ) : null}
        {selectedUnits.length > 1 ? <span className="planet-map-canvas__mode">已框选 {selectedUnits.length} 个单位 · 右键移动/攻击</span> : null}
        {selectedSquads.length > 0 ? <span className="planet-map-canvas__mode">已选 {selectedSquads.length} 个小队 · 右键点地部署任务群</span> : null}
        <span>{selectionLabel(selected)}</span>
        {simplificationMessages.length > 0 ? <span>低缩放简化</span> : null}
        {simplificationMessages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </div>
    </div>
  );
}
