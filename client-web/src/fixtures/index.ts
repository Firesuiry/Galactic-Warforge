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
  PlanetNetworksView,
  PlanetRuntimeView,
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
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/networks')) {
      const planetId = pathname.split('/')[3] ?? '';
      const networks = scenario.networksByPlanet[planetId];
      return networks ? createJsonResponse(networks) : createErrorResponse(404, `unknown planet networks ${planetId}`);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/') && pathname.endsWith('/fog')) {
      const planetId = pathname.split('/')[3] ?? '';
      const fog = scenario.fogByPlanet[planetId];
      return fog ? createJsonResponse(fog) : createErrorResponse(404, `unknown planet fog ${planetId}`);
    }
    if (method === 'GET' && pathname.startsWith('/world/planets/')) {
      const planetId = pathname.split('/').at(-1) ?? '';
      const planet = scenario.planets[planetId];
      return planet ? createJsonResponse(planet) : createErrorResponse(404, `unknown planet ${planetId}`);
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
