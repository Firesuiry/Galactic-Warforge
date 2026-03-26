import {
  DEFAULT_EVENT_TYPES,
  DEFAULT_GALAXY_ID,
  DEFAULT_PLANET_ID,
  DEFAULT_SYSTEM_ID,
} from './config.js';
import type {
  AlertSnapshotResponse,
  AuditResponse,
  Command,
  CommandRequest,
  CommandResponse,
  EventSnapshotResponse,
  FogMapView,
  GalaxyView,
  HealthResponse,
  CatalogView,
  MetricsSnapshot,
  PlanetInspectEntityKind,
  PlanetInspectView,
  PlanetNetworksView,
  PlanetRuntimeView,
  PlanetSceneDetailLevel,
  PlanetSceneView,
  PlanetSummaryView,
  PlanetView,
  PlayerStatsSnapshot,
  Position,
  ReplayResponse,
  RollbackResponse,
  StateSummary,
  SystemView,
} from './types.js';
import { resolveServerUrl } from './utils.js';

export interface AuthState {
  playerId: string;
  playerKey: string;
}

export interface ApiClientOptions {
  serverUrl: string;
  fetchFn?: typeof fetch;
  auth?: Partial<AuthState>;
  defaultGalaxyId?: string;
  defaultPlanetId?: string;
  defaultSystemId?: string;
}

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

export interface EventSnapshotParams {
  event_types?: string[];
  after_event_id?: string;
  since_tick?: number;
  limit?: number;
}

export interface AlertSnapshotParams {
  after_alert_id?: string;
  since_tick?: number;
  limit?: number;
}

export interface PlanetSceneParams {
  x: number;
  y: number;
  width: number;
  height: number;
  detailLevel?: PlanetSceneDetailLevel;
  layers?: string[];
}

export interface PlanetInspectParams {
  entityKind: PlanetInspectEntityKind;
  entityId?: string;
  sectorId?: string;
}

export interface ReplayRequest {
  from_tick?: number;
  to_tick?: number;
  step?: boolean;
  speed?: number;
  verify?: boolean;
}

export interface RollbackRequest {
  to_tick?: number;
}

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

function buildUrl(serverUrl: string, path: string): string {
  return resolveServerUrl(serverUrl, path);
}

function addParams(params: URLSearchParams, values: object) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      params.set(key, value.join(','));
      return;
    }
    params.set(key, String(value));
  });
}

export function createApiClient(options: ApiClientOptions) {
  let serverUrl = options.serverUrl;
  let auth: AuthState = {
    playerId: options.auth?.playerId ?? '',
    playerKey: options.auth?.playerKey ?? '',
  };

  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const defaultGalaxyId = options.defaultGalaxyId ?? DEFAULT_GALAXY_ID;
  const defaultPlanetId = options.defaultPlanetId ?? DEFAULT_PLANET_ID;
  const defaultSystemId = options.defaultSystemId ?? DEFAULT_SYSTEM_ID;

  async function apiFetch<T>(path: string, requestInit: RequestInit = {}): Promise<T> {
    const headers = new Headers(requestInit.headers);
    if (!headers.has('Content-Type') && requestInit.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (auth.playerKey) {
      headers.set('Authorization', `Bearer ${auth.playerKey}`);
    }

    const response = await fetchFn(buildUrl(serverUrl, path), {
      ...requestInit,
      headers,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = typeof payload?.error === 'string'
        ? payload.error
        : response.statusText || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }

  function setAuth(playerId: string, playerKey: string) {
    auth = { playerId, playerKey };
  }

  function clearAuth() {
    auth = { playerId: '', playerKey: '' };
  }

  function getAuth(): AuthState {
    return { ...auth };
  }

  function setServerUrl(nextServerUrl: string) {
    serverUrl = nextServerUrl;
  }

  function getServerUrl(): string {
    return serverUrl;
  }

  async function fetchHealth(): Promise<HealthResponse> {
    const response = await fetchFn(buildUrl(serverUrl, '/health'));
    if (!response.ok) {
      throw new Error(response.statusText || `HTTP ${response.status}`);
    }
    return response.json() as Promise<HealthResponse>;
  }

  async function fetchMetrics(): Promise<MetricsSnapshot> {
    const response = await fetchFn(buildUrl(serverUrl, '/metrics'));
    if (!response.ok) {
      throw new Error(response.statusText || `HTTP ${response.status}`);
    }
    return response.json() as Promise<MetricsSnapshot>;
  }

  function fetchSummary(): Promise<StateSummary> {
    return apiFetch<StateSummary>('/state/summary');
  }

  function fetchStats(): Promise<PlayerStatsSnapshot> {
    return apiFetch<PlayerStatsSnapshot>('/state/stats');
  }

  function fetchGalaxy(): Promise<GalaxyView> {
    return apiFetch<GalaxyView>('/world/galaxy');
  }

  function fetchSystem(systemId: string): Promise<SystemView> {
    return apiFetch<SystemView>(`/world/systems/${systemId}`);
  }

  function fetchPlanet(planetId: string): Promise<PlanetSummaryView> {
    return apiFetch<PlanetSummaryView>(`/world/planets/${planetId}`);
  }

  function fetchPlanetScene(planetId: string, params: PlanetSceneParams): Promise<PlanetSceneView> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, {
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
      detail_level: params.detailLevel,
      layers: params.layers,
    });
    const query = searchParams.toString();
    return apiFetch<PlanetSceneView>(`/world/planets/${planetId}/scene?${query}`);
  }

  function fetchPlanetInspect(planetId: string, params: PlanetInspectParams): Promise<PlanetInspectView> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, {
      entity_kind: params.entityKind,
      entity_id: params.entityId,
      sector_id: params.sectorId,
    });
    const query = searchParams.toString();
    return apiFetch<PlanetInspectView>(`/world/planets/${planetId}/inspect?${query}`);
  }

  function fetchFogMap(planetId: string): Promise<FogMapView> {
    return apiFetch<FogMapView>(`/world/planets/${planetId}/fog`);
  }

  function fetchPlanetRuntime(planetId: string): Promise<PlanetRuntimeView> {
    return apiFetch<PlanetRuntimeView>(`/world/planets/${planetId}/runtime`);
  }

  function fetchPlanetNetworks(planetId: string): Promise<PlanetNetworksView> {
    return apiFetch<PlanetNetworksView>(`/world/planets/${planetId}/networks`);
  }

  function fetchCatalog(): Promise<CatalogView> {
    return apiFetch<CatalogView>('/catalog');
  }

  async function sendCommands(commands: Command[]): Promise<CommandResponse> {
    if (!auth.playerId) {
      throw new Error('missing authenticated player_id');
    }
    const request: CommandRequest = {
      request_id: crypto.randomUUID(),
      issuer_type: 'player',
      issuer_id: auth.playerId,
      commands,
    };
    return sendCommandRequest(request);
  }

  function sendSingleCommand(command: Command): Promise<CommandResponse> {
    return sendCommands([command]);
  }

  function cmdScanGalaxy(galaxyId = defaultGalaxyId): Promise<CommandResponse> {
    return sendSingleCommand({
      type: 'scan_galaxy',
      target: { layer: 'galaxy', galaxy_id: galaxyId },
    });
  }

  function cmdScanSystem(systemId = defaultSystemId): Promise<CommandResponse> {
    return sendSingleCommand({
      type: 'scan_system',
      target: { layer: 'system', system_id: systemId },
    });
  }

  function cmdScanPlanet(planetId = defaultPlanetId): Promise<CommandResponse> {
    return sendSingleCommand({
      type: 'scan_planet',
      target: { layer: 'planet', planet_id: planetId },
    });
  }

  function sendCommandRequest(request: CommandRequest): Promise<CommandResponse> {
    return apiFetch<CommandResponse>('/commands', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  function fetchAudit(params: AuditQueryParams = {}): Promise<AuditResponse> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, params);
    const query = searchParams.toString();
    return apiFetch<AuditResponse>(`/audit${query ? `?${query}` : ''}`);
  }

  function fetchEventSnapshot(params: EventSnapshotParams = {}): Promise<EventSnapshotResponse> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, {
      ...params,
      event_types: params.event_types && params.event_types.length > 0
        ? params.event_types
        : [...DEFAULT_EVENT_TYPES],
    });
    const query = searchParams.toString();
    return apiFetch<EventSnapshotResponse>(`/events/snapshot${query ? `?${query}` : ''}`);
  }

  function fetchAlertSnapshot(params: AlertSnapshotParams = {}): Promise<AlertSnapshotResponse> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, params);
    const query = searchParams.toString();
    return apiFetch<AlertSnapshotResponse>(`/alerts/production/snapshot${query ? `?${query}` : ''}`);
  }

  function sendReplay(request: ReplayRequest): Promise<ReplayResponse> {
    return apiFetch<ReplayResponse>('/replay', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  function sendRollback(request: RollbackRequest): Promise<RollbackResponse> {
    return apiFetch<RollbackResponse>('/rollback', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  function cmdBuild(position: Position, buildingType: string, buildOptions: BuildOptions = {}) {
    return sendSingleCommand({
      type: 'build',
      target: { layer: 'planet', position },
      payload: {
        building_type: buildingType,
        ...(buildOptions.direction ? { direction: buildOptions.direction } : {}),
        ...(buildOptions.recipeId ? { recipe_id: buildOptions.recipeId } : {}),
      },
    });
  }

  function cmdMove(entityId: string, position: Position) {
    return sendSingleCommand({
      type: 'move',
      target: { layer: 'planet', entity_id: entityId, position },
    });
  }

  function cmdAttack(entityId: string, targetEntityId: string) {
    return sendSingleCommand({
      type: 'attack',
      target: { layer: 'planet', entity_id: entityId },
      payload: { target_entity_id: targetEntityId },
    });
  }

  function cmdProduce(entityId: string, unitType: UnitTypeName) {
    return sendSingleCommand({
      type: 'produce',
      target: { layer: 'planet', entity_id: entityId },
      payload: { unit_type: unitType },
    });
  }

  function cmdUpgrade(entityId: string) {
    return sendSingleCommand({
      type: 'upgrade',
      target: { layer: 'planet', entity_id: entityId },
    });
  }

  function cmdDemolish(entityId: string) {
    return sendSingleCommand({
      type: 'demolish',
      target: { layer: 'planet', entity_id: entityId },
    });
  }

  function cmdCancelConstruction(taskId: string) {
    return sendSingleCommand({
      type: 'cancel_construction',
      target: { layer: 'planet' },
      payload: { task_id: taskId },
    });
  }

  function cmdRestoreConstruction(taskId: string) {
    return sendSingleCommand({
      type: 'restore_construction',
      target: { layer: 'planet' },
      payload: { task_id: taskId },
    });
  }

  function cmdStartResearch(techId: string) {
    return sendSingleCommand({
      type: 'start_research',
      target: { layer: 'planet' },
      payload: { tech_id: techId },
    });
  }

  function cmdCancelResearch(techId: string) {
    return sendSingleCommand({
      type: 'cancel_research',
      target: { layer: 'planet' },
      payload: { tech_id: techId },
    });
  }

  function cmdLaunchSolarSail(buildingId: string, launchOptions: LaunchSolarSailOptions = {}) {
    return sendSingleCommand({
      type: 'launch_solar_sail',
      target: { layer: 'planet' },
      payload: {
        building_id: buildingId,
        ...(launchOptions.count !== undefined ? { count: launchOptions.count } : {}),
        ...(launchOptions.orbitRadius !== undefined ? { orbit_radius: launchOptions.orbitRadius } : {}),
        ...(launchOptions.inclination !== undefined ? { inclination: launchOptions.inclination } : {}),
      },
    });
  }

  function cmdBuildDysonNode(buildOptions: BuildDysonNodeOptions) {
    return sendSingleCommand({
      type: 'build_dyson_node',
      target: { layer: 'system', system_id: buildOptions.systemId },
      payload: {
        system_id: buildOptions.systemId,
        layer_index: buildOptions.layerIndex,
        latitude: buildOptions.latitude,
        longitude: buildOptions.longitude,
        ...(buildOptions.orbitRadius !== undefined ? { orbit_radius: buildOptions.orbitRadius } : {}),
      },
    });
  }

  function cmdBuildDysonFrame(buildOptions: BuildDysonFrameOptions) {
    return sendSingleCommand({
      type: 'build_dyson_frame',
      target: { layer: 'system', system_id: buildOptions.systemId },
      payload: {
        system_id: buildOptions.systemId,
        layer_index: buildOptions.layerIndex,
        node_a_id: buildOptions.nodeAId,
        node_b_id: buildOptions.nodeBId,
      },
    });
  }

  function cmdBuildDysonShell(buildOptions: BuildDysonShellOptions) {
    return sendSingleCommand({
      type: 'build_dyson_shell',
      target: { layer: 'system', system_id: buildOptions.systemId },
      payload: {
        system_id: buildOptions.systemId,
        layer_index: buildOptions.layerIndex,
        latitude_min: buildOptions.latitudeMin,
        latitude_max: buildOptions.latitudeMax,
        coverage: buildOptions.coverage,
      },
    });
  }

  function cmdDemolishDyson(systemId: string, componentType: DysonComponentType, componentId: string) {
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

  return {
    clearAuth,
    cmdAttack,
    cmdBuild,
    cmdBuildDysonFrame,
    cmdBuildDysonNode,
    cmdBuildDysonShell,
    cmdCancelConstruction,
    cmdCancelResearch,
    cmdDemolish,
    cmdDemolishDyson,
    cmdLaunchSolarSail,
    cmdMove,
    cmdProduce,
    cmdRestoreConstruction,
    cmdScanGalaxy,
    cmdScanPlanet,
    cmdScanSystem,
    cmdStartResearch,
    cmdUpgrade,
    fetchAlertSnapshot,
    fetchAudit,
    fetchCatalog,
    fetchEventSnapshot,
    fetchFogMap,
    fetchGalaxy,
    fetchHealth,
    fetchMetrics,
    fetchPlanetNetworks,
    fetchPlanet,
    fetchPlanetInspect,
    fetchPlanetScene,
    fetchPlanetRuntime,
    fetchStats,
    fetchSummary,
    fetchSystem,
    getAuth,
    getServerUrl,
    sendCommandRequest,
    sendCommands,
    sendReplay,
    sendRollback,
    setAuth,
    setServerUrl,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
