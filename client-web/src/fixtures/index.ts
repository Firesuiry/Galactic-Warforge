import { DEFAULT_PLAYERS } from '@shared/config';
import type {
  AlertSnapshotParams,
  EventSnapshotParams,
  ReplayRequest,
} from '@shared/api';
import type {
  AlertSnapshotResponse,
  CatalogView,
  EventSnapshotResponse,
  FogMapView,
  GalaxyView,
  HealthResponse,
  MetricsSnapshot,
  PlanetInspectView,
  PlanetSceneView,
  PlanetOverviewView,
  PlanetNetworksView,
  PlanetRuntimeView,
  PlanetSummaryView,
  PlanetView,
  PlayerStatsSnapshot,
  ReplayDigest,
  ReplayResponse,
  StateSummary,
  SystemView,
} from '@shared/types';

import { baselineFixtureScenario } from '@/fixtures/scenarios/baseline';
import {
  translateBuildingType,
  translateItemId,
  translateUnitType,
} from '@/i18n/translate';

export interface FixtureSseBlock {
  event: string;
  data: unknown;
}

interface ReplayPreset {
  snapshot_tick: number;
  baseDigest: ReplayDigest;
  mismatchTick: number;
}

export interface FixtureScenario {
  id: string;
  label: string;
  description: string;
  health: HealthResponse;
  metrics: MetricsSnapshot;
  summary: StateSummary;
  statsByPlayer: Record<string, PlayerStatsSnapshot>;
  galaxy: GalaxyView;
  systems: Record<string, SystemView>;
  planets: Record<string, PlanetView>;
  fogByPlanet: Record<string, FogMapView>;
  runtimeByPlanet: Record<string, PlanetRuntimeView>;
  networksByPlanet: Record<string, PlanetNetworksView>;
  catalog: CatalogView;
  eventSnapshot: EventSnapshotResponse;
  alertSnapshot: AlertSnapshotResponse;
  replayPreset: ReplayPreset;
  eventStream: FixtureSseBlock[];
}

const FIXTURE_SERVER_PREFIX = 'fixture://';

const scenarios = [
  baselineFixtureScenario,
] satisfies FixtureScenario[];

const scenarioMap = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export function listFixtureScenarios() {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
  }));
}

export function createFixtureServerUrl(fixtureId: string) {
  return `${FIXTURE_SERVER_PREFIX}${fixtureId}`;
}

export function isFixtureServerUrl(serverUrl: string) {
  return serverUrl.startsWith(FIXTURE_SERVER_PREFIX);
}

export function parseFixtureIdFromServerUrl(serverUrl: string) {
  if (!isFixtureServerUrl(serverUrl)) {
    return '';
  }
  return serverUrl.slice(FIXTURE_SERVER_PREFIX.length);
}

export function getFixtureScenario(fixtureId: string) {
  const scenario = scenarioMap.get(fixtureId);
  if (!scenario) {
    throw new Error(`unknown fixture scenario: ${fixtureId}`);
  }
  return scenario;
}

function createJsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
    ...init,
  });
}

function createErrorResponse(status: number, message: string) {
  return createJsonResponse({ error: message }, {
    status,
    statusText: message,
  });
}

function cloneReplayDigest(baseDigest: ReplayDigest, tick: number, hash: string): ReplayDigest {
  return {
    ...baseDigest,
    tick,
    hash,
  };
}

function buildReplayResponse(scenario: FixtureScenario, request: ReplayRequest): ReplayResponse {
  const currentTick = scenario.summary.tick;
  const requestedToTick = request.step
    ? (request.from_tick ?? currentTick)
    : (request.to_tick || currentTick);
  const requestedFromTick = request.from_tick || requestedToTick;
  const snapshotTick = Math.min(scenario.replayPreset.snapshot_tick, requestedFromTick);
  const appliedTicks = Math.max(0, requestedToTick - snapshotTick);
  const verify = Boolean(request.verify);
  const driftDetected = verify && requestedToTick >= scenario.replayPreset.mismatchTick;
  const digestHash = driftDetected
    ? `${scenario.id}-replay-drift-${requestedToTick}`
    : `${scenario.id}-replay-ok-${requestedToTick}`;
  const digest = cloneReplayDigest(scenario.replayPreset.baseDigest, requestedToTick, digestHash);
  const snapshotDigest = verify
    ? cloneReplayDigest(
      scenario.replayPreset.baseDigest,
      requestedToTick,
      driftDetected ? `${scenario.id}-snapshot-ok-${requestedToTick}` : digestHash,
    )
    : undefined;

  return {
    from_tick: requestedFromTick,
    to_tick: requestedToTick,
    snapshot_tick: snapshotTick,
    replay_from_tick: Math.min(snapshotTick + 1, requestedToTick),
    replay_to_tick: requestedToTick,
    applied_ticks: appliedTicks,
    command_count: Math.max(1, Math.floor(appliedTicks / 2)),
    result_mismatch_count: verify && driftDetected ? 1 : 0,
    duration_ms: Math.max(6, appliedTicks * 2),
    step: Boolean(request.step),
    speed: request.speed ?? 0,
    digest,
    snapshot_digest: snapshotDigest,
    drift_detected: driftDetected,
    notes: verify
      ? (
        driftDetected
          ? ['检测到 replay digest 与 snapshot digest 不一致。', '该样例用于验证回放校验面板的差异高亮。']
          : ['replay digest 与 snapshot digest 一致。']
      )
      : ['未启用 verify，仅返回 replay digest。'],
  };
}

function resolvePlayerIdFromRequest(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const auth = headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  return DEFAULT_PLAYERS.find((player) => player.key === token)?.id ?? DEFAULT_PLAYERS[0]?.id ?? 'p1';
}

function sliceEvents(response: EventSnapshotResponse, params: EventSnapshotParams) {
  let events = [...response.events];
  if (params.event_types?.length) {
    const allowed = new Set(params.event_types);
    events = events.filter((event) => allowed.has(event.event_type));
  }
  if (params.after_event_id) {
    const eventIndex = events.findIndex((event) => event.event_id === params.after_event_id);
    if (eventIndex >= 0) {
      events = events.slice(eventIndex + 1);
    }
  }
  if (params.limit !== undefined) {
    events = events.slice(-params.limit);
  }

  return {
    ...response,
    events,
    next_event_id: events.at(-1)?.event_id ?? response.next_event_id,
  };
}

function sliceAlerts(response: AlertSnapshotResponse, params: AlertSnapshotParams) {
  let alerts = [...response.alerts];
  if (params.after_alert_id) {
    const alertIndex = alerts.findIndex((alert) => alert.alert_id === params.after_alert_id);
    if (alertIndex >= 0) {
      alerts = alerts.slice(alertIndex + 1);
    }
  }
  if (params.limit !== undefined) {
    alerts = alerts.slice(-params.limit);
  }

  return {
    ...response,
    alerts,
    next_alert_id: alerts.at(-1)?.alert_id ?? response.next_alert_id,
  };
}

function clampSceneBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) {
  const nextWidth = Math.max(1, Math.min(width || 160, maxWidth));
  const nextHeight = Math.max(1, Math.min(height || 160, maxHeight));
  const nextX = Math.max(0, Math.min(x || 0, Math.max(0, maxWidth - nextWidth)));
  const nextY = Math.max(0, Math.min(y || 0, Math.max(0, maxHeight - nextHeight)));
  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  };
}

function sliceMatrix<T>(grid: T[][] | undefined, bounds: { x: number; y: number; width: number; height: number }) {
  if (!grid?.length) {
    return [];
  }
  return Array.from({ length: bounds.height }, (_, rowIndex) => (
    [...(grid[bounds.y + rowIndex]?.slice(bounds.x, bounds.x + bounds.width) ?? [])]
  ));
}

function filterRecordByBounds<T extends { position: { x: number; y: number } }>(
  record: Record<string, T> | undefined,
  bounds: { x: number; y: number; width: number; height: number },
) {
  return Object.fromEntries(
    Object.entries(record ?? {}).filter(([, value]) => (
      value.position.x >= bounds.x &&
      value.position.x < bounds.x + bounds.width &&
      value.position.y >= bounds.y &&
      value.position.y < bounds.y + bounds.height
    )),
  );
}

function filterResourcesByBounds(
  resources: PlanetView['resources'],
  bounds: { x: number; y: number; width: number; height: number },
) {
  return [...(resources ?? [])].filter((resource) => (
    resource.position.x >= bounds.x &&
    resource.position.x < bounds.x + bounds.width &&
    resource.position.y >= bounds.y &&
    resource.position.y < bounds.y + bounds.height
  ));
}

function buildPlanetSummary(planet: PlanetView): PlanetSummaryView {
  return {
    planet_id: planet.planet_id,
    name: planet.name,
    discovered: planet.discovered,
    kind: planet.kind,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    building_count: Object.keys(planet.buildings ?? {}).length,
    unit_count: Object.keys(planet.units ?? {}).length,
    resource_count: planet.resources?.length ?? 0,
  };
}

function buildPlanetInspect(planet: PlanetView, entityKind: string, entityId: string): PlanetInspectView | null {
  switch (entityKind) {
    case 'building': {
      const building = planet.buildings?.[entityId];
      if (!building) {
        return null;
      }
      return {
        planet_id: planet.planet_id,
        discovered: planet.discovered,
        entity_kind: 'building',
        entity_id: entityId,
        title: translateBuildingType(building.type),
        building,
      };
    }
    case 'unit': {
      const unit = planet.units?.[entityId];
      if (!unit) {
        return null;
      }
      return {
        planet_id: planet.planet_id,
        discovered: planet.discovered,
        entity_kind: 'unit',
        entity_id: entityId,
        title: translateUnitType(unit.type),
        unit,
      };
    }
    case 'resource': {
      const resource = planet.resources?.find((candidate) => candidate.id === entityId);
      if (!resource) {
        return null;
      }
      return {
        planet_id: planet.planet_id,
        discovered: planet.discovered,
        entity_kind: 'resource',
        entity_id: entityId,
        title: translateItemId(resource.kind),
        resource,
      };
    }
    case 'sector':
      return {
        planet_id: planet.planet_id,
        discovered: planet.discovered,
        entity_kind: 'sector',
        entity_id: entityId,
        title: `区域 ${entityId}`,
      };
    default:
      return null;
  }
}

function buildPlanetScene(planet: PlanetView, fog: FogMapView | undefined, x: number, y: number, width: number, height: number): PlanetSceneView {
  const bounds = clampSceneBounds(x, y, width, height, planet.map_width, planet.map_height);
  return {
    planet_id: planet.planet_id,
    name: planet.name,
    discovered: planet.discovered,
    kind: planet.kind,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    bounds,
    terrain: sliceMatrix(planet.terrain, bounds),
    environment: planet.environment,
    visible: sliceMatrix(fog?.visible, bounds),
    explored: sliceMatrix(fog?.explored, bounds),
    buildings: filterRecordByBounds(planet.buildings, bounds),
    units: filterRecordByBounds(planet.units, bounds),
    resources: filterResourcesByBounds(planet.resources, bounds),
    building_count: Object.keys(planet.buildings ?? {}).length,
    unit_count: Object.keys(planet.units ?? {}).length,
    resource_count: planet.resources?.length ?? 0,
  };
}

function buildPlanetOverview(planet: PlanetView, fog: FogMapView | undefined, step: number): PlanetOverviewView {
  const nextStep = Math.max(1, step || 100);
  const cellsWidth = Math.max(1, Math.ceil(planet.map_width / nextStep));
  const cellsHeight = Math.max(1, Math.ceil(planet.map_height / nextStep));
  const terrain = Array.from({ length: cellsHeight }, (_, cellY) => (
    Array.from({ length: cellsWidth }, (_, cellX) => (
      planet.terrain?.[cellY * nextStep]?.[cellX * nextStep] ?? 'unknown'
    ))
  ));
  const visible = Array.from({ length: cellsHeight }, (_, cellY) => (
    Array.from({ length: cellsWidth }, (_, cellX) => (
      Boolean(fog?.visible?.[cellY * nextStep]?.[cellX * nextStep])
    ))
  ));
  const explored = Array.from({ length: cellsHeight }, (_, cellY) => (
    Array.from({ length: cellsWidth }, (_, cellX) => (
      Boolean(fog?.explored?.[cellY * nextStep]?.[cellX * nextStep])
    ))
  ));
  const buildingCounts = Array.from({ length: cellsHeight }, () => Array.from({ length: cellsWidth }, () => 0));
  const unitCounts = Array.from({ length: cellsHeight }, () => Array.from({ length: cellsWidth }, () => 0));
  const resourceCounts = Array.from({ length: cellsHeight }, () => Array.from({ length: cellsWidth }, () => 0));

  Object.values(planet.buildings ?? {}).forEach((building) => {
    buildingCounts[Math.floor(building.position.y / nextStep)]![Math.floor(building.position.x / nextStep)] += 1;
  });
  Object.values(planet.units ?? {}).forEach((unit) => {
    unitCounts[Math.floor(unit.position.y / nextStep)]![Math.floor(unit.position.x / nextStep)] += 1;
  });
  (planet.resources ?? []).forEach((resource) => {
    resourceCounts[Math.floor(resource.position.y / nextStep)]![Math.floor(resource.position.x / nextStep)] += 1;
  });

  return {
    planet_id: planet.planet_id,
    name: planet.name,
    discovered: planet.discovered,
    kind: planet.kind,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    step: nextStep,
    cells_width: cellsWidth,
    cells_height: cellsHeight,
    terrain,
    visible,
    explored,
    building_counts: buildingCounts,
    unit_counts: unitCounts,
    resource_counts: resourceCounts,
    building_count: Object.keys(planet.buildings ?? {}).length,
    unit_count: Object.keys(planet.units ?? {}).length,
    resource_count: planet.resources?.length ?? 0,
  };
}

function createSseResponse(blocks: FixtureSseBlock[], signal?: AbortSignal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      blocks.forEach((block) => {
        controller.enqueue(encoder.encode(
          `event: ${block.event}\ndata: ${JSON.stringify(block.data)}\n\n`,
        ));
      });

      signal?.addEventListener('abort', () => {
        controller.close();
      }, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
    },
    status: 200,
  });
}

function parseBody<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  if (typeof init?.body === 'string') {
    return Promise.resolve(JSON.parse(init.body) as T);
  }
  if (input instanceof Request) {
    return input.clone().json() as Promise<T>;
  }
  return Promise.resolve({} as T);
}

function parseUrl(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(String(input));
}

export function createFixtureFetch(serverUrl: string): typeof fetch {
  const fixtureId = parseFixtureIdFromServerUrl(serverUrl);
  const scenario = getFixtureScenario(fixtureId);

  return async (input, init) => {
    const url = parseUrl(input);
    const pathname = url.pathname;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const playerId = resolvePlayerIdFromRequest(init);

    if (method === 'GET' && pathname === '/health') {
      return createJsonResponse(scenario.health);
    }
    if (method === 'GET' && pathname === '/metrics') {
      return createJsonResponse(scenario.metrics);
    }
    if (method === 'GET' && pathname === '/state/summary') {
      return createJsonResponse(scenario.summary);
    }
    if (method === 'GET' && pathname === '/state/stats') {
      return createJsonResponse(scenario.statsByPlayer[playerId] ?? scenario.statsByPlayer.p1);
    }
    if (method === 'GET' && pathname === '/catalog') {
      return createJsonResponse(scenario.catalog);
    }
    if (method === 'GET' && pathname === '/world/galaxy') {
      return createJsonResponse(scenario.galaxy);
    }
    if (method === 'GET' && pathname.startsWith('/world/systems/')) {
      const systemId = pathname.split('/').at(-1) ?? '';
      const system = scenario.systems[systemId];
      return system ? createJsonResponse(system) : createErrorResponse(404, `unknown system ${systemId}`);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/runtime')) {
      const planetId = pathname.split('/')[3] ?? '';
      const runtime = scenario.runtimeByPlanet[planetId];
      return runtime ? createJsonResponse(runtime) : createErrorResponse(404, `unknown planet runtime ${planetId}`);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/scene')) {
      const planetId = pathname.split('/')[3] ?? '';
      const planet = scenario.planets[planetId];
      if (!planet) {
        return createErrorResponse(404, `unknown planet ${planetId}`);
      }
      return createJsonResponse(buildPlanetScene(
        planet,
        scenario.fogByPlanet[planetId],
        Number(url.searchParams.get('x') ?? 0),
        Number(url.searchParams.get('y') ?? 0),
        Number(url.searchParams.get('width') ?? 160),
        Number(url.searchParams.get('height') ?? 160),
      ));
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/overview')) {
      const planetId = pathname.split('/')[3] ?? '';
      const planet = scenario.planets[planetId];
      if (!planet) {
        return createErrorResponse(404, `unknown planet ${planetId}`);
      }
      return createJsonResponse(buildPlanetOverview(
        planet,
        scenario.fogByPlanet[planetId],
        Number(url.searchParams.get('step') ?? 100),
      ));
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/inspect')) {
      const planetId = pathname.split('/')[3] ?? '';
      const planet = scenario.planets[planetId];
      if (!planet) {
        return createErrorResponse(404, `unknown planet ${planetId}`);
      }

      const entityKind = url.searchParams.get('entity_kind');
      if (!entityKind) {
        return createErrorResponse(400, 'entity_kind is required');
      }
      const entityId = url.searchParams.get('entity_id') ?? url.searchParams.get('sector_id') ?? '';
      if (!entityId) {
        return createErrorResponse(400, 'entity_id or sector_id is required');
      }

      const inspect = buildPlanetInspect(planet, entityKind, entityId);
      return inspect ? createJsonResponse(inspect) : createErrorResponse(404, 'target not found');
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/networks')) {
      const planetId = pathname.split('/')[3] ?? '';
      const networks = scenario.networksByPlanet[planetId];
      return networks ? createJsonResponse(networks) : createErrorResponse(404, `unknown planet networks ${planetId}`);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/fog')) {
      return createErrorResponse(404, 'not found');
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/')) {
      const planetId = pathname.split('/').at(-1) ?? '';
      const planet = scenario.planets[planetId];
      return planet ? createJsonResponse(buildPlanetSummary(planet)) : createErrorResponse(404, `unknown planet ${planetId}`);
    }
    if (method === 'GET' && pathname === '/events/snapshot') {
      const eventTypes = url.searchParams.get('event_types');
      const afterEventId = url.searchParams.get('after_event_id') ?? undefined;
      const limit = url.searchParams.get('limit');
      return createJsonResponse(sliceEvents(scenario.eventSnapshot, {
        event_types: eventTypes ? eventTypes.split(',').filter(Boolean) : undefined,
        after_event_id: afterEventId,
        limit: limit ? Number(limit) : undefined,
      }));
    }
    if (method === 'GET' && pathname === '/alerts/production/snapshot') {
      const afterAlertId = url.searchParams.get('after_alert_id') ?? undefined;
      const limit = url.searchParams.get('limit');
      return createJsonResponse(sliceAlerts(scenario.alertSnapshot, {
        after_alert_id: afterAlertId,
        limit: limit ? Number(limit) : undefined,
      }));
    }
    if (method === 'GET' && pathname === '/events/stream') {
      const allowedTypes = new Set((url.searchParams.get('event_types') ?? '').split(',').filter(Boolean));
      const filteredBlocks = scenario.eventStream.filter((block) => (
        block.event !== 'game'
        || allowedTypes.size === 0
        || allowedTypes.has((block.data as { event_type?: string }).event_type ?? '')
      ));
      return createSseResponse(filteredBlocks, init?.signal ?? undefined);
    }
    if (method === 'POST' && pathname === '/replay') {
      const request = await parseBody<ReplayRequest>(input, init);
      return createJsonResponse(buildReplayResponse(scenario, request));
    }

    return createErrorResponse(404, `fixture endpoint not implemented: ${method} ${pathname}`);
  };
}
