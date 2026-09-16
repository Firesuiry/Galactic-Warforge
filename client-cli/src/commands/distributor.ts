import { cmdConfigureDistributor, cmdConfigureMechaLogistics, cmdInstallLogisticsBot, cmdUninstallLogisticsBot } from '../api.js';
import { fmtCommandResponse, fmtError } from '../format.js';
import { parseArgs } from './args.js';
import type { DistributorConfig, MechaLogisticsRequest } from '../types.js';

function integer(raw: string | undefined) {
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('数量必须为非负整数');
  return Number(raw);
}
export async function configureDistributor(args: string[]) {
  const { positionals: p, options } = parseArgs(args);
  if (p.length !== 4 || args.includes('--help')) return fmtError('Usage: configure_distributor <id> <item_id|none> <none|supply|demand> <local_storage> [--delivery true|false] [--collection true|false]');
  try {
    for (const [k, v] of Object.entries(options)) if (!['delivery', 'collection'].includes(k) || !['true', 'false'].includes(String(v))) throw new Error('开关必须为 --delivery/--collection true|false');
    if (!['none', 'supply', 'demand'].includes(p[2])) throw new Error('无效配送模式');
    return fmtCommandResponse(await cmdConfigureDistributor(p[0], { item_id: p[1] === 'none' ? '' : p[1], mode: p[2] as DistributorConfig['mode'], local_storage: integer(p[3]), player_delivery_enabled: options.delivery === undefined ? undefined : options.delivery === 'true' || options.delivery === true, player_collection_enabled: options.collection === undefined ? undefined : options.collection === 'true' || options.collection === true }));
  } catch (e) { return fmtError(String(e)); }
}
export async function installBot(args: string[]) {
  const { positionals: p, options } = parseArgs(args);
  if (p.length !== 2 || args.includes('--help')) return fmtError('Usage: install_logistics_bot <distributor_id> <quantity> [--source player|storage]');
  try {
    if (Object.keys(options).some(k => k !== 'source')) throw new Error('无效选项');
    const source = options.source ?? 'player';
    if (source !== 'player' && source !== 'storage') throw new Error('source 必须为 player 或 storage');
    const n = integer(p[1]); if (!n) throw new Error('quantity 必须大于零');
    return fmtCommandResponse(await cmdInstallLogisticsBot(p[0], n, source));
  } catch (e) { return fmtError(String(e)); }
}
export async function uninstallBot(args: string[]) {
  if (args.length !== 2 || args.includes('--help')) return fmtError('Usage: uninstall_logistics_bot <distributor_id> <quantity>');
  try { const n = integer(args[1]); if (!n) throw new Error('quantity 必须大于零'); return fmtCommandResponse(await cmdUninstallLogisticsBot(args[0], n)); }
  catch (e) { return fmtError(String(e)); }
}
export async function configureMechaLogistics(args: string[]) {
  if (args.length !== 2 || args.includes('--help')) return fmtError('Usage: configure_mecha_logistics <unit_id> <item:min:max,...|none>');
  try {
    const requests: Record<string, MechaLogisticsRequest> = {};
    if (args[1] !== 'none') for (const token of args[1].split(',')) {
      const [item, low, high, extra] = token.split(':');
      if (!item || extra !== undefined || requests[item]) throw new Error('物品设置必须为不重复的 item:min:max');
      const min = integer(low), max = integer(high);
      if (min > max || max < 1 || max > 1000) throw new Error('需要 0 <= min <= max <= 1000，max > 0');
      requests[item] = { min, max };
    }
    if (Object.keys(requests).length > 8) throw new Error('最多 8 种物品');
    return fmtCommandResponse(await cmdConfigureMechaLogistics(args[0], requests));
  } catch (e) { return fmtError(String(e)); }
}
