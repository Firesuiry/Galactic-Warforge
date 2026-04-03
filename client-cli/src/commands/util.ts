import chalk from 'chalk';
import { setAuth, getAuth } from '../api.js';
import { stopSSE, startSSE, getEventBuffer } from '../sse.js';
import { fetchPlanetScene } from '../api.js';
import { fmtEvent, fmtError, fmtFogScene } from '../format.js';
import { DEFAULT_PLAYERS, DEFAULT_PLANET_ID, SERVER_URL } from '../config.js';
import type { ReplContext } from '../types.js';
import { parseArgs, parseIntegerArg } from './args.js';

const HELP_ENTRIES: Record<string, { usage?: string; desc: string }> = {
  health: { desc: 'Server status and current tick' },
  metrics: { desc: 'Runtime metrics' },
  summary: { desc: 'Game summary (resources, players, map)' },
  stats: { desc: 'Current player statistics' },
  galaxy: { desc: 'Galaxy list' },
  system: { usage: '[system_id]', desc: 'System details (default: sys-1)' },
  planet: { usage: '[planet_id]', desc: 'Planet summary (default: planet-1-1)' },
  scene: { usage: '[planet_id] <x> <y> <width> <height>', desc: 'Planet scene raw JSON' },
  inspect: { usage: '<planet_id> <building|unit|resource|sector> <entity_id>', desc: 'Planet inspect raw JSON' },
  fog: { usage: '[planet_id] [x y width height]', desc: 'ASCII fog slice via /scene (default: 0 0 32 16)' },
  scan_galaxy: { usage: '[galaxy_id]', desc: 'Discover all systems in a galaxy' },
  scan_system: { usage: '<system_id>', desc: 'Discover a system' },
  scan_planet: { usage: '<planet_id>', desc: 'Discover a planet' },
  build: { usage: '<x> <y> <type> [--z <z>] [--direction <dir>] [--recipe <id>]', desc: 'Build any server-side buildable structure' },
  move: { usage: '<entity_id> <x> <y> [--z <z>]', desc: 'Move entity to position' },
  attack: { usage: '<entity_id> <target_id>', desc: 'Attack target entity' },
  produce: { usage: '<entity_id> <unit_type>', desc: 'Produce unit (worker/soldier)' },
  upgrade: { usage: '<entity_id>', desc: 'Upgrade building' },
  demolish: { usage: '<entity_id>', desc: 'Demolish building' },
  configure_logistics_station: { usage: '<building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true|false>] [--warp-enabled <true|false>] [--ship-slots <n>]', desc: 'Configure logistics station capacity, priority and interstellar switches' },
  configure_logistics_slot: { usage: '<building_id> <planetary|interstellar> <item_id> <none|supply|demand|both> <local_storage>', desc: 'Configure logistics supply or demand for one item slot' },
  cancel_construction: { usage: '<task_id>', desc: 'Cancel queued or running construction task' },
  restore_construction: { usage: '<task_id>', desc: 'Restore a cancelled construction task' },
  start_research: { usage: '<tech_id>', desc: 'Start researching a technology' },
  cancel_research: { usage: '<tech_id>', desc: 'Cancel a technology in progress or queue' },
  launch_solar_sail: { usage: '<building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>]', desc: 'Launch loaded solar sails from an EM Rail Ejector' },
  build_dyson_node: { usage: '<system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]', desc: 'Build a Dyson sphere node' },
  build_dyson_frame: { usage: '<system_id> <layer_index> <node_a_id> <node_b_id>', desc: 'Build a Dyson sphere frame' },
  build_dyson_shell: { usage: '<system_id> <layer_index> <latitude_min> <latitude_max> <coverage>', desc: 'Build a Dyson sphere shell' },
  demolish_dyson: { usage: '<system_id> <node|frame|shell> <component_id>', desc: 'Demolish a Dyson sphere component' },
  raw: { usage: '<json>', desc: 'Send raw /commands request JSON' },
  switch: { usage: '[player_id] [key]', desc: 'Switch player' },
  events: { usage: '[count]', desc: 'Show recent SSE events (default: 10)' },
  status: { desc: 'Current player and connection status' },
  audit: { usage: '[options]', desc: 'Query audit log' },
  event_snapshot: { usage: '[options]', desc: 'Query event snapshot' },
  alert_snapshot: { usage: '[options]', desc: 'Query production alert snapshot' },
  save: { usage: '[--reason <text>]', desc: 'Trigger manual save' },
  replay: { usage: '[options]', desc: 'Replay tick range' },
  rollback: { usage: '[options]', desc: 'Rollback to tick' },
  help: { usage: '[command]', desc: 'Show help' },
  clear: { desc: 'Clear screen' },
  quit: { desc: 'Exit' },
};

const HELP_TEXT = [
  chalk.bold('Commands:'),
  '',
  chalk.bold('  Query:'),
  '    health          Server status and current tick',
  '    metrics         Runtime metrics',
  '    summary         Game summary',
  '    stats           Current player statistics',
  '    galaxy          Galaxy list',
  '    system [id]     System details',
  '    planet [id]     Planet summary',
  '    scene [id] <x> <y> <w> <h>',
  '    inspect <planet_id> <kind> <entity_id>',
  '    fog [id] [x y w h]  ASCII fog slice',
  '',
  chalk.bold('  Discovery:'),
  '    scan_galaxy [id]   Discover all systems in a galaxy',
  '    scan_system <id>   Discover a system',
  '    scan_planet <id>   Discover a planet',
  '',
  chalk.bold('  Game Actions:'),
  '    build <x> <y> <type> [--z <z>] [--direction <dir>] [--recipe <id>]',
  '    move <entity_id> <x> <y> [--z <z>]',
  '    attack <entity_id> <target>',
  '    produce <entity_id> <type>',
  '    upgrade <entity_id>',
  '    demolish <entity_id>',
  '    configure_logistics_station <building_id> [--drone-capacity <n>] [--input-priority <n>] [--output-priority <n>] [--interstellar-enabled <true|false>] [--warp-enabled <true|false>] [--ship-slots <n>]',
  '    configure_logistics_slot <building_id> <planetary|interstellar> <item_id> <none|supply|demand|both> <local_storage>',
  '    cancel_construction <task_id>',
  '    restore_construction <task_id>',
  '    start_research <tech_id>',
  '    cancel_research <tech_id>',
  '    launch_solar_sail <building_id> [--count <n>] [--orbit-radius <n>] [--inclination <n>]',
  '    build_dyson_node <system_id> <layer_index> <latitude> <longitude> [--orbit-radius <n>]',
  '    build_dyson_frame <system_id> <layer_index> <node_a_id> <node_b_id>',
  '    build_dyson_shell <system_id> <layer_index> <latitude_min> <latitude_max> <coverage>',
  '    demolish_dyson <system_id> <node|frame|shell> <component_id>',
  '',
  chalk.bold('  Admin/Debug:'),
  '    audit [options]             Query audit log',
  '    event_snapshot [options]    Query event snapshot',
  '    alert_snapshot [options]    Query production alert snapshot',
  '    save [--reason <text>]     Trigger manual save',
  '    replay [options]            Replay tick range',
  '    rollback [options]          Rollback to tick',
  '    raw <json>                  Send raw /commands request JSON',
  '',
  chalk.bold('  Util:'),
  '    switch [player_id] [key]  Switch player',
  '    events [count]            Show recent SSE events',
  '    status                    Current player & server',
  '    help [command]            Show help',
  '    clear                     Clear screen',
  '    quit / exit               Exit',
].join('\n');

function getCommandHelp(cmd: string): string {
  const entry = HELP_ENTRIES[cmd];
  if (!entry) {
    return fmtError(`Unknown command: ${cmd}`);
  }
  return `${chalk.bold(cmd)} ${chalk.dim(entry.usage ?? '')}\n  ${entry.desc}`;
}

export function cmdHelp(args: string[]): string {
  if (args[0]) {
    return getCommandHelp(args[0]);
  }
  return HELP_TEXT;
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
  setAuth(playerId, playerKey);
  ctx.currentPlayer = playerId;
  startSSE(playerKey);

  return chalk.green(`Switched to ${playerId}`);
}

export async function cmdFog(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  const planetId = parsed.positionals[0] ?? DEFAULT_PLANET_ID;
  const x = parseIntegerArg(parsed.positionals[1]) ?? 0;
  const y = parseIntegerArg(parsed.positionals[2]) ?? 0;
  const width = parseIntegerArg(parsed.positionals[3]) ?? 32;
  const height = parseIntegerArg(parsed.positionals[4]) ?? 16;

  if (width <= 0 || height <= 0) {
    return fmtError('width 和 height 必须是正整数');
  }

  try {
    const scene = await fetchPlanetScene(planetId, {
      x,
      y,
      width,
      height,
    });
    return fmtFogScene(scene);
  } catch (e) {
    return fmtError(String(e));
  }
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

export function cmdStatus(_args: string[]): string {
  const { playerId } = getAuth();
  return [
    `Current player: ${chalk.bold(playerId || '(none)')}`,
    `Server: ${SERVER_URL}`,
  ].join('\n');
}
