import chalk from 'chalk';

import type { MechaView } from '../types.js';
import { NO_MECHA_HINT, selectMyMecha, sortMechas } from '../mecha.js';
import { fmtCommandResponse, fmtError } from './format.js';
import { resolveIssuerId, type CommandContext } from './game-commands.js';

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
}

function fmtMechaTable(mechas: MechaView[], issuerId: string): string {
  if (mechas.length === 0) {
    return `${chalk.dim('本方没有机甲。')}\n在基站生产：produce <hq_id> executor（成本：铁块16、齿轮8、磁线圈8、电路板8）`;
  }
  const headers = ['ID', 'Planet', 'Operator', 'Alive', 'Slots', 'Construction'];
  const rows = mechas.map((mecha) => [
    mecha.operator === issuerId ? chalk.bold(mecha.unit_id) : mecha.unit_id,
    mecha.planet_id,
    mecha.operator || chalk.dim('(idle)'),
    mecha.alive ? chalk.green('yes') : chalk.red(`no (respawn tick ${mecha.respawn_at_tick})`),
    `${mecha.inventory_slots_used}/${mecha.inventory_slots_total}`,
    `${mecha.construction_active}/${mecha.construction_pending}`,
  ]);
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i].length)));
  const line = (cols: string[]) => cols.map((col, i) => pad(col, widths[i])).join('  ');
  return [chalk.bold(line(headers)), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

export async function cmdMecha(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const sub = (args[0] ?? 'list').toLowerCase();
  const issuerId = resolveIssuerId(ctx);
  if (args.includes('--help') || sub === 'help') {
    return 'Usage: mecha list | mecha assign <mecha_id> [operator] | mecha assign <mecha_id> --release';
  }
  try {
    if (sub === 'list') {
      const summary = await api.fetchSummary();
      const mechas = sortMechas(summary.players?.[api.getAuth().playerId]?.mechas);
      const mine = selectMyMecha({ mechas }, issuerId);
      const lines = [fmtMechaTable(mechas, issuerId)];
      lines.push(mine
        ? `我的机甲（${issuerId}）：${mine.unit_id} @${mine.planet_id}`
        : chalk.yellow(`当前发令者 ${issuerId} ${NO_MECHA_HINT}`));
      return lines.join('\n');
    }
    if (sub === 'assign') {
      const mechaId = args[1];
      const release = args.includes('--release');
      const operatorArg = args.slice(2).find((arg) => !arg.startsWith('--'));
      if (!mechaId || (release && operatorArg)) {
        return fmtError('Usage: mecha assign <mecha_id> [operator] | mecha assign <mecha_id> --release');
      }
      const operator = release ? '' : (operatorArg ?? issuerId);
      const response = await api.cmdAssignMecha(mechaId, operator);
      const note = operator
        ? `${mechaId} 已绑给 ${operator}`
        : `${mechaId} 已解绑（空闲）`;
      return `${fmtCommandResponse(response)}\n${note}`;
    }
    return fmtError(`未知子命令: ${sub}（mecha list | mecha assign <mecha_id> [operator] | mecha assign <mecha_id> --release）`);
  } catch (error) {
    return fmtError(error instanceof Error ? error.message : String(error));
  }
}
