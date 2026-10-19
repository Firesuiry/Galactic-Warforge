import chalk from 'chalk';
import { fmtError, fmtEvent } from '@gw/shared/commands/format';
import { DEFAULT_PLAYERS } from '@gw/shared/config';

import { AGENT_GATEWAY_URL } from '../config.js';
import type { ReplContext } from '../repl.js';
import { stopSSE, startSSE, getEventBuffer } from '../sse.js';

function fmtIssuer(ctx: ReplContext): string {
  const auth = ctx.api.getAuth();
  return auth.issuerType === 'agent'
    ? `agent:${chalk.bold(auth.issuerId)}（以代理身份发令）`
    : `player:${chalk.bold(auth.playerId)}（本人发令）`;
}

/** `as <名>`：以代理身份发令（issuer_type=agent）；`as` 不带参数 = 恢复为玩家本人。 */
export function cmdAs(args: string[], ctx: ReplContext): string {
  const name = args[0]?.trim();
  if (args.length > 1) {
    return fmtError('Usage: as <name> | as');
  }
  if (name && !/^[A-Za-z0-9_.:-]{1,64}$/.test(name)) {
    return fmtError('代理名只允许字母、数字、_ . : -，最长 64 字符');
  }
  if (name && name === ctx.api.getAuth().playerId) {
    return fmtError('代理名不能等于玩家 ID');
  }
  ctx.api.setIssuer(name || undefined);
  ctx.issuerId = ctx.api.getAuth().issuerId;
  return name
    ? chalk.green(`Now issuing as agent ${chalk.bold(name)}`)
    : chalk.green(`Now issuing as player ${chalk.bold(ctx.api.getAuth().playerId)}`);
}

export async function cmdSwitch(args: string[], ctx: ReplContext): Promise<string> {
  const playerId = args[0];
  let playerKey = '';

  if (!playerId) {
    const list = DEFAULT_PLAYERS.map((p, i) => `  [${i + 1}] ${p.id}`).join('\n');
    return `Available players:\n${list}\nUsage: switch <player_id> [key]`;
  }

  const found = DEFAULT_PLAYERS.find(p => p.id === playerId);
  if (found) {
    playerKey = found.key;
  } else if (args.length >= 2) {
    playerKey = args[1];
  } else {
    return fmtError('Unknown player. Usage: switch <player_id> [key]');
  }

  stopSSE();
  ctx.api.setAuth(playerId, playerKey);
  ctx.currentPlayer = playerId;
  ctx.issuerId = ctx.api.getAuth().issuerId;
  startSSE(playerKey);

  return chalk.green(`Switched to ${playerId}`) + `（发令者：${fmtIssuer(ctx)}）`;
}

export function cmdEvents(args: string[]): string {
  const count = parseInt(args[0] ?? '10', 10);
  const buffer = getEventBuffer();
  const recent = buffer.slice(-count);
  if (recent.length === 0) {
    return chalk.dim('No events received yet.');
  }
  return recent.map(fmtEvent).join('\n');
}

export function cmdStatus(_args: string[], ctx: ReplContext): string {
  const { playerId } = ctx.api.getAuth();
  return [
    `Current player: ${chalk.bold(playerId || '(none)')}`,
    `Issuer: ${fmtIssuer(ctx)}`,
    `Server: ${ctx.api.getServerUrl()}`,
    `Agent Gateway: ${AGENT_GATEWAY_URL}`,
  ].join('\n');
}

export { fmtIssuer };
