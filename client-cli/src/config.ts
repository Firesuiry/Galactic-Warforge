export const SERVER_URL = process.env.SW_SERVER ?? 'http://localhost:18080';

export const DEFAULT_PLAYERS = [
  { id: 'p1', key: 'key_player_1' },
  { id: 'p2', key: 'key_player_2' },
];

export const DEFAULT_GALAXY_ID = 'galaxy-1';
export const DEFAULT_PLANET_ID = 'planet-1-1';
export const DEFAULT_SYSTEM_ID = 'sys-1';
export const SSE_BUFFER_SIZE = 100;
export const SSE_VERBOSE = process.env.SW_SSE_VERBOSE === '1';
export const SSE_SILENT_EVENT_TYPES = new Set([
  'resource_changed',
  'threat_level_changed',
  'tick_completed',
]);
