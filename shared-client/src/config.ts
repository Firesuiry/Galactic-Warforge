export const DEFAULT_SERVER_URL = 'http://localhost:18080';

export const DEFAULT_PLAYERS = [
  { id: 'p1', key: 'key_player_1' },
  { id: 'p2', key: 'key_player_2' },
] as const;

export const DEFAULT_GALAXY_ID = 'galaxy-1';
export const DEFAULT_PLANET_ID = 'planet-1-1';
export const DEFAULT_SYSTEM_ID = 'sys-1';

export const DEFAULT_SSE_BUFFER_SIZE = 100;

export const ALL_EVENT_TYPES = [
  'command_result',
  'entity_created',
  'entity_moved',
  'damage_applied',
  'entity_destroyed',
  'building_state_changed',
  'resource_changed',
  'tick_completed',
  'production_alert',
  'construction_paused',
  'construction_resumed',
  'research_completed',
  'threat_level_changed',
  'loot_dropped',
  'entity_updated',
  'rocket_launched',
  // 战争闭环事件（fleet / 战场 / 封锁 / 登陆 / 补给 / 胜利）
  'squad_deployed',
  'fleet_commissioned',
  'fleet_assigned',
  'fleet_attack_started',
  'fleet_disbanded',
  'missile_salvo_fired',
  'point_defense_intercept',
  'battle_report_generated',
  'landing_started',
  'landing_failed',
  'orbital_superiority_changed',
  'supply_line_disrupted',
  'victory_declared',
] as const;

export const DEFAULT_EVENT_TYPES = [
  'command_result',
  'entity_created',
  'entity_destroyed',
  'building_state_changed',
  'construction_paused',
  'construction_resumed',
  'research_completed',
  'loot_dropped',
  'rocket_launched',
  // 战争高频事件：让战争工作台的 SSE 实时层默认订阅
  'fleet_commissioned',
  'fleet_attack_started',
  'battle_report_generated',
  'orbital_superiority_changed',
  'landing_started',
  'landing_failed',
  'supply_line_disrupted',
  'squad_deployed',
] as const;

export const DEFAULT_SSE_SILENT_EVENT_TYPES = new Set([
  'resource_changed',
  'threat_level_changed',
  'tick_completed',
]);

export type KnownEventType = (typeof ALL_EVENT_TYPES)[number];
