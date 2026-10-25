import type { ApiClient } from '../api.js';
import { NO_MECHA_HINT, selectMyMecha } from '../mecha.js';
import type { Building, CatalogView, ItemInventory } from '../types.js';
import { getStringOption, parseArgs } from './args.js';
import { buildingName } from './catalog-format.js';
import { fmtError, fmtFailure, fmtOk } from './format.js';
import { resolveIssuerId, type CommandContext } from './game-commands.js';
import { fetchPlanetContext } from './scene-context.js';

/**
 * 批量搬运：`feed` 把背包里的物料累计装入建筑，`drain` 把建筑里的成品取空/转运。
 *
 * 这两条命令存在的理由（试玩 1025 A/B 段）：一个矩阵制造台的原料要分十几轮
 * `transfer` 才能装满（输入窗口只有 8 个），熔炉出料缓冲 8 个、不接出料汇时
 * 每 ~50 tick 就得手工 `transfer --take` 一次。命令把「反复搬同一批货」原子化：
 * 计数只看**机甲背包的增减量**（服务端只扣实际装入量），不解析回执文案；
 * `STORAGE_FULL` 视为「暂时装不下」，`--wait` 时等建筑消耗后继续。
 */
const DEFAULT_TIMEOUT_SECONDS = 120;
const POLL_INTERVAL_MS = 1000;
/** 单条 transfer_item 的执行等待（受理后的下一 tick 执行 + /audit 轮询）。 */
const EXEC_TIMEOUT_MS = 15_000;
/** 等执行结果的审计轮询间隔：执行在下一 tick，100ms 轮询能把单次搬运压到 ~0.2s。 */
const EXEC_POLL_INTERVAL_MS = 100;
/** 单条命令的搬运次数上限：防服务端持续产出/持续消耗导致的死循环。 */
const MAX_TRANSFERS = 200;

interface ItemSpec {
  itemId: string;
  /** 累计要装入/取出的数量；undefined = 装到当前窗口上限 / 取到空。 */
  count?: number;
}

/** 测试注入的时钟（waitOptions 同源），生产用 Date.now / setTimeout。 */
interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

function clockOf(ctx: CommandContext): Clock {
  return {
    now: ctx.waitOptions?.now ?? Date.now,
    sleep: ctx.waitOptions?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fmtSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

function findUnknownOption(parsed: { options: Record<string, string | boolean> }, allowed: string[]): string | undefined {
  return Object.keys(parsed.options).find((key) => !allowed.includes(key));
}

/** `magnetic_coil:20,circuit_board:20` → 结构化列表；非法写法返回错误文案。 */
function parseItemSpecs(raw: string): ItemSpec[] | string {
  const specs: ItemSpec[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    const [itemId, countRaw, ...rest] = trimmed.split(':');
    if (!trimmed || rest.length > 0 || !itemId) {
      return `物品写法错误：「${trimmed}」（形如 magnetic_coil:20,circuit_board:20）`;
    }
    if (seen.has(itemId)) {
      return `同一物品重复出现：${itemId}`;
    }
    seen.add(itemId);
    if (countRaw === undefined) {
      specs.push({ itemId });
      continue;
    }
    if (!/^[1-9]\d*$/.test(countRaw)) {
      return `数量必须是正整数：「${trimmed}」（收到 ${countRaw || '空'}）`;
    }
    specs.push({ itemId, count: Number(countRaw) });
  }
  return specs;
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

interface ExecOutcome {
  ok: boolean;
  code: string;
  message: string;
}

/** 发一条 transfer_item 并等它的**执行结果**（不能只看 ACCEPTED）。 */
async function runTransfer(
  api: ApiClient,
  clock: Clock,
  buildingId: string,
  itemId: string,
  quantity: number,
  direction: 'to_building' | 'to_player',
  planetId: string | undefined,
): Promise<ExecOutcome> {
  const response = await api.cmdTransferItem(buildingId, itemId, quantity, planetId, direction);
  const rejected = response.results?.[0];
  if (!response.accepted) {
    return { ok: false, code: rejected?.code ?? 'REJECTED', message: rejected?.message ?? '服务端拒绝该命令' };
  }
  const awaited = await api.awaitExecution(response.request_id, 1, {
    timeoutMs: EXEC_TIMEOUT_MS,
    pollIntervalMs: EXEC_POLL_INTERVAL_MS,
    now: clock.now,
    sleep: clock.sleep,
  });
  const outcome = awaited.outcomes[0];
  if (!outcome) {
    return {
      ok: false,
      code: 'EXECUTION_TIMEOUT',
      message: `执行结果未在 ${fmtSeconds(EXEC_TIMEOUT_MS)}s 内返回（tick 是否在走？）`,
    };
  }
  return { ok: outcome.status === 'executed', code: outcome.code, message: outcome.message };
}

interface Backpack {
  inventory: ItemInventory;
  slotsUsed: number;
  slotsTotal: number;
}

async function fetchBackpack(api: ApiClient, issuerId: string, planetId: string | undefined): Promise<Backpack | undefined> {
  const summary = await api.fetchSummary();
  const mecha = selectMyMecha(summary.players?.[api.getAuth().playerId], issuerId, planetId);
  if (!mecha) {
    return undefined;
  }
  return {
    inventory: mecha.inventory ?? {},
    slotsUsed: mecha.inventory_slots_used,
    slotsTotal: mecha.inventory_slots_total,
  };
}

async function tryInspect(api: ApiClient, planetId: string, buildingId: string): Promise<Building | undefined> {
  try {
    const inspect = await api.fetchPlanetInspect(planetId, { entityKind: 'building', entityId: buildingId });
    return inspect.building;
  } catch (error) {
    // 建筑不存在时 inspect 回 404；把它折叠成 undefined（由调用方给失败回执）。
    if (error instanceof Error && /not found/i.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

/** 建筑里当前可取出的物品（主库存 + 输出缓冲，与服务端 to_player 的取货口径一致）。 */
function drainableQuantities(building: Building): ItemInventory {
  const out: ItemInventory = {};
  for (const bucket of [building.storage?.inventory, building.storage?.output_buffer]) {
    for (const [itemId, quantity] of Object.entries(bucket ?? {})) {
      if (quantity > 0) {
        out[itemId] = (out[itemId] ?? 0) + quantity;
      }
    }
  }
  return out;
}

function itemLabel(catalog: CatalogView, itemId: string): string {
  return catalog.items?.find((entry) => entry.id === itemId)?.name ?? itemId;
}

function buildingLabelOf(catalog: CatalogView, building: Building | undefined, fallbackId: string): string {
  return building ? buildingName(catalog, building.type) : fallbackId;
}

/** 装入进度文案：有目标写 `名称 已装/目标`，`--fill` 项写 `名称 已装 个`。 */
function feedProgressText(catalog: CatalogView, specs: ItemSpec[], loaded: Map<string, number>): string {
  return specs
    .map((spec) => {
      const count = loaded.get(spec.itemId) ?? 0;
      const name = itemLabel(catalog, spec.itemId);
      return spec.count === undefined ? `${name} ${count} 个` : `${name} ${count}/${spec.count}`;
    })
    .join('、');
}

function feedShortfallText(catalog: CatalogView, specs: ItemSpec[], loaded: Map<string, number>): string {
  const short = specs
    .filter((spec) => spec.count !== undefined && (loaded.get(spec.itemId) ?? 0) < spec.count)
    .map((spec) => `${itemLabel(catalog, spec.itemId)} ${spec.count! - (loaded.get(spec.itemId) ?? 0)}`);
  return short.length > 0 ? `还差${short.join('、')}` : '';
}

/**
 * `feed <building_id> <item_id>[:<count>][,...] [--wait] [--fill] [--timeout <秒>] [--planet <planet_id>]`
 *
 * 计数口径：**机甲背包里该物品的减少量**（服务端只扣实际装入量），与回执文案无关。
 * 省略数量（或 `--fill`）时一次装到当前窗口上限；`--wait` 时窗口满了睡 1 秒等建筑消耗。
 */
export async function cmdFeed(args: string[], ctx: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const unknown = findUnknownOption(parsed, ['wait', 'fill', 'timeout', 'planet']);
  if (unknown) {
    return fmtError(`未知选项：--${unknown}`);
  }
  const [buildingId, itemListRaw, ...extra] = parsed.positionals;
  if (!buildingId || !itemListRaw || extra.length > 0) {
    return fmtError('用法：feed <建筑ID> <物品ID>[:数量][,物品ID[:数量]…] [--wait] [--fill] [--timeout <秒>] [--planet <行星ID>]');
  }
  const parsedSpecs = parseItemSpecs(itemListRaw);
  if (typeof parsedSpecs === 'string') {
    return fmtError(parsedSpecs);
  }
  const specs = parsedSpecs;
  const wait = parsed.options.wait === true;
  const fill = parsed.options.fill === true;
  if (wait && fill) {
    return fmtError('--wait 与 --fill 不能同时使用');
  }
  if (fill && specs.some((spec) => spec.count !== undefined)) {
    return fmtError('--fill 只装到当前窗口上限，不能再写数量');
  }
  if (wait && specs.some((spec) => spec.count === undefined)) {
    return fmtError('--wait 要求每项都写数量（形如 magnetic_coil:20）');
  }
  const timeout = parseTimeout(parsed);
  if (typeof timeout === 'string') {
    return timeout;
  }

  const { api } = ctx;
  const issuerId = resolveIssuerId(ctx);
  const clock = clockOf(ctx);
  try {
    const planetId = getStringOption(parsed, 'planet') ?? (await fetchPlanetContext(api, issuerId)).planetId;
    const catalog = await api.fetchCatalog();
    const backpack = await fetchBackpack(api, issuerId, planetId);
    if (!backpack) {
      return fmtError(NO_MECHA_HINT);
    }
    const source = await tryInspect(api, planetId, buildingId);
    if (!source) {
      // 建筑不存在/已拆：让服务端给原文，不自己猜。
      const outcome = await runTransfer(api, clock, buildingId, specs[0].itemId, specs[0].count ?? 1, 'to_building', planetId);
      return fmtFailure(`未装入 ${buildingId}：${outcome.message}`);
    }
    const target = buildingLabelOf(catalog, source, buildingId);

    const loaded = new Map<string, number>();
    const filled = new Set<string>();
    // 单项的致命错误（类型拒收/建筑被拆等）：记下来继续搬其它项，最后汇总失败。
    const errors = new Map<string, string>();
    const startedAt = clock.now();
    let inventory = backpack.inventory;
    let transfers = 0; // 实际搬成功的次数（回执用）
    let attempts = 0; // 含被 STORAGE_FULL 挡回的尝试（上限用）
    let blockReason = '';

    const isDone = (spec: ItemSpec): boolean => {
      if (spec.count !== undefined) {
        return (loaded.get(spec.itemId) ?? 0) >= spec.count;
      }
      return filled.has(spec.itemId);
    };
    const errorsText = (): string =>
      [...errors].map(([itemId, message]) => `${itemLabel(catalog, itemId)}：${message}`).join('；');
    const failure = (detail: string): string =>
      `已装入 ${target}：${feedProgressText(catalog, specs, loaded)}（${[errorsText(), detail].filter(Boolean).join('；')}）`;

    for (;;) {
      blockReason = '';
      let progressed = false;
      let missing: string[] = [];
      for (const spec of specs) {
        if (isDone(spec) || errors.has(spec.itemId)) {
          continue;
        }
        const before = inventory[spec.itemId] ?? 0;
        if (before <= 0) {
          missing.push(itemLabel(catalog, spec.itemId));
          continue;
        }
        const targetLeft = spec.count !== undefined ? spec.count - (loaded.get(spec.itemId) ?? 0) : before;
        const quantity = Math.min(before, targetLeft);
        if (quantity <= 0) {
          continue;
        }
        const outcome = await runTransfer(api, clock, buildingId, spec.itemId, quantity, 'to_building', planetId);
        attempts += 1;
        if (outcome.ok) {
          transfers += 1;
          inventory = (await fetchBackpack(api, issuerId, planetId))?.inventory ?? inventory;
          loaded.set(spec.itemId, (loaded.get(spec.itemId) ?? 0) + (before - (inventory[spec.itemId] ?? 0)));
          if (spec.count === undefined) {
            filled.add(spec.itemId);
          }
          progressed = true;
          continue;
        }
        if (outcome.code === 'STORAGE_FULL') {
          // 暂时装不下：等建筑消耗（--wait）或直接把差额与「加 --wait」一起报给玩家。
          blockReason = outcome.message;
          continue;
        }
        errors.set(spec.itemId, outcome.message);
      }

      if (errors.size > 0) {
        return fmtFailure(failure(feedShortfallText(catalog, specs, loaded) || '装入失败'));
      }
      if (specs.every(isDone)) {
        return fmtOk(
          `已装入 ${target}：${feedProgressText(catalog, specs, loaded)}（共 ${transfers} 次搬运，用 ${fmtSeconds(clock.now() - startedAt)} 秒）`,
        );
      }
      if (attempts >= MAX_TRANSFERS) {
        return fmtFailure(failure(`超过 ${MAX_TRANSFERS} 次尝试仍未完成`));
      }
      if (!wait) {
        const detail = feedFailureDetail(
          catalog,
          specs,
          loaded,
          blockReason || (missing.length > 0 ? `背包里没有「${missing.join('」「')}」` : ''),
          false,
        );
        return fmtFailure(failure(detail || '装入未完成'));
      }
      if (missing.length > 0) {
        // 背包里已经没货了，再等也不会有进展。
        return fmtFailure(failure(`背包里没有「${missing.join('」「')}」了，先补货再来`));
      }
      if (clock.now() - startedAt >= timeout * 1000) {
        const detail = feedFailureDetail(catalog, specs, loaded, blockReason, true);
        return fmtFailure(failure(`超时 ${timeout}s${detail ? `：${detail}` : ''}`));
      }
      if (!progressed && !blockReason) {
        return fmtFailure(failure('这一轮没有任何进展'));
      }
      // 有进展就立刻再试（窗口刚腾出空位）；只有被 STORAGE_FULL 挡住时才睡 1 秒。
      if (!progressed) {
        await clock.sleep(POLL_INTERVAL_MS);
      }
    }
  } catch (error) {
    return fmtError(errorMessage(error));
  }
}

function feedFailureDetail(catalog: CatalogView, specs: ItemSpec[], loaded: Map<string, number>, reason: string, wait: boolean): string {
  const shortfall = feedShortfallText(catalog, specs, loaded);
  const hint = !wait && shortfall ? '加 --wait 等消耗' : '';
  return [shortfall, reason, hint].filter(Boolean).join('；');
}

/**
 * `drain <building_id> [item_id[:<count>][,...]] [--to <building_id>] [--timeout <秒>] [--planet <planet_id>]`
 *
 * 不带物品列表时取空建筑当前所有 `inventory + output_buffer` 里的物品（每轮重读，
 * 兼容持续产出）。不带 `--to` 取进机甲背包；带 `--to` 经背包中转装进目标建筑，
 * 目标满（`STORAGE_FULL`）时睡 1 秒重试直到超时。
 */
export async function cmdDrain(args: string[], ctx: CommandContext): Promise<string> {
  const parsed = parseArgs(args);
  const unknown = findUnknownOption(parsed, ['to', 'timeout', 'planet']);
  if (unknown) {
    return fmtError(`未知选项：--${unknown}`);
  }
  const [buildingId, itemListRaw, ...extra] = parsed.positionals;
  if (!buildingId || extra.length > 0) {
    return fmtError('用法：drain <建筑ID> [物品ID[:数量][,物品ID[:数量]…]] [--to <目标建筑ID>] [--timeout <秒>] [--planet <行星ID>]');
  }
  const specs: ItemSpec[] = [];
  if (itemListRaw !== undefined) {
    const parsedSpecs = parseItemSpecs(itemListRaw);
    if (typeof parsedSpecs === 'string') {
      return fmtError(parsedSpecs);
    }
    specs.push(...parsedSpecs);
  }
  if (parsed.options.to !== undefined && typeof parsed.options.to !== 'string') {
    return fmtError('--to 需要一个建筑 ID');
  }
  const toBuildingId = getStringOption(parsed, 'to');
  const timeout = parseTimeout(parsed);
  if (typeof timeout === 'string') {
    return timeout;
  }

  const { api } = ctx;
  const issuerId = resolveIssuerId(ctx);
  const clock = clockOf(ctx);
  try {
    const planetId = getStringOption(parsed, 'planet') ?? (await fetchPlanetContext(api, issuerId)).planetId;
    const catalog = await api.fetchCatalog();
    const initial = await fetchBackpack(api, issuerId, planetId);
    if (!initial) {
      return fmtError(NO_MECHA_HINT);
    }
    const sourceInitial = await tryInspect(api, planetId, buildingId);
    if (!sourceInitial) {
      if (specs.length > 0) {
        const outcome = await runTransfer(api, clock, buildingId, specs[0].itemId, specs[0].count ?? 1, 'to_player', planetId);
        return fmtFailure(`未取出 ${buildingId}：${outcome.message}`);
      }
      return fmtFailure(`未取出 ${buildingId}：建筑不存在（可能已被拆除）`);
    }
    const sourceLabel = buildingLabelOf(catalog, sourceInitial, buildingId);
    let targetLabel = '';
    if (toBuildingId) {
      const target = await tryInspect(api, planetId, toBuildingId);
      if (!target) {
        return fmtFailure(`未转运 ${sourceLabel}：目标建筑 ${toBuildingId} 不存在（可能已被拆除）`);
      }
      targetLabel = buildingLabelOf(catalog, target, toBuildingId);
    }

    const taken = new Map<string, number>();
    const attempted = new Set<string>();
    const startedAt = clock.now();
    let inventory = initial.inventory;
    let transfers = 0; // 实际搬成功的次数（回执用）
    let attempts = 0; // 含被 STORAGE_FULL 挡回的尝试（上限用）
    // --to 时单项的致命错误（目标不收/参数错）：记下来继续转运其它项，最后汇总失败。
    const errors = new Map<string, string>();

    const specFor = (itemId: string): ItemSpec | undefined => specs.find((spec) => spec.itemId === itemId);
    const takenCount = (itemId: string): number => taken.get(itemId) ?? 0;
    /** 该项是否已经不需要再搬（按「源里还剩多少」+「已取出多少」判断）。 */
    const needsMore = (itemId: string, remaining: number): boolean => {
      const spec = specFor(itemId);
      if (remaining <= 0) {
        // 指定物品从没取到过任何货：交给服务端给原文（「…里没有可取出的…」）。
        return spec !== undefined && !attempted.has(itemId);
      }
      if (!spec || spec.count === undefined) {
        return true;
      }
      return takenCount(itemId) < spec.count;
    };

    const drainProgressText = (): string =>
      (specs.length > 0 ? specs.map((spec) => spec.itemId) : [...taken.keys()])
        .filter((itemId) => takenCount(itemId) > 0 || specFor(itemId) !== undefined)
        .map((itemId) => {
          const spec = specFor(itemId);
          const name = itemLabel(catalog, itemId);
          return spec?.count !== undefined ? `${name} ${takenCount(itemId)}/${spec.count}` : `${name} ${takenCount(itemId)} 个`;
        })
        .join('、');

    const successText = (): string => {
      const totals = drainProgressText();
      // count 大于源库存时取到空即算完成，回执注明源已空（玩家不会以为少给了）。
      const emptied = specs.some((spec) => spec.count !== undefined && takenCount(spec.itemId) < spec.count);
      const note = emptied ? '（源已空）' : '';
      if (toBuildingId) {
        return `已转运 ${sourceLabel} → ${targetLabel}：${totals}${note}（共 ${transfers} 次，用 ${fmtSeconds(clock.now() - startedAt)} 秒）`;
      }
      return `已取出 ${sourceLabel}：${totals}${note}（${transfers} 次，用 ${fmtSeconds(clock.now() - startedAt)} 秒）`;
    };

    const failureText = (reason: string, extraNote = ''): string =>
      `${toBuildingId ? '已转运' : '已取出'} ${sourceLabel}${toBuildingId ? ` → ${targetLabel}` : ''}：${drainProgressText()}${extraNote ? `（${extraNote}）` : ''}（${reason}）`;

    for (;;) {
      const source = await tryInspect(api, planetId, buildingId);
      if (!source) {
        return fmtFailure(failureText('源建筑已不存在（可能已被拆除）'));
      }
      const available = drainableQuantities(source);
      const itemIds = specs.length > 0 ? specs.map((spec) => spec.itemId) : Object.keys(available).filter((itemId) => (available[itemId] ?? 0) > 0);
      const pending = itemIds.filter((itemId) => !errors.has(itemId) && needsMore(itemId, available[itemId] ?? 0));
      if (pending.length === 0) {
        if (specs.length > 0 || [...taken.keys()].length > 0) {
          return fmtOk(successText());
        }
        return fmtFailure(`未取出 ${sourceLabel}：建筑里没有可取出的物品`);
      }
      items: for (const itemId of pending) {
        const name = itemLabel(catalog, itemId);
        const spec = specFor(itemId);
        const remaining = available[itemId] ?? 0;
        if (remaining <= 0) {
          const outcome = await runTransfer(api, clock, buildingId, itemId, 1, 'to_player', planetId);
          return fmtFailure(failureText(outcome.message));
        }
        if (!toBuildingId) {
          // 直接取进背包。
          const before = inventory[itemId] ?? 0;
          const targetLeft = spec?.count !== undefined ? spec.count - takenCount(itemId) : remaining;
          const quantity = Math.min(remaining, targetLeft);
          const outcome = await runTransfer(api, clock, buildingId, itemId, quantity, 'to_player', planetId);
          attempts += 1;
          if (!outcome.ok) {
            return fmtFailure(
              failureText(
                `${name} 已取出 ${takenCount(itemId)} 个后${outcome.message}；源里还剩 ${remaining} 个`,
              ),
            );
          }
          inventory = (await fetchBackpack(api, issuerId, planetId))?.inventory ?? inventory;
          taken.set(itemId, takenCount(itemId) + ((inventory[itemId] ?? 0) - before));
          attempted.add(itemId);
          transfers += 1;
          if (attempts >= MAX_TRANSFERS) {
            return fmtFailure(failureText(`超过 ${MAX_TRANSFERS} 次尝试仍未取空`));
          }
          if (clock.now() - startedAt >= timeout * 1000) {
            return fmtFailure(failureText(`超时 ${timeout}s`));
          }
          continue;
        }

        // 经背包中转：先取进背包（背包里已有该物品时跳过取货），再装进目标。
        let carrying = inventory[itemId] ?? 0;
        if (carrying <= 0) {
          const targetLeft = spec?.count !== undefined ? spec.count - takenCount(itemId) : remaining;
          const quantity = Math.min(remaining, targetLeft);
          const outcome = await runTransfer(api, clock, buildingId, itemId, quantity, 'to_player', planetId);
          attempts += 1;
          if (!outcome.ok) {
            errors.set(itemId, `${name} 取货失败：${outcome.message}（源里还剩 ${remaining} 个）`);
            continue items;
          }
          inventory = (await fetchBackpack(api, issuerId, planetId))?.inventory ?? inventory;
          transfers += 1;
          carrying = inventory[itemId] ?? 0;
          if (carrying <= 0) {
            return fmtFailure(failureText(`${name} 取进背包后数量为 0`));
          }
        }
        for (;;) {
          const beforeLoad = carrying;
          const outcome = await runTransfer(api, clock, toBuildingId, itemId, beforeLoad, 'to_building', planetId);
          attempts += 1;
          if (outcome.ok) {
            transfers += 1;
            inventory = (await fetchBackpack(api, issuerId, planetId))?.inventory ?? inventory;
            taken.set(itemId, takenCount(itemId) + (beforeLoad - (inventory[itemId] ?? 0)));
            attempted.add(itemId);
            break;
          }
          if (outcome.code === 'STORAGE_FULL') {
            if (clock.now() - startedAt >= timeout * 1000) {
              return fmtFailure(
                failureText(`超时 ${timeout}s：${outcome.message}`, `背包里还剩 ${carrying} 个「${name}」`),
              );
            }
            await clock.sleep(POLL_INTERVAL_MS);
            continue;
          }
          errors.set(
            itemId,
            `${name} ${takenCount(itemId)} 个后${outcome.message}（背包里还剩 ${carrying} 个）`,
          );
          continue items;
        }
        if (attempts >= MAX_TRANSFERS) {
          return fmtFailure(failureText(`超过 ${MAX_TRANSFERS} 次尝试仍未取空`));
        }
      }
      if (errors.size > 0) {
        // 其它项照常搬完，最后按项汇总失败原因。
        return fmtFailure(failureText([...errors.values()].join('；')));
      }
    }
  } catch (error) {
    return fmtError(errorMessage(error));
  }
}
