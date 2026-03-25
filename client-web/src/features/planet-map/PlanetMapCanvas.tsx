import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import type { CatalogView, FogMapView, PlanetNetworksView, PlanetRuntimeView, PlanetView } from '@shared/types';

import {
  clamp,
  getBuildingDisplayName,
  getBuildingFootprint,
  getBuildingList,
  getFogState,
  getResourceList,
  getTerrainTile,
  getUnitList,
  resolveSelectionAtTile,
  selectionLabel,
  toTilePoint,
} from '@/features/planet-map/model';
import { PLANET_ZOOM_LEVELS, usePlanetViewStore } from '@/features/planet-map/store';
import { useSessionSnapshot } from '@/hooks/use-session';

interface PlanetMapCanvasProps {
  catalog?: CatalogView;
  fog?: FogMapView;
  networks?: PlanetNetworksView;
  planet: PlanetView;
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

function createInitialCamera(viewport: ViewportSize, planet: PlanetView, zoomIndex: number) {
  const tileSize = PLANET_ZOOM_LEVELS[zoomIndex];
  const worldWidth = planet.map_width * tileSize;
  const worldHeight = planet.map_height * tileSize;
  return {
    offsetX: worldWidth < viewport.width ? (viewport.width - worldWidth) / 2 : 32,
    offsetY: worldHeight < viewport.height ? (viewport.height - worldHeight) / 2 : 32,
  };
}

function centerCameraOnTile(viewport: ViewportSize, zoomIndex: number, x: number, y: number) {
  const tileSize = PLANET_ZOOM_LEVELS[zoomIndex];
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
  planet: PlanetView,
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

export function PlanetMapCanvas({ catalog, fog, networks, planet, runtime, onCanvasReady }: PlanetMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
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
    setHoveredTile: state.setHoveredTile,
    setSelected: state.setSelected,
  })));
  const session = useSessionSnapshot();

  const buildingList = useMemo(() => getBuildingList(planet), [planet]);
  const unitList = useMemo(() => getUnitList(planet), [planet]);
  const resourceList = useMemo(() => getResourceList(planet), [planet]);
  const tileSize = PLANET_ZOOM_LEVELS[camera.zoomIndex];
  const logisticsDrones = runtime?.available ? runtime.logistics_drones ?? [] : [];
  const logisticsShips = runtime?.available ? runtime.logistics_ships ?? [] : [];
  const constructionTasks = runtime?.available ? runtime.construction_tasks ?? [] : [];
  const enemyForces = runtime?.available ? runtime.enemy_forces ?? [] : [];
  const detections = runtime?.available ? runtime.detections ?? [] : [];
  const powerLinks = networks?.available ? networks.power_links ?? [] : [];
  const powerCoverage = networks?.available ? networks.power_coverage ?? [] : [];
  const pipelineNodes = networks?.available ? networks.pipeline_nodes ?? [] : [];
  const pipelineSegments = networks?.available ? networks.pipeline_segments ?? [] : [];

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
    if (!focusRequest) {
      return;
    }
    const nextCamera = centerCameraOnTile(
      viewport,
      camera.zoomIndex,
      focusRequest.position.x,
      focusRequest.position.y,
    );
    setCamera({
      ...nextCamera,
      ready: true,
    });
    consumeFocusRequest(focusRequest.nonce);
  }, [camera.zoomIndex, consumeFocusRequest, focusRequest, setCamera, viewport]);

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
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.fillStyle = '#07101d';
    context.fillRect(0, 0, viewport.width, viewport.height);

    const startX = clamp(Math.floor((-camera.offsetX) / tileSize) - 1, 0, Math.max(planet.map_width - 1, 0));
    const startY = clamp(Math.floor((-camera.offsetY) / tileSize) - 1, 0, Math.max(planet.map_height - 1, 0));
    const endX = clamp(Math.ceil((viewport.width - camera.offsetX) / tileSize) + 1, 0, planet.map_width);
    const endY = clamp(Math.ceil((viewport.height - camera.offsetY) / tileSize) + 1, 0, planet.map_height);

    if (layers.terrain) {
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          context.fillStyle = terrainColors[getTerrainTile(planet, x, y)] ?? terrainColors.unknown;
          context.fillRect(camera.offsetX + (x * tileSize), camera.offsetY + (y * tileSize), tileSize, tileSize);
        }
      }
    }

    if (layers.grid) {
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
      resourceList.forEach((resource) => {
        const position = toTilePoint(resource.position);
        if (position.x < startX || position.x >= endX || position.y < startY || position.y >= endY) {
          return;
        }
        const screenX = camera.offsetX + ((position.x + 0.5) * tileSize);
        const screenY = camera.offsetY + ((position.y + 0.5) * tileSize);
        context.fillStyle = getResourceColor(resource.kind);
        context.beginPath();
        context.arc(screenX, screenY, Math.max(3, tileSize * 0.24), 0, Math.PI * 2);
        context.fill();
      });
    }

    if (layers.buildings) {
      buildingList.forEach((building) => {
        const { width, height } = getBuildingFootprint(building);
        const position = toTilePoint(building.position);
        const screenX = camera.offsetX + (position.x * tileSize);
        const screenY = camera.offsetY + (position.y * tileSize);
        const pixelWidth = width * tileSize;
        const pixelHeight = height * tileSize;

        context.fillStyle = building.owner_id === session.playerId ? 'rgba(36, 201, 182, 0.26)' : 'rgba(222, 87, 87, 0.22)';
        context.fillRect(screenX + 1, screenY + 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2));
        context.strokeStyle = building.owner_id === session.playerId ? '#57efe0' : '#ff7b7b';
        context.lineWidth = 2;
        context.strokeRect(screenX + 1, screenY + 1, Math.max(pixelWidth - 2, 2), Math.max(pixelHeight - 2, 2));

        if (tileSize >= 24) {
          context.fillStyle = '#edf6ff';
          context.font = '11px sans-serif';
          context.fillText(getBuildingDisplayName(catalog, building.type).slice(0, 6), screenX + 4, screenY + 14);
        }
      });
    }

    if (layers.units) {
      unitList.forEach((unit) => {
        const position = toTilePoint(unit.position);
        if (position.x < startX || position.x >= endX || position.y < startY || position.y >= endY) {
          return;
        }
        const screenX = camera.offsetX + ((position.x + 0.5) * tileSize);
        const screenY = camera.offsetY + ((position.y + 0.5) * tileSize);
        context.fillStyle = unit.owner_id === session.playerId ? '#91ff70' : '#ff6262';
        context.beginPath();
        context.arc(screenX, screenY, Math.max(3, tileSize * 0.22), 0, Math.PI * 2);
        context.fill();
      });
    }

    if (layers.logistics) {
      context.save();
      context.lineWidth = 2;
      logisticsDrones.forEach((drone) => {
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
      logisticsShips.forEach((ship) => {
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
      powerLinks.forEach((link) => {
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
      powerCoverage.forEach((coverage) => {
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
      pipelineSegments.forEach((segment) => {
        const from = toTilePoint(segment.from_position);
        const to = toTilePoint(segment.to_position);
        context.strokeStyle = 'rgba(99, 230, 190, 0.78)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(tileCenter(camera.offsetX, from.x, tileSize), tileCenter(camera.offsetY, from.y, tileSize));
        context.lineTo(tileCenter(camera.offsetX, to.x, tileSize), tileCenter(camera.offsetY, to.y, tileSize));
        context.stroke();
      });
      pipelineNodes.forEach((node) => {
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
      constructionTasks.forEach((task) => {
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
      enemyForces.forEach((force) => {
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
      detections.forEach((detection) => {
        detection.detected_positions?.forEach((position) => {
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

    if (layers.selection) {
      const highlightTile = selected
        ? toTilePoint(selected.position)
        : hoveredTile;
      if (highlightTile) {
        const screenX = camera.offsetX + (highlightTile.x * tileSize);
        const screenY = camera.offsetY + (highlightTile.y * tileSize);
        context.strokeStyle = selected ? '#ffd166' : 'rgba(255, 255, 255, 0.65)';
        context.lineWidth = selected ? 3 : 2;
        context.strokeRect(screenX + 1.5, screenY + 1.5, Math.max(tileSize - 3, 2), Math.max(tileSize - 3, 2));
      }
    }

    if (layers.fog && fog) {
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const tileFog = getFogState(fog, x, y);
          if (tileFog.visible) {
            continue;
          }
          context.fillStyle = tileFog.explored ? 'rgba(7, 11, 20, 0.44)' : 'rgba(0, 0, 0, 0.9)';
          context.fillRect(camera.offsetX + (x * tileSize), camera.offsetY + (y * tileSize), tileSize, tileSize);
        }
      }
    }
  }, [
    buildingList,
    camera.offsetX,
    camera.offsetY,
    fog,
    hoveredTile,
    layers,
    planet,
    resourceList,
    selected,
    tileSize,
    unitList,
    viewport,
    catalog,
    constructionTasks,
    detections,
    enemyForces,
    logisticsDrones,
    logisticsShips,
    pipelineNodes,
    pipelineSegments,
    powerCoverage,
    powerLinks,
    session.playerId,
  ]);

  function updateHoveredTile(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const tile = pointToTile(clientX, clientY, rect, camera.offsetX, camera.offsetY, tileSize, planet);
    setHoveredTile(tile);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
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
    setHoveredTile(null);
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

    const currentTileSize = PLANET_ZOOM_LEVELS[camera.zoomIndex];
    const nextTileSize = PLANET_ZOOM_LEVELS[nextZoomIndex];
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
    const selection = resolveSelectionAtTile(planet, tile.x, tile.y);
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
        <span>缩放 {tileSize}px/tile</span>
        <span>
          Hover {hoveredTile ? `(${hoveredTile.x}, ${hoveredTile.y})` : '-'}
        </span>
        <span>{selectionLabel(selected)}</span>
      </div>
    </div>
  );
}
