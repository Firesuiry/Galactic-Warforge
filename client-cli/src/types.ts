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
}

export interface SprayModule {
  throughput: number;
  max_level: number;
}

export interface StorageModule {
  capacity: number;
  slots?: number;
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
}

export interface BuildingRuntime {
  params: BuildingRuntimeParams;
  functions?: BuildingFunctionModules;
  state: BuildingWorkState;
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

export type CommandType = 'scan_galaxy' | 'scan_system' | 'scan_planet';

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

export interface PlayerState {
  player_id: string;
  resources: Resources;
  inventory?: ItemInventory;
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

export interface PlanetView {
  planet_id: string;
  name?: string;
  discovered: boolean;
  map_width: number;
  map_height: number;
  tick: number;
  buildings?: Record<string, Building>;
  units?: Record<string, Unit>;
}

export interface FogMapView {
  planet_id: string;
  discovered: boolean;
  map_width: number;
  map_height: number;
  visible?: boolean[][];
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
}

export interface GalaxyView {
  galaxy_id: string;
  name?: string;
  discovered: boolean;
  systems?: SystemRef[];
}

export interface PlanetRef {
  planet_id: string;
  name?: string;
  discovered: boolean;
}

export interface SystemView {
  system_id: string;
  name?: string;
  discovered: boolean;
  planets?: PlanetRef[];
}

export interface HealthResponse {
  status: string;
  tick: number;
}

export interface MetricsSnapshot {
  tick: number;
  tick_duration_ms: number;
  connections: number;
  commands_processed: number;
  [key: string]: unknown;
}

export interface ReplContext {
  currentPlayer: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rl: any;
}
