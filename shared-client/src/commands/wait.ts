import chalk from 'chalk';

import type { ApiClient } from '../api.js';
import { NO_MECHA_HINT, selectMyMecha } from '../mecha.js';
import type { ConstructionTaskView, MechaJobView, MechaView } from '../types.js';
import { getStringOption, parseArgs } from './args.js';
import { fmtError, fmtOk } from './format.js';
import { resolveIssuerId, type CommandContext } from './game-commands.js';
import { fetchPlanetContext } from './scene-context.js';

/** 默认超时（秒）：手搓一批 20–60 tick、产线出货几十上百 tick，120s 覆盖绝大多数等待。 */
const DEFAULT_TIMEOUT_SECONDS = 120;
/** 轮询间隔：1 秒一次，足够跟上 tick_rate 5–20，又不会把服务端打满。 */
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** 施工任务在这段时间内签名毫无变化就提前返回（tick 停了、缺料卡死都表现为这样）。 */
const BUILD_STALL_MS = 10_000;

/** 失败行前缀：`scripts/sw` 的退出码靠它判定（见 client-cli/src/once.ts）。 */
export const WAIT_FAILURE_MARKER = '✗ ';

/** 测试注入的轮询参数；生产环境用默认的 Date.now / setTimeout。 */
export interface WaitOptions {
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface ProbeOutcome {
  /** 条件达成时的描述（不含「等到了：」前缀）。 */
  done?: string;
  /** 判定无法继续时的详情（提前返回）。 */
  stuck?: string;
  /** 提前返回的短原因（缺料 / 无进展 / 条件无法满足）。 */
  stuckReason?: string;
  /** 超时时报告的当前状况。 */
  pending: string;
}

type Probe = (tick: number) => Promise<ProbeOutcome>;

const REASON_TEXT: Record<string, string> = {
  insufficient_materials: '缺料',
  executor_concurrent_limit: '机甲施工额度已满',
  region_concurrent_limit: '区域施工额度已满',
  footprint_occupied: '占地被占',
};

function fmtFailure(text: string): string {
  return chalk.red(WAIT_FAILURE_MARKER) + text;
}

function fmtSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * 统一轮询：每轮先探测再判超时；`stuck` 优先于超时（提前返回）。
 * `startTick` 由调用方给（wait ticks 要用它算前进量），缺省读 /health。
 */
async function runWait(
  api: ApiClient,
  options: WaitOptions | undefined,
  timeoutSeconds: number,
  probe: Probe,
  startTickIn?: number,
): Promise<string> {
  const now = options?.now ?? Date.now;
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = timeoutSeconds * 1000;

  const startTick = startTickIn ?? (await api.fetchHealth()).tick;
  const startMs = now();
  let tick = startTick;

  for (;;) {
    const outcome = await probe(tick);
    const elapsedMs = now() - startMs;
    const tickDelta = Math.max(0, tick - startTick);
    if (outcome.done) {
      return fmtOk(`等到了：${outcome.done}（用了 ${tickDelta} tick / ${fmtSeconds(elapsedMs)} 秒）`);
    }
    if (outcome.stuck) {
      const reason = outcome.stuckReason ?? '条件无法满足';
      return fmtFailure(`提前返回（${reason}，tick 前进 ${tickDelta}）：${outcome.stuck}`);
    }
    if (elapsedMs >= timeoutMs) {
      return fmtFailure(`超时（${timeoutSeconds}s，tick 前进 ${tickDelta}）：${outcome.pending}`);
    }
    await sleep(interval);
    tick = (await api.fetchHealth()).tick;
  }
}

function jobText(job: MechaJobView | undefined): string {
  if (!job) {
    return '无作业';
  }
  const target = job.kind === 'mine' ? (job.resource_id ?? '?') : (job.recipe_id ?? '?');
  return `${job.kind} ${target} ×${job.remaining_batches}`;
}

function mechaOf(api: ApiClient, issuerId: string, summary: { players?: Record<string, { mechas?: MechaView[] }> }): MechaView | undefined {
  return selectMyMecha(summary.players?.[api.getAuth().playerId], issuerId);
}

async function runTicks(
  api: ApiClient,
  options: WaitOptions | undefined,
  timeout: number,
  count: number,
): Promise<string> {
  const start = (await api.fetchHealth()).tick;
  return runWait(api, options, timeout, async (tick) => {
    const advanced = Math.max(0, tick - start);
    if (advanced >= count) {
      return { done: `tick 前进 ${count}（${start} → ${tick}）`, pending: '' };
    }
    return { pending: `tick 只前进 ${advanced}/${count}` };
  }, start);
}

async function waitJob(api: ApiClient, issuerId: string, options: WaitOptions | undefined, timeout: number): Promise<string> {
  const initial = await api.fetchSummary();
  const mecha = mechaOf(api, issuerId, initial);
  if (!mecha) {
    return fmtError(NO_MECHA_HINT);
  }
  if (!mecha.job) {
    return fmtOk('等到了：当前没有作业（用了 0 tick / 0 秒）');
  }
  const initialJob = jobText(mecha.job);
  return runWait(api, options, timeout, async () => {
    const summary = await api.fetchSummary();
    const current = mechaOf(api, issuerId, summary);
    if (!current) {
      return { stuck: `我的机甲 ${mecha.unit_id} 不在 summary 里（可能已解绑或阵亡）`, stuckReason: '机甲不可用', pending: '' };
    }
    if (!current.job) {
      return { done: `我的机甲 ${current.unit_id} 完成 ${initialJob}`, pending: '' };
    }
    return { pending: `我的机甲 ${current.unit_id} 作业仍在：${jobText(current.job)}` };
  });
}

function activeTasks(tasks: ConstructionTaskView[] | undefined, mechaId: string): ConstructionTaskView[] {
  return (tasks ?? []).filter((task) =>
    task.mecha_id === mechaId && (task.state === 'pending' || task.state === 'in_progress' || task.state === 'paused'));
}

function taskLabel(task: ConstructionTaskView): string {
  const name = task.building_name ?? task.building_type;
  const pos = `${task.position.x},${task.position.y}`;
  const reason = task.wait_reason ? `，${REASON_TEXT[task.wait_reason] ?? task.wait_reason}` : '';
  return `${task.id} ${name} @(${pos})：${task.state}${reason}`;
}

function taskListText(tasks: ConstructionTaskView[]): string {
  return tasks.map((task) => `任务 ${taskLabel(task)}`).join('；');
}

function taskSignature(tasks: ConstructionTaskView[]): string {
  return tasks
    .map((task) => `${task.id}:${task.state}:${task.remaining_ticks ?? ''}:${task.wait_reason ?? ''}:${task.queue_index ?? ''}`)
    .sort()
    .join('|');
}

async function waitBuild(api: ApiClient, issuerId: string, options: WaitOptions | undefined, timeout: number): Promise<string> {
  const initial = await api.fetchSummary();
  const mecha = mechaOf(api, issuerId, initial);
  if (!mecha) {
    return fmtError(NO_MECHA_HINT);
  }
  const mechaId = mecha.unit_id;
  const planetId = mecha.planet_id;
  const now = options?.now ?? Date.now;
  let lastSignature = '';
  let lastProgressAt = now();

  return runWait(api, options, timeout, async () => {
    const runtime = await api.fetchPlanetRuntime(planetId);
    const tasks = activeTasks(runtime.construction_tasks, mechaId);
    if (tasks.length === 0) {
      return { done: `我的机甲 ${mechaId} 施工队列已清空`, pending: '' };
    }
    const allWaitingForMaterials = tasks.every(
      (task) => task.state === 'pending' && task.wait_reason === 'insufficient_materials');
    if (allWaitingForMaterials) {
      return { stuck: taskListText(tasks), stuckReason: '缺料', pending: '' };
    }
    const signature = taskSignature(tasks);
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastProgressAt = now();
    } else if (now() - lastProgressAt >= BUILD_STALL_MS) {
      return {
        stuck: `${fmtSeconds(BUILD_STALL_MS)}s 内无进展；${taskListText(tasks)}`,
        stuckReason: '施工无进展',
        pending: '',
      };
    }
    return { pending: `还有 ${tasks.length} 个施工任务：${taskListText(tasks)}` };
  });
}

function itemCount(inventory: Record<string, number> | undefined, itemId: string): number {
  return inventory?.[itemId] ?? 0;
}

async function waitItem(
  api: ApiClient,
  issuerId: string,
  itemId: string,
  quantity: number,
  buildingId: string | undefined,
  options: WaitOptions | undefined,
  timeout: number,
): Promise<string> {
  if (!buildingId) {
    const initial = await api.fetchSummary();
    const mecha = mechaOf(api, issuerId, initial);
    if (!mecha) {
      return fmtError(NO_MECHA_HINT);
    }
    return runWait(api, options, timeout, async () => {
      const summary = await api.fetchSummary();
      const current = mechaOf(api, issuerId, summary);
      if (!current) {
        return { stuck: `我的机甲 ${mecha.unit_id} 不在 summary 里`, stuckReason: '机甲不可用', pending: '' };
      }
      const count = itemCount(current.inventory, itemId);
      if (count >= quantity) {
        return { done: `我的机甲背包 ${itemId} ≥ ${quantity}（当前 ${count}）`, pending: '' };
      }
      return { pending: `背包 ${itemId} ${count}/${quantity}` };
    });
  }

  const context = await fetchPlanetContext(api, issuerId);
  return runWait(api, options, timeout, async () => {
    const inspect = await api.fetchPlanetInspect(context.planetId, { entityKind: 'building', entityId: buildingId });
    if (!inspect.building) {
      return {
        stuck: `建筑 ${buildingId} 不在 ${context.planetId}`,
        stuckReason: '建筑不存在',
        pending: '',
      };
    }
    const storage = inspect.building.storage;
    const count = itemCount(storage?.inventory, itemId) + itemCount(storage?.output_buffer, itemId);
    if (count >= quantity) {
      return { done: `建筑 ${buildingId} ${itemId} ≥ ${quantity}（当前 ${count}）`, pending: '' };
    }
    return { pending: `建筑 ${buildingId} 库存 ${itemId} ${count}/${quantity}` };
  });
}

async function waitRunning(
  api: ApiClient,
  issuerId: string,
  buildingId: string,
  options: WaitOptions | undefined,
  timeout: number,
): Promise<string> {
  const context = await fetchPlanetContext(api, issuerId);
  return runWait(api, options, timeout, async () => {
    const inspect = await api.fetchPlanetInspect(context.planetId, { entityKind: 'building', entityId: buildingId });
    if (!inspect.building) {
      return {
        stuck: `建筑 ${buildingId} 不在 ${context.planetId}`,
        stuckReason: '建筑不存在',
        pending: '',
      };
    }
    const runtime = inspect.building.runtime;
    if (runtime.state === 'running') {
      return { done: `建筑 ${buildingId} 进入 running`, pending: '' };
    }
    const reason = runtime.state_reason ? `，reason=${runtime.state_reason}` : '';
    return { pending: `建筑 ${buildingId} state=${runtime.state}${reason}` };
  });
}

function parseTimeout(parsed: { options: Record<string, string | boolean> }): number | string {
  const raw = parsed.options.timeout;
  if (raw === undefined) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  if (typeof raw !== 'string') {
    return fmtError('--timeout 需要一个秒数');
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return fmtError(`--timeout 非法（${raw}）：应为非负秒数`);
  }
  return value;
}

export async function cmdWait(args: string[], ctx: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const allowedOptions = new Set(['timeout', 'in']);
  const unknown = Object.keys(parsed.options).find((key) => !allowedOptions.has(key));
  if (unknown) {
    return fmtError(`未知选项：--${unknown}`);
  }
  const [condition, ...rest] = parsed.positionals;
  if (!condition) {
    return fmtError('用法：wait <ticks <n>|job|build|item <物品ID> <数量> [--in <建筑ID>]|running <建筑ID>> [--timeout <秒>]');
  }

  const timeout = parseTimeout(parsed);
  if (typeof timeout === 'string') {
    return timeout;
  }
  const { api } = ctx;
  const issuerId = resolveIssuerId(ctx);
  const options = ctx.waitOptions;

  switch (condition) {
    case 'ticks': {
      if (rest.length !== 1) {
        return fmtError('用法：wait ticks <n>');
      }
      const count = Number(rest[0]);
      if (!Number.isInteger(count) || count < 0) {
        return fmtError(`ticks 必须是非负整数（收到 ${rest[0]}）`);
      }
      return runTicks(api, options, timeout, count);
    }
    case 'job':
      if (rest.length !== 0) {
        return fmtError('用法：wait job [--timeout <秒>]');
      }
      return waitJob(api, issuerId, options, timeout);
    case 'build':
      if (rest.length !== 0) {
        return fmtError('用法：wait build [--timeout <秒>]');
      }
      return waitBuild(api, issuerId, options, timeout);
    case 'item': {
      const buildingId = getStringOption(parsed, 'in');
      if (parsed.options.in !== undefined && buildingId === undefined) {
        return fmtError('--in 需要一个建筑 ID');
      }
      if (rest.length !== 2) {
        return fmtError('用法：wait item <物品ID> <数量> [--in <建筑ID>] [--timeout <秒>]');
      }
      const quantity = Number(rest[1]);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return fmtError(`数量必须是正整数（收到 ${rest[1]}）`);
      }
      return waitItem(api, issuerId, rest[0], quantity, buildingId, options, timeout);
    }
    case 'running': {
      if (rest.length !== 1) {
        return fmtError('用法：wait running <建筑ID> [--timeout <秒>]');
      }
      return waitRunning(api, issuerId, rest[0], options, timeout);
    }
    default:
      return fmtError(`未知等待条件：${condition}（支持 ticks / job / build / item / running）`);
  }
}
