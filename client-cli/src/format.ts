import chalk from 'chalk';
import type {
  StateSummary, PlanetView,
  CommandResponse, FogMapView, GalaxyView, SystemView,
  HealthResponse, MetricsSnapshot, PlayerStatsSnapshot, SseEvent, Building,
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

export function fmtPlanet(p: PlanetView): string {
  if (!p.discovered) {
    return `Planet: ${chalk.bold(p.planet_id)}  ${chalk.dim('undiscovered')}`;
  }

  const lines = [
    `Planet: ${chalk.bold(p.name ?? p.planet_id)} (${p.planet_id})  Tick: ${chalk.cyan(p.tick)}  Map: ${p.map_width}x${p.map_height}`,
  ];
  if (p.kind) {
    lines.push(`Kind: ${p.kind}`);
  }
  if (p.environment) {
    lines.push(
      `Environment: wind=${p.environment.wind_factor ?? '-'} light=${p.environment.light_factor ?? '-'} day_hours=${p.environment.day_length_hours ?? '-'}`
    );
  }

  const buildings = Object.values(p.buildings ?? {});
  if (buildings.length > 0) {
    lines.push('', chalk.bold('Buildings:'));
    const bHeaders = ['ID', 'Type', 'Owner', 'Pos', 'HP', 'Lvl', 'State', 'Ops'];
    const bRows = buildings.map(b => [
      b.id,
      chalk.yellow(b.type),
      b.owner_id,
      `(${b.position.x},${b.position.y})`,
      `${b.hp}/${b.max_hp}`,
      String(b.level),
      fmtStateLabel(b.runtime?.state, b.runtime?.state_reason),
      fmtBuildingOps(b),
    ]);
    lines.push(table(bHeaders, bRows));
  } else {
    lines.push('', 'No buildings.');
  }

  const units = Object.values(p.units ?? {});
  if (units.length > 0) {
    lines.push('', chalk.bold('Units:'));
    const uHeaders = ['ID', 'Type', 'Owner', 'Pos', 'HP', 'Moving'];
    const uRows = units.map(u => [
      u.id,
      chalk.cyan(u.type),
      u.owner_id,
      `(${u.position.x},${u.position.y})`,
      `${u.hp}/${u.max_hp}`,
      u.is_moving ? chalk.yellow('yes') : 'no',
    ]);
    lines.push(table(uHeaders, uRows));
  } else {
    lines.push('', 'No units.');
  }

  const resources = p.resources ?? [];
  if (resources.length > 0) {
    lines.push('', chalk.bold(`Resources (${resources.length}):`));
    const rHeaders = ['ID', 'Kind', 'Pos', 'Remaining', 'Yield'];
    const rRows = resources.slice(0, 12).map(resource => [
      resource.id,
      resource.kind,
      `(${resource.position.x},${resource.position.y})`,
      String(resource.remaining ?? '-'),
      String(resource.current_yield ?? resource.base_yield ?? '-'),
    ]);
    lines.push(table(rHeaders, rRows));
    if (resources.length > 12) {
      lines.push(chalk.dim(`... ${resources.length - 12} more resource nodes`));
    }
  } else {
    lines.push('', 'No resource nodes visible.');
  }

  return lines.join('\n');
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

export function fmtFog(f: FogMapView): string {
  if (!f.discovered) {
    return `FogMap: ${f.planet_id}  ${chalk.dim('undiscovered')}`;
  }

  const lines = [
    `FogMap: ${f.planet_id}  ${f.map_width}x${f.map_height}`,
    chalk.dim('#=visible +=explored .=unknown'),
    '',
  ];
  const colNums = Array.from({ length: f.map_width }, (_, i) => (i % 10).toString()).join('');
  lines.push(`  ${chalk.dim(colNums)}`);

  for (let y = 0; y < f.map_height; y += 1) {
    const rowStr = Array.from({ length: f.map_width }, (_, x) => {
      const visible = f.visible?.[y]?.[x] ?? false;
      const explored = f.explored?.[y]?.[x] ?? false;
      if (visible) {
        return chalk.green('#');
      }
      if (explored) {
        return chalk.yellow('+');
      }
      return chalk.dim('.');
    }).join('');
    lines.push(`${String(y).padStart(2, ' ')} ${rowStr}`);
  }

  return lines.join('\n');
}

export function fmtEvent(e: SseEvent): string {
  if (e.type === 'connected') {
    return `${chalk.green('[connected]')} player_id=${chalk.bold(e.player_id)}`;
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
