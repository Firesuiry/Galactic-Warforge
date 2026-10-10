import type { PlanetPathView, SorterConfig } from './types.js';
import type { GameSummary, NewGameRequest } from './game.js';
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
  FleetDetailView,
  FormationType,
  GalaxyView,
  GroundTaskForceOrder,
  HealthResponse,
  CatalogView,
  CommandCatalogView,
  ConfigureLogisticsSlotOptions,
  ConfigureLogisticsStationOptions,
  DistributorConfig,
  MechaLogisticsRequest,
  SplitterConfig,
  TrafficMonitorConfig,
  MetricsSnapshot,
  OrbitalSupportMode,
  PlanetInspectEntityKind,
  PlanetInspectView,
  PlanetOverviewView,
  PlanetSceneView,
  PlanetNetworksView,
  PlanetRuntimeView,
  PlanetSummaryView,
  PlayerStatsSnapshot,
  Position,
  RayReceiverMode,
  EnergyExchangerMode,
  SetEnergyExchangerModePayload,
  SetRecipePayload,
  ReplayResponse,
  RollbackResponse,
  SaveRequest,
  SaveResponse,
  CheckpointListView,
  CheckpointLoadResult,
  CheckpointSaveRequest,
  CheckpointSummary,
  AgentBriefing,
  StateSummary,
  SystemRuntimeView,
  SystemView,
  WarIndustryView,
  WarBlueprintListView,
  WarBlueprintState,
  WarBlueprintDetailView,
  WarTaskForceListView,
  WarTaskForceMemberKind,
  WarTaskForceStance,
  WarTheaterListView,
  WarTheaterZoneType,
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
  near_x?: number;
  near_y?: number;
  radius?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanetOverviewParams {
  step: number;
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

export type WorldUnitID = string;
export type BlueprintID = string;
export type Direction = 'north' | 'east' | 'south' | 'west' | 'auto';
export type DysonComponentType = 'node' | 'frame' | 'shell';

export interface BuildOptions {
  rotation?: 0 | 90 | 180 | 270;
  autoApproach?: boolean;
  direction?: Direction;
  recipeId?: string;
  /** F4：显式落点行星；缺省落在玩家焦点行星。 */
  planetId?: string;
}

export interface LaunchSolarSailOptions {
  count?: number;
  orbitRadius?: number;
  inclination?: number;
  /** F4：发射场所在行星的路由提示（跨行星同 ID 时消歧）。 */
  planetId?: string;
}

export interface LaunchRocketOptions {
  layerIndex?: number;
  count?: number;
  /** F4：发射场所在行星的路由提示（跨行星同 ID 时消歧）。 */
  planetId?: string;
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

export interface DeploySquadOptions {
  count?: number;
  planetId?: string;
}

export interface CommissionFleetOptions {
  count?: number;
  fleetId?: string;
}

export interface CreateBlueprintOptions {
  name?: string;
  baseFrameId?: string;
  baseHullId?: string;
}

export interface FinalizeBlueprintOptions {
  targetState?: WarBlueprintState;
}

export interface VariantBlueprintOptions {
  name?: string;
}

export interface QueueMilitaryProductionOptions {
  count?: number;
}

export type FleetFormation = FormationType;

export interface CreateTaskForceOptions {
  name?: string;
  stance?: WarTaskForceStance;
}

export interface TaskForceAssignOptions {
  memberKind: WarTaskForceMemberKind;
  memberIds: string[];
  systemId?: string;
  planetId?: string;
}

export interface TaskForceDeployOptions {
  theaterId?: string;
  systemId?: string;
  planetId?: string;
  position?: Position;
  frontlineId?: string;
  groundOrder?: GroundTaskForceOrder;
  supportMode?: OrbitalSupportMode;
}

export interface TheaterCreateOptions {
  name?: string;
}

export interface TheaterDefineZoneOptions {
  zoneType: WarTheaterZoneType;
  systemId?: string;
  planetId?: string;
  position?: Position;
  radius?: number;
}

export interface TheaterSetObjectiveOptions {
  objectiveType: string;
  systemId?: string;
  planetId?: string;
  entityId?: string;
  description?: string;
}

export interface BlockadePlanetOptions {
  planetId: string;
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

  const fetchFn: typeof fetch = options.fetchFn
    ?? ((input, init) => globalThis.fetch(input, init));
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

  function fetchAgentBriefing(params?: { alert_limit?: number }): Promise<AgentBriefing> {
    const searchParams = new URLSearchParams();
    if (params?.alert_limit !== undefined) {
      searchParams.set('alert_limit', String(params.alert_limit));
    }
    const query = searchParams.toString();
    return apiFetch<AgentBriefing>(`/state/agent-briefing${query ? `?${query}` : ''}`);
  }

  function fetchGalaxy(): Promise<GalaxyView> {
    return apiFetch<GalaxyView>('/world/galaxy');
  }

  function fetchSystem(systemId: string): Promise<SystemView> {
    return apiFetch<SystemView>(`/world/systems/${systemId}`);
  }

  function fetchSystemRuntime(systemId: string): Promise<SystemRuntimeView> {
    return apiFetch<SystemRuntimeView>(`/world/systems/${systemId}/runtime`);
  }

  function fetchPlanet(planetId: string): Promise<PlanetSummaryView> {
    return apiFetch<PlanetSummaryView>(`/world/planets/${planetId}`);
  }

  function fetchPlanetPath(planetId: string, params: {unit_id:string;target_x:number;target_y:number;stop_range?:number}): Promise<PlanetPathView> {
    const query=new URLSearchParams();addParams(query,params);
    return apiFetch<PlanetPathView>(`/world/planets/${planetId}/path?${query.toString()}`);
  }

  function fetchPlanetScene(planetId: string, params: PlanetSceneParams): Promise<PlanetSceneView> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, params);
    const query = searchParams.toString();
    return apiFetch<PlanetSceneView>(`/world/planets/${planetId}/scene${query ? `?${query}` : ''}`);
  }

  function fetchPlanetOverview(planetId: string, params: PlanetOverviewParams): Promise<PlanetOverviewView> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, params);
    const query = searchParams.toString();
    return apiFetch<PlanetOverviewView>(`/world/planets/${planetId}/overview${query ? `?${query}` : ''}`);
  }

  function fetchPlanetInspect(planetId: string, params: PlanetInspectParams): Promise<PlanetInspectView> {
    const searchParams = new URLSearchParams();
    addParams(searchParams, {
      entity_kind: params.entityKind,
      entity_id: params.entityId,
      sector_id: params.sectorId,
    });
    const query = searchParams.toString();
    return apiFetch<PlanetInspectView>(`/world/planets/${planetId}/inspect${query ? `?${query}` : ''}`);
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

  function fetchCommandCatalog(): Promise<CommandCatalogView> {
    return apiFetch<CommandCatalogView>('/catalog/commands');
  }

  function fetchWarfareBlueprints(): Promise<WarBlueprintListView> {
    return apiFetch<WarBlueprintListView>('/world/warfare/blueprints');
  }

  function fetchWarfareBlueprint(blueprintId: string): Promise<WarBlueprintDetailView> {
    return apiFetch<WarBlueprintDetailView>(`/world/warfare/blueprints/${blueprintId}`);
  }

  function fetchWarIndustry(): Promise<WarIndustryView> {
    return apiFetch<WarIndustryView>('/world/warfare/industry');
  }

  function fetchWarTaskForces(): Promise<WarTaskForceListView> {
    return apiFetch<WarTaskForceListView>('/world/warfare/task-forces');
  }

  function fetchWarTheaters(): Promise<WarTheaterListView> {
    return apiFetch<WarTheaterListView>('/world/warfare/theaters');
  }

  function fetchFleets(): Promise<FleetDetailView[]> {
    return apiFetch<FleetDetailView[]>('/world/fleets');
  }

  function fetchFleet(fleetId: string): Promise<FleetDetailView> {
    return apiFetch<FleetDetailView>(`/world/fleets/${fleetId}`);
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

  function sendSave(request: SaveRequest = {}): Promise<SaveResponse> {
    return apiFetch<SaveResponse>('/save', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // 命名存档点：列表任意登录玩家可查，创建/加载仅 role=admin。
  function fetchCheckpoints(): Promise<CheckpointListView> {
    return apiFetch<CheckpointListView>('/checkpoints');
  }

  function saveCheckpoint(request: CheckpointSaveRequest): Promise<CheckpointSummary> {
    return apiFetch<CheckpointSummary>('/checkpoints', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  function loadCheckpoint(name: string): Promise<CheckpointLoadResult> {
    return apiFetch<CheckpointLoadResult>(`/checkpoints/${encodeURIComponent(name)}/load`, {
      method: 'POST',
    });
  }

  // F1 新局热重置：查询当前对局概要。
  function fetchCurrentGame(): Promise<GameSummary> {
    return apiFetch<GameSummary>('/games/current');
  }

  // F1 新局热重置：仅 role=admin 可调用；成功后旧 key 立即失效，
  // 调用方需用新局玩家的 key 重新 setAuth 并重新订阅事件流。
  function createNewGame(request: NewGameRequest): Promise<GameSummary> {
    return apiFetch<GameSummary>('/games/new', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  function cmdBuild(position: Position, buildingType: string, buildOptions: BuildOptions = {}) {
    return sendSingleCommand({
      type: 'build',
      target: { layer: 'planet', position, ...(buildOptions.planetId ? { planet_id: buildOptions.planetId } : {}) },
      payload: {
        building_type: buildingType,
        ...(buildOptions.rotation !== undefined ? { rotation: buildOptions.rotation } : {}),
        ...(buildOptions.autoApproach !== undefined ? { auto_approach: buildOptions.autoApproach } : {}),
        ...(buildOptions.direction ? { direction: buildOptions.direction } : {}),
        ...(buildOptions.recipeId ? { recipe_id: buildOptions.recipeId } : {}),
      },
    });
  }

  function unitSelectorTarget(selector: string | string[]) {
    if (Array.isArray(selector)) {
      return { entity_ids: selector };
    }
    return { entity_id: selector };
  }

  function cmdMove(selector: string | string[], position: Position, planetId?: string) {
    return sendSingleCommand({
      type: 'move',
      target: { layer: 'planet', ...unitSelectorTarget(selector), position, ...(planetId ? { planet_id: planetId } : {}) },
    });
  }

  function cmdAttack(selector: string | string[], targetEntityId: string, planetId?: string) {
    return sendSingleCommand({
      type: 'attack',
      target: { layer: 'planet', ...unitSelectorTarget(selector), ...(planetId ? { planet_id: planetId } : {}) },
      payload: { target_entity_id: targetEntityId },
    });
  }

  type UnitOrderKind = 'attack_move' | 'patrol' | 'guard' | 'hold' | 'follow' | 'retreat' | 'stop';

  function cmdUnitOrder(selector: string | string[], order: UnitOrderKind, options: { position?: Position; targetEntityId?: string; planetId?: string } = {}) {
    return sendSingleCommand({
      type: 'unit_order',
      target: { layer: 'planet', ...unitSelectorTarget(selector), ...(options.position ? { position: options.position } : {}), ...(options.planetId ? { planet_id: options.planetId } : {}) },
      payload: {
        order,
        ...(options.targetEntityId ? { target_entity_id: options.targetEntityId } : {}),
      },
    });
  }

  /** count：最多烧几块燃料（缺省 1），服务端烧到核心满为止。 */
  function cmdRefuelMecha(entityId: string, itemId: string, count?: number, planetId?: string) {
    return sendSingleCommand({
      type: 'refuel_mecha',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: { item_id: itemId, ...(count !== undefined ? { count } : {}) },
    });
  }

  function cmdMineResource(entityId: string, itemId: string, quantity: number, planetId?: string) {
    return sendSingleCommand({
      type: 'mine_resource',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: { resource_id: itemId, quantity },
    });
  }

  function cmdCraftItem(entityId: string, itemId: string, quantity: number, planetId?: string) {
    return sendSingleCommand({
      type: 'craft_item',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: { recipe_id: itemId, quantity },
    });
  }

  function cmdConfigureTrafficMonitor(entityId: string, config: TrafficMonitorConfig) {
    return sendSingleCommand({
      type: 'configure_traffic_monitor',
      target: { layer: 'planet', entity_id: entityId },
      payload: { ...config },
    });
  }

  function cmdConfigureSorter(entityId: string, config: SorterConfig, planetId?: string) {
    return sendSingleCommand({type: 'configure_sorter', target: {layer:'planet', entity_id:entityId, ...(planetId ? {planet_id:planetId} : {})}, payload:{...config}});
  }

  function cmdConfigureSplitter(entityId: string, config: SplitterConfig) {
    return sendSingleCommand({
      type: 'configure_splitter',
      target: { layer: 'planet', entity_id: entityId },
      payload: { ...config },
    });
  }

  function cmdCancelMechaJob(entityId: string, planetId?: string) {
    return sendSingleCommand({
      type: 'cancel_mecha_job',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
    });
  }

  function cmdSetRallyPoint(entityId:string,position:{x:number;y:number;z:number},planetId?:string) {
   return sendSingleCommand({type:'set_rally_point',target:{layer:'planet',entity_id:entityId,position,...(planetId?{planet_id:planetId}:{})}});
  }

  function cmdFormSquad(entityIds: string[], name?: string, planetId?: string) {
    return sendSingleCommand({
      type: 'form_squad',
      target: { layer: 'planet', ...(planetId ? { planet_id: planetId } : {}) },
      payload: { entity_ids: entityIds, ...(name ? { name } : {}) },
    });
  }

  function cmdSquadOrder(squadId: string, order: 'attack' | 'defend' | 'retreat' | 'resupply', position?: { x: number; y: number; z?: number }, planetId?: string) {
    return sendSingleCommand({
      type: 'squad_order',
      target: { layer: 'planet', ...(position ? { position: { z: 0, ...position } } : {}), ...(planetId ? { planet_id: planetId } : {}) },
      payload: { squad_id: squadId, order },
    });
  }

  function cmdDissolveSquad(squadId: string, planetId?: string) {
    return sendSingleCommand({
      type: 'dissolve_squad',
      target: { layer: 'planet', ...(planetId ? { planet_id: planetId } : {}) },
      payload: { squad_id: squadId },
    });
  }

  function cmdProduce(entityId: string, unitType: WorldUnitID, planetId?: string) {
    return sendSingleCommand({
      type: 'produce',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: { unit_type: unitType },
    });
  }

  function cmdUpgrade(entityId: string, planetId?: string) {
    return sendSingleCommand({
      type: 'upgrade',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
    });
  }

  function cmdDemolish(entityId: string, planetId?: string) {
    return sendSingleCommand({
      type: 'demolish',
      target: { layer: 'planet', entity_id: entityId, ...(planetId ? { planet_id: planetId } : {}) },
    });
  }

  function cmdInstallLogisticsVehicle(buildingId: string, itemId: string, quantity: number, source: 'player' | 'station' = 'player') {
    return sendSingleCommand({ type: 'install_logistics_vehicle', target: { layer: 'planet', entity_id: buildingId },
      payload: { item_id: itemId, quantity, source } });
  }

  function cmdConfigureDistributor(buildingId: string, config: DistributorConfig) {
    return sendSingleCommand({ type: 'configure_distributor', target: { layer: 'planet', entity_id: buildingId }, payload: { ...config } });
  }
  function cmdInstallLogisticsBot(buildingId: string, quantity: number, source: 'player' | 'storage' = 'player') {
    return sendSingleCommand({ type: 'install_logistics_bot', target: { layer: 'planet', entity_id: buildingId }, payload: { quantity, source } });
  }
  function cmdUninstallLogisticsBot(buildingId: string, quantity: number) {
    return sendSingleCommand({ type: 'uninstall_logistics_bot', target: { layer: 'planet', entity_id: buildingId }, payload: { quantity } });
  }
  function cmdConfigureMechaLogistics(unitId: string, requests: Record<string, MechaLogisticsRequest>, planetId?: string) {
    return sendSingleCommand({ type: 'configure_mecha_logistics', target: { layer: 'planet', entity_id: unitId, ...(planetId ? { planet_id: planetId } : {}) }, payload: { requests } });
  }

  function cmdConfigureLogisticsStation(buildingId: string, options: ConfigureLogisticsStationOptions = {}) {
    const payload: Record<string, unknown> = {
      ...(options.inputPriority !== undefined ? { input_priority: options.inputPriority } : {}),
      ...(options.outputPriority !== undefined ? { output_priority: options.outputPriority } : {}),
      ...(options.droneCapacity !== undefined ? { drone_capacity: options.droneCapacity } : {}),
      ...(options.beltPorts !== undefined ? { belt_ports: options.beltPorts } : {}),
    };
    const interstellar: Record<string, unknown> = {
      ...(options.interstellar?.enabled !== undefined ? { enabled: options.interstellar.enabled } : {}),
      ...(options.interstellar?.warpEnabled !== undefined ? { warp_enabled: options.interstellar.warpEnabled } : {}),
      ...(options.interstellar?.shipSlots !== undefined ? { ship_slots: options.interstellar.shipSlots } : {}),
    };
    if (Object.keys(interstellar).length > 0) {
      payload.interstellar = interstellar;
    }
    return sendSingleCommand({
      type: 'configure_logistics_station',
      target: { layer: 'planet', entity_id: buildingId },
      payload,
    });
  }

  function cmdConfigureLogisticsSlot(buildingId: string, options: ConfigureLogisticsSlotOptions) {
    return sendSingleCommand({
      type: 'configure_logistics_slot',
      target: { layer: 'planet', entity_id: buildingId },
      payload: {
        scope: options.scope,
        item_id: options.itemId,
        mode: options.mode,
        local_storage: options.localStorage,
        ...(options.remove !== undefined ? { remove: options.remove } : {}),
      },
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

  function cmdSetRecipe(buildingId: string, recipeId?: string, planetId?: string) {
    const payload: SetRecipePayload = recipeId ? { recipe_id: recipeId } : {};
    return sendSingleCommand({
      type: 'set_recipe',
      target: { layer: 'planet', entity_id: buildingId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: { ...payload },
    });
  }

  function cmdTransferItem(buildingId: string, itemId: string, quantity: number, planetId?: string, direction: 'to_building' | 'to_player' = 'to_building') {
    return sendSingleCommand({
      type: 'transfer_item',
      target: { layer: 'planet', entity_id: buildingId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: {
        building_id: buildingId,
        item_id: itemId,
        quantity,
        direction,
      },
    });
  }

  function cmdSwitchActivePlanet(planetId: string) {
    return sendSingleCommand({
      type: 'switch_active_planet',
      target: { layer: 'planet', planet_id: planetId },
      payload: { planet_id: planetId },
    });
  }

  function cmdSetRayReceiverMode(buildingId: string, mode: RayReceiverMode, planetId?: string) {
    return sendSingleCommand({
      type: 'set_ray_receiver_mode',
      target: { layer: 'planet', entity_id: buildingId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: {
        building_id: buildingId,
        mode,
      },
    });
  }

  function cmdSetEnergyExchangerMode(buildingId: string, mode: EnergyExchangerMode, planetId?: string) {
    const payload: SetEnergyExchangerModePayload = { building_id: buildingId, mode };
    return sendSingleCommand({
      type: 'set_energy_exchanger_mode',
      target: { layer: 'planet', entity_id: buildingId, ...(planetId ? { planet_id: planetId } : {}) },
      payload: { ...payload },
    });
  }

  function cmdDeploySquad(buildingId: string, blueprintId: BlueprintID, options: DeploySquadOptions = {}) {
    return sendSingleCommand({
      type: 'deploy_squad',
      target: {
        layer: 'planet',
        entity_id: buildingId,
      },
      payload: {
        building_id: buildingId,
        blueprint_id: blueprintId,
        count: options.count ?? 1,
        // planet_id 是小队落点行星（作战参数，可为非建筑所在行星）；行星路由由 building_id 决定。
        ...(options.planetId ? { planet_id: options.planetId } : {}),
      },
    });
  }

  function cmdCommissionFleet(
    buildingId: string,
    blueprintId: BlueprintID,
    systemId: string,
    options: CommissionFleetOptions = {},
  ) {
    return sendSingleCommand({
      type: 'commission_fleet',
      target: { layer: 'system', system_id: systemId, entity_id: buildingId },
      payload: {
        building_id: buildingId,
        blueprint_id: blueprintId,
        count: options.count ?? 1,
        system_id: systemId,
        ...(options.fleetId ? { fleet_id: options.fleetId } : {}),
      },
    });
  }

  function cmdFleetAssign(fleetId: string, formation: FleetFormation) {
    return sendSingleCommand({
      type: 'fleet_assign',
      target: { layer: 'system', entity_id: fleetId },
      payload: {
        fleet_id: fleetId,
        formation,
      },
    });
  }

  function cmdFleetAttack(fleetId: string, planetId: string, targetId: string) {
    return sendSingleCommand({
      type: 'fleet_attack',
      target: { layer: 'system', entity_id: fleetId, planet_id: planetId },
      payload: {
        fleet_id: fleetId,
        planet_id: planetId,
        target_id: targetId,
      },
    });
  }

  function cmdFleetDisband(fleetId: string) {
    return sendSingleCommand({
      type: 'fleet_disband',
      target: { layer: 'system', entity_id: fleetId },
      payload: { fleet_id: fleetId },
    });
  }

  function cmdFleetMove(fleetId: string, targetSystemId: string) {
    return sendSingleCommand({
      type: 'fleet_move',
      target: { layer: 'system', entity_id: fleetId, system_id: targetSystemId },
      payload: {
        fleet_id: fleetId,
        target_system_id: targetSystemId,
      },
    });
  }

  function cmdTaskForceCreate(taskForceId: string, options: CreateTaskForceOptions = {}) {
    return sendSingleCommand({
      type: 'task_force_create',
      target: { layer: 'planet', entity_id: taskForceId },
      payload: {
        task_force_id: taskForceId,
        ...(options.name ? { name: options.name } : {}),
        ...(options.stance ? { stance: options.stance } : {}),
      },
    });
  }

  function cmdTaskForceAssign(taskForceId: string, options: TaskForceAssignOptions) {
    const layer = options.systemId ? 'system' : 'planet';
    return sendSingleCommand({
      type: 'task_force_assign',
      target: {
        layer,
        entity_id: taskForceId,
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
      },
      payload: {
        task_force_id: taskForceId,
        member_kind: options.memberKind,
        member_ids: options.memberIds,
      },
    });
  }

  function cmdTaskForceSetStance(taskForceId: string, stance: WarTaskForceStance) {
    return sendSingleCommand({
      type: 'task_force_set_stance',
      target: { layer: 'planet', entity_id: taskForceId },
      payload: {
        task_force_id: taskForceId,
        stance,
      },
    });
  }

  function cmdTaskForceDeploy(taskForceId: string, options: TaskForceDeployOptions) {
    const layer = options.systemId ? 'system' : 'planet';
    return sendSingleCommand({
      type: 'task_force_deploy',
      target: {
        layer,
        entity_id: taskForceId,
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
        ...(options.position ? { position: options.position } : {}),
      },
      payload: {
        task_force_id: taskForceId,
        ...(options.theaterId ? { theater_id: options.theaterId } : {}),
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
        ...(options.position ? { position: options.position } : {}),
        ...(options.frontlineId ? { frontline_id: options.frontlineId } : {}),
        ...(options.groundOrder ? { ground_order: options.groundOrder } : {}),
        ...(options.supportMode ? { support_mode: options.supportMode } : {}),
      },
    });
  }

  function cmdTheaterCreate(theaterId: string, options: TheaterCreateOptions = {}) {
    return sendSingleCommand({
      type: 'theater_create',
      target: { layer: 'planet', entity_id: theaterId },
      payload: {
        theater_id: theaterId,
        ...(options.name ? { name: options.name } : {}),
      },
    });
  }

  function cmdTheaterDefineZone(theaterId: string, options: TheaterDefineZoneOptions) {
    const layer = options.systemId ? 'system' : 'planet';
    return sendSingleCommand({
      type: 'theater_define_zone',
      target: {
        layer,
        entity_id: theaterId,
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
        ...(options.position ? { position: options.position } : {}),
      },
      payload: {
        theater_id: theaterId,
        zone_type: options.zoneType,
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
        ...(options.position ? { position: options.position } : {}),
        ...(options.radius !== undefined ? { radius: options.radius } : {}),
      },
    });
  }

  function cmdTheaterSetObjective(theaterId: string, options: TheaterSetObjectiveOptions) {
    const layer = options.systemId ? 'system' : 'planet';
    return sendSingleCommand({
      type: 'theater_set_objective',
      target: {
        layer,
        entity_id: theaterId,
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
      },
      payload: {
        theater_id: theaterId,
        objective_type: options.objectiveType,
        ...(options.systemId ? { system_id: options.systemId } : {}),
        ...(options.planetId ? { planet_id: options.planetId } : {}),
        ...(options.entityId ? { entity_id: options.entityId } : {}),
        ...(options.description ? { description: options.description } : {}),
      },
    });
  }

  function cmdBlockadePlanet(taskForceId: string, options: BlockadePlanetOptions) {
    return sendSingleCommand({
      type: 'blockade_planet',
      target: { layer: 'planet', planet_id: options.planetId, entity_id: taskForceId },
      payload: {
        task_force_id: taskForceId,
        planet_id: options.planetId,
      },
    });
  }

  function cmdBlueprintCreate(blueprintId: string, domain: string, options: CreateBlueprintOptions) {
    return sendSingleCommand({
      type: 'blueprint_create',
      target: { layer: 'planet' },
      payload: {
        blueprint_id: blueprintId,
        domain,
        ...(options.name ? { name: options.name } : {}),
        ...(options.baseFrameId ? { base_frame_id: options.baseFrameId } : {}),
        ...(options.baseHullId ? { base_hull_id: options.baseHullId } : {}),
      },
    });
  }

  function cmdBlueprintSetComponent(blueprintId: string, slotId: string, componentId: string) {
    return sendSingleCommand({
      type: 'blueprint_set_component',
      target: { layer: 'planet' },
      payload: {
        blueprint_id: blueprintId,
        slot_id: slotId,
        component_id: componentId,
      },
    });
  }

  function cmdBlueprintValidate(blueprintId: string) {
    return sendSingleCommand({
      type: 'blueprint_validate',
      target: { layer: 'planet' },
      payload: { blueprint_id: blueprintId },
    });
  }

  function cmdBlueprintFinalize(blueprintId: string, options: FinalizeBlueprintOptions = {}) {
    return sendSingleCommand({
      type: 'blueprint_finalize',
      target: { layer: 'planet' },
      payload: {
        blueprint_id: blueprintId,
        ...(options.targetState ? { target_state: options.targetState } : {}),
      },
    });
  }

  function cmdBlueprintVariant(
    parentBlueprintId: string,
    blueprintId: string,
    allowedSlotIds: string[],
    options: VariantBlueprintOptions = {},
  ) {
    return sendSingleCommand({
      type: 'blueprint_variant',
      target: { layer: 'planet' },
      payload: {
        parent_blueprint_id: parentBlueprintId,
        blueprint_id: blueprintId,
        allowed_slot_ids: allowedSlotIds,
        ...(options.name ? { name: options.name } : {}),
      },
    });
  }

  function cmdQueueMilitaryProduction(
    buildingId: string,
    deploymentHubId: string,
    blueprintId: BlueprintID,
    options: QueueMilitaryProductionOptions = {},
  ) {
    return sendSingleCommand({
      type: 'queue_military_production',
      target: { layer: 'planet', entity_id: buildingId },
      payload: {
        building_id: buildingId,
        deployment_hub_id: deploymentHubId,
        blueprint_id: blueprintId,
        count: options.count ?? 1,
      },
    });
  }

  function cmdRefitUnit(buildingId: string, unitId: string, targetBlueprintId: BlueprintID) {
    return sendSingleCommand({
      type: 'refit_unit',
      target: { layer: 'planet', entity_id: buildingId },
      payload: {
        building_id: buildingId,
        unit_id: unitId,
        target_blueprint_id: targetBlueprintId,
      },
    });
  }

  function cmdLaunchSolarSail(buildingId: string, launchOptions: LaunchSolarSailOptions = {}) {
    return sendSingleCommand({
      type: 'launch_solar_sail',
      target: { layer: 'planet', ...(launchOptions.planetId ? { planet_id: launchOptions.planetId } : {}) },
      payload: {
        building_id: buildingId,
        ...(launchOptions.count !== undefined ? { count: launchOptions.count } : {}),
        ...(launchOptions.orbitRadius !== undefined ? { orbit_radius: launchOptions.orbitRadius } : {}),
        ...(launchOptions.inclination !== undefined ? { inclination: launchOptions.inclination } : {}),
      },
    });
  }

  function cmdLaunchRocket(buildingId: string, systemId: string, launchOptions: LaunchRocketOptions = {}) {
    return sendSingleCommand({
      type: 'launch_rocket',
      target: { layer: 'system', system_id: systemId, ...(launchOptions.planetId ? { planet_id: launchOptions.planetId } : {}) },
      payload: {
        building_id: buildingId,
        system_id: systemId,
        ...(launchOptions.layerIndex !== undefined ? { layer_index: launchOptions.layerIndex } : {}),
        ...(launchOptions.count !== undefined ? { count: launchOptions.count } : {}),
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
    cmdUnitOrder,
    cmdRefuelMecha,
    cmdMineResource,
    cmdCraftItem,
    cmdCancelMechaJob,
    cmdConfigureSorter,
    cmdConfigureSplitter,
    cmdConfigureTrafficMonitor,
    createNewGame,

    cmdBuild,
    cmdBlueprintCreate,
    cmdBlueprintFinalize,
    cmdBlueprintSetComponent,
    cmdBlueprintValidate,
    cmdBlueprintVariant,
    cmdBlockadePlanet,
    cmdQueueMilitaryProduction,
    cmdRefitUnit,
    cmdBuildDysonFrame,
    cmdBuildDysonNode,
    cmdBuildDysonShell,
    cmdCancelConstruction,
    cmdCancelResearch,
    cmdCommissionFleet,
    cmdConfigureLogisticsSlot,
    cmdConfigureLogisticsStation,
    cmdConfigureDistributor,
    cmdInstallLogisticsBot,
    cmdUninstallLogisticsBot,
    cmdConfigureMechaLogistics,
    cmdInstallLogisticsVehicle,
    cmdDemolish,
    cmdDemolishDyson,
    cmdDeploySquad,
    cmdTaskForceAssign,
    cmdTaskForceCreate,
    cmdTaskForceDeploy,
    cmdTaskForceSetStance,
    cmdTheaterCreate,
    cmdTheaterDefineZone,
    cmdTheaterSetObjective,
    cmdFleetAssign,
    cmdFleetAttack,
    cmdFleetDisband,
    cmdFleetMove,
    cmdLaunchRocket,
    cmdLaunchSolarSail,
    cmdMove,
    cmdSetRallyPoint,
    cmdFormSquad,
    cmdSquadOrder,
    cmdDissolveSquad,
    cmdProduce,
    cmdRestoreConstruction,
    cmdScanGalaxy,
    cmdScanPlanet,
    cmdScanSystem,
    cmdSetRayReceiverMode,
    cmdSetEnergyExchangerMode,
    cmdSetRecipe,
    cmdStartResearch,
    cmdSwitchActivePlanet,
    cmdTransferItem,
    cmdUpgrade,
    fetchAlertSnapshot,
    fetchAudit,
    fetchCatalog,
    fetchCheckpoints,
    fetchCommandCatalog,
    fetchCurrentGame,
    fetchEventSnapshot,
    fetchFleet,
    fetchFleets,
    fetchGalaxy,
    fetchHealth,
    fetchMetrics,
    fetchPlanetNetworks,
    fetchPlanet,
    fetchPlanetInspect,
    fetchPlanetOverview,
    fetchPlanetScene,
    fetchPlanetPath,
    fetchPlanetRuntime,
    fetchStats,
    fetchSummary,
    fetchAgentBriefing,
    fetchSystem,
    fetchSystemRuntime,
    fetchWarfareBlueprint,
    fetchWarfareBlueprints,
    fetchWarIndustry,
    fetchWarTaskForces,
    fetchWarTheaters,
    getAuth,
    getServerUrl,
    loadCheckpoint,
    saveCheckpoint,
    sendCommandRequest,
    sendCommands,
    sendReplay,
    sendRollback,
    sendSave,
    setAuth,
    setServerUrl,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
