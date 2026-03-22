import chalk from 'chalk';
import {
  fetchAudit, fetchEventSnapshot, fetchAlertSnapshot,
  sendReplay, sendRollback,
} from '../api.js';
import { fmtError } from '../format.js';
import { getStringOption, hasFlag, parseArgs, parseIntegerArg } from './args.js';

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

export async function cmdAudit(args: string[]): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `audit [options]
  --player <id>       Filter by player ID
  --issuer-type <t>   Filter by issuer type
  --issuer-id <id>    Filter by issuer ID
  --action <a>        Filter by action (command)
  --request-id <rid>  Filter by request ID
  --permission <p>    Filter by permission type
  --granted <bool>    Filter by permission granted (true/false)
  --from-tick <n>     From tick
  --to-tick <n>       To tick
  --from-time <ts>    From RFC3339 timestamp
  --to-time <ts>      To RFC3339 timestamp
  --limit <n>         Max entries
  --order <dir>       asc or desc`;
  }

  try {
    const granted = getStringOption(parsed, 'granted');
    const order = getStringOption(parsed, 'order');
    const result = await fetchAudit({
      player_id: getStringOption(parsed, 'player'),
      issuer_type: getStringOption(parsed, 'issuer-type'),
      issuer_id: getStringOption(parsed, 'issuer-id'),
      action: getStringOption(parsed, 'action'),
      request_id: getStringOption(parsed, 'request-id'),
      permission: getStringOption(parsed, 'permission'),
      permission_granted: granted !== undefined ? granted === 'true' : undefined,
      from_tick: parseOptionalInteger(getStringOption(parsed, 'from-tick'), 'from-tick'),
      to_tick: parseOptionalInteger(getStringOption(parsed, 'to-tick'), 'to-tick'),
      from_time: getStringOption(parsed, 'from-time'),
      to_time: getStringOption(parsed, 'to-time'),
      limit: parseOptionalInteger(getStringOption(parsed, 'limit'), 'limit'),
      order: order === 'asc' || order === 'desc' ? order : undefined,
    });

    if (result.entries.length === 0) {
      return chalk.dim('No audit entries found.');
    }

    const lines: string[] = [`Found ${chalk.cyan(result.count)} entries:`, ''];
    for (const entry of result.entries.slice(0, 20)) {
      const grantedText = entry.permission_granted ? chalk.green('GRANTED') : chalk.red('DENIED');
      lines.push(
        `[t${entry.tick}] ${chalk.yellow(entry.permission)} ${grantedText} by ${entry.player_id} ` +
        `(${entry.issuer_type}:${entry.issuer_id}) request=${entry.request_id}`
      );
      const detail = entry.details?.message;
      if (typeof detail === 'string' && detail) {
        lines.push(`    ${chalk.dim(detail)}`);
      }
    }
    if (result.count > 20) {
      lines.push(chalk.dim(`... and ${result.count - 20} more entries`));
    }
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function cmdEventSnapshot(args: string[]): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `event_snapshot [options]
  --after-id <id>    After event ID
  --since-tick <n>   Since tick
  --limit <n>        Max events (default 200)`;
  }

  try {
    const result = await fetchEventSnapshot({
      after_event_id: getStringOption(parsed, 'after-id'),
      since_tick: parseOptionalInteger(getStringOption(parsed, 'since-tick'), 'since-tick'),
      limit: parseOptionalInteger(getStringOption(parsed, 'limit'), 'limit'),
    });
    if (result.events.length === 0) {
      return chalk.dim('No events found.');
    }

    const lines: string[] = [
      `Events ${formatCursor(result.after_event_id, result.since_tick, 'from latest cursor')} (${result.events.length} events)`,
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

export async function cmdAlertSnapshot(args: string[]): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `alert_snapshot [options]
  --after-id <id>    After alert ID
  --since-tick <n>   Since tick
  --limit <n>        Max alerts (default 200)`;
  }

  try {
    const result = await fetchAlertSnapshot({
      after_alert_id: getStringOption(parsed, 'after-id'),
      since_tick: parseOptionalInteger(getStringOption(parsed, 'since-tick'), 'since-tick'),
      limit: parseOptionalInteger(getStringOption(parsed, 'limit'), 'limit'),
    });
    if (result.alerts.length === 0) {
      return chalk.dim('No alerts found.');
    }

    const lines: string[] = [
      `Alerts ${formatCursor(result.after_alert_id, result.since_tick, 'from latest cursor')} (${result.alerts.length} alerts)`,
      `Available from tick ${chalk.cyan(result.available_from_tick.toString())}`,
      result.has_more ? chalk.dim('(more alerts available)') : '',
      '',
    ];
    for (const alert of result.alerts.slice(-20)) {
      const severity = alert.severity === 'critical'
        ? chalk.red(alert.severity)
        : alert.severity === 'warning'
          ? chalk.yellow(alert.severity)
          : chalk.dim(alert.severity);
      lines.push(`[t${alert.tick}] ${severity} ${chalk.yellow(alert.alert_type)} ${alert.message}`);
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

export async function cmdReplay(args: string[]): Promise<string> {
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
    const result = await sendReplay({
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

export async function cmdRollback(args: string[]): Promise<string> {
  const parsed = parseArgs(args);

  if (hasFlag(parsed, 'help')) {
    return `rollback [options]
  --to <tick>   Target tick (default: current)`;
  }

  try {
    const result = await sendRollback({
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
