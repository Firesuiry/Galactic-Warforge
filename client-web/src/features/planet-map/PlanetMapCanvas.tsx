import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import type { CatalogView, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView } from '@shared/types';

import {
  buildSceneWindow,
  clamp,
  getFogState,
  getTerrainTile,
  getViewportTileBounds,
  type PlanetRenderView,
  resolveSelectionAtTile,
  selectionLabel,
  type TilePoint,
  toTilePoint,
} from '@/features/planet-map/model';
import {
  createAnimationFrameValueScheduler,
  describeSceneRenderSimplifications,
  getSceneRenderDetailPolicy,
  isTilePointVisible,
} from '@/features/planet-map/render';
import { collectVisibleEntities } from '@/features/planet-map/entity-draw';
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

interface PlanetMapCanvasProps {
  catalog?: CatalogView;
  fog?: FogMapView | PlanetSceneView;
  networks?: PlanetNetworksView;
  overview?: PlanetOverviewView;
  planet: PlanetRenderView;
  runtime?: PlanetRuntimeView;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

interface ViewportSize {
  width: number;
  height: number;
}

const MIN_VIEWPORT_WIDTH = 240;
const MIN_VIEWPORT_HEIGHT = 240;

const terrainColors: Record<string, string> = {
  buildable: '#27344d',
  blocked: '#0f1625',
  water: '#225b87',
  lava: '#9a4624',
  unknown: '#1a2236',
};

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
  return {
    offsetX: worldWidth < viewport.width ? (viewport.width - worldWidth) / 2 : 32,
    offsetY: worldHeight < viewport.height ? (viewport.height - worldHeight) / 2 : 32,
  };
}

function centerCameraOnTile(viewport: ViewportSize, planet: PlanetRenderView, zoomIndex: number, x: number, y: number) {
  const tileSize = getPlanetRenderTileSize(zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
  return {
    offsetX: (viewport.width / 2) - ((x + 0.5) * tileSize),
    offsetY: (viewport.height / 2) - ((y + 0.5) * tileSize),
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

function drawOverviewHeatmap(
  context: CanvasRenderingContext2D,
  counts: number[][] | undefined,
  tileSize: number,
  step: number,
  offsetX: number,
  offsetY: number,
  color: string,
) {
  if (!counts || counts.length === 0) {
    return;
  }
  const maxCount = counts.reduce(
    (best, row) => Math.max(best, ...row),
    0,
  );
  if (maxCount <= 0) {
    return;
  }
  const cellSize = Math.max(tileSize * step, 1);
  counts.forEach((row, cellY) => {
    row.forEach((count, cellX) => {
      if (count <= 0) {
        return;
      }
      context.fillStyle = color.replace('{alpha}', (0.18 + ((count / maxCount) * 0.55)).toFixed(3));
      context.fillRect(
        offsetX + (cellX * cellSize),
        offsetY + (cellY * cellSize),
        Math.max(cellSize - 1, 1),
        Math.max(cellSize - 1, 1),
      );
    });
  });
}

function resizeCanvas(canvas: HTMLCanvasElement, viewport: ViewportSize, dpr: number, syncStyle: boolean) {
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  if (syncStyle) {
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }
}

function drawCanvasBackdrop(context: CanvasRenderingContext2D, viewport: ViewportSize) {
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.fillStyle = '#07101d';
  context.fillRect(0, 0, viewport.width, viewport.height);
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

export function PlanetMapCanvas({ catalog, fog, networks, overview, planet, runtime, onCanvasReady }: PlanetMapCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseFrameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const entityLayerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const previousZoomIndexRef = useRef(DEFAULT_PLANET_ZOOM_INDEX);
  const [viewport, setViewport] = useState<ViewportSize>(getViewportDefaults);

  const {
    camera,
    focusRequest,
    hoveredTile,
    layers,
    selected,
    consumeFocusRequest,
    requestFocus,
    setCamera,
    setSceneWindow,
    setHoveredTile,
    setSelected,
  } = usePlanetViewStore(useShallow((state) => ({
    camera: state.camera,
    focusRequest: state.focusRequest,
    hoveredTile: state.hoveredTile,
    layers: state.layers,
    selected: state.selected,
    consumeFocusRequest: state.consumeFocusRequest,
    requestFocus: state.requestFocus,
    setCamera: state.setCamera,
    setSceneWindow: state.setSceneWindow,
    setHoveredTile: state.setHoveredTile,
    setSelected: state.setSelected,
  })));
  const session = useSessionSnapshot();

  const zoomLevel = getPlanetZoomLevel(camera.zoomIndex);
  const overviewMode = isPlanetOverviewZoom(camera.zoomIndex);
  const tileSize = getPlanetRenderTileSize(camera.zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
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
          return layers.grid;
        }
        if (message === '迷雾已合并') {
          return layers.fog;
        }
        if (message === '建筑与单位已简化') {
          return layers.buildings || layers.units;
        }
        return true;
      });
    },
    [detailPolicy, layers.buildings, layers.fog, layers.grid, layers.units, overviewMode],
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
  // 拖拽/滚轮的高频 setCamera 走 rAF 合帧：N 次 pointermove/scroll 在同一帧只提交一次相机状态，
  // 避免每个事件触发整屏逐格重绘（实测拖拽曾达 4110 fillRect/移动）。与 hover 同样的合帧机制。
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

  useEffect(() => {
    onCanvasReady?.(canvasRef.current);
    return () => {
      onCanvasReady?.(null);
    };
  }, [onCanvasReady]);

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

  useEffect(() => {
    if (!camera.ready || overviewMode) {
      return;
    }
    const nextSceneWindow = buildSceneWindow(planet, camera, tileSize, viewport.width, viewport.height);
    setSceneWindow(nextSceneWindow);
  }, [camera, overviewMode, planet, setSceneWindow, tileSize, viewport.height, viewport.width]);

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

  useEffect(() => {
    const baseCanvas = baseFrameCanvasRef.current ?? document.createElement('canvas');
    baseFrameCanvasRef.current = baseCanvas;
    const context = baseCanvas.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    resizeCanvas(baseCanvas, viewport, dpr, false);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCanvasBackdrop(context, viewport);

    const startX = Math.max(viewportBounds.minX - 1, 0);
    const startY = Math.max(viewportBounds.minY - 1, 0);
    const endX = Math.min(viewportBounds.maxX + 2, planet.map_width);
    const endY = Math.min(viewportBounds.maxY + 2, planet.map_height);

    if (overviewMode && overview) {
      const step = Math.max(overview.step || 1, 1);
      const cellSize = Math.max(tileSize * step, 1);
      const terrain = overview.terrain ?? [];

      if (layers.terrain) {
        terrain.forEach((row, cellY) => {
          row.forEach((tile, cellX) => {
            context.fillStyle = terrainColors[tile] ?? terrainColors.unknown;
            context.fillRect(
              camera.offsetX + (cellX * cellSize),
              camera.offsetY + (cellY * cellSize),
              Math.max(cellSize, 1),
              Math.max(cellSize, 1),
            );
          });
        });
      }

      if (layers.grid && cellSize >= 10) {
        context.strokeStyle = 'rgba(210, 226, 255, 0.12)';
        context.lineWidth = 1;
        for (let x = 0; x <= overview.cells_width; x += 1) {
          const screenX = camera.offsetX + (x * cellSize);
          context.beginPath();
          context.moveTo(screenX, camera.offsetY);
          context.lineTo(screenX, camera.offsetY + (overview.cells_height * cellSize));
          context.stroke();
        }
        for (let y = 0; y <= overview.cells_height; y += 1) {
          const screenY = camera.offsetY + (y * cellSize);
          context.beginPath();
          context.moveTo(camera.offsetX, screenY);
          context.lineTo(camera.offsetX + (overview.cells_width * cellSize), screenY);
          context.stroke();
        }
      }

      if (layers.resources) {
        drawOverviewHeatmap(context, overview.resource_counts, tileSize, step, camera.offsetX, camera.offsetY, 'rgba(210, 192, 111, {alpha})');
      }
      if (layers.buildings) {
        drawOverviewHeatmap(context, overview.building_counts, tileSize, step, camera.offsetX, camera.offsetY, 'rgba(36, 201, 182, {alpha})');
      }
      if (layers.units) {
        drawOverviewHeatmap(context, overview.unit_counts, tileSize, step, camera.offsetX, camera.offsetY, 'rgba(145, 255, 112, {alpha})');
      }

      if (layers.fog) {
        const visible = overview.visible ?? [];
        const explored = overview.explored ?? [];
        for (let cellY = 0; cellY < overview.cells_height; cellY += 1) {
          for (let cellX = 0; cellX < overview.cells_width; cellX += 1) {
            const isVisible = Boolean(visible[cellY]?.[cellX]);
            const isExplored = Boolean(explored[cellY]?.[cellX]);
            if (isVisible) {
              continue;
            }
            context.fillStyle = isExplored ? 'rgba(7, 11, 20, 0.4)' : 'rgba(0, 0, 0, 0.86)';
            context.fillRect(
              camera.offsetX + (cellX * cellSize),
              camera.offsetY + (cellY * cellSize),
              Math.max(cellSize, 1),
              Math.max(cellSize, 1),
            );
          }
        }
      }
      return;
    }

    if (layers.terrain) {
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          context.fillStyle = terrainColors[getTerrainTile(planet, x, y)] ?? terrainColors.unknown;
          context.fillRect(camera.offsetX + (x * tileSize), camera.offsetY + (y * tileSize), tileSize, tileSize);
        }
      }
    }

    if (layers.grid && detailPolicy.showSceneGrid) {
      context.strokeStyle = 'rgba(210, 226, 255, 0.08)';
      context.lineWidth = 1;
      for (let x = startX; x <= endX; x += 1) {
        const screenX = camera.offsetX + (x * tileSize);
        context.beginPath();
        context.moveTo(screenX, camera.offsetY + (startY * tileSize));
        context.lineTo(screenX, camera.offsetY + (endY * tileSize));
        context.stroke();
      }
      for (let y = startY; y <= endY; y += 1) {
        const screenY = camera.offsetY + (y * tileSize);
        context.beginPath();
        context.moveTo(camera.offsetX + (startX * tileSize), screenY);
        context.lineTo(camera.offsetX + (endX * tileSize), screenY);
        context.stroke();
      }
    }

    // 实体（资源/建筑/单位/物流/电力/管道/工地/敌情）已迁到 DOM 实体层（PlanetEntityLayer），
    // 不再在 canvas 上绘制。canvas 只保留底图：地形 / 网格 / 迷雾 / overview 热力图。
    // 实体的 canvas 绘制函数保留在 entity-draw.ts，供 PNG 导出（exportScreenshot）合成全保真截图。

    if (layers.fog && fog) {
      const fogStride = detailPolicy.simplifyFog
        ? Math.max(2, Math.ceil(6 / Math.max(tileSize, 1)))
        : 1;
      for (let y = startY; y < endY; y += fogStride) {
        for (let x = startX; x < endX; x += fogStride) {
          const blockEndX = Math.min(x + fogStride, endX);
          const blockEndY = Math.min(y + fogStride, endY);
          let blockVisible = true;
          let blockExplored = false;

          for (let sampleY = y; sampleY < blockEndY; sampleY += 1) {
            for (let sampleX = x; sampleX < blockEndX; sampleX += 1) {
              const tileFog = getFogState(fog, sampleX, sampleY);
              blockVisible = blockVisible && tileFog.visible;
              blockExplored = blockExplored || tileFog.explored;
            }
          }

          if (blockVisible) {
            continue;
          }
          context.fillStyle = blockExplored ? 'rgba(7, 11, 20, 0.44)' : 'rgba(0, 0, 0, 0.9)';
          context.fillRect(
            camera.offsetX + (x * tileSize),
            camera.offsetY + (y * tileSize),
            (blockEndX - x) * tileSize,
            (blockEndY - y) * tileSize,
          );
        }
      }
    }
  }, [
    camera.offsetX,
    camera.offsetY,
    detailPolicy,
    fog,
    layers,
    overview,
    overviewMode,
    planet,
    tileSize,
    viewport,
    viewportBounds,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    resizeCanvas(canvas, viewport, dpr, true);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCanvasBackdrop(context, viewport);

    const baseCanvas = baseFrameCanvasRef.current;
    if (baseCanvas) {
      context.drawImage(
        baseCanvas,
        0,
        0,
        baseCanvas.width,
        baseCanvas.height,
        0,
        0,
        viewport.width,
        viewport.height,
      );
    }

    if (!layers.selection) {
      return;
    }

    if (overviewMode && overview) {
      const highlightTile = selected ? toTilePoint(selected.position) : hoveredTile;
      if (!highlightTile) {
        return;
      }

      const step = Math.max(overview.step || 1, 1);
      const cellSize = Math.max(tileSize * step, 1);
      const cellX = Math.floor(highlightTile.x / step);
      const cellY = Math.floor(highlightTile.y / step);
      const screenX = camera.offsetX + (cellX * cellSize);
      const screenY = camera.offsetY + (cellY * cellSize);
      context.strokeStyle = selected ? '#ffd166' : 'rgba(255, 255, 255, 0.7)';
      context.lineWidth = selected ? 3 : 2;
      context.strokeRect(screenX + 1, screenY + 1, Math.max(cellSize - 2, 2), Math.max(cellSize - 2, 2));
      return;
    }

    const highlightTile = selected ? toTilePoint(selected.position) : hoveredTile;
    if (!highlightTile || !isTilePointVisible(highlightTile, viewportBounds, 1)) {
      return;
    }

    const screenX = camera.offsetX + (highlightTile.x * tileSize);
    const screenY = camera.offsetY + (highlightTile.y * tileSize);
    context.strokeStyle = selected ? '#ffd166' : 'rgba(255, 255, 255, 0.65)';
    context.lineWidth = selected ? 3 : 2;
    context.strokeRect(screenX + 1.5, screenY + 1.5, Math.max(tileSize - 3, 2), Math.max(tileSize - 3, 2));
  }, [
    camera.offsetX,
    camera.offsetY,
    hoveredTile,
    layers,
    overview,
    overviewMode,
    selected,
    tileSize,
    viewport,
    viewportBounds,
  ]);

  function updateHoveredTile(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(clientX, clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    hoverScheduler.schedule(tile);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
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

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const dragState = dragStateRef.current;
    if (dragState) {
      const deltaX = event.clientX - dragState.pointerX;
      const deltaY = event.clientY - dragState.pointerY;
      cameraScheduler.schedule({
        offsetX: dragState.offsetX + deltaX,
        offsetY: dragState.offsetY + deltaY,
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

  function handleWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const nextZoomIndex = clamp(camera.zoomIndex + (event.deltaY < 0 ? 1 : -1), 0, PLANET_ZOOM_LEVELS.length - 1);
    if (nextZoomIndex === camera.zoomIndex) {
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const currentTileSize = getPlanetRenderTileSize(camera.zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
    const nextTileSize = getPlanetRenderTileSize(nextZoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
    const worldX = (event.clientX - rect.left - camera.offsetX) / currentTileSize;
    const worldY = (event.clientY - rect.top - camera.offsetY) / currentTileSize;

    cameraScheduler.schedule({
      zoomIndex: nextZoomIndex,
      offsetX: event.clientX - rect.left - (worldX * nextTileSize),
      offsetY: event.clientY - rect.top - (worldY * nextTileSize),
      ready: true,
    });
  }

  function handleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(event.clientX, event.clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    if (!tile) {
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

  function handleDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
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
      <div className="planet-map-canvas__viewport" ref={viewportRef}>
        <canvas
          aria-label="行星地图"
          className="planet-map-canvas__surface"
          data-camera-offset-x={camera.offsetX}
          data-camera-offset-y={camera.offsetY}
          data-tile-size={tileSize}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerLeave={handlePointerLeave}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          ref={canvasRef}
          role="img"
        />
        {/*
          语义实体层：叠在 canvas 底图之上的只读 DOM。pointer-events:none，点击穿透回 canvas，
          命中检测仍走 canvas 的 pointToTile → resolveSelectionAtTile（保留建筑>单位>资源>地块优先级）。
          实体节点由 PlanetEntityLayer 渲染；本 div 仅作 transform/--tile 容器，供 useImperativeCameraTransform 写入。
        */}
        {/*
          语义实体层：叠在 canvas 底图之上的只读 DOM。pointer-events:none，点击穿透回 canvas，
          命中检测仍走 canvas 的 pointToTile → resolveSelectionAtTile（保留建筑>单位>资源>地块优先级）。
          本 div 作为 transform/--tile 容器（由 useImperativeCameraTransform 写入），
          内部节点由 PlanetEntityLayer 渲染（按 tile 空间定位，随容器整体平移/缩放）。
        */}
        <div className="entity-layer" ref={entityLayerRef} aria-hidden="true">
          <PlanetEntityLayer
            catalog={catalog}
            playerId={session.playerId}
            tileSize={tileSize}
            detailPolicy={detailPolicy}
            overviewMode={overviewMode}
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
        <span>{selectionLabel(selected)}</span>
        {simplificationMessages.length > 0 ? <span>低缩放简化</span> : null}
        {simplificationMessages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </div>
    </div>
  );
}
