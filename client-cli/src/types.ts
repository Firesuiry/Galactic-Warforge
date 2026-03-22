// Mirror of Go model structs

export interface Position {
  x: number;
  y: number;
  z: number;
}

export type BuildingType = string;
export type UnitType = 'worker' | 'soldier' | 'executor';

export type BuildingWorkState = 'idle' | 'running' | 'paused' | 'no_power' | 'error';
export type ConnectionKind = 'power' | 'transport' | 'logistics';
export type PortDirection = 'input' | 'output' | 'both';

export interface Footprint {
  width: number;
  height: number;
}

export interface GridOffset {
  x: number;
  y: number;
}

export interface ConnectionPoint {
  id: string;
  kind: ConnectionKind;
  offset: GridOffset;
  capacity: number;
}

export interface IOPort {
  id: string;
  direction: PortDirection;
  offset: GridOffset;
  capacity: number;
  allowed_items?: string[];
}

export interface MaintenanceCost {
  minerals: number;
  energy: number;
}

export interface BuildingRuntimeParams {
  energy_consume: number;
  energy_generate: number;
  power_priority?: number;
  capacity: number;
  maintenance_cost: MaintenanceCost;
  footprint: Footprint;
  connection_points?: ConnectionPoint[];
  io_ports?: IOPort[];
}

export interface ProductionModule {
  throughput: number;
  recipe_slots: number;
}

export interface CollectModule {
  resource_kind?: string;
  yield_per_tick: number;
}

export interface TransportModule {
  throughput: number;
  stack_limit?: number;
}

export interface SprayModule {
  throughput: number;
  max_level: number;
}

export interface StorageModule {
  capacity: number;
  slots?: number;
  buffer?: number;
  input_priority?: number;
  output_priority?: number;
}

export interface EnergyModule {
  output_per_tick: number;
  consume_per_tick: number;
  buffer: number;
}

export interface ResearchModule {
  research_per_tick: number;
}

export interface CombatModule {
  attack: number;
  range: number;
}

export interface BuildingFunctionModules {
  production?: ProductionModule;
  collect?: CollectModule;
  transport?: TransportModule;
  spray?: SprayModule;
  storage?: StorageModule;
  energy?: EnergyModule;
  research?: ResearchModule;
  combat?: CombatModule;
  orbital?: Record<string, unknown>;
  sorter?: Record<string, unknown>;
  ray_receiver?: Record<string, unknown>;
  energy_storage?: Record<string, unknown>;
  launch?: Record<string, unknown>;
}

export interface BuildingRuntime {
  params: BuildingRuntimeParams;
  functions?: BuildingFunctionModules;
  state: BuildingWorkState;
  state_reason?: string;
}

export type BuildingJobType = 'upgrade' | 'demolish';

export interface BuildingJob {
  type: BuildingJobType;
  remaining_ticks: number;
  target_level?: number;
  refund_rate?: number;
}

export interface Building {
  id: string;
  type: BuildingType;
  owner_id: string;
  position: Position;
  hp: number;
  max_hp: number;
  level: number;
  vision_range: number;
  runtime: BuildingRuntime;
  storage?: {
    inventory?: ItemInventory;
    input_buffer?: ItemInventory;
    output_buffer?: ItemInventory;
  };
  production?: {
    recipe_id?: string;
    remaining_ticks?: number;
  };
  job?: BuildingJob;
}

export interface Unit {
  id: string;
  type: UnitType;
  owner_id: string;
  position: Position;
  hp: number;
  max_hp: number;
  attack: number;
  defense: number;
  attack_range: number;
  move_range: number;
  vision_range: number;
  is_moving: boolean;
  target_pos?: Position;
  attack_target?: string;
}

export type CommandType =
  | 'scan_galaxy'
  | 'scan_system'
  | 'scan_planet'
  | 'build'
  | 'move'
  | 'attack'
  | 'produce'
  | 'upgrade'
  | 'demolish'
  | 'cancel_construction'
  | 'restore_construction'
  | 'start_research'
  | 'cancel_research'
  | 'launch_solar_sail'
  | 'build_dyson_node'
  | 'build_dyson_frame'
  | 'build_dyson_shell'
  | 'demolish_dyson';

export interface CommandTarget {
  layer: string;
  galaxy_id?: string;
  system_id?: string;
  planet_id?: string;
  entity_id?: string;
  position?: Position;
}

export interface Command {
  type: CommandType;
  target: CommandTarget;
  payload?: Record<string, unknown>;
}

export interface CommandRequest {
  request_id: string;
  issuer_type: string;
  issuer_id: string;
  commands: Command[];
}

export interface CommandResult {
  command_index: number;
  status: string;
  code: string;
  message: string;
}

export interface CommandResponse {
  request_id: string;
  accepted: boolean;
  enqueue_tick: number;
  results: CommandResult[];
}

export interface Resources {
  minerals: number;
  energy: number;
}

export type ItemInventory = Record<string, number>;

export interface ExecutorState {
  unit_id: string;
  build_efficiency: number;
  operate_range: number;
  concurrent_tasks: number;
  research_boost: number;
}

export interface TechQueueEntry {
  tech_id: string;
  state: string;
  progress: number;
  total_cost: number;
  current_level?: number;
  enqueue_tick?: number;
  complete_tick?: number;
}

export interface TechState {
  player_id: string;
  completed_techs?: string[];
  current_research?: TechQueueEntry;
  research_queue?: TechQueueEntry[];
  total_researched?: number;
}

export interface CombatTechItem {
  id: string;
  name: string;
  type: string;
  level: number;
  max_level?: number;
  research_cost?: number;
  effects?: Record<string, unknown>;
}

export interface CombatTechState {
  player_id: string;
  unlocked_techs?: CombatTechItem[];
  current_research?: CombatTechItem;
  research_progress?: number;
}

export interface ProductionStats {
  total_output: number;
  by_building_type: Record<string, number>;
  by_item: Record<string, number>;
  efficiency: number;
}

export interface EnergyStats {
  generation: number;
  consumption: number;
  storage: number;
  current_stored: number;
  shortage_ticks: number;
}

export interface LogisticsStats {
  throughput: number;
  avg_distance: number;
  avg_travel_time: number;
  deliveries: number;
}

export interface CombatStats {
  units_lost: number;
  enemies_killed: number;
  threat_level: number;
  highest_threat: number;
}

export interface PlayerStatsSnapshot {
  player_id: string;
  tick: number;
  production_stats: ProductionStats;
  energy_stats: EnergyStats;
  logistics_stats: LogisticsStats;
  combat_stats: CombatStats;
}

export interface PlayerState {
  player_id: string;
  team_id?: string;
  role?: string;
  resources?: Resources;
  inventory?: ItemInventory;
  permissions?: string[];
  executor?: ExecutorState;
  tech?: TechState;
  combat_tech?: CombatTechState;
  stats?: PlayerStatsSnapshot;
  is_alive: boolean;
}

export interface StateSummary {
  tick: number;
  players: Record<string, PlayerState>;
  winner?: string;
  active_planet_id: string;
  map_width: number;
  map_height: number;
}

export interface OrbitInfo {
  distance_au: number;
  period_days: number;
  inclination_deg: number;
}

export interface PlanetMoon {
  id: string;
  name: string;
  orbit: OrbitInfo;
}

export interface PlanetEnvironment {
  wind_factor?: number;
  light_factor?: number;
  tidal_locked?: boolean;
  day_length_hours?: number;
}

export interface PlanetResource {
  id: string;
  planet_id: string;
  kind: string;
  behavior: string;
  position: Position;
  remaining?: number;
  max_amount?: number;
  base_yield?: number;
  current_yield?: number;
  min_yield?: number;
  regen_per_tick?: number;
  decay_per_tick?: number;
  is_rare?: boolean;
  cluster_id?: string;
}

export interface PlanetView {
  planet_id: string;
  name?: string;
  discovered: boolean;
  kind?: string;
  orbit?: OrbitInfo;
  moons?: PlanetMoon[];
  map_width: number;
  map_height: number;
  terrain?: string[][];
  environment?: PlanetEnvironment;
  tick: number;
  buildings?: Record<string, Building>;
  units?: Record<string, Unit>;
  resources?: PlanetResource[];
}

export interface FogMapView {
  planet_id: string;
  discovered: boolean;
  map_width: number;
  map_height: number;
  visible?: boolean[][];
  explored?: boolean[][];
}

export interface GameEvent {
  event_id: string;
  tick: number;
  event_type: string;
  visibility_scope: string;
  payload: Record<string, unknown>;
}

export interface ConnectedEvent {
  type: 'connected';
  player_id: string;
  event_types?: string[];
}

export interface GameStreamEvent {
  type: 'game';
  event: GameEvent;
}

export type SseEvent = ConnectedEvent | GameStreamEvent;

export interface SystemRef {
  system_id: string;
  name?: string;
  discovered: boolean;
  position?: {
    x: number;
    y: number;
  };
  star?: Record<string, unknown>;
}

export interface GalaxyView {
  galaxy_id: string;
  name?: string;
  discovered: boolean;
  width?: number;
  height?: number;
  distance_matrix?: number[][];
  systems?: SystemRef[];
}

export interface PlanetRef {
  planet_id: string;
  name?: string;
  discovered: boolean;
  kind?: string;
  orbit?: OrbitInfo;
  moon_count?: number;
}

export interface SystemView {
  system_id: string;
  name?: string;
  discovered: boolean;
  position?: {
    x: number;
    y: number;
  };
  star?: Record<string, unknown>;
  planets?: PlanetRef[];
}

export interface HealthResponse {
  status: string;
  tick: number;
}

export interface MetricsSnapshot {
  tick_count?: number;
  last_tick_dur_ms?: number;
  commands_total?: number;
  sse_connections?: number;
  queue_backlog?: number;
  tick_p95_ms?: number;
  tick_p99_ms?: number;
  [key: string]: unknown;
}

export interface ReplContext {
  currentPlayer: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rl: any;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  tick: number;
  player_id: string;
  role: string;
  issuer_type: string;
  issuer_id: string;
  request_id: string;
  action: string;
  permission: string;
  permission_granted: boolean;
  permissions: string[];
  details: Record<string, unknown>;
}

export interface AuditResponse {
  count: number;
  entries: AuditEntry[];
}

// ── Event Snapshot ────────────────────────────────────────────────────────────

export interface GameEventDetail {
  event_id: string;
  tick: number;
  event_type: string;
  visibility_scope: string;
  payload: Record<string, unknown>;
}

export interface EventSnapshotResponse {
  event_types?: string[];
  available_from_tick: number;
  since_tick?: number;
  after_event_id?: string;
  next_event_id?: string;
  has_more: boolean;
  events: GameEventDetail[];
}

// ── Alert Snapshot ────────────────────────────────────────────────────────────

export interface AlertMetric {
  throughput: number;
  backlog: number;
  idle_ratio: number;
  efficiency: number;
  input_shortage: boolean;
  output_blocked: boolean;
  power_state: string;
}

export interface AlertEntry {
  alert_id: string;
  tick: number;
  player_id: string;
  building_id: string;
  building_type: string;
  alert_type: string;
  severity: string;
  message: string;
  metrics: AlertMetric;
  details: Record<string, unknown>;
}

export interface AlertSnapshotResponse {
  available_from_tick: number;
  since_tick?: number;
  after_alert_id?: string;
  next_alert_id?: string;
  has_more: boolean;
  alerts: AlertEntry[];
}

// ── Replay ────────────────────────────────────────────────────────────────────

export interface ReplayDigest {
  tick: number;
  players: number;
  alive_players: number;
  buildings: number;
  units: number;
  resources: number;
  total_minerals: number;
  total_energy: number;
  resource_remaining: number;
  entity_counter: number;
  hash: string;
}

export interface ReplayResponse {
  from_tick: number;
  to_tick: number;
  snapshot_tick: number;
  replay_from_tick: number;
  replay_to_tick: number;
  applied_ticks: number;
  command_count: number;
  result_mismatch_count?: number;
  duration_ms: number;
  step: boolean;
  speed: number;
  digest: ReplayDigest;
  snapshot_digest?: ReplayDigest;
  drift_detected?: boolean;
  notes?: string[];
}

// ── Rollback ──────────────────────────────────────────────────────────────────

export interface RollbackResponse {
  from_tick: number;
  to_tick: number;
  snapshot_tick: number;
  replay_from_tick: number;
  replay_to_tick: number;
  applied_ticks: number;
  command_count: number;
  duration_ms: number;
  trimmed_command_log: number;
  trimmed_event_history: number;
  trimmed_alert_history: number;
  trimmed_snapshots: number;
  trimmed_deltas: number;
  digest: ReplayDigest;
  notes?: string[];
}
