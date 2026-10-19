import chalk from 'chalk';

import type { MechaView } from '../types.js';
import { NO_MECHA_HINT, selectMyMecha, sortMechas } from '../mecha.js';
import { fmtCommandResponse, fmtError, table } from './format.js';
import { resolveIssuerId, type CommandContext } from './game-commands.js';

const USAGE = 'Usage: mecha list | mecha assign <mecha_id> [operator] | mecha assign <mecha_id> --release';

/** 空表提示：造价从 /catalog 的 executor 条目读，不在客户端写死（调平衡不会漂移）。 */
async function emptyMechaHint(api: CommandContext['api']): Promise<string> {
  const lines = [chalk.dim('本方没有机甲。')];
  try {
    const catalog = await api.fetchCatalog();
    const executor = catalog.world_units?.find((entry) => entry.id === 'executor');
    const items = new Map((catalog.items ?? []).map((item) => [item.id, item.name]));
    const cost = (executor?.cost ?? [])
      .map((item) => `${items.get(item.item_id) ?? item.item_id} ${item.quantity}`)
      .join('、');
    lines.push(cost
      ? `在基站生产：produce <hq_id> executor（成本：${cost}）`
      : '在基站生产：produce <hq_id> executor（成本见 catalog）');
  } catch {
    // 服务端不可达时只给命令，不给可能过期的数字。
    lines.push('在基站生产：produce <hq_id> executor（成本见 catalog）');
  }
  return lines.join('\n');
}

function fmtMechaTable(mechas: MechaView[], issuerId: string): string {
  const headers = ['ID', 'Planet', 'Operator', 'Alive', 'Slots', 'Construction'];
  // 单元格先给纯文本算列宽，着色在补齐之后（见 format.table）。
  const rows = mechas.map((mecha) => [
    mecha.unit_id,
    mecha.planet_id,
    mecha.operator || '(idle)',
    mecha.alive ? 'yes' : `no (respawn tick ${mecha.respawn_at_tick})`,
    `${mecha.inventory_slots_used}/${mecha.inventory_slots_total}`,
    `${mecha.construction_active}/${mecha.construction_pending}`,
  ]);
  return table(headers, rows, (col, value, rowIndex) => {
    const mecha = mechas[rowIndex];
    if (col === 0) return mecha.operator === issuerId ? chalk.bold(value) : value;
    if (col === 2) return mecha.operator ? value : chalk.dim(value);
    if (col === 3) return mecha.alive ? chalk.green(value) : chalk.red(value);
    return value;
  });
}

/** 回执里是否真的执行成功：以服务端结论为准，客户端预期不能替代它。 */
function assignSucceeded(response: { accepted: boolean; results?: Array<{ status?: string }> }): boolean {
  const results = response.results ?? [];
  return response.accepted && results.length > 0
    && results.every((result) => result.status === 'executed' || result.status === 'accepted');
}

function rejectionReason(response: { results?: Array<{ message?: string; code?: string }> }): string {
  return (response.results ?? [])
    .map((result) => result.message || result.code)
    .filter(Boolean)
    .join('；');
}

export async function cmdMecha(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const sub = (args[0] ?? 'list').toLowerCase();
  const issuerId = resolveIssuerId(ctx);
  if (args.includes('--help') || sub === 'help') {
    return USAGE;
  }
  try {
    if (sub === 'list') {
      const summary = await api.fetchSummary();
      const mechas = sortMechas(summary.players?.[api.getAuth().playerId]?.mechas);
      const mine = selectMyMecha({ mechas }, issuerId);
      const lines = [mechas.length === 0 ? await emptyMechaHint(api) : fmtMechaTable(mechas, issuerId)];
      lines.push(mine
        ? `我的机甲（${issuerId}）：${mine.unit_id} @${mine.planet_id}`
        : chalk.yellow(`当前发令者 ${issuerId} ${NO_MECHA_HINT}`));
      return lines.join('\n');
    }
    if (sub === 'assign') {
      // 位置参数：assign <mecha_id> [operator]；`--release` 与 operator 互斥，未知选项直接报错。
      const positionals: string[] = [];
      let release = false;
      for (const arg of args.slice(1)) {
        if (arg === '--release') {
          if (release) return fmtError(`${USAGE}\n--release 只能出现一次`);
          release = true;
          continue;
        }
        if (arg.startsWith('--')) {
          return fmtError(`${USAGE}\n未知选项: ${arg}`);
        }
        positionals.push(arg);
      }
      if (positionals.length === 0 || positionals.length > 2) {
        return fmtError(positionals.length > 2
          ? `${USAGE}\n参数过多: ${positionals.slice(2).join(' ')}`
          : USAGE);
      }
      if (release && positionals.length > 1) {
        return fmtError(`${USAGE}\n--release 不接受 operator`);
      }
      const [mechaId, operatorArg] = positionals;
      const operator = release ? '' : (operatorArg ?? issuerId);
      const response = await api.cmdAssignMecha(mechaId, operator);
      if (!assignSucceeded(response)) {
        // 服务端拒绝时只打回执，不打印「已绑给」。
        return `${fmtCommandResponse(response)}\n${chalk.red(`绑定未生效：${rejectionReason(response) || '服务端拒绝'}`)}`;
      }
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
