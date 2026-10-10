import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { ApiClient } from '../api.js';
import { getStringOption, hasFlag, parseArgs } from '@gw/shared/commands/args';
import { fmtError } from '@gw/shared/commands/format';
import type { CommandContext } from '@gw/shared/commands/game-commands';
import type { CheckpointContract, CheckpointSummary } from '@gw/shared/types';

type CheckpointApi = Pick<ApiClient, 'fetchCheckpoints' | 'saveCheckpoint' | 'loadCheckpoint'>;

const HELP = `checkpoint <subcommand> [options]

  list
      列出全部命名存档点（含来源与 stale 标记）。任意登录玩家可查。
  save <name> [--note <text>] [--contract <file.json>] [--replace]
      把当前对局存成命名存档点（仅 role=admin）。
      名字须匹配 [a-z0-9][a-z0-9-]{0,63}；以 bug- 开头即 bug 存档点（契约只记录不拦截）。
      --contract 传一份状态契约 JSON（{\\"checks\\":[{\\"kind\\":\\"tick_gte\\",\\"tick\\":1000}]}）：
      regression 存档点契约未全过时返回 400 与逐条结果，bug 存档点照存。
      --replace 覆盖同名存档点（默认同名报 409）。
  load <name>
      热加载存档点（仅 role=admin）：按存档内配置与地图拓扑重建对局并原子替换，
      读档后当前对局写入 data_dir；stale 只警告不阻止。读档后旧 key 仍有效。

谓词：tick_gte/tick_lt/game_not_finished/player_alive/tech_researched/building_count_gte/
      unit_count_gte/item_gte/dark_fog_hostile/enemy_attack_seen（可带 player 字段）。`;

function parseContract(raw: string): CheckpointContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('--contract JSON 解析失败');
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as CheckpointContract).checks)) {
    throw new Error('--contract 必须是 {"checks":[...]} 形式');
  }
  return parsed as CheckpointContract;
}

function formatSummary(item: CheckpointSummary): string {
  const tags = [item.kind === 'bug' ? chalk.red(item.kind) : chalk.green(item.kind)];
  if (item.stale) {
    tags.push(chalk.yellow('stale'));
  }
  const parent = item.parent ? ` parent=${chalk.cyan(item.parent)}` : '';
  const note = item.note ? `  ${chalk.dim(item.note)}` : '';
  return `${chalk.yellow(item.name)} [${tags.join(',')}] tick=${item.tick} seed=${item.map_seed}${parent}${note}`;
}

export async function cmdCheckpoint(args: string[], { api }: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const sub = parsed.positionals[0];

  if (hasFlag(parsed, 'help') || sub === undefined) {
    return HELP;
  }

  try {
    switch (sub) {
      case 'list':
        return await checkpointList(api);
      case 'save':
        return await checkpointSave(parsed.positionals[1], parsed.options, api);
      case 'load':
        return await checkpointLoad(parsed.positionals[1], api);
      default:
        return `Unknown checkpoint subcommand: "${sub}"\n\n${HELP}`;
    }
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}

export async function checkpointList(api: CheckpointApi): Promise<string> {
  const view = await api.fetchCheckpoints();
  const lines: string[] = [];
  lines.push(`checkpoint_dir: ${chalk.cyan(view.checkpoint_dir || '(未配置)')}`);
  lines.push(`当前对局来源: ${view.source ? chalk.cyan(view.source) : chalk.dim('(新局)')}`);
  if (view.checkpoints.length === 0) {
    lines.push(chalk.dim('（暂无存档点）'));
    return lines.join('\n');
  }
  lines.push(`${chalk.cyan(String(view.checkpoints.length))} 个存档点:`);
  for (const item of view.checkpoints) {
    lines.push(`  ${formatSummary(item)}`);
    if (item.error) {
      lines.push(`    ${chalk.red(`读取失败: ${item.error}`)}`);
    }
  }
  return lines.join('\n');
}

export async function checkpointSave(
  name: string | undefined,
  options: Record<string, string | boolean>,
  api: CheckpointApi,
): Promise<string> {
  if (!name) {
    throw new Error('用法：checkpoint save <name> [--note <text>] [--contract <file.json>] [--replace]');
  }
  const request: Parameters<CheckpointApi['saveCheckpoint']>[0] = { name };
  const note = options['note'];
  if (typeof note === 'string') {
    request.note = note;
  }
  const contractPath = options['contract'];
  if (typeof contractPath === 'string') {
    request.contract = parseContract(await readFile(contractPath, 'utf8'));
  }
  if (options['replace'] === true) {
    request.replace = true;
  }
  const summary = await api.saveCheckpoint(request);
  return [
    chalk.green(`存档点 ${summary.name} 已创建`),
    `  kind: ${summary.kind}  tick: ${chalk.cyan(String(summary.tick))}  seed: ${summary.map_seed}`,
    `  parent: ${summary.parent || chalk.dim('(无)')}  commit: ${summary.commit ? summary.commit.slice(0, 12) : '(unknown)'}${summary.dirty ? chalk.yellow(' (dirty)') : ''}`,
    `  契约: ${summary.contract_report.passed ? chalk.green('全部通过') : chalk.red('有未通过项')}`,
  ].join('\n');
}

export async function checkpointLoad(name: string | undefined, api: CheckpointApi): Promise<string> {
  if (!name) {
    throw new Error('用法：checkpoint load <name>');
  }
  const result = await api.loadCheckpoint(name);
  const lines: string[] = [
    chalk.green(`已从存档点 ${result.manifest.name} 热加载`),
    `  tick: ${chalk.cyan(String(result.game.tick))}  seed: ${result.game.map_seed}  status: ${result.game.status ?? 'running'}`,
    `  parent: ${result.manifest.parent || chalk.dim('(无)')}  started_at: ${result.game.started_at}`,
  ];
  for (const warning of result.warnings) {
    lines.push(chalk.yellow(`  警告: ${warning}`));
  }
  return lines.join('\n');
}
