import chalk from 'chalk';

import type {
  Building,
  MechaView,
  PlanetInspectView,
  PlanetNetworksView,
  PlanetSceneView,
  PlanetResource,
  SorterEndpointView,
  Unit,
} from '../types.js';
import { fmtAmounts } from './catalog-format.js';
import { fmtPlanetContext, type PlanetContext } from './scene-context.js';
import { table } from './format.js';

export const SCENE_SECTION_LIMIT = 20;

function stateLabel(building: Building): string {
  const state = building.runtime?.state ?? 'unknown';
  const reason = building.runtime?.state_reason;
  return reason ? `${state}:${reason}` : state;
}

function sizeLabel(building: Building): string {
  const footprint = building.runtime?.params?.footprint;
  return footprint ? `${footprint.width}x${footprint.height}` : '-';
}

export interface SceneFormatOptions {
  /** 每节最多显示多少条，默认 20；`--limit all` 传 Infinity。 */
  limit?: number;
  /** unit_id -> operator（来自 summary.mechas），机甲标出操作者。 */
  operators?: Map<string, string>;
  /** 星球默认值的来源提示（省略 planet 参数时打印）。 */
  context?: PlanetContext;
}

function truncated(count: number, limit: number): string[] {
  return count > limit
    ? [chalk.dim(`  (showing ${limit} of ${count}; use --json or narrow the window for the rest)`)]
    : [];
}

function summarizeResources(resources: PlanetResource[]) {
  const groups = new Map<string, { cells: number; minX: number; minY: number; maxX: number; maxY: number; sampleId: string }>();
  for (const resource of resources) {
    const group = groups.get(resource.kind) ?? {
      cells: 0,
      minX: resource.position.x,
      minY: resource.position.y,
      maxX: resource.position.x,
      maxY: resource.position.y,
      sampleId: resource.id,
    };
    group.cells += 1;
    group.minX = Math.min(group.minX, resource.position.x);
    group.minY = Math.min(group.minY, resource.position.y);
    group.maxX = Math.max(group.maxX, resource.position.x);
    group.maxY = Math.max(group.maxY, resource.position.y);
    groups.set(resource.kind, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, group]) => ({ kind, ...group }));
}

export function fmtScene(scene: PlanetSceneView, options: SceneFormatOptions = {}): string {
  const limit = options.limit ?? SCENE_SECTION_LIMIT;
  if (!scene.discovered) {
    return `Scene: ${chalk.bold(scene.planet_id)}  ${chalk.dim('undiscovered')}`;
  }
  const bounds = scene.bounds;
  const buildings = Object.values(scene.buildings ?? {});
  const units = Object.values(scene.units ?? {});
  const resources = scene.resources ?? [];
  const lines: string[] = [];

  if (options.context) {
    lines.push(fmtPlanetContext(options.context));
  }
  lines.push(
    `Scene: ${chalk.bold(scene.planet_id)}  x=${bounds.x}..${bounds.x + bounds.width - 1}  y=${bounds.y}..${bounds.y + bounds.height - 1}  size=${bounds.width}x${bounds.height}  tick=${chalk.cyan(scene.tick)}`,
    `window: buildings=${buildings.length} units=${units.length} resource_cells=${resources.length}  planet totals: buildings=${scene.building_count ?? '-'} units=${scene.unit_count ?? '-'} resources=${scene.resource_count ?? '-'}`,
  );

  lines.push('', chalk.bold('Buildings') + chalk.dim(` (${buildings.length})`));
  if (buildings.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    const shown = buildings.slice(0, limit);
    lines.push(table(
      ['id', 'type', 'at', 'size', 'state'],
      shown.map((building) => [
        building.id,
        building.type,
        `${building.position.x},${building.position.y}`,
        sizeLabel(building),
        stateLabel(building),
      ]),
      (col, value) => (col === 4 && !value.trim().startsWith('running') ? chalk.yellow(value) : value),
    ));
    lines.push(...truncated(buildings.length, limit));
  }

  const resourceGroups = summarizeResources(resources);
  lines.push('', chalk.bold('Resources') + chalk.dim(` (${resourceGroups.length} kinds, ${resources.length} cells)`));
  if (resourceGroups.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    const shown = resourceGroups.slice(0, limit);
    lines.push(table(
      ['kind', 'cells', 'bbox', 'sample_id'],
      shown.map((group) => [
        group.kind,
        String(group.cells),
        `${group.minX},${group.minY}..${group.maxX},${group.maxY}`,
        group.sampleId,
      ]),
    ));
    lines.push(...truncated(resourceGroups.length, limit));
  }

  lines.push('', chalk.bold('Units') + chalk.dim(` (${units.length})`));
  if (units.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    const shown = units.slice(0, limit);
    lines.push(table(
      ['id', 'type', 'at', 'owner', 'operator'],
      shown.map((unit: Unit) => [
        unit.id,
        unit.type,
        `${unit.position.x},${unit.position.y}`,
        unit.owner_id,
        unit.mecha ? (options.operators?.get(unit.id) || '(idle)') : '-',
      ]),
    ));
    lines.push(...truncated(units.length, limit));
  }

  return lines.join('\n');
}

/** summary.mechas 展开成 unit_id -> operator，供 scene / inspect 标机甲操作者。 */
export function operatorMap(mechas: MechaView[] | undefined): Map<string, string> {
  return new Map((mechas ?? []).map((mecha) => [mecha.unit_id, mecha.operator]));
}

function activeAlertNames(alerts: Record<string, boolean> | undefined): string[] {
  return Object.entries(alerts ?? {})
    .filter(([, active]) => active)
    .map(([name]) => name);
}

export function fmtInspect(view: PlanetInspectView, options: { operator?: string } = {}): string {
  if (!view.discovered) {
    return `Inspect: ${chalk.bold(view.planet_id)}  ${chalk.dim('undiscovered')}`;
  }
  const lines: string[] = [
    `${chalk.bold(view.title ?? view.entity_id ?? '(unknown)')}  ${chalk.dim(`${view.entity_kind} ${view.entity_id ?? ''} @ ${view.planet_id}`)}`,
  ];
  if (view.building) {
    const building = view.building;
    lines.push(
      `  state       ${stateLabel(building)}`,
      `  position    ${building.position.x},${building.position.y}  size=${sizeLabel(building)}  rotation=${building.rotation ?? '0'}`,
      `  hp          ${building.hp}/${building.max_hp}  level=${building.level}  owner=${building.owner_id}`,
    );
    if (view.mining_item) {
      lines.push(`  mining      ${view.mining_item}`);
    }
    if (building.production) {
      const pending = building.production.pending_outputs;
      const pendingText = pending && pending.length > 0 ? `  pending=${fmtAmounts(pending)}` : '';
      lines.push(`  production  recipe=${building.production.recipe_id ?? '-'}  remaining=${building.production.remaining_ticks ?? '-'}${pendingText}`);
    }
    if (building.storage) {
      lines.push(`  inventory   ${fmtAmounts(Object.entries(building.storage.inventory ?? {}).map(([item_id, quantity]) => ({ item_id, quantity })))}`);
      const output = building.storage.output_buffer;
      if (output && Object.keys(output).length > 0) {
        lines.push(`  output      ${fmtAmounts(Object.entries(output).map(([item_id, quantity]) => ({ item_id, quantity })))}`);
      }
    }
    if (building.job) {
      lines.push(`  job         ${building.job.type}  remaining=${building.job.remaining_ticks}`);
    }
    if (building.conveyor) {
      lines.push(`  conveyor    in=${building.conveyor.input} out=${building.conveyor.output}  blocked_ticks=${building.conveyor.blocked_ticks ?? 0}`);
    }
    if (view.sorter_endpoints) {
      lines.push(`  sorter      ${fmtSorterEndpoints(view.sorter_endpoints, building.sorter?.last_transfer)}`);
    }
    const monitor = building.production_monitor;
    const alerts = activeAlertNames(monitor?.active_alerts);
    if (alerts.length > 0) {
      lines.push(`  alerts      ${alerts.join(',')}`);
    }
    if (monitor?.last_stats) {
      const stats = monitor.last_stats;
      lines.push(`  monitor     throughput=${stats.throughput ?? '-'} backlog=${stats.backlog ?? '-'} idle_ratio=${stats.idle_ratio ?? '-'} power=${stats.power_state ?? '-'}`);
    }
  } else if (view.unit) {
    const unit = view.unit;
    lines.push(
      `  position    ${unit.position.x},${unit.position.y}  owner=${unit.owner_id}`,
      `  hp          ${unit.hp}/${unit.max_hp}  stance=${unit.stance ?? '-'}  attack=${unit.attack} range=${unit.attack_range}`,
    );
    if (unit.mecha) {
      const mecha = unit.mecha;
      const maxBatches = (mecha.job?.remaining_batches ?? 0) + (mecha.job?.completed_batches ?? 0);
      lines.push(
        `  operator    ${options.operator || '(idle)'}`,
        `  energy      ${mecha.energy}/${mecha.max_energy}  shield=${mecha.shield}/${mecha.max_shield}`,
      );
      const job = mecha.job;
      if (job) {
        const target = job.kind === 'craft' ? job.recipe_id : job.resource_id;
        lines.push(`  job         ${job.kind} ${target ?? ''} state=${job.state} remaining=${job.remaining_ticks} batches=${job.completed_batches}/${maxBatches}`);
      } else {
        lines.push('  job         idle');
      }
    }
    if (unit.ammo_class) {
      lines.push(`  ammo        ${unit.ammo ?? 0}/${unit.ammo_capacity ?? 0} ${unit.ammo_item ?? ''}`.trimEnd());
    }
  } else if (view.resource) {
    const resource = view.resource;
    lines.push(
      `  kind        ${resource.kind}  behavior=${resource.behavior}${resource.depleted ? ' depleted' : ''}`,
      `  position    ${resource.position.x},${resource.position.y}`,
      `  amount      ${resource.remaining ?? '-'} / ${resource.max_amount ?? '-'}  yield=${resource.current_yield ?? '-'}`,
    );
  }
  lines.push(chalk.dim('raw JSON: inspect ... --json'));
  return lines.join('\n');
}

const SORTER_DIRECTION_LABEL: Record<string, string> = {
  north: '北',
  east: '东',
  south: '南',
  west: '西',
};

function sorterEndpointRef(endpoint: SorterEndpointView): string {
  const name = endpoint.building_name ?? endpoint.building_type ?? '';
  const id = endpoint.building_id ?? endpoint.blocker_id ?? '';
  const ref = [id, name].filter(Boolean).join(' ');
  return endpoint.pending ? `${ref}(施工中)` : ref;
}

/** 挡住扫描的建筑：分拣器/分流器只写 ID（前面已经有「分拣器」「分流器」），其余写 ID+名字。 */
function sorterBlockerRef(endpoint: SorterEndpointView, withName = true): string {
  const id = endpoint.blocker_id ?? '';
  const name = withName ? endpoint.blocker_name ?? endpoint.blocker_type ?? '' : '';
  const ref = [id, name].filter(Boolean).join(' ');
  return endpoint.pending ? `${ref}(施工中)` : ref;
}

/** 分拣器一端的摘要：连上时「b-55 电弧熔炉(1格)」，没连上时「未连上：被分拣器 b-181 挡住」。 */
function fmtSorterEndpoint(side: 'pick' | 'drop', endpoint: SorterEndpointView): string {
  const dir = endpoint.direction ? SORTER_DIRECTION_LABEL[endpoint.direction] ?? endpoint.direction : '?';
  const arrow = side === 'pick' ? '取←' : '放→';
  const prefix = `${arrow}${dir}`;
  if (!endpoint.reason) {
    const steps = endpoint.steps ? `(${endpoint.steps}格)` : '';
    return `${prefix} ${sorterEndpointRef(endpoint)}${steps}`;
  }
  const blocker = sorterBlockerRef(endpoint);
  switch (endpoint.reason) {
    case 'no_building':
      return `${prefix} 未连上：3格内没有建筑`;
    case 'not_owned':
      return `${prefix} 未连上：${blocker} 不是你的`;
    case 'blocked_by_sorter':
      return `${prefix} 未连上：被分拣器 ${sorterBlockerRef(endpoint, false)} 挡住`;
    case 'splitter':
      return `${prefix} 未连上：被分流器 ${sorterBlockerRef(endpoint, false)} 挡住`;
    case 'conveyor_inactive':
      return `${prefix} 未连上：传送带 ${blocker} 未运行`;
    case 'conveyor_rejects_side':
      return `${prefix} 未连上：传送带 ${blocker} 不接受这一侧插入`;
    case 'no_port':
      return `${prefix} 未连上：${blocker} 没有${side === 'pick' ? '输出' : '输入'}口`;
    case 'no_storage':
      return `${prefix} 未连上：${blocker} 没有存储`;
    default:
      return `${prefix} 未连上：${endpoint.reason}`;
  }
}

/** 分拣器整行：两端 + 最近一次搬运（`last=t1234 iron_ore b-55→b-105`）。 */
export function fmtSorterEndpoints(
  endpoints: { pick: SorterEndpointView; drop: SorterEndpointView },
  lastTransfer?: { tick: number; item_id: string; source_id: string; target_id: string },
): string {
  const parts = [fmtSorterEndpoint('pick', endpoints.pick), fmtSorterEndpoint('drop', endpoints.drop)];
  const last = lastTransfer
    ? `last=t${lastTransfer.tick} ${lastTransfer.item_id} ${lastTransfer.source_id}→${lastTransfer.target_id}`
    : 'last=-';
  return `${parts.join(' | ')}   ${last}`;
}

export function fmtNetworks(view: PlanetNetworksView, context?: PlanetContext): string {
  if (!view.discovered) {
    return `Networks: ${chalk.bold(view.planet_id)}  ${chalk.dim('undiscovered')}`;
  }
  const lines: string[] = [];
  if (context) {
    lines.push(fmtPlanetContext(context));
  }
  lines.push(
    `Networks: ${chalk.bold(view.planet_id)}  available=${view.available ? chalk.green('yes') : chalk.dim('no')}  tick=${chalk.cyan(view.tick)}`,
  );

  const networks = view.power_networks ?? [];
  lines.push('', chalk.bold('Power networks') + chalk.dim(` (${networks.length})`));
  if (networks.length === 0) {
    lines.push(chalk.dim('  none'));
  } else {
    lines.push(table(
      ['id', 'owner', 'supply', 'demand', 'net', 'buildings', 'shortage'],
      networks.map((network) => [
        network.id,
        network.owner_id,
        String(network.supply),
        String(network.demand),
        String(network.net),
        String(network.node_ids?.length ?? 0),
        network.shortage ? 'yes' : 'no',
      ]),
      (col, value) => (col === 6 && value.trim() === 'yes' ? chalk.red(value) : value),
    ));
  }

  const coverage = view.power_coverage ?? [];
  const disconnected = coverage.filter((entry) => !entry.connected);
  const underpowered = coverage.filter((entry) => entry.connected && (entry.ratio ?? 1) < 1);
  lines.push('', chalk.bold('Coverage') + chalk.dim(` (${coverage.length} consumers, ${disconnected.length} disconnected, ${underpowered.length} underpowered)`));
  const problems = [...disconnected, ...underpowered].slice(0, SCENE_SECTION_LIMIT);
  if (problems.length === 0) {
    lines.push(chalk.dim('  all connected consumers fully powered'));
  } else {
    lines.push(table(
      ['building', 'type', 'at', 'connected', 'ratio', 'reason'],
      problems.map((entry) => [
        entry.building_id,
        entry.building_type,
        `${entry.position.x},${entry.position.y}`,
        entry.connected ? 'yes' : 'no',
        entry.ratio !== undefined ? entry.ratio.toFixed(2) : '-',
        entry.reason || '-',
      ]),
    ));
    lines.push(...truncated(disconnected.length + underpowered.length, SCENE_SECTION_LIMIT));
  }

  const pipelineNodes = view.pipeline_nodes ?? [];
  const pipelineSegments = view.pipeline_segments ?? [];
  if (pipelineNodes.length > 0 || pipelineSegments.length > 0) {
    const fluids = [...new Set(pipelineNodes.map((node) => node.fluid_id).filter(Boolean))];
    lines.push('', chalk.bold('Pipeline') + chalk.dim(` (nodes=${pipelineNodes.length} segments=${pipelineSegments.length} fluids=${fluids.join(',') || '-'})`));
  }
  return lines.join('\n');
}
