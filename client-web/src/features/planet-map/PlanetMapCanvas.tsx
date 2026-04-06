import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import type { CatalogView, FogMapView, PlanetNetworksView, PlanetOverviewView, PlanetRuntimeView, PlanetSceneView } from '@shared/types';

import {
  buildSceneWindow,
  clamp,
  getBuildingDisplayName,
  getBuildingFootprint,
  getBuildingList,
  getFogState,
  getResourceList,
  getTerrainTile,
  getUnitList,
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
  isBuildingFootprintVisible,
  isPositionVisible,
  isTilePointVisible,
} from '@/features/planet-map/render';
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

const MIN_VIEWPORT_WIDTH = 520;
const MIN_VIEWPORT_HEIGHT = 420;

const terrainColors: Record<string, string> = {
  buildable: '#27344d',
  blocked: '#0f1625',
  water: '#225b87',
  lava: '#9a4624',
  unknown: '#1a2236',
};

const resourceColors: Record<string, string> = {
  iron_ore: '#8ea5b8',
  copper_ore: '#e38d4a',
  coal: '#666b73',
  stone: '#c8c0a4',
  oil: '#4d3a89',
  silicon_ore: '#6fc5c2',
};

function getResourceColor(kind: string) {
  return resourceColors[kind] ?? '#d2c06f';
}

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

function tileCenter(cameraOffset: number, tile: number, tileSize: number) {
  return cameraOffset + ((tile + 0.5) * tileSize);
}

function drawCenteredLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number) {
  context.save();
  context.fillStyle = 'rgba(5, 12, 22, 0.82)';
  const width = context.measureText(text).width + 8;
  context.fillRect(x - (width / 2), y - 10, width, 14);
  context.fillStyle = '#edf6ff';
  context.fillText(text, x - (width / 2) + 4, y);
  context.restore();
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

export function PlanetMapCanvas({ catalog, fog, networks, overview, planet, runtime, onCanvasReady }: PlanetMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseFrameCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const buildingList = useMemo(() => getBuildingList(planet), [planet]);
  const unitList = useMemo(() => getUnitList(planet), [planet]);
  const resourceList = useMemo(() => getResourceList(planet), [planet]);
  const logisticsDrones = runtime?.available ? runtime.logistics_drones ?? [] : [];
  const logisticsShips = runtime?.available ? runtime.logistics_ships ?? [] : [];
  const constructionTasks = runtime?.available ? runtime.construction_tasks ?? [] : [];
  const enemyForces = runtime?.available ? runtime.enemy_forces ?? [] : [];
  const detections = runtime?.available ? runtime.detections ?? [] : [];
  const powerLinks = networks?.available ? networks.power_links ?? [] : [];
  const powerCoverage = networks?.available ? networks.power_coverage ?? [] : [];
  const pipelineNodes = networks?.available ? networks.pipeline_nodes ?? [] : [];
  const pipelineSegments = networks?.available ? networks.pipeline_segments ?? [] : [];
  const zoomLevel = getPlanetZoomLevel(camera.zoomIndex);
  const overviewMode = isPlanetOverviewZoom(camera.zoomIndex);
  const tileSize = getPlanetRenderTileSize(camera.zoomIndex, viewport.width, viewport.height, planet.map_width, planet.map_height);
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
  const visibleBuildings = useMemo(
    () => buildingList.filter((building) => isBuildingFootprintVisible(building, viewportBounds, 1)),
    [buildingList, viewportBounds],
  );
  const visibleUnits = useMemo(
    () => unitList.filter((unit) => isPositionVisible(unit.position, viewportBounds, 1)),
    [unitList, viewportBounds],
  );
  const visibleResources = useMemo(
    () => resourceList.filter((resource) => isPositionVisible(resource.position, viewportBounds, 1)),
    [resourceList, viewportBounds],
  );
  const visibleLogisticsDrones = useMemo(
    () => logisticsDrones.filter((drone) => (
      isPositionVisible(drone.position, viewportBounds, 1)
      || Boolean(drone.target_pos && isPositionVisible(drone.target_pos, viewportBounds, 1))
    )),
    [logisticsDrones, viewportBounds],
  );
  const visibleLogisticsShips = useMemo(
    () => logisticsShips.filter((ship) => (
      isPositionVisible(ship.position, viewportBounds, 1)
      || Boolean(ship.target_pos && isPositionVisible(ship.target_pos, viewportBounds, 1))
    )),
    [logisticsShips, viewportBounds],
  );
  const visibleConstructionTasks = useMemo(
    () => constructionTasks.filter((task) => isPositionVisible(task.position, viewportBounds, 1)),
    [constructionTasks, viewportBounds],
  );
  const visibleEnemyForces = useMemo(
    () => enemyForces.filter((force) => isPositionVisible(force.position, viewportBounds, 1)),
    [enemyForces, viewportBounds],
  );
  const visibleDetections = useMemo(
    () => detections.filter((detection) => (
      (detection.detected_positions ?? []).some((position) => isPositionVisible(position, viewportBounds, 1))
    )),
    [detections, viewportBounds],
  );
  const visiblePowerLinks = useMemo(
    () => powerLinks.filter((link) => (
      isPositionVisible(link.from_position, viewportBounds, 1)
      || isPositionVisible(link.to_position, viewportBounds, 1)
    )),
    [powerLinks, viewportBounds],
  );
  const visiblePowerCoverage = useMemo(
    () => powerCoverage.filter((coverage) => isPositionVisible(coverage.position, viewportBounds, 1)),
    [powerCoverage, viewportBounds],
  );
  const visiblePipelineSegments = useMemo(
    () => pipelineSegments.filter((segment) => (
      isPositionVisible(segment.from_position, viewportBounds, 1)
      || isPositionVisible(segment.to_position, viewportBounds, 1)
    )),
    [pipelineSegments, viewportBounds],
  );
  const visiblePipelineNodes = useMemo(
    () => pipelineNodes.filter((node) => isPositionVisible(node.position, viewportBounds, 1)),
    [pipelineNodes, viewportBounds],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    function updateViewport() {
      const rect = containerRef.current?.getBoundingClientRect();
      setViewport({
        width: Math.max(MIN_VIEWPORT_WIDTH, Math.floor(rect?.width || 0) || getViewportDefaults().width),
        height: Math.max(MIN_VIEWPORT_HEIGHT, Math.floor(rect?.height || 0) || getViewportDefaults().height),
      });
    }

    updateViewport();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateViewport());
      resizeObserver.observe(containerRef.current);
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
  }, [hoverScheduler]);

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

    if (layers.resources) {
      visibleResources.forEach((resource) => {
        const position = toTilePoint(resource.position);
        const screenX = camera.offsetX + ((position.x + 0.5) * tileSize);
        const screenY = camera.offsetY + ((position.y + 0.5) * tileSize);
        context.fillStyle = getResourceColor(resource.kind);
        context.beginPath();
        context.arc(screenX, screenY, Math.max(2, tileSize * (detailPolicy.simplifyStructures ? 0.18 : 0.24)), 0, Math.PI * 2);
        context.fill();
      });
    }

    if (layers.buildings) {
      visibleBuildings.forEach((building) => {
        const { width, height } = getBuildingFootprint(building);
        const position = toTilePoint(building.position);
        const screenX = camera.offsetX + (position.x * tileSize);
        const screenY = camera.offsetY + (position.y * tileSize);
        const pixelWidth = width * tileSize;
        const pixelHeight = height * tileSize;

        if (detailPolicy.simplifyStructures) {
          context.fillStyle = building.owner_id === session.playerId ? 'rgba(36, 201, 182, 0.4)' : 'rgba(222, 87, 87, 0.38)';
          context.fillRect(screenX, screenY, Math.max(pixelWidth, 2), Math.max(pixelHeight, 2));
        } else {
          context.fillStyle = building.owner_id === session.playerId ? 'rgba(36, 201, 182, 0.26)' : 'rgba(222, 87, 87, 0.22)';
          context.fillRect(screenX + 1, screenY + 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2));
          context.strokeStyle = building.owner_id === session.playerId ? '#57efe0' : '#ff7b7b';
          context.lineWidth = 2;
          context.strokeRect(screenX + 1, screenY + 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2));
        }

        if (detailPolicy.showBuildingLabels) {
          context.fillStyle = '#edf6ff';
          context.font = '11px sans-serif';
          context.fillText(getBuildingDisplayName(catalog, building.type).slice(0, 6), screenX + 4, screenY + 14);
        }
      });
    }

    if (layers.units) {
      visibleUnits.forEach((unit) => {
        const position = toTilePoint(unit.position);
        const screenX = camera.offsetX + ((position.x + 0.5) * tileSize);
        const screenY = camera.offsetY + ((position.y + 0.5) * tileSize);
        context.fillStyle = unit.owner_id === session.playerId ? '#91ff70' : '#ff6262';
        if (detailPolicy.simplifyStructures) {
          const size = Math.max(3, tileSize * 0.32);
          context.fillRect(screenX - (size / 2), screenY - (size / 2), size, size);
        } else {
          context.beginPath();
          context.arc(screenX, screenY, Math.max(3, tileSize * 0.22), 0, Math.PI * 2);
          context.fill();
        }
      });
    }

    if (layers.logistics) {
      context.save();
      context.lineWidth = 2;
      visibleLogisticsDrones.forEach((drone) => {
        const start = toTilePoint(drone.position);
        const startX = tileCenter(camera.offsetX, start.x, tileSize);
        const startY = tileCenter(camera.offsetY, start.y, tileSize);
        if (drone.target_pos) {
          const target = toTilePoint(drone.target_pos);
          context.setLineDash([8, 6]);
          context.strokeStyle = 'rgba(45, 212, 191, 0.72)';
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(tileCenter(camera.offsetX, target.x, tileSize), tileCenter(camera.offsetY, target.y, tileSize));
          context.stroke();
        }
        context.setLineDash([]);
        context.fillStyle = '#2dd4bf';
        context.beginPath();
        context.arc(startX, startY, Math.max(4, tileSize * 0.18), 0, Math.PI * 2);
        context.fill();
      });
      visibleLogisticsShips.forEach((ship) => {
        const start = toTilePoint(ship.position);
        const startX = tileCenter(camera.offsetX, start.x, tileSize);
        const startY = tileCenter(camera.offsetY, start.y, tileSize);
        if (ship.target_pos) {
          const target = toTilePoint(ship.target_pos);
          context.setLineDash([2, 8]);
          context.strokeStyle = 'rgba(255, 224, 102, 0.68)';
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(tileCenter(camera.offsetX, target.x, tileSize), tileCenter(camera.offsetY, target.y, tileSize));
          context.stroke();
        }
        context.setLineDash([]);
        context.fillStyle = '#ffe066';
        context.fillRect(startX - Math.max(3, tileSize * 0.16), startY - Math.max(3, tileSize * 0.16), Math.max(6, tileSize * 0.32), Math.max(6, tileSize * 0.32));
      });
      context.restore();
    }

    if (layers.power) {
      context.save();
      visiblePowerLinks.forEach((link) => {
        const from = toTilePoint(link.from_position);
        const to = toTilePoint(link.to_position);
        context.beginPath();
        context.setLineDash(link.kind === 'wireless' ? [6, 6] : []);
        context.strokeStyle = link.kind === 'wireless' ? 'rgba(255, 212, 59, 0.72)' : 'rgba(116, 192, 252, 0.72)';
        context.lineWidth = link.kind === 'wireless' ? 2 : 3;
        context.moveTo(tileCenter(camera.offsetX, from.x, tileSize), tileCenter(camera.offsetY, from.y, tileSize));
        context.lineTo(tileCenter(camera.offsetX, to.x, tileSize), tileCenter(camera.offsetY, to.y, tileSize));
        context.stroke();
      });
      context.setLineDash([]);
      visiblePowerCoverage.forEach((coverage) => {
        const point = toTilePoint(coverage.position);
        const centerX = tileCenter(camera.offsetX, point.x, tileSize);
        const centerY = tileCenter(camera.offsetY, point.y, tileSize);
        context.strokeStyle = coverage.connected ? 'rgba(116, 192, 252, 0.92)' : 'rgba(255, 107, 107, 0.92)';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(centerX, centerY, Math.max(6, tileSize * 0.32), 0, Math.PI * 2);
        context.stroke();
      });
      context.restore();
    }

    if (layers.pipelines) {
      context.save();
      visiblePipelineSegments.forEach((segment) => {
        const from = toTilePoint(segment.from_position);
        const to = toTilePoint(segment.to_position);
        context.strokeStyle = 'rgba(99, 230, 190, 0.78)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(tileCenter(camera.offsetX, from.x, tileSize), tileCenter(camera.offsetY, from.y, tileSize));
        context.lineTo(tileCenter(camera.offsetX, to.x, tileSize), tileCenter(camera.offsetY, to.y, tileSize));
        context.stroke();
      });
      visiblePipelineNodes.forEach((node) => {
        const point = toTilePoint(node.position);
        const centerX = tileCenter(camera.offsetX, point.x, tileSize);
        const centerY = tileCenter(camera.offsetY, point.y, tileSize);
        context.fillStyle = node.fluid_id ? getResourceColor(node.fluid_id) : '#63e6be';
        context.fillRect(centerX - Math.max(3, tileSize * 0.18), centerY - Math.max(3, tileSize * 0.18), Math.max(6, tileSize * 0.36), Math.max(6, tileSize * 0.36));
      });
      context.restore();
    }

    if (layers.construction) {
      context.save();
      visibleConstructionTasks.forEach((task) => {
        const point = toTilePoint(task.position);
        const screenX = camera.offsetX + (point.x * tileSize);
        const screenY = camera.offsetY + (point.y * tileSize);
        const color = task.state === 'in_progress'
          ? 'rgba(255, 224, 102, 0.9)'
          : task.state === 'paused'
            ? 'rgba(255, 146, 43, 0.9)'
            : task.state === 'cancelled'
              ? 'rgba(255, 107, 107, 0.9)'
              : 'rgba(148, 216, 45, 0.9)';
        context.strokeStyle = color;
        context.lineWidth = 3;
        context.strokeRect(screenX + 2, screenY + 2, Math.max(tileSize - 4, 4), Math.max(tileSize - 4, 4));
        if (tileSize >= 24) {
          context.font = '11px sans-serif';
          drawCenteredLabel(context, task.state, screenX + (tileSize / 2), screenY + 14);
        }
      });
      context.restore();
    }

    if (layers.threat) {
      context.save();
      visibleEnemyForces.forEach((force) => {
        const point = toTilePoint(force.position);
        const centerX = tileCenter(camera.offsetX, point.x, tileSize);
        const centerY = tileCenter(camera.offsetY, point.y, tileSize);
        context.fillStyle = 'rgba(255, 107, 107, 0.88)';
        context.beginPath();
        context.moveTo(centerX, centerY - Math.max(6, tileSize * 0.28));
        context.lineTo(centerX + Math.max(6, tileSize * 0.28), centerY);
        context.lineTo(centerX, centerY + Math.max(6, tileSize * 0.28));
        context.lineTo(centerX - Math.max(6, tileSize * 0.28), centerY);
        context.closePath();
        context.fill();
      });
      visibleDetections.forEach((detection) => {
        detection.detected_positions?.forEach((position) => {
          if (!isPositionVisible(position, viewportBounds, 1)) {
            return;
          }
          const point = toTilePoint(position);
          const centerX = tileCenter(camera.offsetX, point.x, tileSize);
          const centerY = tileCenter(camera.offsetY, point.y, tileSize);
          context.strokeStyle = 'rgba(255, 212, 59, 0.76)';
          context.lineWidth = 2;
          context.beginPath();
          context.arc(centerX, centerY, Math.max(5, tileSize * 0.22), 0, Math.PI * 2);
          context.stroke();
        });
      });
      context.restore();
    }

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
    catalog,
    constructionTasks,
    detailPolicy,
    fog,
    layers,
    logisticsDrones,
    logisticsShips,
    overview,
    overviewMode,
    planet,
    powerCoverage,
    powerLinks,
    session.playerId,
    tileSize,
    viewport,
    viewportBounds,
    visibleBuildings,
    visibleConstructionTasks,
    visibleDetections,
    visibleEnemyForces,
    visibleLogisticsDrones,
    visibleLogisticsShips,
    visiblePipelineNodes,
    visiblePipelineSegments,
    visiblePowerCoverage,
    visiblePowerLinks,
    visibleResources,
    visibleUnits,
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
      setCamera({
        offsetX: dragState.offsetX + deltaX,
        offsetY: dragState.offsetY + deltaY,
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

    setCamera({
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
    <div className="planet-map-canvas" ref={containerRef}>
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
