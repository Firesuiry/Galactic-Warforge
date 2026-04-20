import chalk from 'chalk';
import type {
  Building,
  CommandResponse,
  FleetDetailView,
  FleetRuntimeView,
  GalaxyView,
  HealthResponse,
  MetricsSnapshot,
  PlanetSceneView,
  PlanetSummaryView,
  PlayerStatsSnapshot,
  SseEvent,
  StateSummary,
  SystemRuntimeView,
  SystemView,
} from './types.js';

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function row(cols: string[], widths: number[]): string {
  return cols.map((c, i) => pad(c, widths[i])).join('  ');
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const header = chalk.bold(row(headers, widths));
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  const body = rows.map(r => row(r, widths)).join('\n');
  return [header, sep, body].join('\n');
}

function fmtTopEntries(entries: Record<string, number> | undefined, limit = 4): string {
  const pairs = Object.entries(entries ?? {});
  if (pairs.length === 0) {
    return '-';
  }
  const preview = pairs.slice(0, limit).map(([key, value]) => `${key}:${value}`).join(', ');
  return pairs.length > limit ? `${preview} ...` : preview;
}

function fmtStateLabel(state?: string, reason?: string): string {
  if (!state) {
    return 'unknown';
  }
  if (!reason) {
    return state;
  }
  return `${state}:${reason}`;
}

function inventoryTotal(inv?: Record<string, number>): number {
  return Object.values(inv ?? {}).reduce((sum, qty) => sum + qty, 0);
}

function fmtInventoryPreview(inv?: Record<string, number>, limit = 2): string {
  const entries = Object.entries(inv ?? {}).filter(([, qty]) => qty > 0);
  if (entries.length === 0) {
    return '';
  }
  const preview = entries.slice(0, limit).map(([item, qty]) => `${item}:${qty}`).join(',');
  return entries.length > limit ? `${preview},...` : preview;
}

function fmtFleetUnits(units?: Array<{ blueprint_id: string; count: number }>): string {
  const entries = (units ?? []).filter((stack) => stack.count > 0);
  if (entries.length === 0) {
    return '-';
  }
  return entries.map((stack) => `${stack.blueprint_id}:${stack.count}`).join(', ');
}

function fmtFleetTarget(target?: { planet_id: string; target_id?: string }): string {
  if (!target) {
    return '-';
  }
  return target.target_id ? `${target.planet_id}/${target.target_id}` : target.planet_id;
}

function fmtBuildingOps(building: Building): string {
  const ops: string[] = [];
  const runtime = building.runtime;
  const functions = runtime?.functions;
  if (functions?.collect) {
    const kind = functions.collect.resource_kind ?? '?';
    ops.push(`collect=${kind}@${functions.collect.yield_per_tick}`);
  }
  if (building.production?.recipe_id) {
    ops.push(`recipe=${building.production.recipe_id}`);
  } else if (functions?.production) {
    ops.push('production');
  }
  if (functions?.research) {
    ops.push(`research=${functions.research.research_per_tick}/t`);
  }
  if (building.storage) {
    const total =
      inventoryTotal(building.storage.inventory) +
      inventoryTotal(building.storage.input_buffer) +
      inventoryTotal(building.storage.output_buffer);
    if (total > 0) {
      const parts = [
        fmtInventoryPreview(building.storage.output_buffer),
        fmtInventoryPreview(building.storage.inventory),
        fmtInventoryPreview(building.storage.input_buffer),
      ].filter(Boolean);
      ops.push(`storage=${parts.join('|')}`);
    }
  }
  return ops.length > 0 ? ops.join('  ') : '-';
}

export function fmtHealth(h: HealthResponse): string {
  const statusColor = h.status === 'ok' ? chalk.green(h.status) : chalk.red(h.status);
  return `Status: ${statusColor}  Tick: ${chalk.cyan(h.tick)}`;
}

export function fmtMetrics(m: MetricsSnapshot): string {
  return Object.entries(m).map(([k, v]) => `  ${chalk.yellow(k)}: ${v}`).join('\n');
}

export function fmtSummary(s: StateSummary): string {
  const lines: string[] = [
    `Tick: ${chalk.cyan(s.tick)}  Active Planet: ${s.active_planet_id}  Map: ${s.map_width}x${s.map_height}`,
  ];
  if (s.winner) {
    lines.push(chalk.green(`Winner: ${s.winner}`));
  }
  lines.push('');

  const headers = ['Player', 'Team', 'Role', 'Alive', 'Minerals', 'Energy'];
  const rows = Object.values(s.players).map(p => [
    p.player_id,
    p.team_id ?? '-',
    p.role ?? '-',
    p.is_alive ? chalk.green('yes') : chalk.red('no'),
    p.resources ? String(p.resources.minerals) : chalk.dim('-'),
    p.resources ? String(p.resources.energy) : chalk.dim('-'),
  ]);
  lines.push(table(headers, rows));
  return lines.join('\n');
}

export function fmtStats(s: PlayerStatsSnapshot): string {
  return [
    `Player: ${chalk.bold(s.player_id)}  Tick: ${chalk.cyan(s.tick)}`,
    '',
    chalk.bold('Production'),
    `  total_output=${s.production_stats.total_output}  efficiency=${s.production_stats.efficiency}`,
    `  by_building=${fmtTopEntries(s.production_stats.by_building_type)}`,
    `  by_item=${fmtTopEntries(s.production_stats.by_item)}`,
    '',
    chalk.bold('Energy'),
    `  generation=${s.energy_stats.generation}  consumption=${s.energy_stats.consumption}  storage=${s.energy_stats.current_stored}/${s.energy_stats.storage}`,
    `  shortage_ticks=${s.energy_stats.shortage_ticks}`,
    '',
    chalk.bold('Logistics'),
    `  throughput=${s.logistics_stats.throughput}  deliveries=${s.logistics_stats.deliveries}`,
    `  avg_distance=${s.logistics_stats.avg_distance}  avg_travel_time=${s.logistics_stats.avg_travel_time}`,
    '',
    chalk.bold('Combat'),
    `  enemies_killed=${s.combat_stats.enemies_killed}  units_lost=${s.combat_stats.units_lost}`,
    `  threat=${s.combat_stats.threat_level}  highest=${s.combat_stats.highest_threat}`,
  ].join('\n');
}

export function fmtGalaxy(g: GalaxyView): string {
  const name = g.name ?? '(unknown)';
  const size = g.width !== undefined && g.height !== undefined ? `  Size: ${g.width}x${g.height}` : '';
  const lines = [`Galaxy: ${chalk.bold(name)} (${g.galaxy_id})${size}`, ''];
  const headers = ['SystemID', 'Name', 'Discovered'];
  const rows = (g.systems ?? []).map(s => [
    s.system_id,
    s.name ?? '(unknown)',
    s.discovered ? chalk.green('yes') : chalk.dim('no'),
  ]);
  lines.push(table(headers, rows));
  return lines.join('\n');
}

export function fmtSystem(s: SystemView): string {
  const lines = [
    `System: ${chalk.bold(s.name ?? '(unknown)')} (${s.system_id})`,
    '',
  ];
  const headers = ['PlanetID', 'Name', 'Kind', 'Discovered'];
  const rows = (s.planets ?? []).map(p => [
    p.planet_id,
    p.name ?? '(unknown)',
    p.kind ?? '-',
    p.discovered ? chalk.green('yes') : chalk.dim('no'),
  ]);
  lines.push(table(headers, rows));
  return lines.join('\n');
}

export function fmtSystemRuntime(runtime: SystemRuntimeView): string {
  const lines = [
    `System Runtime: ${chalk.bold(runtime.system_id)}`,
    `Discovered: ${runtime.discovered ? chalk.green('yes') : chalk.dim('no')}  Available: ${runtime.available ? chalk.green('yes') : chalk.dim('no')}`,
  ];
  const orbit = runtime.solar_sail_orbit;
  if (orbit) {
    lines.push(`Solar sails: count=${orbit.sails.length}  total_energy=${orbit.total_energy}`);
  } else {
    lines.push('Solar sails: -');
  }

  const fleets = runtime.fleets ?? [];
  lines.push('');
  if (fleets.length === 0) {
    lines.push(chalk.dim('No fleets in this system runtime.'));
    return lines.join('\n');
  }

  const rows = fleets.map((fleet) => [
    fleet.fleet_id,
    fleet.state,
    fleet.formation,
    fmtFleetUnits(fleet.units),
    fmtFleetTarget(fleet.target),
  ]);
  lines.push(table(['FleetID', 'State', 'Formation', 'Units', 'Target'], rows));
  return lines.join('\n');
}

export function fmtPlanetSummary(p: PlanetSummaryView): string {
  if (!p.discovered) {
    return `Planet: ${chalk.bold(p.planet_id)}  ${chalk.dim('undiscovered')}`;
  }

  return [
    `Planet: ${chalk.bold(p.name ?? p.planet_id)} (${p.planet_id})  Tick: ${chalk.cyan(p.tick)}  Map: ${p.map_width}x${p.map_height}`,
    `Kind: ${p.kind ?? '-'}`,
    `Counts: buildings=${p.building_count} units=${p.unit_count} resources=${p.resource_count}`,
  ].join('\n');
}

export function fmtCommandResponse(r: CommandResponse): string {
  const accepted = r.accepted ? chalk.green('ACCEPTED') : chalk.red('REJECTED');
  const lines = [`${accepted}  request_id=${r.request_id}  tick=${r.enqueue_tick}`];
  for (const res of r.results ?? []) {
    const okStatuses = new Set(['executed', 'accepted']);
    const statusColor = okStatuses.has(res.status) ? chalk.green : chalk.red;
    lines.push(`  [${res.command_index}] ${statusColor(res.status)} ${res.code}: ${res.message}`);
  }
  return lines.join('\n');
}

export function fmtFleetList(fleets: FleetDetailView[]): string {
  if (fleets.length === 0) {
    return chalk.dim('No fleets found.');
  }
  const rows = fleets.map((fleet) => [
    fleet.fleet_id,
    fleet.system_id,
    fleet.state,
    fleet.formation,
    fmtFleetUnits(fleet.units),
    fmtFleetTarget(fleet.target),
  ]);
  return table(['FleetID', 'System', 'State', 'Formation', 'Units', 'Target'], rows);
}

export function fmtFleetDetail(fleet: FleetDetailView | FleetRuntimeView): string {
  const lines = [
    `Fleet: ${chalk.bold(fleet.fleet_id)}  System: ${fleet.system_id}`,
    `State: ${fleet.state}  Formation: ${fleet.formation}  Units: ${fmtFleetUnits(fleet.units)}`,
    `Target: ${fmtFleetTarget(fleet.target)}`,
  ];
  if ('source_building_id' in fleet && fleet.source_building_id) {
    lines.push(`Source hub: ${fleet.source_building_id}`);
  }
  if ('weapon' in fleet && fleet.weapon) {
    lines.push(`Weapon: ${fleet.weapon.type} dmg=${fleet.weapon.damage} rate=${fleet.weapon.fire_rate} range=${fleet.weapon.range}`);
  }
  if ('shield' in fleet && fleet.shield) {
    lines.push(`Shield: ${fleet.shield.level}/${fleet.shield.max_level} recharge=${fleet.shield.recharge_rate} delay=${fleet.shield.recharge_delay}`);
  }
  if ('last_attack_tick' in fleet && fleet.last_attack_tick !== undefined) {
    lines.push(`Last attack tick: ${fleet.last_attack_tick}`);
  }
  return lines.join('\n');
}

export function fmtFogScene(scene: PlanetSceneView): string {
  if (!scene.discovered) {
    return `Fog: ${scene.planet_id}  ${chalk.dim('undiscovered')}`;
  }
  const bounds = scene.bounds;
  if (!scene.visible || !scene.explored) {
    return `Fog: ${scene.planet_id}  ${chalk.dim('scene payload missing fog layer')}`;
  }
  const width = bounds.width;
  const height = bounds.height;

  const lines = [
    `Fog: ${scene.planet_id}  x=${bounds.x}..${bounds.x + width - 1}  y=${bounds.y}..${bounds.y + height - 1}  size=${width}x${height}`,
    chalk.dim('#=visible +=explored .=unknown'),
    '',
  ];
  const colNums = Array.from({ length: width }, (_, i) => ((bounds.x + i) % 10).toString()).join('');
  lines.push(`  ${chalk.dim(colNums)}`);

  for (let y = 0; y < height; y += 1) {
    const rowStr = Array.from({ length: width }, (_, x) => {
      const visible = scene.visible?.[y]?.[x] ?? false;
      const explored = scene.explored?.[y]?.[x] ?? false;
      if (visible) {
        return chalk.green('#');
      }
      if (explored) {
        return chalk.yellow('+');
      }
      return chalk.dim('.');
    }).join('');
    lines.push(`${String(bounds.y + y).padStart(4, ' ')} ${rowStr}`);
  }

  return lines.join('\n');
}

export function fmtEvent(e: SseEvent): string {
  if (e.type === 'connected') {
    const types = e.event_types?.length ? ` event_types=${chalk.dim(e.event_types.join(','))}` : '';
    return `${chalk.green('[connected]')} player_id=${chalk.bold(e.player_id)}${types}`;
  }
  const evt = e.event;
  return `${chalk.cyan(`[t${evt.tick}]`)} ${chalk.yellow(evt.event_type)} ${chalk.dim(evt.visibility_scope)} ${JSON.stringify(evt.payload)}`;
}

export function fmtError(msg: string): string {
  return chalk.red('Error: ') + msg;
}

export function fmtOk(msg: string): string {
  return chalk.green('✓ ') + msg;
}
