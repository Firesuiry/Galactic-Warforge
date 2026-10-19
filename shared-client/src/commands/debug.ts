import type { ApiClient } from '../api.js';
import type { CommandContext } from './game-commands.js';
import chalk from 'chalk';
import { formatAlertText } from '../alerts.js';
import { ALL_EVENT_TYPES, DEFAULT_EVENT_TYPES } from '../config.js';
import { fmtError } from './format.js';
import { getStringOption, hasFlag, parseArgs, parseIntegerArg, type ParsedArgs } from './args.js';

function parseOptionalInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseIntegerArg(value);
  if (parsed === undefined) {
    throw new Error(`${label} 必须是整数`);
  }
  return parsed;
}

function formatCursor(afterId: string | undefined, sinceTick: number | undefined, fallback: string): string {
  if (afterId) {
    return `after ${chalk.cyan(afterId)}`;
  }
  if (sinceTick !== undefined) {
    return `from tick ${chalk.cyan(sinceTick.toString())}`;
  }
  return fallback;
}

const AUDIT_DEFAULT_LIMIT = 20;

/** 审计 details 的字段名以服务端为准（details.stage / command_index / code …）。 */
function auditDetail(entry: { details?: Record<string, unknown> }, key: string): string | undefined {
  const value = entry.details?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function auditCommandType(entry: { permission?: string; details?: Record<string, unknown> }): string {
  const command = entry.details?.command;
  if (command && typeof command === 'object' && typeof (command as { type?: unknown }).type === 'string') {
    return (command as { type: string }).type;
  }
  return entry.permission ?? '-';
}

/** 一条审计记录：tick、stage、command_index、命令类型、code、状态、发令者、message。 */
function fmtAuditEntry(entry: {
  tick: number;
  player_id: string;
  issuer_type: string;
  issuer_id: string;
  request_id: string;
  permission: string;
  permission_granted: boolean;
  details?: Record<string, unknown>;
}): string[] {
  const stage = auditDetail(entry, 'stage') ?? '-';
  const index = entry.details?.command_index;
  const indexText = typeof index === 'number' ? `#${index}` : '#-';
  const status = auditDetail(entry, 'status') ?? '-';
  const code = auditDetail(entry, 'code') ?? '-';
  const commandType = auditCommandType(entry);
  const grantedText = entry.permission_granted ? chalk.green('GRANTED') : chalk.red('DENIED');
  const ok = code === 'OK' && status !== 'failed' && status !== 'rejected';
  const codeText = ok ? chalk.green(code) : chalk.red(code);
  const lines = [
    `[t${entry.tick}] ${chalk.yellow(stage)} ${indexText} ${chalk.bold(commandType)} ${codeText} ${status} ` +
    `${grantedText} by ${entry.player_id} (${entry.issuer_type}:${entry.issuer_id}) request=${entry.request_id}`,
  ];
  const message = auditDetail(entry, 'message');
  if (message) {
    lines.push(`    ${chalk.dim(message)}`);
  }
  return lines;
}

export async function cmdAudit(args: string[], { api, issuerId }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `audit [options]
  --limit <n>         Max entries (default ${AUDIT_DEFAULT_LIMIT})
  --issuer <id>       Filter by issuer ID（默认只看当前发令者）
  --request <rid>     Filter by request ID
  --all-issuers       Do not filter by the current issuer
  --player <id>       Filter by player ID
  --issuer-type <t>   Filter by issuer type
  --issuer-id <id>    Filter by issuer ID (alias of --issuer)
  --action <a>        Filter by action (command)
  --request-id <rid>  Filter by request ID (alias of --request)
  --permission <p>    Filter by command type
  --granted <bool>    Filter by permission granted (true/false)
  --from-tick <n>     From tick
  --to-tick <n>       To tick
  --from-time <ts>    From RFC3339 timestamp
  --to-time <ts>      To RFC3339 timestamp
  --order <dir>       asc or desc
每条记录显示 stage（precheck/execute）、command_index、命令类型、code 与 status。`;
  }

  try {
    const granted = getStringOption(parsed, 'granted');
    const order = getStringOption(parsed, 'order');
    const explicitIssuer = getStringOption(parsed, 'issuer') ?? getStringOption(parsed, 'issuer-id');
    // 默认只看当前发令者（玩家本人或代理名）；--all-issuers 看本玩家所有发令者。
    const issuerFilter = explicitIssuer ?? (hasFlag(parsed, 'all-issuers')
      ? undefined
      : (issuerId || api.getAuth().issuerId || undefined));
    const limit = parseOptionalInteger(getStringOption(parsed, 'limit'), 'limit') ?? AUDIT_DEFAULT_LIMIT;
    if (limit < 0) {
      throw new Error('--limit 必须是非负整数');
    }
    const result = await api.fetchAudit({
      player_id: getStringOption(parsed, 'player'),
      issuer_type: getStringOption(parsed, 'issuer-type'),
      issuer_id: issuerFilter,
      action: getStringOption(parsed, 'action'),
      request_id: getStringOption(parsed, 'request') ?? getStringOption(parsed, 'request-id'),
      permission: getStringOption(parsed, 'permission'),
      permission_granted: granted !== undefined ? granted === 'true' : undefined,
      from_tick: parseOptionalInteger(getStringOption(parsed, 'from-tick'), 'from-tick'),
      to_tick: parseOptionalInteger(getStringOption(parsed, 'to-tick'), 'to-tick'),
      from_time: getStringOption(parsed, 'from-time'),
      to_time: getStringOption(parsed, 'to-time'),
      limit,
      order: order === 'asc' || order === 'desc' ? order : undefined,
    });

    if (result.entries.length === 0) {
      return chalk.dim('No audit entries found.');
    }

    const scope = issuerFilter ? `issuer=${chalk.cyan(issuerFilter)}` : 'all issuers';
    const lines: string[] = [`Found ${chalk.cyan(result.count)} entries (${scope}, limit ${limit}):`, ''];
    for (const entry of result.entries) {
      lines.push(...fmtAuditEntry(entry));
    }
    if (result.count > result.entries.length) {
      lines.push(chalk.dim(`... and ${result.count - result.entries.length} more entries`));
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdEventSnapshot(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `event_snapshot [options]
  --types <a,b>      Explicit event types to query
  --all              Query all event types
  --after-id <id>    After event ID
  --since-tick <n>   Since tick
  --limit <n>        Max events (default 200)`;
  }

  try {
    const eventTypes = hasFlag(parsed, 'all')
      ? [...ALL_EVENT_TYPES]
      : (getStringOption(parsed, 'types')?.split(',').map(s => s.trim()).filter(Boolean) ?? [...DEFAULT_EVENT_TYPES]);
    const result = await api.fetchEventSnapshot({
      event_types: eventTypes,
      after_event_id: getStringOption(parsed, 'after-id'),
      since_tick: parseOptionalInteger(getStringOption(parsed, 'since-tick'), 'since-tick'),
      limit: parseOptionalInteger(getStringOption(parsed, 'limit'), 'limit'),
    });
    if (result.events.length === 0) {
      return chalk.dim('No events found.');
    }

    const lines: string[] = [
      `Events ${formatCursor(result.after_event_id, result.since_tick, 'from latest cursor')} (${result.events.length} events)`,
      `Subscribed types: ${chalk.dim((result.event_types ?? eventTypes).join(','))}`,
      `Available from tick ${chalk.cyan(result.available_from_tick.toString())}`,
      result.has_more ? chalk.dim('(more events available)') : '',
      '',
    ];
    for (const evt of result.events.slice(-20)) {
      lines.push(`[t${evt.tick}] ${chalk.yellow(evt.event_type)} ${chalk.dim(evt.visibility_scope)} event_id=${evt.event_id}`);
    }
    if (result.next_event_id) {
      lines.push(chalk.dim(`Next event_id: ${result.next_event_id}`));
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdAlertSnapshot(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `alert_snapshot [options]
  --after-id <id>    After alert ID
  --since-tick <n>   Since tick
  --active-only      Only alerts that still hold (active=true)
  --limit <n>        Max alerts (default 200)`;
  }

  try {
    const result = await api.fetchAlertSnapshot({
      after_alert_id: getStringOption(parsed, 'after-id'),
      since_tick: parseOptionalInteger(getStringOption(parsed, 'since-tick'), 'since-tick'),
      active_only: hasFlag(parsed, 'active-only') ? true : undefined,
      limit: parseOptionalInteger(getStringOption(parsed, 'limit'), 'limit'),
    });
    if (result.alerts.length === 0) {
      return chalk.dim('No alerts found.');
    }

    const lines: string[] = [
      `Alerts ${formatCursor(result.after_alert_id, result.since_tick, 'from latest cursor')} (${result.alerts.length} alerts)`,
      // available_from_tick 是历史里最老的首次出现 tick（含已解除条目），
      // 不是「本页第一条」的 tick；快照顺序是最新在前。
      `Earliest recorded alert tick ${chalk.cyan(result.available_from_tick.toString())} (history start)`,
      result.has_more ? chalk.dim('(more alerts available)') : '',
      '',
    ];
    // 服务端快照已按「仍成立在前、最新在前」排好；终端只列前 20 条（最紧要的在前），
    // 不再像旧实现那样取尾部。
    for (const alert of result.alerts.slice(0, 20)) {
      const severity = alert.severity === 'critical'
        ? chalk.red(alert.severity)
        : alert.severity === 'warning'
          ? chalk.yellow(alert.severity)
          : chalk.dim(alert.severity);
      // 中文口径走 shared alerts：绝不裸显 belt_blocked 这类枚举 id，
      // 传送带堵塞还要带上位置/件数/停顿时长（与 Web 警报条同一份文案）。
      // 服务端快照仍成立的在前、最新在前；已解除的条目留在历史里，标「已解除」。
      const state = alert.active === false ? chalk.dim('（已解除）') : '';
      lines.push(`[t${alert.tick}] ${severity} ${chalk.yellow(formatAlertText(alert))}${state}`);
      lines.push(`    building=${alert.building_id} type=${alert.building_type}`);
    }
    if (result.next_alert_id) {
      lines.push(chalk.dim(`Next alert_id: ${result.next_alert_id}`));
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function runSaveCommand(
  args: string[],
  saveFn: ApiClient['sendSave'],
): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, "help")) {
    return `save [--reason <text>]
  --reason <text>   Optional save trigger label`;
  }

  try {
    const result = await saveFn({
      reason: getStringOption(parsed, "reason"),
    });
    return [
      `Saved at tick ${result.tick}`,
      `Time: ${result.saved_at}`,
      `Path: ${result.path}`,
    ].join("\n");
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdSave(args: string[], { api }: CommandContext): Promise<string> {
  return runSaveCommand(args, api.sendSave);
}

/** 把 CLI 的 --no-stop-* 开关翻成 stop_on：默认全开，出现该开关即关闭对应项。 */
export function advanceStopOnFromArgs(parsed: ParsedArgs) {
  return {
    game_over: !hasFlag(parsed, 'no-stop-gameover'),
    under_attack: !hasFlag(parsed, 'no-stop-attack'),
    critical_alert: !hasFlag(parsed, 'no-stop-alert'),
  };
}

const ADVANCE_HELP = `advance <ticks> [options]
  <ticks>              Number of ticks to fast-forward (mutually exclusive with --to)
  --to <tick>          Fast-forward to an absolute tick
  --no-stop-attack     Do not stop when our buildings/units take damage
  --no-stop-alert      Do not stop on new critical alerts (power shortage / input shortage)
  --no-stop-gameover   Do not stop when the match ends
  --json               Print the raw response JSON

Admin only; a multiplayer game (more than one non-bot player) requires the admin role.
Only alerts that appear during the fast-forward stop it: routine line alerts
(output blocked / throughput drop / backlog) are ignored.
POST /admin/advance — see docs/dev/服务端API.md`;

export async function cmdAdvance(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return ADVANCE_HELP;
  }

  const ticksArg = parsed.positionals[0];
  const toTick = parseOptionalInteger(getStringOption(parsed, 'to'), 'to');
  if (ticksArg !== undefined && toTick !== undefined) {
    return fmtError('advance: <ticks> 与 --to 只能给一个');
  }
  let ticks: number | undefined;
  if (ticksArg !== undefined) {
    ticks = parseIntegerArg(ticksArg);
    if (ticks === undefined || ticks <= 0) {
      return fmtError('advance: <ticks> 必须是正整数');
    }
  }
  if (ticks === undefined && toTick === undefined) {
    return fmtError('advance: 需要 <ticks> 或 --to <tick>');
  }

  try {
    const result = await api.sendAdvance({
      ...(ticks !== undefined ? { ticks } : { to_tick: toTick }),
      stop_on: advanceStopOnFromArgs(parsed),
    });
    if (hasFlag(parsed, 'json')) {
      return JSON.stringify(result, null, 2);
    }
    return [
      `Fast-forward: tick ${chalk.cyan(result.start_tick.toString())} → ${chalk.cyan(result.end_tick.toString())}`,
      `Stopped: ${chalk.yellow(result.stopped_reason)} ${chalk.dim(result.detail)}`,
      `Elapsed: ${result.elapsed_ms}ms (${result.ticks_per_sec.toFixed(0)} tick/s)`,
    ].join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdAdvanceCancel(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  if (hasFlag(parsed, 'help')) {
    return `advance_cancel
  取消进行中的快进（admin）。没有快进时返回 cancelled=false。
POST /admin/advance/cancel — see docs/dev/服务端API.md`;
  }
  try {
    const result = await api.cancelAdvance();
    return result.cancelled
      ? 'Fast-forward cancelled.'
      : chalk.dim('No fast-forward in progress.');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdReplay(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `replay [options]
  --from <tick>   Start tick (default: 0)
  --to <tick>     End tick (default: current)
  --step          Single-step mode
  --speed <n>     Ticks per second
  --verify <bool> Enable verification (default: true)`;
  }

  try {
    const verify = getStringOption(parsed, 'verify');
    const result = await api.sendReplay({
      from_tick: parseOptionalInteger(getStringOption(parsed, 'from'), 'from'),
      to_tick: parseOptionalInteger(getStringOption(parsed, 'to'), 'to'),
      step: hasFlag(parsed, 'step'),
      speed: parseOptionalInteger(getStringOption(parsed, 'speed'), 'speed'),
      verify: verify !== undefined ? verify !== 'false' : hasFlag(parsed, 'verify'),
    });

    const lines: string[] = [
      `Replay: ${chalk.cyan(result.from_tick.toString())} → ${chalk.cyan(result.to_tick.toString())}`,
      `Applied: ${result.applied_ticks} ticks, ${result.command_count} commands`,
      `Duration: ${result.duration_ms}ms`,
    ];

    if ((result.result_mismatch_count ?? 0) > 0) {
      lines.push(chalk.red(`Mismatches: ${result.result_mismatch_count}`));
    } else if (result.result_mismatch_count !== undefined) {
      lines.push(chalk.green('No mismatches'));
    }

    if (result.drift_detected) {
      lines.push(chalk.red('DRIFT DETECTED'));
    } else if (result.drift_detected !== undefined) {
      lines.push(chalk.green('No drift'));
    }

    lines.push(`Digest hash: ${chalk.dim(result.digest.hash.slice(0, 16))}...`);
    if (result.notes && result.notes.length > 0) {
      lines.push(...result.notes.map(note => chalk.dim(note)));
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdRollback(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `rollback [options]
  --to <tick>   Target tick (default: current)`;
  }

  try {
    const result = await api.sendRollback({
      to_tick: parseOptionalInteger(getStringOption(parsed, 'to'), 'to'),
    });

    const lines: string[] = [
      `Rollback: ${chalk.cyan(result.from_tick.toString())} → ${chalk.cyan(result.to_tick.toString())}`,
      `Applied: ${result.applied_ticks} ticks, ${result.command_count} commands`,
      `Duration: ${result.duration_ms}ms`,
      `Trimmed: ${result.trimmed_command_log} log, ${result.trimmed_event_history} events, ${result.trimmed_snapshots} snapshots`,
    ];
    if (result.notes && result.notes.length > 0) {
      lines.push(...result.notes.map(note => chalk.dim(note)));
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}
