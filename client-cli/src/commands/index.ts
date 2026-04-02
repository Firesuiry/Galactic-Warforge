import { cmdHealth, cmdMetrics, cmdSummary, cmdStats, cmdGalaxy, cmdInspect, cmdPlanet, cmdScene, cmdSystem } from './query.js';
import {
  cmdScanGalaxy,
  cmdScanSystem,
  cmdScanPlanet,
  cmdRaw,
  cmdBuild,
  cmdMove,
  cmdAttack,
  cmdProduce,
  cmdUpgrade,
  cmdDemolish,
  cmdCancelConstruction,
  cmdRestoreConstruction,
  cmdStartResearch,
  cmdCancelResearch,
  cmdLaunchSolarSail,
  cmdBuildDysonNode,
  cmdBuildDysonFrame,
  cmdBuildDysonShell,
  cmdDemolishDyson,
} from './action.js';
import { cmdSwitch, cmdFog, cmdEvents, cmdStatus, cmdHelp } from './util.js';
import { cmdAudit, cmdEventSnapshot, cmdAlertSnapshot, cmdSave, cmdReplay, cmdRollback } from './debug.js';
import type { ReplContext } from '../types.js';

export type CommandHandler = (args: string[], ctx: ReplContext) => Promise<string> | string;

export interface CommandEntry {
  handler: CommandHandler;
  completions?: string[];
}

export const COMMANDS: Record<string, CommandEntry> = {
  health: { handler: cmdHealth },
  metrics: { handler: cmdMetrics },
  summary: { handler: cmdSummary },
  stats: { handler: cmdStats },
  galaxy: { handler: cmdGalaxy },
  system: { handler: cmdSystem },
  planet: { handler: cmdPlanet },
  scene: { handler: cmdScene },
  inspect: { handler: cmdInspect },
  fog: { handler: cmdFog },
  scan_galaxy: { handler: cmdScanGalaxy },
  scan_system: { handler: cmdScanSystem },
  scan_planet: { handler: cmdScanPlanet },
  build: { handler: cmdBuild },
  move: { handler: cmdMove },
  attack: { handler: cmdAttack },
  produce: { handler: cmdProduce },
  upgrade: { handler: cmdUpgrade },
  demolish: { handler: cmdDemolish },
  cancel_construction: { handler: cmdCancelConstruction },
  restore_construction: { handler: cmdRestoreConstruction },
  start_research: { handler: cmdStartResearch },
  cancel_research: { handler: cmdCancelResearch },
  launch_solar_sail: { handler: cmdLaunchSolarSail },
  build_dyson_node: { handler: cmdBuildDysonNode },
  build_dyson_frame: { handler: cmdBuildDysonFrame },
  build_dyson_shell: { handler: cmdBuildDysonShell },
  demolish_dyson: { handler: cmdDemolishDyson },
  raw: { handler: cmdRaw },
  switch: { handler: cmdSwitch },
  events: { handler: cmdEvents },
  status: { handler: cmdStatus },
  audit: { handler: cmdAudit },
  event_snapshot: { handler: cmdEventSnapshot },
  alert_snapshot: { handler: cmdAlertSnapshot },
  save: { handler: cmdSave },
  replay: { handler: cmdReplay },
  rollback: { handler: cmdRollback },
  help: { handler: cmdHelp, completions: [] },
  clear: { handler: () => { process.stdout.write('\x1Bc'); return ''; } },
  quit: { handler: () => { process.exit(0); return ''; } },
  exit: { handler: () => { process.exit(0); return ''; } },
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
