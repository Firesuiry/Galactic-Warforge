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

/** 终局结算中单个玩家在宣判时刻冻结的战果/战损。字段名与服务端 json 一致。 */
export interface SettlementPlayerStats {
  player_id: string;
  team_id?: string;
  is_alive: boolean;
  winner?: boolean;
  units_killed: number;
  units_lost: number;
  buildings_destroyed: number;
  buildings_lost: number;
}

/** 宣判时冻结的终局结算报告。仅 status=finished 时由服务端附带。 */
export interface SettlementReport {
  winner_id: string;
  team_id?: string;
  reason: string;
  victory_rule: string;
  tech_id?: string;
  start_tick: number;
  declared_tick: number;
  duration_ticks: number;
  players: SettlementPlayerStats[];
}

export type GameStatus = 'running' | 'finished';

// GameSummary 是 GET /games/current 与 POST /games/new 的响应体。
export interface GameSummary {
  map_seed: string;
  enemy_difficulty: string;
  victory_mode: string;
  max_tick_rate: number;
  active_planet_id: string;
  tick: number;
  started_at: string;
  /** 本 session 的来源：new 新局 / resume 进程重启恢复同一局 / checkpoint 热加载存档点。 */
  origin: GameOrigin;
  /** 本局的来源存档点名；不是从存档点读出来的局没有。 */
  source_checkpoint?: string;
  players: GamePlayerSummary[];
  victory: GameVictorySummary;
  /**
   * running|finished。旧响应可缺省，客户端把缺省当 running。
   * finished 后常规游戏命令以 GAME_FINISHED 拒绝。
   */
  status?: GameStatus;
  /** 仅 finished 时存在。 */
  settlement?: SettlementReport;
}

export type GameOrigin = 'new' | 'resume' | 'checkpoint';

/** 缺省 status 视为 running，兼容尚未带该字段的旧响应。 */
export function gameStatusOf(game: Pick<GameSummary, 'status'>): GameStatus {
  return game.status === 'finished' ? 'finished' : 'running';
}
