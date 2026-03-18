export const SERVER_URL = process.env.SW_SERVER ?? 'http://localhost:18080';

export const DEFAULT_PLAYERS = [
  { id: 'p1', key: 'key_player_1' },
  { id: 'p2', key: 'key_player_2' },
];

export const DEFAULT_PLANET_ID = 'planet-1';
export const DEFAULT_SYSTEM_ID = 'sys-1';
export const SSE_BUFFER_SIZE = 100;
