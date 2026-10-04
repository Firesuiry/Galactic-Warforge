import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import {
  createNewGame, fetchCurrentGame, setAuth,
} from '../api.js';
import type { GameSummary, NewGamePlayer, NewGameRequest } from '../api.js';
import { gameStatusOf } from '@gw/shared/game';
import { fmtError } from '../format.js';
import { getStringOption, hasFlag, parseArgs } from './args.js';

function formatGameSummary(game: GameSummary): string {
  const status = gameStatusOf(game);
  const lines: string[] = [
    `status: ${status === 'finished' ? chalk.yellow(status) : chalk.green(status)}`,
    `seed: ${chalk.cyan(game.map_seed)}  tick: ${chalk.cyan(String(game.tick))}  tick rate: ${game.max_tick_rate}/s`,
    `enemy difficulty: ${game.enemy_difficulty}  victory mode: ${game.victory_mode}`,
    `started at: ${game.started_at}`,
  ];
  if (game.victory.declared) {
    lines.push(`victory: ${chalk.green(game.victory.winner_id ?? '')} (${game.victory.reason ?? ''})`);
  }
  if (status === 'finished') {
    const report = game.settlement;
    if (!report) {
      lines.push('settlement: (missing)');
    } else {
      lines.push(`winner: ${chalk.green(report.winner_id)}  reason: ${report.reason}  duration: ${report.duration_ticks} ticks`);
      lines.push('settlement:');
      for (const player of report.players ?? []) {
        lines.push(
          `  ${player.player_id} killed=${player.units_killed} lost=${player.units_lost} buildings_destroyed=${player.buildings_destroyed} buildings_lost=${player.buildings_lost}`,
        );
      }
    }
  }
  lines.push('players:');
  for (const player of game.players) {
    const tags: string[] = [];
    if (player.bot) {
      tags.push(`bot:${player.bot}`);
    }
    if (!player.is_alive) {
      tags.push('eliminated');
    }
    const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    lines.push(`  ${chalk.yellow(player.player_id)} role=${player.role} team=${player.team_id}${suffix}`);
  }
  return lines.join('\n');
}

/** POST /games/new 成功后旧 key 立即失效：优先切换到新局的 admin key，保持 CLI 可用。 */
function adoptNewGameAuth(game: GameSummary, request: NewGameRequest): string | undefined {
  const admin =
    request.players.find(p => p.role === 'admin')
    ?? request.players[0];
  if (!admin) {
    return undefined;
  }
  setAuth(admin.player_id, admin.key);
  return `auth switched to ${admin.player_id}（旧局 key 已失效）`;
}

export async function cmdGameNew(args: string[]): Promise<string> {
  return gameNewCommand(args);
}

export async function cmdGameStatus(args: string[]): Promise<string> {
  return gameStatusCommand(args);
}

export async function gameNewCommand(
  args: string[],
  createFn: typeof createNewGame = createNewGame,
): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `game_new [options]
  --seed <s>            地图种子；缺省由服务端随机生成（地图拓扑沿用服务端启动 mapconfig）
  --difficulty <d>      黑雾难度：off|easy|normal|hard（默认 normal）
  --victory <m>         胜利判定：elimination|mission_complete|hybrid|sandbox（默认 elimination）
  --players <json>      玩家定义 JSON 数组，如 '[{"player_id":"p1","key":"k1","role":"admin"}]'
  --players-file <path> 从文件读取玩家定义 JSON 数组（与 --players 二选一）
 玩家字段：player_id/key 必填；role(admin|commander|observer)/team_id/bot(easy|normal|hard)/bootstrap 可选。
 注意：成功后旧局 key 全部失效，SSE 事件流需重新订阅并重拉全量状态。`;
  }

  try {
    const playersJson = getStringOption(parsed, 'players');
    const playersFile = getStringOption(parsed, 'players-file');
    if (playersJson !== undefined && playersFile !== undefined) {
      throw new Error('--players 与 --players-file 只能二选一');
    }
    let rawPlayers = playersJson;
    if (playersFile !== undefined) {
      rawPlayers = await readFile(playersFile, 'utf8');
    }
    if (rawPlayers === undefined) {
      throw new Error('缺少 --players <json> 或 --players-file <path>');
    }
    let players: NewGamePlayer[];
    try {
      players = JSON.parse(rawPlayers) as NewGamePlayer[];
    } catch {
      throw new Error('players JSON 解析失败，应为玩家定义数组');
    }
    if (!Array.isArray(players) || players.length === 0) {
      throw new Error('players 必须是非空数组');
    }
    for (const p of players) {
      if (!p || typeof p.player_id !== 'string' || p.player_id === '') {
        throw new Error('每个玩家必须包含非空 player_id');
      }
      if (typeof p.key !== 'string' || p.key === '') {
        throw new Error('每个玩家必须包含非空 key');
      }
    }

    const request: NewGameRequest = { players };
    const seed = getStringOption(parsed, 'seed');
    if (seed !== undefined) {
      request.map_seed = seed;
    }
    const difficulty = getStringOption(parsed, 'difficulty');
    if (difficulty !== undefined) {
      if (!['off', 'easy', 'normal', 'hard'].includes(difficulty)) {
        throw new Error('--difficulty 必须是 off|easy|normal|hard');
      }
      request.enemy_difficulty = difficulty as NewGameRequest['enemy_difficulty'];
    }
    const victory = getStringOption(parsed, 'victory');
    if (victory !== undefined) {
      if (!['elimination', 'mission_complete', 'hybrid', 'sandbox'].includes(victory)) {
        throw new Error('--victory 必须是 elimination|mission_complete|hybrid|sandbox');
      }
      request.victory_mode = victory as NewGameRequest['victory_mode'];
    }

    const game = await createFn(request);
    const lines = [chalk.green('新对局已创建：'), formatGameSummary(game)];
    const authNote = adoptNewGameAuth(game, request);
    if (authNote) {
      lines.push(authNote);
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function gameStatusCommand(
  args: string[],
  fetchFn: typeof fetchCurrentGame = fetchCurrentGame,
): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return 'game_status\n  查询当前对局概要：status/seed/tick/难度/胜利模式/玩家列表（不含 key）；finished 时附带胜者、原因、时长 tick 与玩家战损';
  }

  try {
    const game = await fetchFn();
    return formatGameSummary(game);
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}
