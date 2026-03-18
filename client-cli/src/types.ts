// Mirror of Go model structs

export interface Position {
  x: number;
  y: number;
  z: number;
}

export type BuildingType = 'base' | 'mine' | 'solar_plant' | 'factory' | 'turret';
export type UnitType = 'worker' | 'soldier';

export interface Building {
  id: string;
  type: BuildingType;
  owner_id: string;
  position: Position;
  hp: number;
  max_hp: number;
  level: number;
  vision_range: number;
  mineral_rate: number;
  energy_rate: number;
  energy_consume: number;
  attack: number;
  attack_range: number;
  is_active: boolean;
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

export interface PlayerState {
  player_id: string;
  resources: Resources;
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
