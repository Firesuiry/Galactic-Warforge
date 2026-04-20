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

export type WeaponType = 'gun' | 'cannon' | 'missile' | 'laser';

export interface ShieldState {
  level: number;
  max_level: number;
  recharge_rate: number;
  recharge_delay: number;
  last_hit_tick?: number;
}

export interface WeaponState {
  type: WeaponType;
  damage: number;
  fire_rate: number;
  range: number;
  last_fire_tick?: number;
  ammo_cost: number;
}

export interface OrbitPosition {
  planet_id: string;
  radius: number;
  angle: number;
  angular_speed: number;
}

export type CombatSquadState = 'idle' | 'engaging' | 'destroyed';

export interface CombatSquad {
  id: string;
  owner_id: string;
  planet_id: string;
  source_building_id?: string;
  blueprint_id: string;
  count: number;
  hp: number;
  max_hp: number;
  shield: ShieldState;
  weapon: WeaponState;
  state: CombatSquadState;
  target_enemy_id?: string;
  last_attack_tick?: number;
}

export interface OrbitalPlatform {
  id: string;
  owner_id: string;
  planet_id: string;
  orbit: OrbitPosition;
  hp: number;
  max_hp: number;
  weapon: WeaponState;
  ammo_capacity: number;
  ammo_count: number;
  last_fire_tick?: number;
  is_active: boolean;
}

export interface SolarSail {
  id: string;
  orbit_radius: number;
  inclination: number;
  launch_tick: number;
  lifetime_ticks: number;
  energy_per_tick: number;
}

export interface SolarSailOrbitState {
  player_id: string;
  system_id: string;
  sails: SolarSail[];
  total_energy: number;
}

export interface FleetTarget {
  planet_id: string;
  target_id?: string;
}

export interface FleetUnitStack {
  blueprint_id: string;
  count: number;
}

export type FormationType = 'line' | 'vee' | 'circle' | 'wedge';
export type FleetState = 'idle' | 'attacking';

export type LogisticsScope = 'planetary' | 'interstellar';
export type LogisticsMode = 'none' | 'supply' | 'demand' | 'both';

export interface ConfigureLogisticsStationInterstellarOptions {
  enabled?: boolean;
  warpEnabled?: boolean;
  shipSlots?: number;
}

export interface ConfigureLogisticsStationOptions {
  inputPriority?: number;
  outputPriority?: number;
  droneCapacity?: number;
  interstellar?: ConfigureLogisticsStationInterstellarOptions;
}

export interface ConfigureLogisticsSlotOptions {
  scope: LogisticsScope;
  itemId: string;
  mode: LogisticsMode;
  localStorage: number;
}

export type RayReceiverMode = 'power' | 'photon' | 'hybrid';

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
  | 'configure_logistics_station'
  | 'configure_logistics_slot'
  | 'cancel_construction'
  | 'restore_construction'
  | 'start_research'
  | 'cancel_research'
  | 'transfer_item'
  | 'switch_active_planet'
  | 'set_ray_receiver_mode'
  | 'deploy_squad'
  | 'commission_fleet'
  | 'fleet_assign'
  | 'fleet_attack'
  | 'fleet_disband'
  | 'task_force_create'
  | 'task_force_assign'
  | 'task_force_set_stance'
  | 'task_force_deploy'
  | 'theater_create'
  | 'theater_define_zone'
  | 'theater_set_objective'
  | 'blueprint_create'
  | 'blueprint_set_component'
  | 'blueprint_validate'
  | 'blueprint_finalize'
  | 'blueprint_variant'
  | 'queue_military_production'
  | 'refit_unit'
  | 'launch_solar_sail'
  | 'launch_rocket'
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
  validation?: WarBlueprintValidationResult;
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
  required_cost?: ItemAmount[];
  consumed_cost?: Record<string, number>;
  blocked_reason?: string;
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
  executors?: Record<string, ExecutorState>;
  tech?: TechState;
  combat_tech?: CombatTechState;
  stats?: PlayerStatsSnapshot;
  war_blueprints?: Record<string, WarBlueprintDetailView>;
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

export interface PlanetSummaryView {
  planet_id: string;
  system_id?: string;
  name?: string;
  discovered: boolean;
  kind?: string;
  map_width: number;
  map_height: number;
  tick: number;
  building_count: number;
  unit_count: number;
  resource_count: number;
}

export interface PlanetView {
  planet_id: string;
  system_id?: string;
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

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanetSceneView {
  planet_id: string;
  system_id?: string;
  name?: string;
  discovered: boolean;
  kind?: string;
  map_width: number;
  map_height: number;
  tick: number;
  bounds: SceneBounds;
  terrain?: string[][];
  environment?: PlanetEnvironment;
  visible?: boolean[][];
  explored?: boolean[][];
  buildings?: Record<string, Building>;
  units?: Record<string, Unit>;
  resources?: PlanetResource[];
  building_count?: number;
  unit_count?: number;
  resource_count?: number;
}

export interface PlanetOverviewView {
  planet_id: string;
  system_id?: string;
  name?: string;
  discovered: boolean;
  kind?: string;
  map_width: number;
  map_height: number;
  tick: number;
  step: number;
  cells_width: number;
  cells_height: number;
  terrain?: string[][];
  visible?: boolean[][];
  explored?: boolean[][];
  resource_counts?: number[][];
  building_counts?: number[][];
  unit_counts?: number[][];
  building_count?: number;
  unit_count?: number;
  resource_count?: number;
}

export type PlanetInspectEntityKind = 'building' | 'unit' | 'resource' | 'sector';

export interface PlanetInspectView {
  planet_id: string;
  discovered: boolean;
  entity_kind?: PlanetInspectEntityKind;
  entity_id?: string;
  title?: string;
  building?: Building;
  unit?: Unit;
  resource?: PlanetResource;
}

export interface FogMapView {
  planet_id: string;
  discovered: boolean;
  map_width: number;
  map_height: number;
  visible?: boolean[][];
  explored?: boolean[][];
}

export interface LogisticsStationPriority {
  input: number;
  output: number;
}

export type LogisticsStationMode = 'none' | 'supply' | 'demand' | 'both';

export interface LogisticsStationInterstellarConfig {
  enabled: boolean;
  warp_enabled: boolean;
  ship_slots: number;
  ship_capacity: number;
  ship_speed: number;
  warp_speed: number;
  warp_distance: number;
  energy_per_distance: number;
  warp_energy_multiplier: number;
  warp_item_id?: string;
  warp_item_cost: number;
}

export interface LogisticsStationItemSetting {
  item_id: string;
  mode: LogisticsStationMode;
  local_storage: number;
}

export interface LogisticsStationCapacityCache {
  supply?: ItemInventory;
  demand?: ItemInventory;
  local?: ItemInventory;
}

export interface LogisticsStationState {
  priority: LogisticsStationPriority;
  settings?: Record<string, LogisticsStationItemSetting>;
  inventory?: ItemInventory;
  drone_capacity: number;
  interstellar: LogisticsStationInterstellarConfig;
  interstellar_settings?: Record<string, LogisticsStationItemSetting>;
  cache?: LogisticsStationCapacityCache;
  interstellar_cache?: LogisticsStationCapacityCache;
}

export type LogisticsDroneStatus = 'idle' | 'takeoff' | 'in_flight' | 'landing';

export interface LogisticsDroneView {
  id: string;
  owner_id: string;
  station_id: string;
  target_station_id?: string;
  capacity: number;
  speed: number;
  status: LogisticsDroneStatus;
  position: Position;
  target_pos?: Position;
  remaining_ticks: number;
  travel_ticks: number;
  cargo?: ItemInventory;
}

export type LogisticsShipStatus = 'idle' | 'takeoff' | 'in_flight' | 'landing';

export interface LogisticsShipView {
  id: string;
  owner_id: string;
  station_id: string;
  origin_planet_id?: string;
  target_planet_id?: string;
  target_station_id?: string;
  capacity: number;
  speed: number;
  warp_speed: number;
  warp_distance: number;
  energy_per_distance: number;
  warp_energy_multiplier: number;
  warp_item_id?: string;
  warp_item_cost: number;
  warp_enabled: boolean;
  status: LogisticsShipStatus;
  position: Position;
  target_pos?: Position;
  remaining_ticks: number;
  travel_ticks: number;
  cargo?: ItemInventory;
  warped: boolean;
  energy_cost: number;
  warp_item_spent: number;
}

export interface LogisticsStationView {
  building_id: string;
  building_type: string;
  owner_id: string;
  position: Position;
  state?: LogisticsStationState;
  drone_ids?: string[];
  ship_ids?: string[];
}

export type ConstructionState = 'pending' | 'in_progress' | 'paused' | 'completed' | 'cancelled';

export type PlanRotation = '' | 'north' | 'east' | 'south' | 'west';
export type ConveyorDirection = '' | 'north' | 'east' | 'south' | 'west' | 'auto';

export interface BlueprintParams {
  [key: string]: unknown;
}

export interface BuildCost {
  minerals: number;
  energy: number;
  items?: ItemAmount[];
}

export interface ItemAmount {
  item_id: string;
  quantity: number;
}

export interface ConstructionTaskView {
  id: string;
  player_id: string;
  region_id?: string;
  building_type: string;
  position: Position;
  rotation?: PlanRotation;
  blueprint_params?: BlueprintParams;
  conveyor_direction?: ConveyorDirection;
  recipe_id?: string;
  cost?: BuildCost;
  state: ConstructionState;
  enqueue_tick: number;
  start_tick?: number;
  update_tick?: number;
  queue_index?: number;
  remaining_ticks?: number;
  total_ticks?: number;
  speed_bonus?: number;
  priority?: number;
  error?: string;
  materials_deducted?: boolean;
}

export interface EnemyForceView {
  id: string;
  type: string;
  position: Position;
  strength: number;
  target_player?: string;
  spawn_tick?: number;
  last_seen?: number;
  threat_level?: number;
}

export interface DetectionView {
  player_id: string;
  vision_range: number;
  known_enemy_count: number;
  detected_positions?: Position[];
}

export interface PlanetRuntimeView {
  planet_id: string;
  discovered: boolean;
  available: boolean;
  active_planet_id?: string;
  tick: number;
  combat_squads?: CombatSquad[];
  orbital_platforms?: OrbitalPlatform[];
  logistics_stations?: LogisticsStationView[];
  logistics_drones?: LogisticsDroneView[];
  logistics_ships?: LogisticsShipView[];
  construction_tasks?: ConstructionTaskView[];
  enemy_forces?: EnemyForceView[];
  detections?: DetectionView[];
  threat_level: number;
  last_attack_tick?: number;
}

export type PowerGridLinkKind = 'line' | 'wireless';
export type PowerCoverageFailureReason = '' | 'no_connector' | 'no_provider' | 'out_of_range' | 'capacity_full';

export interface PowerConnector {
  building_id: string;
  position: Position;
  kind: 'line' | 'wireless';
  range: number;
  capacity: number;
}

export interface PowerNetworkView {
  id: string;
  owner_id: string;
  supply: number;
  demand: number;
  allocated: number;
  net: number;
  shortage: boolean;
  node_ids?: string[];
}

export interface PowerNodeView {
  building_id: string;
  owner_id: string;
  building_type: string;
  position: Position;
  network_id?: string;
  connectors?: PowerConnector[];
}

export interface PowerLinkView {
  from_building_id: string;
  to_building_id: string;
  kind: PowerGridLinkKind;
  distance: number;
  from_position: Position;
  to_position: Position;
}

export interface PowerCoverageView {
  building_id: string;
  owner_id: string;
  building_type: string;
  position: Position;
  connected: boolean;
  reason?: PowerCoverageFailureReason;
  provider_id?: string;
  network_id?: string;
  demand?: number;
  allocated?: number;
  ratio?: number;
  priority?: number;
}

export interface PipelineNodeView {
  id: string;
  position: Position;
  buffer: number;
  pressure: number;
  fluid_id?: string;
}

export interface PipelineSegmentView {
  id: string;
  from_node_id: string;
  to_node_id: string;
  from_position: Position;
  to_position: Position;
  flow_rate: number;
  pressure: number;
  capacity: number;
  attenuation?: number;
  current_flow: number;
  buffer: number;
  fluid_id?: string;
}

export interface PipelineEndpointView {
  id: string;
  node_id: string;
  building_id: string;
  owner_id: string;
  port_id: string;
  direction: PortDirection;
  position: Position;
  capacity: number;
  allowed_items?: string[];
}

export interface PlanetNetworksView {
  planet_id: string;
  discovered: boolean;
  available: boolean;
  active_planet_id?: string;
  tick: number;
  power_networks?: PowerNetworkView[];
  power_nodes?: PowerNodeView[];
  power_links?: PowerLinkView[];
  power_coverage?: PowerCoverageView[];
  pipeline_nodes?: PipelineNodeView[];
  pipeline_segments?: PipelineSegmentView[];
  pipeline_endpoints?: PipelineEndpointView[];
}

export interface BuildingCatalogEntry {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  footprint: Footprint;
  build_cost: BuildCost;
  buildable: boolean;
  default_recipe_id?: string;
  requires_resource_node?: boolean;
  can_produce_units?: boolean;
  unlock_tech?: string[];
  icon_key: string;
  color: string;
}

export interface ItemCatalogEntry {
  id: string;
  name: string;
  category: string;
  form: string;
  stack_limit: number;
  unit_volume: number;
  container_id?: string;
  is_rare?: boolean;
  icon_key: string;
  color: string;
}

export interface RecipeCatalogEntry {
  id: string;
  name: string;
  inputs: ItemAmount[];
  outputs: ItemAmount[];
  byproducts?: ItemAmount[];
  duration: number;
  energy_cost: number;
  building_types?: string[];
  tech_unlock?: string[];
  icon_key: string;
  color: string;
}

export interface TechUnlock {
  type: string;
  id: string;
  level?: number;
}

export interface TechEffect {
  type: string;
  value: number;
}

export interface TechCatalogEntry {
  id: string;
  name: string;
  name_en?: string;
  category: string;
  type: string;
  level: number;
  prerequisites?: string[];
  cost?: ItemAmount[];
  unlocks?: TechUnlock[];
  effects?: TechEffect[];
  max_level?: number;
  hidden?: boolean;
  icon_key: string;
  color: string;
}

export interface WorldUnitCatalogEntry {
  id: string;
  name: string;
  domain: string;
  runtime_class: string;
  public: boolean;
  visible_tech_id?: string;
  production_mode: string;
  producer_recipes?: string[];
  deploy_command?: string;
  query_scopes?: string[];
  commands?: string[];
  hidden_reason?: string;
}

export interface WarBudgetProfile {
  power_output?: number;
  sustained_draw?: number;
  peak_draw?: number;
  volume_capacity?: number;
  mass_capacity?: number;
  rigidity_capacity?: number;
  heat_capacity?: number;
  maintenance_limit?: number;
  signal_capacity?: number;
}

export interface WarSlotSpec {
  id: string;
  category: string;
  size?: string;
  required?: boolean;
  notes?: string;
}

export interface WarBaseFrameCatalogEntry {
  id: string;
  name: string;
  role?: string;
  description?: string;
  supported_domains?: string[];
  visible_tech_id?: string;
  budgets?: WarBudgetProfile;
  slots?: WarSlotSpec[];
}

export interface WarBaseHullCatalogEntry {
  id: string;
  name: string;
  role?: string;
  description?: string;
  supported_domains?: string[];
  visible_tech_id?: string;
  budgets?: WarBudgetProfile;
  slots?: WarSlotSpec[];
}

export interface WarComponentCatalogEntry {
  id: string;
  name: string;
  category: string;
  slot_kind?: string;
  supported_domains?: string[];
  power_output?: number;
  power_draw?: number;
  volume?: number;
  mass?: number;
  rigidity_load?: number;
  heat_load?: number;
  maintenance?: number;
  signal_load?: number;
  stealth_rating?: number;
  tags?: string[];
}

export interface WarBlueprintComponentSlot {
  slot_id: string;
  component_id: string;
}

export interface WarPublicBlueprintCatalogEntry {
  id: string;
  name: string;
  domain: string;
  source: string;
  base_frame_id?: string;
  base_hull_id?: string;
  visible_tech_id?: string;
  runtime_class: string;
  production_mode: string;
  producer_recipes?: string[];
  deploy_command?: string;
  query_scopes?: string[];
  commands?: string[];
  components?: WarBlueprintComponentSlot[];
}

export interface WarfareCatalogView {
  base_frames?: WarBaseFrameCatalogEntry[];
  base_hulls?: WarBaseHullCatalogEntry[];
  components?: WarComponentCatalogEntry[];
  public_blueprints?: WarPublicBlueprintCatalogEntry[];
}

export type WarBlueprintState =
  | 'draft'
  | 'validated'
  | 'prototype'
  | 'field_tested'
  | 'adopted'
  | 'obsolete';

export interface WarBlueprintBudgetUsage {
  power_output?: number;
  power_draw?: number;
  volume?: number;
  mass?: number;
  rigidity_load?: number;
  heat_load?: number;
  maintenance?: number;
  signal_load?: number;
  stealth_rating?: number;
}

export interface WarBlueprintValidationIssue {
  code: string;
  message: string;
  slot_id?: string;
  component_id?: string;
  actual?: number;
  limit?: number;
}

export interface WarBlueprintValidationResult {
  valid: boolean;
  limits?: WarBudgetProfile;
  usage?: WarBlueprintBudgetUsage;
  issues?: WarBlueprintValidationIssue[];
}

export interface WarBlueprintDetailView {
  id: string;
  owner_id?: string;
  name: string;
  source: string;
  state: WarBlueprintState;
  domain: string;
  base_frame_id?: string;
  base_hull_id?: string;
  parent_blueprint_id?: string;
  allowed_variant_slots?: string[];
  components?: WarBlueprintComponentSlot[];
  validation: WarBlueprintValidationResult;
  allowed_actions?: string[];
}

export interface WarBlueprintListView {
  blueprints: WarBlueprintDetailView[];
}

export type WarOrderStatus = 'queued' | 'in_progress' | 'blocked' | 'completed';

export type WarProductionStage = 'components' | 'assembly' | 'ready';

export type WarRefitUnitKind = 'squad' | 'fleet';

export interface WarProductionOrder {
  id: string;
  factory_building_id: string;
  deployment_hub_id?: string;
  blueprint_id: string;
  domain: string;
  count: number;
  completed_count: number;
  status: WarOrderStatus;
  stage: WarProductionStage;
  stage_remaining_ticks?: number;
  stage_total_ticks?: number;
  component_ticks?: number;
  assembly_ticks?: number;
  retool_ticks?: number;
  repeat_bonus_percent?: number;
  queue_index?: number;
  created_tick?: number;
  updated_tick?: number;
}

export interface WarRefitOrder {
  id: string;
  building_id: string;
  unit_id: string;
  unit_kind: WarRefitUnitKind;
  source_planet_id?: string;
  source_system_id?: string;
  source_building_id?: string;
  source_blueprint_id: string;
  target_blueprint_id: string;
  count?: number;
  fleet_formation?: FormationType;
  status: WarOrderStatus;
  remaining_ticks?: number;
  total_ticks?: number;
  queue_index?: number;
  created_tick?: number;
  updated_tick?: number;
}

export interface WarDeploymentHubView {
  building_id: string;
  building_type: string;
  planet_id?: string;
  capacity?: number;
  ready_payloads?: Record<string, number>;
}

export interface WarIndustryView {
  production_orders: WarProductionOrder[];
  refit_orders: WarRefitOrder[];
  deployment_hubs: WarDeploymentHubView[];
}

export type WarTaskForceStance =
  | 'hold'
  | 'patrol'
  | 'escort'
  | 'intercept'
  | 'harass'
  | 'siege'
  | 'bombard'
  | 'retreat_on_losses';

export type WarTaskForceMemberKind = 'squad' | 'fleet';

export type WarTheaterZoneType =
  | 'primary'
  | 'secondary'
  | 'no_entry'
  | 'rally'
  | 'supply_priority';

export type WarCommandCapacitySourceType =
  | 'command_center'
  | 'command_ship'
  | 'battlefield_analysis_base'
  | 'military_ai_core';

export interface WarTaskForceDeployment {
  system_id?: string;
  planet_id?: string;
  position?: Position;
}

export interface WarCommandCapacitySource {
  source_id: string;
  source_type: WarCommandCapacitySourceType;
  label?: string;
  entity_id?: string;
  planet_id?: string;
  system_id?: string;
  capacity: number;
}

export interface WarCommandCapacityStatus {
  total: number;
  used: number;
  over?: number;
  delay_penalty?: number;
  hit_penalty?: number;
  formation_penalty?: number;
  coordination_penalty?: number;
  sources?: WarCommandCapacitySource[];
}

export interface WarTaskForceMemberView {
  kind: WarTaskForceMemberKind;
  entity_id: string;
  planet_id?: string;
  system_id?: string;
  blueprint_ids?: string[];
  count?: number;
  state?: string;
}

export interface WarTaskForceView {
  id: string;
  name?: string;
  theater_id?: string;
  stance: WarTaskForceStance;
  deployment?: WarTaskForceDeployment;
  members?: WarTaskForceMemberView[];
  command_capacity: WarCommandCapacityStatus;
}

export interface WarTaskForceListView {
  task_forces: WarTaskForceView[];
}

export interface WarTheaterZoneView {
  zone_type: WarTheaterZoneType;
  system_id?: string;
  planet_id?: string;
  position?: Position;
  radius?: number;
}

export interface WarTheaterObjectiveView {
  objective_type: string;
  system_id?: string;
  planet_id?: string;
  entity_id?: string;
  description?: string;
}

export interface WarTheaterView {
  id: string;
  name?: string;
  zones?: WarTheaterZoneView[];
  objective?: WarTheaterObjectiveView;
}

export interface WarTheaterListView {
  theaters: WarTheaterView[];
}

export interface FleetRuntimeView {
  fleet_id: string;
  owner_id: string;
  system_id: string;
  source_building_id?: string;
  formation: FormationType;
  state: FleetState;
  units?: FleetUnitStack[];
  target?: FleetTarget;
}

export interface FleetDetailView extends FleetRuntimeView {
  weapon: WeaponState;
  shield: ShieldState;
  last_attack_tick?: number;
}

export interface DysonNodeView {
  id: string;
  layer_index: number;
  latitude: number;
  longitude: number;
  energy_output: number;
  integrity: number;
  built: boolean;
}

export interface DysonFrameView {
  id: string;
  layer_index: number;
  node_a_id: string;
  node_b_id: string;
  integrity: number;
  built: boolean;
}

export interface DysonShellView {
  id: string;
  layer_index: number;
  latitude_min: number;
  latitude_max: number;
  coverage: number;
  energy_output: number;
  integrity: number;
  built: boolean;
}

export interface DysonLayerView {
  layer_index: number;
  orbit_radius: number;
  nodes?: DysonNodeView[];
  frames?: DysonFrameView[];
  shells?: DysonShellView[];
  energy_output: number;
  rocket_launches?: number;
  construction_bonus?: number;
}

export interface DysonSphereView {
  player_id: string;
  system_id: string;
  layers?: DysonLayerView[];
  total_energy: number;
}

export interface ActivePlanetDysonContextView {
  planet_id: string;
  em_rail_ejector_count: number;
  vertical_launching_silo_count: number;
  ray_receiver_count: number;
  ray_receiver_modes?: Record<string, number>;
}

export interface SystemRuntimeView {
  system_id: string;
  discovered: boolean;
  available: boolean;
  solar_sail_orbit?: SolarSailOrbitState;
  dyson_sphere?: DysonSphereView;
  active_planet_context?: ActivePlanetDysonContextView;
  fleets?: FleetRuntimeView[];
}

export interface CatalogView {
  buildings?: BuildingCatalogEntry[];
  items?: ItemCatalogEntry[];
  recipes?: RecipeCatalogEntry[];
  techs?: TechCatalogEntry[];
  world_units?: WorldUnitCatalogEntry[];
  warfare?: WarfareCatalogView;
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
  rl: any;
}

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

export interface SaveRequest {
  reason?: string;
}

export interface SaveResponse {
  ok: boolean;
  tick: number;
  saved_at: string;
  path: string;
  trigger: string;
}

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
  space_entity_counter: number;
  solar_sail_count: number;
  solar_sail_systems: number;
  solar_sail_total_energy: number;
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
