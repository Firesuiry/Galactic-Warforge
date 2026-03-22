import { SERVER_URL, DEFAULT_GALAXY_ID, DEFAULT_PLANET_ID, DEFAULT_SYSTEM_ID } from './config.js';
import type {
  StateSummary, PlanetView, FogMapView, GalaxyView, SystemView,
  CommandRequest, CommandResponse, HealthResponse, MetricsSnapshot,
  Command, AuditResponse, EventSnapshotResponse, AlertSnapshotResponse,
  ReplayResponse, RollbackResponse, Position, PlayerStatsSnapshot,
} from './types.js';

let _playerId = '';
let _playerKey = '';

export function setAuth(playerId: string, playerKey: string) {
  _playerId = playerId;
  _playerKey = playerKey;
}

export function getAuth(): { playerId: string; playerKey: string } {
  return { playerId: _playerId, playerKey: _playerKey };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (_playerKey) {
    headers.Authorization = `Bearer ${_playerKey}`;
  }
  const res = await fetch(`${SERVER_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Public read endpoints ──────────────────────────────────────────────────

export function fetchHealth(): Promise<HealthResponse> {
  return fetch(`${SERVER_URL}/health`).then(r => r.json());
}

export function fetchMetrics(): Promise<MetricsSnapshot> {
  return fetch(`${SERVER_URL}/metrics`).then(r => r.json());
}

export function fetchSummary(): Promise<StateSummary> {
  return apiFetch<StateSummary>('/state/summary');
}

export function fetchStats(): Promise<PlayerStatsSnapshot> {
  return apiFetch<PlayerStatsSnapshot>('/state/stats');
}

export function fetchGalaxy(): Promise<GalaxyView> {
  return apiFetch<GalaxyView>('/world/galaxy');
}

export function fetchSystem(systemId: string): Promise<SystemView> {
  return apiFetch<SystemView>(`/world/systems/${systemId}`);
}

export function fetchPlanet(planetId: string): Promise<PlanetView> {
  return apiFetch<PlanetView>(`/world/planets/${planetId}`);
}

export function fetchFogMap(planetId: string): Promise<FogMapView> {
  return apiFetch<FogMapView>(`/world/planets/${planetId}/fog`);
}

// ── Command helpers ────────────────────────────────────────────────────────

export async function sendCommands(commands: Command[]): Promise<CommandResponse> {
  const req: CommandRequest = {
    request_id: crypto.randomUUID(),
    issuer_type: 'player',
    issuer_id: _playerId,
    commands,
  };
  return sendCommandRequest(req);
}

function sendSingleCommand(command: Command): Promise<CommandResponse> {
  return sendCommands([command]);
}

export function cmdScanGalaxy(galaxyId = DEFAULT_GALAXY_ID): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'scan_galaxy',
    target: { layer: 'galaxy', galaxy_id: galaxyId },
  });
}

export function cmdScanSystem(systemId = DEFAULT_SYSTEM_ID): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'scan_system',
    target: { layer: 'system', system_id: systemId },
  });
}

export function cmdScanPlanet(planetId = DEFAULT_PLANET_ID): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'scan_planet',
    target: { layer: 'planet', planet_id: planetId },
  });
}

export function sendCommandRequest(req: CommandRequest): Promise<CommandResponse> {
  return apiFetch<CommandResponse>('/commands', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditQueryParams {
  player_id?: string;
  issuer_type?: string;
  issuer_id?: string;
  action?: string;
  request_id?: string;
  permission?: string;
  permission_granted?: boolean;
  from_tick?: number;
  to_tick?: number;
  from_time?: string;
  to_time?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

export function fetchAudit(params: AuditQueryParams = {}): Promise<AuditResponse> {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      searchParams.set(k, String(v));
    }
  }
  const query = searchParams.toString();
  return apiFetch<AuditResponse>(`/audit${query ? `?${query}` : ''}`);
}

// ── Event Snapshot ────────────────────────────────────────────────────────────

export interface EventSnapshotParams {
  after_event_id?: string;
  since_tick?: number;
  limit?: number;
}

export function fetchEventSnapshot(params: EventSnapshotParams = {}): Promise<EventSnapshotResponse> {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      searchParams.set(k, String(v));
    }
  }
  const query = searchParams.toString();
  return apiFetch<EventSnapshotResponse>(`/events/snapshot${query ? `?${query}` : ''}`);
}

// ── Alert Snapshot ────────────────────────────────────────────────────────────

export interface AlertSnapshotParams {
  after_alert_id?: string;
  since_tick?: number;
  limit?: number;
}

export function fetchAlertSnapshot(params: AlertSnapshotParams = {}): Promise<AlertSnapshotResponse> {
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      searchParams.set(k, String(v));
    }
  }
  const query = searchParams.toString();
  return apiFetch<AlertSnapshotResponse>(`/alerts/production/snapshot${query ? `?${query}` : ''}`);
}

// ── Replay ────────────────────────────────────────────────────────────────────

export interface ReplayRequest {
  from_tick?: number;
  to_tick?: number;
  step?: boolean;
  speed?: number;
  verify?: boolean;
}

export function sendReplay(req: ReplayRequest): Promise<ReplayResponse> {
  return apiFetch<ReplayResponse>('/replay', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Rollback ──────────────────────────────────────────────────────────────────

export interface RollbackRequest {
  to_tick?: number;
}

export function sendRollback(req: RollbackRequest): Promise<RollbackResponse> {
  return apiFetch<RollbackResponse>('/rollback', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Game Action Commands ─────────────────────────────────────────────────────

export type UnitTypeName = 'worker' | 'soldier';
export type Direction = 'north' | 'east' | 'south' | 'west' | 'auto';
export type DysonComponentType = 'node' | 'frame' | 'shell';

export interface BuildOptions {
  direction?: Direction;
  recipeId?: string;
}

export interface LaunchSolarSailOptions {
  count?: number;
  orbitRadius?: number;
  inclination?: number;
}

export interface BuildDysonNodeOptions {
  systemId: string;
  layerIndex: number;
  latitude: number;
  longitude: number;
  orbitRadius?: number;
}

export interface BuildDysonFrameOptions {
  systemId: string;
  layerIndex: number;
  nodeAId: string;
  nodeBId: string;
}

export interface BuildDysonShellOptions {
  systemId: string;
  layerIndex: number;
  latitudeMin: number;
  latitudeMax: number;
  coverage: number;
}

export function cmdBuild(position: Position, buildingType: string, options: BuildOptions = {}): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'build',
    target: { layer: 'planet', position },
    payload: {
      building_type: buildingType,
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.recipeId ? { recipe_id: options.recipeId } : {}),
    },
  });
}

export function cmdMove(entityId: string, position: Position): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'move',
    target: { layer: 'planet', entity_id: entityId, position },
  });
}

export function cmdAttack(entityId: string, targetEntityId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'attack',
    target: { layer: 'planet', entity_id: entityId },
    payload: { target_entity_id: targetEntityId },
  });
}

export function cmdProduce(entityId: string, unitType: UnitTypeName): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'produce',
    target: { layer: 'planet', entity_id: entityId },
    payload: { unit_type: unitType },
  });
}

export function cmdUpgrade(entityId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'upgrade',
    target: { layer: 'planet', entity_id: entityId },
  });
}

export function cmdDemolish(entityId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'demolish',
    target: { layer: 'planet', entity_id: entityId },
  });
}

export function cmdCancelConstruction(taskId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'cancel_construction',
    target: { layer: 'planet' },
    payload: { task_id: taskId },
  });
}

export function cmdRestoreConstruction(taskId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'restore_construction',
    target: { layer: 'planet' },
    payload: { task_id: taskId },
  });
}

export function cmdStartResearch(techId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'start_research',
    target: { layer: 'planet' },
    payload: { tech_id: techId },
  });
}

export function cmdCancelResearch(techId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'cancel_research',
    target: { layer: 'planet' },
    payload: { tech_id: techId },
  });
}

export function cmdLaunchSolarSail(buildingId: string, options: LaunchSolarSailOptions = {}): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'launch_solar_sail',
    target: { layer: 'planet' },
    payload: {
      building_id: buildingId,
      ...(options.count !== undefined ? { count: options.count } : {}),
      ...(options.orbitRadius !== undefined ? { orbit_radius: options.orbitRadius } : {}),
      ...(options.inclination !== undefined ? { inclination: options.inclination } : {}),
    },
  });
}

export function cmdBuildDysonNode(options: BuildDysonNodeOptions): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'build_dyson_node',
    target: { layer: 'system', system_id: options.systemId },
    payload: {
      system_id: options.systemId,
      layer_index: options.layerIndex,
      latitude: options.latitude,
      longitude: options.longitude,
      ...(options.orbitRadius !== undefined ? { orbit_radius: options.orbitRadius } : {}),
    },
  });
}

export function cmdBuildDysonFrame(options: BuildDysonFrameOptions): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'build_dyson_frame',
    target: { layer: 'system', system_id: options.systemId },
    payload: {
      system_id: options.systemId,
      layer_index: options.layerIndex,
      node_a_id: options.nodeAId,
      node_b_id: options.nodeBId,
    },
  });
}

export function cmdBuildDysonShell(options: BuildDysonShellOptions): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'build_dyson_shell',
    target: { layer: 'system', system_id: options.systemId },
    payload: {
      system_id: options.systemId,
      layer_index: options.layerIndex,
      latitude_min: options.latitudeMin,
      latitude_max: options.latitudeMax,
      coverage: options.coverage,
    },
  });
}

export function cmdDemolishDyson(systemId: string, componentType: DysonComponentType, componentId: string): Promise<CommandResponse> {
  return sendSingleCommand({
    type: 'demolish_dyson',
    target: { layer: 'system', system_id: systemId },
    payload: {
      system_id: systemId,
      component_type: componentType,
      component_id: componentId,
    },
  });
}
