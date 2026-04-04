import readline from 'readline';
import chalk from 'chalk';
import { dispatch, getCommandNames, COMMANDS } from './commands/index.js';
import { DEFAULT_PLAYERS } from './config.js';
import type { ReplContext } from './types.js';

export type { ReplContext };

export function createSerialLineProcessor<T>(handler: (value: T) => Promise<void> | void) {
  let pending = Promise.resolve();
  return (value: T) => {
    const run = pending.then(() => handler(value));
    pending = run.catch(() => undefined);
    return run;
  };
}

function makePrompt(playerId: string): string {
  return chalk.bold.blue(`[${playerId}]`) + chalk.bold(' > ');
}

function completer(line: string): [string[], string] {
  const parts = line.split(/\s+/);
  const commandNames = getCommandNames();

  if (parts.length <= 1) {
    const hits = commandNames.filter(c => c.startsWith(line));
    return [hits.length ? hits : commandNames, line];
  }

  const cmdName = parts[0].toLowerCase();
  const entry = COMMANDS[cmdName];

  if (entry?.completions && parts.length === 2) {
    const partial = parts[1];
    const hits = entry.completions.filter(c => c.startsWith(partial));
    return [hits.length ? hits : entry.completions, partial];
  }

  if (cmdName === 'switch' && parts.length === 2) {
    const partial = parts[1];
    const ids = DEFAULT_PLAYERS.map(p => p.id);
    const hits = ids.filter(id => id.startsWith(partial));
    return [hits.length ? hits : ids, partial];
  }

  if (cmdName === 'help' && parts.length === 2) {
    const partial = parts[1];
    const hits = commandNames.filter(c => c.startsWith(partial));
    return [hits.length ? hits : commandNames, partial];
  }

  return [[], line];
}

export function startRepl(playerId: string): ReplContext {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: makePrompt(playerId),
    completer,
    terminal: true,
  });

  const ctx: ReplContext = { currentPlayer: playerId, rl };
  const processLine = createSerialLineProcessor(async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.setPrompt(makePrompt(ctx.currentPlayer));
      rl.prompt();
      return;
    }

    try {
      const result = await dispatch(trimmed, ctx);
      if (result) {
        console.log(result);
      }
    } catch (e) {
      console.log(chalk.red('Unexpected error: ') + String(e));
    }

    rl.setPrompt(makePrompt(ctx.currentPlayer));
    rl.prompt();
  });

  rl.prompt();

  rl.on('line', (line: string) => {
    void processLine(line);
  });

  rl.on('close', () => {
    console.log(chalk.dim('\nGoodbye!'));
    process.exit(0);
  });

  return ctx;
}
