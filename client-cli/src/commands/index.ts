import { GAME_COMMANDS, dispatchCommand, type CommandEntry } from '@gw/shared/commands/game-commands';

import type { ReplContext } from '../repl.js';
import {
  cmdAgentCreate,
  cmdAgentList,
  cmdAgentMessage,
  cmdAgentThread,
  cmdAgentUpdate,
} from './agent.js';
import { cmdGameNew, cmdGameStatus } from './game.js';
import { cmdEvents, cmdStatus, cmdSwitch } from './util.js';

/** CLI 命令表 = 共享游戏命令 + 终端会话 / 网关管理 / 开局命令。 */
export const COMMANDS: Record<string, CommandEntry<ReplContext>> = {
  ...GAME_COMMANDS,
  agent_list: { handler: cmdAgentList },
  agent_create: { handler: cmdAgentCreate },
  agent_update: { handler: cmdAgentUpdate },
  agent_message: { handler: cmdAgentMessage },
  agent_thread: { handler: cmdAgentThread },
  switch: { handler: cmdSwitch },
  events: { handler: cmdEvents },
  status: { handler: cmdStatus },
  game_new: { handler: cmdGameNew },
  game_status: { handler: cmdGameStatus },
  clear: { handler: () => { process.stdout.write('\x1Bc'); return ''; } },
  quit: { handler: () => { process.exit(0); return ''; } },
  exit: { handler: () => { process.exit(0); return ''; } },
};

export function getCommandNames(): string[] {
  return Object.keys(COMMANDS);
}

export function dispatch(line: string, ctx: ReplContext): Promise<string> {
  return dispatchCommand(line, ctx, COMMANDS);
}
