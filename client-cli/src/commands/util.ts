import chalk from 'chalk';
import { fmtError, fmtEvent } from '@gw/shared/commands/format';
import { DEFAULT_PLAYERS } from '@gw/shared/config';

import { AGENT_GATEWAY_URL } from '../config.js';
import type { ReplContext } from '../repl.js';
import { stopSSE, startSSE, getEventBuffer } from '../sse.js';

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
  startSSE(playerKey);

  return chalk.green(`Switched to ${playerId}`);
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
    `Server: ${ctx.api.getServerUrl()}`,
    `Agent Gateway: ${AGENT_GATEWAY_URL}`,
  ].join('\n');
}
