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
  PlanetNetworksView,
  PlanetRuntimeView,
  PlanetSceneView,
  PlanetSummaryView,
  PlanetView,
  PlayerStatsSnapshot,
  ReplayDigest,
  ReplayResponse,
  StateSummary,
  SystemView,
} from '@shared/types';

import { baselineFixtureScenario } from '@/fixtures/scenarios/baseline';

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseRequiredIntParam(url: URL, key: string) {
  const raw = url.searchParams.get(key);
  if (!raw) {
    return { error: `${key} is required` };
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    return { error: `${key} must be an integer` };
  }
  return { value };
}

function parsePositiveIntParam(url: URL, key: string) {
  const parsed = parseRequiredIntParam(url, key);
  if (parsed.error) {
    return parsed;
  }
  if ((parsed.value ?? 0) <= 0) {
    return { error: `${key} must be a positive integer` };
  }
  return parsed;
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

interface FixtureSceneBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

function clampSceneBounds(
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  detailLevel: 'tile' | 'sector',
): FixtureSceneBounds {
  const maxSpan = detailLevel === 'tile' ? 256 : Math.max(mapWidth, mapHeight);
  let minX = clamp(x, 0, mapWidth - 1);
  let minY = clamp(y, 0, mapHeight - 1);
  let maxX = clamp(x + width - 1, 0, mapWidth - 1);
  let maxY = clamp(y + height - 1, 0, mapHeight - 1);

  if (maxX < minX) {
    [minX, maxX] = [maxX, minX];
  }
  if (maxY < minY) {
    [minY, maxY] = [maxY, minY];
  }
  if (maxX - minX + 1 > maxSpan) {
    maxX = Math.min(mapWidth - 1, minX + maxSpan - 1);
  }
  if (maxY - minY + 1 > maxSpan) {
    maxY = Math.min(mapHeight - 1, minY + maxSpan - 1);
  }

  return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
}

function cropGrid<T>(grid: T[][] | undefined, bounds: FixtureSceneBounds): T[][] {
  if (!grid) {
    return [];
  }
  const rows: T[][] = [];
  for (let y = bounds.min_y; y <= bounds.max_y; y += 1) {
    const row = grid[y] ?? [];
    rows.push(row.slice(bounds.min_x, bounds.max_x + 1));
  }
  return rows;
}

function inBounds(position: { x: number; y: number }, bounds: FixtureSceneBounds) {
  return (
    position.x >= bounds.min_x
    && position.x <= bounds.max_x
    && position.y >= bounds.min_y
    && position.y <= bounds.max_y
  );
}

function filterEntitiesByBounds<T extends { position: { x: number; y: number } }>(
  source: Record<string, T> | undefined,
  bounds: FixtureSceneBounds,
) {
  const entries = Object.entries(source ?? {}).filter(([, value]) => inBounds(value.position, bounds));
  return Object.fromEntries(entries) as Record<string, T>;
}

function filterResourcesByBounds(resources: PlanetView['resources'], bounds: FixtureSceneBounds) {
  return (resources ?? []).filter((resource) => inBounds(resource.position, bounds));
}

function aggregateSceneSectors(planet: PlanetView, fog: FogMapView | undefined, bounds: FixtureSceneBounds) {
  const sectors = new Map<string, {
    sector_x: number;
    sector_y: number;
    building_count: number;
    unit_count: number;
    resource_count: number;
    visible_tiles: number;
    explored_tiles: number;
  }>();

  const getSector = (sectorX: number, sectorY: number) => {
    const key = `${sectorX}:${sectorY}`;
    const existing = sectors.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      sector_x: sectorX,
      sector_y: sectorY,
      building_count: 0,
      unit_count: 0,
      resource_count: 0,
      visible_tiles: 0,
      explored_tiles: 0,
    };
    sectors.set(key, created);
    return created;
  };

  for (let y = bounds.min_y; y <= bounds.max_y; y += 1) {
    for (let x = bounds.min_x; x <= bounds.max_x; x += 1) {
      const sector = getSector(Math.floor(x / 32), Math.floor(y / 32));
      if (fog?.visible?.[y]?.[x]) {
        sector.visible_tiles += 1;
      }
      if (fog?.explored?.[y]?.[x]) {
        sector.explored_tiles += 1;
      }
    }
  }

  Object.values(planet.buildings ?? {}).forEach((building) => {
    if (!inBounds(building.position, bounds)) {
      return;
    }
    const sector = getSector(Math.floor(building.position.x / 32), Math.floor(building.position.y / 32));
    sector.building_count += 1;
  });
  Object.values(planet.units ?? {}).forEach((unit) => {
    if (!inBounds(unit.position, bounds)) {
      return;
    }
    const sector = getSector(Math.floor(unit.position.x / 32), Math.floor(unit.position.y / 32));
    sector.unit_count += 1;
  });
  (planet.resources ?? []).forEach((resource) => {
    if (!inBounds(resource.position, bounds)) {
      return;
    }
    const sector = getSector(Math.floor(resource.position.x / 32), Math.floor(resource.position.y / 32));
    sector.resource_count += 1;
  });

  return [...sectors.values()].sort((left, right) => (
    left.sector_y - right.sector_y || left.sector_x - right.sector_x
  ));
}

function buildPlanetScene(url: URL, planet: PlanetView, fog: FogMapView | undefined): PlanetSceneView | { error: string } {
  const x = parseRequiredIntParam(url, 'x');
  if (x.error) {
    return { error: x.error };
  }
  const y = parseRequiredIntParam(url, 'y');
  if (y.error) {
    return { error: y.error };
  }
  const width = parsePositiveIntParam(url, 'width');
  if (width.error) {
    return { error: width.error };
  }
  const height = parsePositiveIntParam(url, 'height');
  if (height.error) {
    return { error: height.error };
  }

  const detailLevel = url.searchParams.get('detail_level') === 'sector' ? 'sector' : 'tile';
  const bounds = clampSceneBounds(
    planet.map_width,
    planet.map_height,
    x.value ?? 0,
    y.value ?? 0,
    width.value ?? 1,
    height.value ?? 1,
    detailLevel,
  );
  const scene: PlanetSceneView = {
    planet_id: planet.planet_id,
    discovered: planet.discovered,
    detail_level: detailLevel,
    map_width: planet.map_width,
    map_height: planet.map_height,
    tick: planet.tick,
    bounds,
  };

  if (detailLevel === 'sector') {
    scene.sectors = aggregateSceneSectors(planet, fog, bounds);
    return scene;
  }

  scene.terrain = cropGrid(planet.terrain, bounds);
  scene.fog = {
    visible: cropGrid(fog?.visible, bounds),
    explored: cropGrid(fog?.explored, bounds),
  };
  scene.buildings = filterEntitiesByBounds(planet.buildings, bounds);
  scene.units = filterEntitiesByBounds(planet.units, bounds);
  scene.resources = filterResourcesByBounds(planet.resources, bounds);
  return scene;
}

function buildPlanetInspect(url: URL, planet: PlanetView): PlanetInspectView | { error: string } | null {
  const entityKind = url.searchParams.get('entity_kind');
  if (!entityKind) {
    return { error: 'entity_kind is required' };
  }
  const entityID = url.searchParams.get('entity_id') ?? url.searchParams.get('sector_id') ?? '';
  if (!entityID) {
    return { error: 'entity_id or sector_id is required' };
  }

  if (entityKind === 'building') {
    const building = planet.buildings?.[entityID];
    if (!building) {
      return null;
    }
    return {
      planet_id: planet.planet_id,
      discovered: planet.discovered,
      entity_kind: 'building',
      entity_id: entityID,
      title: building.type,
      building,
    };
  }
  if (entityKind === 'unit') {
    const unit = planet.units?.[entityID];
    if (!unit) {
      return null;
    }
    return {
      planet_id: planet.planet_id,
      discovered: planet.discovered,
      entity_kind: 'unit',
      entity_id: entityID,
      title: unit.type,
      unit,
    };
  }
  if (entityKind === 'resource') {
    const resource = (planet.resources ?? []).find((candidate) => candidate.id === entityID);
    if (!resource) {
      return null;
    }
    return {
      planet_id: planet.planet_id,
      discovered: planet.discovered,
      entity_kind: 'resource',
      entity_id: entityID,
      title: resource.kind,
      resource,
    };
  }
  if (entityKind === 'sector') {
    return {
      planet_id: planet.planet_id,
      discovered: planet.discovered,
      entity_kind: 'sector',
      entity_id: entityID,
      title: `Sector ${entityID}`,
    };
  }
  return null;
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
      const scene = buildPlanetScene(url, planet, scenario.fogByPlanet[planetId]);
      return 'error' in scene ? createErrorResponse(400, scene.error) : createJsonResponse(scene);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/inspect')) {
      const planetId = pathname.split('/')[3] ?? '';
      const planet = scenario.planets[planetId];
      if (!planet) {
        return createErrorResponse(404, `unknown planet ${planetId}`);
      }
      const inspect = buildPlanetInspect(url, planet);
      if (!inspect) {
        return createErrorResponse(404, `unknown inspect target on planet ${planetId}`);
      }
      return 'error' in inspect ? createErrorResponse(400, inspect.error) : createJsonResponse(inspect);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/fog')) {
      return createErrorResponse(404, 'not found');
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/networks')) {
      const planetId = pathname.split('/')[3] ?? '';
      const networks = scenario.networksByPlanet[planetId];
      return networks ? createJsonResponse(networks) : createErrorResponse(404, `unknown planet networks ${planetId}`);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.split('/').length === 4) {
      const planetId = pathname.split('/')[3] ?? '';
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
