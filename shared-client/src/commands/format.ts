import chalk from 'chalk';
import { formatAlertText } from '../alerts.js';
import { NO_MECHA_HINT, selectMyMecha } from '../mecha.js';
import type {
  Building,
  MechaView,
  CommandCatalogView,
  CommandResponse,
  ExecutionOutcome,
  FleetDetailView,
  FleetRuntimeView,
  GalaxyView,
  HealthResponse,
  MetricsSnapshot,
  PlanetRuntimeView,
  PlanetSceneView,
  PlanetSummaryView,
  PlayerStatsSnapshot,
  SseEvent,
  AgentBriefing, StateSummary,
  SystemRuntimeView,
  SystemView,
  WarBlueprintDetailView,
  WarBlueprintListView,
  WarIndustryView,
  WarSupplyStock,
  WarTaskForceListView,
  WarTheaterListView,
} from '../types.js';

export function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

export function row(cols: string[], widths: number[]): string {
  return cols.map((c, i) => pad(c, widths[i])).join('  ');
}

/**
 * 终端表格。列宽按**可见宽度**算：单元格可以带 ANSI 颜色（`chalk`），
 * 直接用 `.length` 会把转义序列算进去，彩色列被撑宽、整表错位。
 * 着色在补齐之后做：调用方传纯文本 + 可选的按列着色函数。
 */
export function table(
  headers: string[],
  rows: string[][],
  colorize?: (col: number, value: string, rowIndex: number) => string,
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const header = chalk.bold(row(headers, widths));
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  const body = rows
    .map((r, rowIndex) => r.map((c, i) => {
      const padded = pad(c, widths[i]);
      return colorize ? colorize(i, padded, rowIndex) : padded;
    }).join('  '))
    .join('\n');
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

function fmtFloat(value?: number, digits = 2): string {
  if (value === undefined) {
    return '-';
  }
  return Number(value.toFixed(digits)).toString();
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

function fmtWarStock(stock?: WarSupplyStock): string {
  const entries = Object.entries(stock ?? {}).filter(([, qty]) => (qty ?? 0) > 0);
  if (entries.length === 0) {
    return '-';
  }
  return entries.map(([item, qty]) => `${item}:${qty}`).join(', ');
}

function fmtContactLabel(contact: {
  confirmed_type?: string;
  classification?: string;
  entity_type?: string;
}): string {
  return contact.confirmed_type ?? contact.classification ?? contact.entity_type ?? '-';
}

function fmtPosition(position?: { x: number; y: number; z?: number }): string {
  if (!position) {
    return '-';
  }
  return position.z ? `${position.x},${position.y},${position.z}` : `${position.x},${position.y}`;
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

/**
 * 玩家自己的背包行（第 21 轮：背包挂在机甲上）。
 * `mecha` = 当前发令者绑定的机甲；未绑定时给统一提示。
 */
export function fmtMechaInventory(mecha: MechaView | undefined, limit = 8): string {
  if (!mecha) {
    return chalk.yellow(NO_MECHA_HINT);
  }
  const slots = mecha.inventory_slots_total
    ? ` [${mecha.inventory_slots_used}/${mecha.inventory_slots_total} slots]`
    : '';
  const preview = fmtInventoryPreview(mecha.inventory, limit) || chalk.dim('空');
  return `Inventory ${mecha.unit_id}${slots}: ${preview}`;
}

/** 机甲作业一行：`craft circuit_board ×3（running）` / `mine iron_ore ×5（paused）`。 */
export function fmtMechaJob(mecha: MechaView | undefined): string {
  const job = mecha?.job;
  if (!job) {
    return '';
  }
  const target = job.kind === 'mine' ? (job.resource_id ?? '?') : (job.recipe_id ?? '?');
  const paused = job.paused ? '，已暂停（防御中）' : '';
  return `${job.kind} ${target} ×${job.remaining_batches}（${job.state}${paused}）`;
}

export function fmtSummary(s: StateSummary): string {
  const lines: string[] = [
    `Tick: ${chalk.cyan(s.tick)}  Active Planet: ${s.active_planet_id}  Map: ${s.map_width}x${s.map_height}`,
  ];
  if (s.winner) {
    lines.push(chalk.green(`Winner: ${s.winner}`));
  }
  lines.push('');

  const headers = ['Player', 'Team', 'Role', 'Alive', 'Energy', 'Mechas'];
  const rows = Object.values(s.players).map(p => [
    p.player_id,
    p.team_id ?? '-',
    p.role ?? '-',
    p.is_alive ? chalk.green('yes') : chalk.red('no'),
    p.resources ? String(p.resources.energy) : chalk.dim('-'),
    (p.mechas ?? []).map(m => m.unit_id).join(',') || '-',
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
    `  units_killed=${s.combat_stats.units_killed}  units_lost=${s.combat_stats.units_lost}  buildings_destroyed=${s.combat_stats.buildings_destroyed}  buildings_lost=${s.combat_stats.buildings_lost}`,
    `  threat=${s.combat_stats.threat_level}  highest=${s.combat_stats.highest_threat}`,
  ].join('\n');
}


export function fmtCommandCatalog(catalog: CommandCatalogView): string {
  const commands = catalog.commands ?? [];
  const lines: string[] = [
    `Command catalog v${catalog.version}  (${commands.length} public types)`,
    '',
  ];
  for (const entry of commands) {
    const target = (entry.required_target_fields ?? []).length > 0
      ? `target=${(entry.required_target_fields ?? []).join(',')}`
      : 'target=-';
    const payload = (entry.required_payload_fields ?? []).length > 0
      ? `payload=${(entry.required_payload_fields ?? []).join(',')}`
      : 'payload=-';
    const optional = (entry.optional_payload_fields ?? []).length > 0
      ? `  optional=${(entry.optional_payload_fields ?? []).join(',')}`
      : '';
    const layer = entry.required_layer ? `  layer=${entry.required_layer}` : '';
    lines.push(`  ${pad(entry.type, 28)} ${target}  ${payload}${optional}${layer}`);
  }
  return lines.join('\n');
}

export function fmtAgentBriefing(b: AgentBriefing, issuerId = b.self.player_id): string {
  const lines: string[] = [
    `Tick: ${chalk.cyan(b.tick)}  Active Planet: ${b.active_planet_id}  Map: ${b.map_width}x${b.map_height}`,
  ];
  if (b.winner) {
    lines.push(chalk.green(`Winner: ${b.winner} (${b.victory_reason ?? '-'} / ${b.victory_rule ?? '-'})`));
  }
  lines.push('');
  lines.push(chalk.bold('Self'));
  lines.push(
    `  ${b.self.player_id} team=${b.self.team_id ?? '-'} role=${b.self.role ?? '-'} alive=${b.self.is_alive}`,
  );
  lines.push(
    `  energy=${b.self.resources?.energy ?? 0}（电网结余）`,
  );
  const myMecha = selectMyMecha(b.self, issuerId);
  // 背包完整列出（不截断前 8 种）：缺料判断要靠这一行。
  lines.push(`  ${fmtMechaInventory(myMecha, Number.POSITIVE_INFINITY)}`);
  const job = fmtMechaJob(myMecha);
  if (job) {
    lines.push(`  job ${job}`);
  }
  if (b.self.tech) {
    lines.push(
      `  tech completed=${b.self.tech.completed_count} queue=${b.self.tech.research_queue_len} researched=${b.self.tech.total_researched}`,
    );
    const completed = b.self.tech.completed_techs ?? [];
    if (completed.length > 0) {
      lines.push(`  completed techs: ${completed.join(', ')}`);
    }
    if (b.self.tech.current_research) {
      const r = b.self.tech.current_research;
      lines.push(`  research ${r.tech_id} progress=${r.progress}/${r.total_cost} state=${r.state}`);
    } else {
      lines.push('  research: (none)');
    }
  }
  lines.push('');
  lines.push(chalk.bold('Energy / Combat'));
  lines.push(
    `  gen=${b.energy_stats?.generation ?? 0} cons=${b.energy_stats?.consumption ?? 0} stored=${b.energy_stats?.current_stored ?? 0}/${b.energy_stats?.storage ?? 0}`,
  );
  lines.push(
    `  killed=${b.combat_stats?.units_killed ?? 0} lost=${b.combat_stats?.units_lost ?? 0} threat=${b.combat_stats?.threat_level ?? 0}`,
  );
  lines.push('');
  lines.push(chalk.bold(`Fleets (${b.fleets?.length ?? 0})`));
  for (const f of b.fleets ?? []) {
    const transit = f.in_transit ? ` transit→${f.transit_to ?? '?'}` : '';
    lines.push(`  ${f.fleet_id} @${f.system_id} ${f.state} units=${f.unit_count}${transit}`);
  }
  lines.push(chalk.bold(`Task forces (${b.task_forces?.length ?? 0}) / Theaters (${b.theaters?.length ?? 0}) / Enemies (${b.enemy_forces?.length ?? 0})`));
  lines.push(chalk.bold(`Recent alerts (${b.recent_alerts?.length ?? 0})`));
  for (const a of b.recent_alerts ?? []) {
    // 中文口径走 shared alerts：枚举 id（如 belt_blocked）不上界面，
    // 传送带堵塞带上位置/件数/停顿时长。
    // 带 alert_type 与 building_id：中文短句看不出枚举值，定位建筑也缺 id。
    const where = a.building_id ? ` ${a.building_id}` : '';
    lines.push(`  [t${a.tick}] ${a.severity ?? '-'} ${chalk.dim(a.alert_type ?? '-')}${where} ${formatAlertText(a)}`);
  }
  lines.push('');
  lines.push(chalk.bold(`Available commands (${b.available_commands?.length ?? 0})`));
  lines.push(`  ${(b.available_commands ?? []).join(', ')}`);
  return lines.join('\n');
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
  if (runtime.orbital_superiority) {
    lines.push(`Orbital superiority: ${runtime.orbital_superiority.advantage_player_id || '-'}  intensity=${fmtFloat(runtime.orbital_superiority.contest_intensity)}  reason=${runtime.orbital_superiority.last_reason || '-'}`);
  }

  const fleets = runtime.fleets ?? [];
  lines.push('');
  if (fleets.length === 0) {
    lines.push(chalk.dim('No fleets in this system runtime.'));
  } else {
    const rows = fleets.map((fleet) => [
      fleet.fleet_id,
      fleet.state,
      fleet.formation,
      fmtFleetUnits(fleet.units),
      fmtFleetTarget(fleet.target),
    ]);
    lines.push(table(['FleetID', 'State', 'Formation', 'Units', 'Target'], rows));
  }

  const contacts = runtime.contacts ?? [];
  lines.push('');
  lines.push(chalk.bold('Contacts'));
  if (contacts.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['ID', 'Level', 'Type', 'Signal', 'Updated'],
      contacts.map((contact) => [
        contact.id,
        contact.level,
        fmtContactLabel(contact),
        fmtFloat(contact.signal_strength),
        String(contact.last_updated_tick ?? '-'),
      ]),
    ));
  }

  const blockades = runtime.planet_blockades ?? [];
  lines.push('');
  lines.push(chalk.bold('Blockades'));
  if (blockades.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['Planet', 'Status', 'TaskForce', 'Supply'],
      blockades.map((blockade) => [
        blockade.planet_id,
        blockade.status,
        blockade.task_force_id ?? '-',
        String(blockade.interdicted_supply ?? 0),
      ]),
    ));
  }

  const reports = runtime.battle_reports ?? [];
  lines.push('');
  lines.push(chalk.bold('Battle Reports'));
  if (reports.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['Battle', 'Fleet', 'Target', 'Damage', 'Lock'],
      reports.map((report) => [
        report.battle_id,
        report.fleet_id,
        report.target_id ?? '-',
        String(report.target_strength_loss ?? 0),
        fmtFloat(report.lock_quality),
      ]),
    ));
  }
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
    for (const issue of res.issues ?? []) {
      const parts = [`code=${issue.code}`];
      if (issue.field) parts.push(`field=${issue.field}`);
      if (issue.expected !== undefined) parts.push(`expected=${JSON.stringify(issue.expected)}`);
      if (issue.actual !== undefined) parts.push(`actual=${JSON.stringify(issue.actual)}`);
      if (issue.message) parts.push(issue.message);
      lines.push(`    - ${parts.join(' ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * 非交互模式在 ACCEPTED 之后追加的执行结果行：每个 command_index 一行。
 * `outcomes` 只含已执行的 index；超时时缺的 index 打印「未在 Ns 内执行」。
 */
export function fmtExecutionOutcomes(
  outcomes: ExecutionOutcome[],
  expectedIndexes: number[],
  timeoutSeconds: number,
): string[] {
  const byIndex = new Map(outcomes.map((outcome) => [outcome.command_index, outcome]));
  return expectedIndexes.map((index) => {
    const outcome = byIndex.get(index);
    if (!outcome) {
      return `  [${index}] … 未在 ${timeoutSeconds}s 内执行（tick 是否在走？）`;
    }
    if (outcome.status === 'executed') {
      return `  [${index}] ${chalk.green('✓')} OK: ${outcome.message}`;
    }
    return `  [${index}] ${chalk.red('✗')} ${outcome.code}: ${outcome.message}`;
  });
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

/** 施工任务表：代理最该看的一栏（wait_reason 说明为什么还没开工）。 */
function fmtConstructionTasks(runtime: PlanetRuntimeView, mineOnly: boolean, myMechaId?: string): string[] {
  const all = runtime.construction_tasks ?? [];
  const tasks = mineOnly
    ? all.filter((task) => myMechaId !== undefined && task.mecha_id === myMechaId)
    : all;
  const lines: string[] = [chalk.bold(`Construction tasks (${tasks.length}${mineOnly ? ` mine, ${all.length} total` : ''})`)];
  if (tasks.length === 0) {
    lines.push(chalk.dim(mineOnly ? '  none for my mecha' : '  none'));
    return lines;
  }
  lines.push(table(
    ['ID', 'Type', 'Position', 'Mecha', 'State', 'Wait', 'Remaining'],
    tasks.map((task) => [
      task.id,
      task.building_name ?? task.building_type,
      fmtPosition(task.position),
      task.mecha_id ?? '-',
      task.state,
      task.wait_reason ?? '-',
      task.state === 'pending' || task.state === 'paused' ? '-' : String(task.remaining_ticks ?? '-'),
    ]),
  ));
  return lines;
}

/** 物流摘要：站点/运输器/机器人按状态计数，站点表给库存总量。 */
function fmtLogistics(runtime: PlanetRuntimeView): string[] {
  const stations = runtime.logistics_stations ?? [];
  const drones = runtime.logistics_drones ?? [];
  const ships = runtime.logistics_ships ?? [];
  const bots = runtime.logistics_bots ?? [];
  const distributors = runtime.logistics_distributors ?? [];
  const countByStatus = (items: Array<{ status?: string }>): string => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const status = item.status ?? '-';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts.size === 0
      ? '-'
      : [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([status, n]) => `${status}:${n}`).join(' ');
  };
  const lines: string[] = [chalk.bold('Logistics')];
  lines.push(
    `  stations=${stations.length}  drones=${drones.length}  ships=${ships.length}  ` +
    `distributors=${distributors.length}  bots=${bots.length}`,
  );
  if (drones.length > 0) {
    lines.push(`  drones ${countByStatus(drones)}`);
  }
  if (ships.length > 0) {
    lines.push(`  ships ${countByStatus(ships)}`);
  }
  if (bots.length > 0) {
    lines.push(`  bots ${countByStatus(bots)}`);
  }
  if (stations.length > 0) {
    lines.push(table(
      ['Station', 'Type', 'Position', 'Drones', 'Ships', 'Inventory'],
      stations.map((station) => [
        station.building_id,
        station.building_type,
        fmtPosition(station.position),
        String(station.drone_ids?.length ?? 0),
        String(station.ship_ids?.length ?? 0),
        fmtInventoryPreview(station.state?.inventory, 6) || '-',
      ]),
    ));
  }
  return lines;
}

export interface PlanetRuntimeFormatOptions {
  /** 只看这台机甲的施工任务（`planet_runtime --mine`）。 */
  myMechaId?: string;
  mineOnly?: boolean;
}

export function fmtPlanetRuntime(runtime: PlanetRuntimeView, options: PlanetRuntimeFormatOptions = {}): string {
  if (!runtime.discovered) {
    return `Planet Runtime: ${chalk.bold(runtime.planet_id)}  ${chalk.dim('undiscovered')}`;
  }
  const lines = [
    `Planet Runtime: ${chalk.bold(runtime.planet_id)}`,
    `Available: ${runtime.available ? chalk.green('yes') : chalk.dim('no')}  Tick: ${chalk.cyan(runtime.tick)}`,
    `Contacts=${runtime.contacts?.length ?? 0}  EnemyForces=${runtime.enemy_forces?.length ?? 0}  Frontlines=${runtime.frontlines?.length ?? 0}`,
  ];

  lines.push('');
  lines.push(...fmtConstructionTasks(runtime, options.mineOnly ?? false, options.myMechaId));
  lines.push('');
  lines.push(...fmtLogistics(runtime));

  const contacts = runtime.contacts ?? [];
  lines.push('');
  lines.push(chalk.bold('Contacts'));
  if (contacts.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['ID', 'Level', 'Type', 'Position', 'Updated'],
      contacts.map((contact) => [
        contact.id,
        contact.level,
        fmtContactLabel(contact),
        fmtPosition(contact.position),
        String(contact.last_updated_tick ?? '-'),
      ]),
    ));
  }

  const frontlines = runtime.frontlines ?? [];
  lines.push('');
  lines.push(chalk.bold('Frontlines'));
  if (frontlines.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['ID', 'Type', 'Status', 'Control', 'Position'],
      frontlines.map((frontline) => [
        frontline.id,
        frontline.type,
        frontline.status,
        fmtFloat(frontline.control),
        fmtPosition(frontline.position),
      ]),
    ));
  }

  const taskForces = runtime.ground_task_forces ?? [];
  lines.push('');
  lines.push(chalk.bold('Ground Task Forces'));
  if (taskForces.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['TaskForce', 'Order', 'Status', 'Support', 'Progress'],
      taskForces.map((taskForce) => [
        taskForce.task_force_id,
        taskForce.ground_order ?? '-',
        taskForce.status ?? '-',
        taskForce.orbital_support_mode ?? '-',
        fmtFloat(taskForce.progress),
      ]),
    ));
  }

  return lines.join('\n');
}

export function fmtWarBlueprintList(view: WarBlueprintListView): string {
  const blueprints = view.blueprints ?? [];
  if (blueprints.length === 0) {
    return chalk.dim('No warfare blueprints.');
  }
  return table(
    ['Blueprint', 'State', 'Domain', 'Source', 'Actions'],
    blueprints.map((blueprint) => [
      blueprint.id,
      blueprint.state,
      blueprint.domain,
      blueprint.source,
      (blueprint.allowed_actions ?? []).join(',') || '-',
    ]),
  );
}

export function fmtWarBlueprintDetail(blueprint: WarBlueprintDetailView): string {
  const lines = [
    `Blueprint: ${chalk.bold(blueprint.name)} (${blueprint.id})`,
    `State: ${blueprint.state}  Domain: ${blueprint.domain}  Source: ${blueprint.source}`,
    `Base: ${blueprint.base_frame_id ?? blueprint.base_hull_id ?? '-'}  Parent: ${blueprint.parent_blueprint_id ?? '-'}`,
    `Validation: ${blueprint.validation.valid ? chalk.green('valid') : chalk.red('invalid')}`,
  ];
  if ((blueprint.components ?? []).length > 0) {
    lines.push('');
    lines.push(table(
      ['Slot', 'Component'],
      (blueprint.components ?? []).map((slot) => [slot.slot_id, slot.component_id]),
    ));
  }
  const issues = blueprint.validation.issues ?? [];
  if (issues.length > 0) {
    lines.push('');
    lines.push(chalk.bold('Validation Issues'));
    lines.push(table(
      ['Code', 'Slot', 'Message'],
      issues.map((issue) => [issue.code, issue.slot_id ?? '-', issue.message]),
    ));
  }
  return lines.join('\n');
}

export function fmtWarIndustry(view: WarIndustryView): string {
  const lines = [chalk.bold('Production Orders')];
  const production = view.production_orders ?? [];
  if (production.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['ID', 'Blueprint', 'Factory', 'Hub', 'Stage', 'Status'],
      production.map((order) => [
        order.id,
        order.blueprint_id,
        order.factory_building_id,
        order.deployment_hub_id ?? '-',
        order.stage,
        order.status,
      ]),
    ));
  }

  lines.push('');
  lines.push(chalk.bold('Refit Orders'));
  const refits = view.refit_orders ?? [];
  if (refits.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['ID', 'Unit', 'From', 'To', 'Status'],
      refits.map((order) => [
        order.id,
        order.unit_id,
        order.source_blueprint_id,
        order.target_blueprint_id,
        order.status,
      ]),
    ));
  }

  lines.push('');
  lines.push(chalk.bold('Deployment Hubs'));
  const hubs = view.deployment_hubs ?? [];
  if (hubs.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['Hub', 'Type', 'Planet', 'Ready Payloads'],
      hubs.map((hub) => [
        hub.building_id,
        hub.building_type,
        hub.planet_id ?? '-',
        fmtTopEntries(hub.ready_payloads),
      ]),
    ));
  }

  lines.push('');
  lines.push(chalk.bold('Supply Nodes'));
  const supplyNodes = view.supply_nodes ?? [];
  if (supplyNodes.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['Node', 'Type', 'Planet', 'Inventory'],
      supplyNodes.map((node) => [
        node.node_id,
        node.source_type,
        node.planet_id ?? '-',
        fmtWarStock(node.inventory),
      ]),
    ));
  }

  return lines.join('\n');
}

export function fmtWarTaskForces(view: WarTaskForceListView): string {
  const taskForces = view.task_forces ?? [];
  if (taskForces.length === 0) {
    return chalk.dim('No task forces.');
  }
  return table(
    ['TaskForce', 'Stance', 'Theater', 'Members', 'Supply', 'Command'],
    taskForces.map((taskForce) => [
      taskForce.id,
      taskForce.stance,
      taskForce.theater_id ?? '-',
      String(taskForce.members?.length ?? 0),
      taskForce.supply_status.condition,
      `${taskForce.command_capacity.used}/${taskForce.command_capacity.total}`,
    ]),
  );
}

export function fmtWarTheaters(view: WarTheaterListView): string {
  const theaters = view.theaters ?? [];
  if (theaters.length === 0) {
    return chalk.dim('No theaters.');
  }
  return table(
    ['Theater', 'Name', 'Zones', 'Objective'],
    theaters.map((theater) => [
      theater.id,
      theater.name ?? '-',
      String(theater.zones?.length ?? 0),
      theater.objective?.objective_type ?? '-',
    ]),
  );
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

/** 失败行前缀：`scripts/sw` 的退出码靠它判定（见 client-cli/src/once.ts）。 */
export const FAILURE_MARKER = '✗ ';

export function fmtFailure(msg: string): string {
  return chalk.red(FAILURE_MARKER) + msg;
}

export function fmtOk(msg: string): string {
  return chalk.green('✓ ') + msg;
}
