import chalk from 'chalk';
import { setAuth, getAuth } from '../api.js';
import { stopSSE, startSSE, getEventBuffer } from '../sse.js';
import { fetchFogMap } from '../api.js';
import { fmtFog, fmtEvent, fmtError } from '../format.js';
import { DEFAULT_PLAYERS, DEFAULT_PLANET_ID } from '../config.js';
import type { ReplContext } from '../types.js';

export async function cmdSwitch(args: string[], ctx: ReplContext): Promise<string> {
  let playerId = args[0];
  let playerKey = '';

  if (!playerId) {
    // show available players
    const list = DEFAULT_PLAYERS.map((p, i) => `  [${i + 1}] ${p.id}`).join('\n');
    return `Available players:\n${list}\nUsage: switch <player_id>`;
  }

  // Check default players
  const found = DEFAULT_PLAYERS.find(p => p.id === playerId);
  if (found) {
    playerKey = found.key;
  } else if (args.length >= 2) {
    playerKey = args[1];
  } else {
    return fmtError('Unknown player. Usage: switch <player_id> [key]');
  }

  // Stop existing SSE
  stopSSE();

  // Set new auth
  setAuth(playerId, playerKey);
  ctx.currentPlayer = playerId;

  // Restart SSE
  startSSE(playerKey);

  return chalk.green(`Switched to ${playerId}`);
}

export async function cmdFog(args: string[]): Promise<string> {
  const planetId = args[0] ?? DEFAULT_PLANET_ID;
  try {
    const fogMap = await fetchFogMap(planetId);
    return fmtFog(fogMap);
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
  const lines = [
    `Current player: ${chalk.bold(playerId || '(none)')}`,
    `Server: ${process.env.SW_SERVER ?? 'http://localhost:18080'}`,
  ];
  return lines.join('\n');
}

export function cmdHelp(args: string[]): string {
  if (args[0]) {
    return getCommandHelp(args[0]);
  }
  return HELP_TEXT;
}

function getCommandHelp(cmd: string): string {
  const entry = HELP_ENTRIES[cmd];
  if (!entry) return fmtError(`Unknown command: ${cmd}`);
  return `${chalk.bold(cmd)} ${chalk.dim(entry.usage ?? '')}\n  ${entry.desc}`;
}

const HELP_ENTRIES: Record<string, { usage?: string; desc: string }> = {
  health:  { desc: 'Server status and current tick' },
  metrics: { desc: 'Runtime metrics' },
  summary: { desc: 'Game summary (resources, players, map)' },
  galaxy:  { desc: 'Galaxy list' },
  system:  { usage: '[system_id]', desc: 'System details (default: sys-1)' },
  planet:  { usage: '[planet_id]', desc: 'Planet details: buildings + units (default: planet-1)' },
  fogmap:  { usage: '[planet_id]', desc: 'Fog map raw JSON' },
  fog:     { usage: '[planet_id]', desc: 'ASCII fog grid render' },
  build:   { usage: '<x> <y> <type>', desc: 'Build mine/solar_plant/factory/turret' },
  move:    { usage: '<entity_id> <x> <y>', desc: 'Move unit' },
  attack:  { usage: '<attacker_id> <target_id>', desc: 'Attack target' },
  produce: { usage: '<factory_id> <unit_type>', desc: 'Produce worker/soldier' },
  upgrade: { usage: '<entity_id>', desc: 'Upgrade building' },
  demolish:{ usage: '<entity_id>', desc: 'Demolish building' },
  raw:     { usage: '<json>', desc: 'Send raw command JSON' },
  switch:  { usage: '[player_id] [key]', desc: 'Switch player' },
  events:  { usage: '[count]', desc: 'Show recent SSE events (default: 10)' },
  status:  { desc: 'Current player and connection status' },
  help:    { usage: '[command]', desc: 'Show help' },
  clear:   { desc: 'Clear screen' },
  quit:    { desc: 'Exit' },
};

const HELP_TEXT = [
  chalk.bold('Commands:'),
  '',
  chalk.bold('  Query:'),
  '    health          Server status and current tick',
  '    metrics         Runtime metrics',
  '    summary         Game summary',
  '    galaxy          Galaxy list',
  '    system [id]     System details',
  '    planet [id]     Planet details (buildings + units)',
  '    fogmap [id]     Fog map raw JSON',
  '    fog    [id]     ASCII fog grid',
  '',
  chalk.bold('  Actions:'),
  '    build <x> <y> <type>              Build structure',
  '    move <entity_id> <x> <y>          Move unit',
  '    attack <attacker_id> <target_id>  Attack',
  '    produce <factory_id> <unit_type>  Produce unit',
  '    upgrade <entity_id>               Upgrade building',
  '    demolish <entity_id>              Demolish building',
  '    raw <json>                        Send raw command JSON',
  '',
  chalk.bold('  Util:'),
  '    switch [player_id] [key]  Switch player',
  '    events [count]            Show recent SSE events',
  '    status                    Current player & server',
  '    help [command]            Show help',
  '    clear                     Clear screen',
  '    quit / exit               Exit',
].join('\n');
