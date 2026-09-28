// F1 新局热重置（POST /games/new / GET /games/current）相关类型。

// NewGameBootstrap 沿用服务端 config.PlayerBootstrapConfig 结构。
export interface NewGameBootstrapItem {
  item_id: string;
  quantity: number;
}

export interface NewGameBootstrap {
  minerals?: number;
  energy?: number;
  inventory?: NewGameBootstrapItem[];
  completed_techs?: string[];
}

export type NewGameBotDifficulty = 'easy' | 'normal' | 'hard';
export type NewGameEnemyDifficulty = 'off' | 'easy' | 'normal' | 'hard';
export type NewGameVictoryMode = 'elimination' | 'mission_complete' | 'hybrid' | 'sandbox';

export interface NewGamePlayer {
  player_id: string;
  key: string;
  /** admin|commander|observer，空默认 commander */
  role?: 'admin' | 'commander' | 'observer';
  /** 空默认 player_id */
  team_id?: string;
  bot?: NewGameBotDifficulty;
  bootstrap?: NewGameBootstrap;
}

export interface NewGameRequest {
  /** 空则由服务端随机生成；地图拓扑沿用服务端启动时的 mapconfig 文件 */
  map_seed?: string;
  enemy_difficulty?: NewGameEnemyDifficulty;
  victory_mode?: NewGameVictoryMode;
  players: NewGamePlayer[];
}

export interface GamePlayerSummary {
  player_id: string;
  role: string;
  team_id: string;
  bot?: string;
  is_alive: boolean;
  /** F4：该玩家当前的视图焦点/默认落点行星。 */
  focus_planet_id?: string;
}

export interface GameVictorySummary {
  declared: boolean;
  winner_id?: string;
  team_id?: string;
  reason?: string;
}

// GameSummary 是 GET /games/current 与 POST /games/new 的响应体。
export interface GameSummary {
  map_seed: string;
  enemy_difficulty: string;
  victory_mode: string;
  max_tick_rate: number;
  active_planet_id: string;
  tick: number;
  started_at: string;
  players: GamePlayerSummary[];
  victory: GameVictorySummary;
}
