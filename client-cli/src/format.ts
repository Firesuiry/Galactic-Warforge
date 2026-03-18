import chalk from 'chalk';
import type {
  Building, Unit, StateSummary, PlanetView,
  CommandResponse, FogMapView, GalaxyView, SystemView,
  HealthResponse, MetricsSnapshot, GameEvent,
} from './types.js';

// ── Simple table helpers ──────────────────────────────────────────────────

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

// ── Formatters ─────────────────────────────────────────────────────────────

export function fmtHealth(h: HealthResponse): string {
  const statusColor = h.status === 'ok' ? chalk.green(h.status) : chalk.red(h.status);
  return `Status: ${statusColor}  Tick: ${chalk.cyan(h.tick)}`;
}

export function fmtMetrics(m: MetricsSnapshot): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(m)) {
    lines.push(`  ${chalk.yellow(k)}: ${v}`);
  }
  return lines.join('\n');
}

export function fmtSummary(s: StateSummary): string {
  const lines: string[] = [
    `Tick: ${chalk.cyan(s.tick)}  Active Planet: ${s.active_planet_id}  Map: ${s.map_width}x${s.map_height}`,
  ];
  if (s.winner) {
    lines.push(chalk.green(`Winner: ${s.winner}`));
  }
  lines.push('');
  const headers = ['Player', 'Alive', 'Minerals', 'Energy'];
  const rows = Object.values(s.players).map(p => [
    p.player_id,
    p.is_alive ? chalk.green('yes') : chalk.red('no'),
    String(p.resources.minerals),
    String(p.resources.energy),
  ]);
  lines.push(table(headers, rows));
  return lines.join('\n');
}

export function fmtGalaxy(g: GalaxyView): string {
  const name = g.name ?? '(unknown)';
  const lines = [`Galaxy: ${chalk.bold(name)} (${g.galaxy_id})`, ''];
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
  const headers = ['PlanetID', 'Name', 'Discovered'];
  const rows = (s.planets ?? []).map(p => [
    p.planet_id,
    p.name ?? '(unknown)',
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
    `Planet: ${chalk.bold(p.planet_id)}  Tick: ${chalk.cyan(p.tick)}  Map: ${p.map_width}x${p.map_height}`,
  ];

  const buildings = Object.values(p.buildings ?? {});
  if (buildings.length > 0) {
    lines.push('', chalk.bold('Buildings:'));
    const bHeaders = ['ID', 'Type', 'Owner', 'Pos', 'HP', 'Lvl', 'Active'];
    const bRows = buildings.map(b => [
      b.id,
      chalk.yellow(b.type),
      b.owner_id,
      `(${b.position.x},${b.position.y})`,
      `${b.hp}/${b.max_hp}`,
      String(b.level),
      b.is_active ? chalk.green('yes') : chalk.red('no'),
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

  return lines.join('\n');
}

export function fmtCommandResponse(r: CommandResponse): string {
  const accepted = r.accepted ? chalk.green('ACCEPTED') : chalk.red('REJECTED');
  const lines = [
    `${accepted}  request_id=${r.request_id}  tick=${r.enqueue_tick}`,
  ];
  if (r.results) {
    for (const res of r.results) {
      const okStatuses = new Set(['executed', 'accepted']);
      const statusColor = okStatuses.has(res.status) ? chalk.green : chalk.red;
      lines.push(`  [${res.command_index}] ${statusColor(res.status)} ${res.code}: ${res.message}`);
    }
  }
  return lines.join('\n');
}

export function fmtFog(f: FogMapView): string {
  if (!f.discovered) {
    return `FogMap: ${f.planet_id}  ${chalk.dim('undiscovered')}`;
  }
  const lines = [
    `FogMap: ${f.planet_id}  ${f.map_width}x${f.map_height}`,
    '',
  ];
  // Column headers
  const colNums = Array.from({ length: f.map_width }, (_, i) => (i % 10).toString()).join('');
  lines.push('  ' + chalk.dim(colNums));
  for (let y = 0; y < f.map_height; y++) {
    const rowStr = f.visible[y]
      ? f.visible[y].map(v => v ? chalk.green('#') : chalk.dim('.')).join('')
      : '.'.repeat(f.map_width);
    lines.push(`${String(y).padStart(2, ' ')} ${rowStr}`);
  }
  return lines.join('\n');
}

export function fmtEvent(e: GameEvent): string {
  const tick = chalk.cyan(`[t${e.tick}]`);
  const type = chalk.yellow(e.event_type);
  const scope = chalk.dim(e.visibility_scope);
  return `${tick} ${type} ${scope} ${JSON.stringify(e.payload)}`;
}

export function fmtError(msg: string): string {
  return chalk.red('Error: ') + msg;
}

export function fmtOk(msg: string): string {
  return chalk.green('✓ ') + msg;
}
