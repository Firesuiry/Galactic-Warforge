import { cmdHealth, cmdMetrics, cmdSummary, cmdGalaxy, cmdSystem, cmdPlanet, cmdFogmap } from './query.js';
import { cmdScanGalaxy, cmdScanSystem, cmdScanPlanet, cmdRaw } from './action.js';
import { cmdSwitch, cmdFog, cmdEvents, cmdStatus, cmdHelp } from './util.js';
import type { ReplContext } from '../types.js';

export type CommandHandler = (args: string[], ctx: ReplContext) => Promise<string> | string;

export interface CommandEntry {
  handler: CommandHandler;
  completions?: string[];
}

export const COMMANDS: Record<string, CommandEntry> = {
  health:   { handler: cmdHealth },
  metrics:  { handler: cmdMetrics },
  summary:  { handler: cmdSummary },
  galaxy:   { handler: cmdGalaxy },
  system:   { handler: cmdSystem },
  planet:   { handler: cmdPlanet },
  fogmap:   { handler: cmdFogmap },
  fog:      { handler: cmdFog },
  scan_galaxy: { handler: cmdScanGalaxy },
  scan_system: { handler: cmdScanSystem },
  scan_planet: { handler: cmdScanPlanet },
  raw:      { handler: cmdRaw },
  switch:   { handler: cmdSwitch },
  events:   { handler: cmdEvents },
  status:   { handler: cmdStatus },
  help:     { handler: cmdHelp, completions: [] },
  clear:    { handler: () => { process.stdout.write('\x1Bc'); return ''; } },
  quit:     { handler: () => { process.exit(0); return ''; } },
  exit:     { handler: () => { process.exit(0); return ''; } },
};

export function getCommandNames(): string[] {
  return Object.keys(COMMANDS);
}

export async function dispatch(line: string, ctx: ReplContext): Promise<string> {
  const parts = line.trim().split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);

  const entry = COMMANDS[name];
  if (!entry) {
    return `Unknown command: "${name}". Type "help" for commands.`;
  }

  return entry.handler(args, ctx);
}
