// C10 大厅与会话：/games/current 轮询、新局表单模型与校验（纯函数，便于单测）。

import {
  gameStatusOf,
  type GameSummary,
  type NewGameBotDifficulty,
  type NewGameEnemyDifficulty,
  type NewGamePlayer,
  type NewGameRequest,
  type NewGameVictoryMode,
  type SettlementReport,
} from '@shared/game';

export { gameStatusOf };

/** 与大厅相同：离线样例没有 /games/current。 */
export const FIXTURE_GAME_UNAVAILABLE =
  '离线样例模式不提供对局大厅；请从登录页切换到在线服务端查看对局状态。';

/** 已提示终局的键：started_at + declared_tick。同一局只提示一次。 */
export const SETTLEMENT_PROMPTED_STORAGE_KEY = 'gw.settlement-prompted';

export function settlementPromptKey(game: Pick<GameSummary, 'started_at' | 'settlement'>) {
  const declaredTick = game.settlement?.declared_tick;
  return `${game.started_at}::${declaredTick ?? ''}`;
}

export function isSameSettlementPrompt(
  stored: string,
  game: Pick<GameSummary, 'started_at' | 'settlement'>,
) {
  if (!stored || !game.started_at) {
    return false;
  }
  return stored === settlementPromptKey(game) || stored.startsWith(`${game.started_at}::`);
}

/** session.playerId 是否属于获胜方（本人 id、结算 winner 标记或同队）。 */
export function didPlayerWin(playerId: string, report: SettlementReport) {
  if (report.winner_id === playerId) {
    return true;
  }
  const me = report.players.find((player) => player.player_id === playerId);
  if (me?.winner) {
    return true;
  }
  return Boolean(report.team_id && me?.team_id && me.team_id === report.team_id);
}

/** 对局身份：started_at + map_seed 任一变化都视为换局（F1 热重置后两者都会变）。 */
export function gameIdentityOf(game: GameSummary) {
  return `${game.started_at}::${game.map_seed}`;
}

/** 对局连续性判定：换局（重置/读档）/ 重连（同一局被服务端重启恢复）/ 无变化。 */
export type GameContinuity = 'none' | 'reset' | 'reconnected';

/**
 * 「对局已被重置」的判定：以服务端给出的 session 来源 `origin` 为准，不再按时间/tick 猜。
 * - 身份（started_at+map_seed）没变：tick 回退 = 同局回滚 → reset，否则 none；
 * - 身份变了：origin=resume（进程重启恢复同一局存档）→ reconnected，
 *   new（开新局）/ checkpoint（读档存档点，实体 id 会复用）→ reset。
 */
export function detectGameContinuity(
  previous: { identity: string; tick: number } | null,
  game: GameSummary,
): GameContinuity {
  if (!previous) {
    return 'none';
  }
  if (previous.identity === gameIdentityOf(game)) {
    return game.tick < previous.tick ? 'reset' : 'none';
  }
  return game.origin === 'resume' ? 'reconnected' : 'reset';
}

/**
 * 判断是否为 401 认证失败。shared-client 的 apiFetch 只透传服务端 error 文案，
 * 服务端 401 文案固定为 "invalid player key" / "missing or invalid Authorization header"；
 * 兜底匹配 HTTP 401（响应体非 JSON 时退化为 statusText/HTTP code）。
 */
export function isAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('invalid player key')
    || normalized.includes('missing or invalid authorization header')
    || normalized.includes('http 401')
    || normalized.includes('unauthorized')
  );
}

export const ENEMY_DIFFICULTY_LABELS: Record<string, string> = {
  off: '关闭',
  easy: '简单',
  normal: '标准',
  hard: '困难',
};

export const VICTORY_MODE_LABELS: Record<string, string> = {
  elimination: '歼灭',
  mission_complete: '任务完成',
  hybrid: '混合',
  sandbox: '沙盒',
};

export const VICTORY_REASON_LABELS: Record<string, string> = {
  elimination: '基地被全歼',
  game_win: '完成任务目标',
  time_limit: '时限到达，按战绩判定',
};

export const PLAYER_ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  commander: '指挥官',
  observer: '观察者',
};

export const BOT_DIFFICULTY_LABELS: Record<string, string> = {
  easy: '简单',
  normal: '标准',
  hard: '困难',
};

export function translateEnemyDifficulty(value: string) {
  return ENEMY_DIFFICULTY_LABELS[value] ?? value;
}

export function translateVictoryMode(value: string) {
  return VICTORY_MODE_LABELS[value] ?? '标准';
}

export function translateVictoryReason(value: string) {
  return VICTORY_REASON_LABELS[value] ?? '对局结束';
}

export function translatePlayerRole(value: string) {
  return PLAYER_ROLE_LABELS[value] ?? value;
}

export function translateBotDifficulty(value: string) {
  return BOT_DIFFICULTY_LABELS[value] ?? value;
}

export const ENEMY_DIFFICULTY_OPTIONS: NewGameEnemyDifficulty[] = ['off', 'easy', 'normal', 'hard'];
export const VICTORY_MODE_OPTIONS: NewGameVictoryMode[] = ['elimination', 'mission_complete', 'hybrid', 'sandbox'];
export const PLAYER_ROLE_OPTIONS: Array<'admin' | 'commander' | 'observer'> = ['admin', 'commander', 'observer'];
export const BOT_DIFFICULTY_OPTIONS: NewGameBotDifficulty[] = ['easy', 'normal', 'hard'];

/** 新局表单一行玩家；bot 为空串表示人类玩家，team_id 为空表示默认取 player_id。 */
export interface NewGamePlayerRow {
  player_id: string;
  key: string;
  role: 'admin' | 'commander' | 'observer';
  bot: '' | NewGameBotDifficulty;
  team_id: string;
}

export interface NewGameFormValue {
  /** 空 = 服务端随机生成 */
  map_seed: string;
  enemy_difficulty: NewGameEnemyDifficulty;
  victory_mode: NewGameVictoryMode;
  players: NewGamePlayerRow[];
}

export function createEmptyPlayerRow(): NewGamePlayerRow {
  return { player_id: '', key: '', role: 'commander', bot: '', team_id: '' };
}

export function normalizeEnemyDifficulty(value: string): NewGameEnemyDifficulty {
  return (ENEMY_DIFFICULTY_OPTIONS as string[]).includes(value)
    ? (value as NewGameEnemyDifficulty)
    : 'normal';
}

export function normalizeVictoryMode(value: string): NewGameVictoryMode {
  return (VICTORY_MODE_OPTIONS as string[]).includes(value)
    ? (value as NewGameVictoryMode)
    : 'elimination';
}

export function normalizePlayerRole(value: string): NewGamePlayerRow['role'] {
  return (PLAYER_ROLE_OPTIONS as string[]).includes(value)
    ? (value as NewGamePlayerRow['role'])
    : 'commander';
}

export function normalizeBotDifficulty(value: string | undefined): NewGamePlayerRow['bot'] {
  return value && (BOT_DIFFICULTY_OPTIONS as string[]).includes(value)
    ? (value as NewGameBotDifficulty)
    : '';
}

/** 用当前对局概要预填表单：玩家行沿用当前阵容，本人行回填当前 key（其他玩家 key 服务端不可见）。 */
export function prefillNewGameForm(
  game: GameSummary,
  selfPlayerId: string,
  selfPlayerKey: string,
): NewGameFormValue {
  return {
    map_seed: '',
    enemy_difficulty: normalizeEnemyDifficulty(game.enemy_difficulty),
    victory_mode: normalizeVictoryMode(game.victory_mode),
    players: game.players.map((player) => ({
      player_id: player.player_id,
      key: player.player_id === selfPlayerId ? selfPlayerKey : '',
      role: normalizePlayerRole(player.role),
      bot: normalizeBotDifficulty(player.bot),
      team_id: player.team_id && player.team_id !== player.player_id ? player.team_id : '',
    })),
  };
}

/** 前端预检：返回错误文案列表，空数组表示通过。与服务端 400 校验对齐。 */
export function validateNewGameForm(form: NewGameFormValue): string[] {
  const errors: string[] = [];
  if (form.players.length === 0) {
    errors.push('至少需要 1 名玩家。');
    return errors;
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  form.players.forEach((row, index) => {
    const label = `第 ${index + 1} 行玩家`;
    const playerId = row.player_id.trim();
    const key = row.key.trim();
    if (!playerId) {
      errors.push(`${label}：player_id 不能为空。`);
    } else if (seenIds.has(playerId)) {
      errors.push(`${label}：player_id「${playerId}」重复。`);
    } else {
      seenIds.add(playerId);
    }
    if (!key) {
      errors.push(`${label}：key 不能为空。`);
    } else if (seenKeys.has(key)) {
      errors.push(`${label}：key 与其他玩家重复。`);
    } else {
      seenKeys.add(key);
    }
  });
  return errors;
}

/** 无 admin 时的软警告（不阻塞提交，但新局将无法再通过大厅/管理端点开新局）。 */
export function newGameAdminWarning(form: NewGameFormValue): string {
  return form.players.some((row) => row.role === 'admin')
    ? ''
    : '玩家列表中没有 admin 角色，新局开启后将无人能执行开新局/存档等管理操作。';
}

export function buildNewGameRequest(form: NewGameFormValue): NewGameRequest {
  const players: NewGamePlayer[] = form.players.map((row) => {
    const player: NewGamePlayer = {
      player_id: row.player_id.trim(),
      key: row.key.trim(),
      role: row.role,
    };
    const teamId = row.team_id.trim();
    if (teamId) {
      player.team_id = teamId;
    }
    if (row.bot) {
      player.bot = row.bot;
    }
    return player;
  });

  const request: NewGameRequest = { players };
  const seed = form.map_seed.trim();
  if (seed) {
    request.map_seed = seed;
  }
  request.enemy_difficulty = form.enemy_difficulty;
  request.victory_mode = form.victory_mode;
  return request;
}

export interface AdoptedAuth {
  playerId: string;
  playerKey: string;
  /** true = 沿用了当前登录身份；false = 切换到了其他玩家（本人被移出或未设 admin） */
  samePlayer: boolean;
}

/**
 * 开新局成功后本机凭证切换策略（对齐 CLI adoptNewGameAuth）：
 * 优先沿用当前登录玩家（拿新 key），否则切到请求里第一个 admin，再兜底第一个玩家。
 * players 为空（理论不可达，校验已拦截）返回 null。
 */
export function resolveAdoptedAuth(
  request: NewGameRequest,
  currentPlayerId: string,
): AdoptedAuth | null {
  const self = request.players.find((player) => player.player_id === currentPlayerId);
  if (self) {
    return { playerId: self.player_id, playerKey: self.key, samePlayer: true };
  }
  const admin = request.players.find((player) => player.role === 'admin') ?? request.players[0];
  if (!admin) {
    return null;
  }
  return { playerId: admin.player_id, playerKey: admin.key, samePlayer: false };
}
