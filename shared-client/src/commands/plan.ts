import chalk from 'chalk';
import { createInterface } from 'node:readline';

import { NO_MECHA_HINT, selectMyMecha } from '../mecha.js';
import type {
  Building,
  BuildingCatalogEntry,
  CatalogView,
  ConstructionTaskView,
  ItemAmount,
  RecipeCatalogEntry,
} from '../types.js';
import { getStringOption, hasFlag, parseArgs, parseIntegerArg } from './args.js';
import { FAILURE_MARKER, fmtError, table } from './format.js';
import { resolveIssuerId, type CommandContext } from './game-commands.js';
import { centeredWindow, fetchPlanetContext } from './scene-context.js';

/** 计划里的一条（build / upgrade / craft_item）。 */
export interface PlanItem {
  kind: 'build' | 'upgrade' | 'craft';
  label: string;
  buildingType: string;
  /** build 的占地左上角；upgrade 不用。 */
  position?: { x: number; y: number };
  /** upgrade 的目标建筑 id。 */
  buildingId?: string;
  /** craft_item 的配方 id 与批数。 */
  recipeId?: string;
  batches?: number;
}

/** 找建筑库存时扫描的窗口边长（以机甲为中心）。 */
const PLAN_SCENE_SIZE = 48;
/** 缺口递归展开的最大层数（防止配方环）。 */
const MAX_HANDCRAFT_DEPTH = 3;

export type PlanCostLine = ItemAmount;

export interface PlanCostResult {
  /** 全部计划项合计。 */
  need: Map<string, number>;
  /** 已下未落成、尚未扣料的任务占用（本机甲）。 */
  occupied: Map<string, number>;
  /** 缺口 = max(0, 需要 + 占用 − 背包)。 */
  gaps: Map<string, number>;
}

export function sumCosts(items: PlanCostLine[], into: Map<string, number>): Map<string, number> {
  for (const item of items) {
    into.set(item.item_id, (into.get(item.item_id) ?? 0) + item.quantity);
  }
  return into;
}

/**
 * 未落成任务里「已锁定、尚未从背包扣除」的料：只有 pending/in_progress/paused
 * 且 materials_deducted=false 的才占料；已扣料的任务不会再从背包拿。
 */
export function occupiedByTasks(tasks: ConstructionTaskView[], mechaId: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!mechaId) {
    return out;
  }
  for (const task of tasks) {
    if (task.mecha_id !== mechaId) {
      continue;
    }
    if (!['pending', 'in_progress', 'paused'].includes(task.state)) {
      continue;
    }
    if (task.materials_deducted) {
      continue;
    }
    sumCosts(task.cost?.items ?? [], out);
  }
  return out;
}

export function computePlanCost(
  costs: PlanCostLine[][],
  inventory: Record<string, number>,
  occupied: Map<string, number>,
): PlanCostResult {
  const need = new Map<string, number>();
  for (const cost of costs) {
    sumCosts(cost, need);
  }
  const gaps = new Map<string, number>();
  const itemIds = new Set([...need.keys(), ...occupied.keys()]);
  for (const itemId of itemIds) {
    const available = (inventory[itemId] ?? 0) - (occupied.get(itemId) ?? 0);
    const gap = (need.get(itemId) ?? 0) - available;
    if (gap > 0) {
      gaps.set(itemId, gap);
    }
  }
  return { need, occupied, gaps };
}

/** 服务端 BuildingUpgradeCost 同口径：cost = ceil(基础造价 × 倍率 × 当前等级)，倍率缺省 1。 */
export function upgradeCost(base: PlanCostLine[], level: number): PlanCostLine[] {
  const factor = Math.max(1, level);
  return base.map((item) => ({ item_id: item.item_id, quantity: Math.ceil(item.quantity * factor) }));
}

/**
 * 把命令行拆成计划项；`;`、换行都算分隔符。
 *
 * 另外，同一条里出现下一个计划动词（build / upgrade / craft_item）时也切开，
 * 这样 `plan build 98 146 matrix_lab craft_item circuit_board 4` 能直接写。
 *
 * 按**语法位置**切：只有当前项的位置参数已经吃满（build 3 个、upgrade 1 个、
 * craft_item 2 个）之后，遇到的动词才当新计划项的开头。这样建筑/配方 id 恰好
 * 叫 `upgrade`、`build` 时（`plan build 1 1 upgrade`、`plan craft_item build 2`）
 * 不会被切错。`--rotation 90` 这类选项会跳过它的值，不会被当成动词。
 */
const PLAN_VERBS = new Set(['build', 'upgrade', 'craft_item']);
const PLAN_OPTIONS_WITH_VALUE = new Set([
  '--rotation', '--direction', '--recipe', '--z', '--elevation', '--planet',
]);
/** 每个计划动词的位置参数个数（其余 token 视为选项或选项值）。 */
const PLAN_VERB_ARITY: Record<string, number> = { build: 3, upgrade: 1, craft_item: 2 };

function splitPlanSegments(text: string): string[] {
  const segments: string[] = [];
  for (const raw of text.split(/[;\n]+/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const tokens = line.split(/\s+/);
    let current: string[] = [];
    // 当前项的位置参数个数（= 位置参数还差几个到 arity）。
    let positionals = 0;
    let skipNext = false;
    for (const token of tokens) {
      if (skipNext) {
        current.push(token);
        skipNext = false;
        continue;
      }
      const arity = PLAN_VERB_ARITY[current[0] ?? ''];
      if (PLAN_VERBS.has(token) && current.length > 0 && arity !== undefined && positionals >= arity) {
        segments.push(current.join(' '));
        current = [token];
        positionals = 0;
        continue;
      }
      // 段的第一个 token 是动词本身，不算位置参数。
      if (current.length > 0 && !token.startsWith('--')) {
        positionals += 1;
      }
      current.push(token);
      skipNext = PLAN_OPTIONS_WITH_VALUE.has(token);
    }
    if (current.length > 0) {
      segments.push(current.join(' '));
    }
  }
  return segments;
}

/** 把命令行拆成计划项。 */
export function parsePlanItems(text: string): PlanItem[] {
  const segments = splitPlanSegments(text);
  const items: PlanItem[] = [];
  for (const segment of segments) {
    const tokens = segment.split(/\s+/);
    const name = tokens[0];
    const args = tokens.slice(1);
    const positionals = args.filter((token) => !token.startsWith('--'));
    if (name === 'build') {
      if (positionals.length < 3) {
        throw new Error(`plan 里的 build 需要 <x> <y> <type>：${segment}`);
      }
      const x = parseIntegerArg(positionals[0]);
      const y = parseIntegerArg(positionals[1]);
      if (x === undefined || y === undefined) {
        throw new Error(`plan 里的 build 坐标必须是整数：${segment}`);
      }
      items.push({
        kind: 'build',
        label: positionals[2],
        buildingType: positionals[2],
        position: { x, y },
      });
    } else if (name === 'upgrade') {
      if (positionals.length < 1) {
        throw new Error(`plan 里的 upgrade 需要 <building_id>：${segment}`);
      }
      items.push({ kind: 'upgrade', label: positionals[0], buildingType: '', buildingId: positionals[0] });
    } else if (name === 'craft_item') {
      if (positionals.length < 2) {
        throw new Error(`plan 里的 craft_item 需要 <配方> <批数>：${segment}`);
      }
      const batches = parseIntegerArg(positionals[1]);
      if (batches === undefined || batches <= 0) {
        throw new Error(`plan 里的 craft_item 批数必须是正整数：${segment}`);
      }
      items.push({
        kind: 'craft',
        label: `craft ${positionals[0]}×${batches}`,
        buildingType: '',
        recipeId: positionals[0],
        batches,
      });
    } else {
      throw new Error(`plan 只支持 build / upgrade / craft_item：${segment}`);
    }
  }
  return items;
}

/** `plan -`：从 stdin 读每一行（空行、# 注释跳过）。 */
async function readPlanStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.join('\n');
}

function itemName(catalog: CatalogView, itemId: string): string {
  return catalog.items?.find((item) => item.id === itemId)?.name ?? itemId;
}

function buildingName(catalog: CatalogView, buildingType: string): string {
  return catalog.buildings?.find((entry) => entry.id === buildingType)?.name ?? buildingType;
}

/** 配方每批的输入总量（批数 × inputs）。 */
export function recipeInputs(recipe: RecipeCatalogEntry, batches: number): PlanCostLine[] {
  return (recipe.inputs ?? []).map((input) => ({
    item_id: input.item_id,
    quantity: input.quantity * batches,
  }));
}

function recipeFor(catalog: CatalogView, recipeId: string): RecipeCatalogEntry | undefined {
  return (catalog.recipes ?? []).find((recipe) => recipe.id === recipeId);
}

function fmtRecipe(recipe: RecipeCatalogEntry, catalog: CatalogView): string {
  const inputs = (recipe.inputs ?? [])
    .map((input) => `${itemName(catalog, input.item_id)}×${input.quantity}`)
    .join('+');
  const outputs = (recipe.outputs ?? [])
    .map((output) => `${itemName(catalog, output.item_id)}×${output.quantity}`)
    .join('+');
  return `${inputs} → ${outputs}`;
}

function handcraftRecipe(catalog: CatalogView, itemId: string): RecipeCatalogEntry | undefined {
  return (catalog.recipes ?? []).find((recipe) =>
    recipe.handcraft_allowed && (recipe.outputs ?? []).some((output) => output.item_id === itemId),
  );
}

/** 手搓配方里每个输出的每批产量；缺省 1。 */
function batchesFor(recipe: RecipeCatalogEntry, itemId: string, quantity: number): number {
  const output = (recipe.outputs ?? []).find((entry) => entry.item_id === itemId);
  return Math.ceil(quantity / (output?.quantity ?? 1));
}

/** 本方建筑里存有该物品的前 `limit` 个（按库存量降序）。 */
export function findBuildingSources(
  buildings: Building[],
  itemId: string,
  limit = 2,
): Array<{ id: string; type: string; quantity: number }> {
  return buildings
    .map((building) => ({
      id: building.id,
      type: building.type,
      quantity: (building.storage?.inventory?.[itemId] ?? 0) + (building.storage?.output_buffer?.[itemId] ?? 0),
    }))
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export interface HandcraftHintContext {
  completedTechs: ReadonlySet<string>;
  /** 背包（机甲）库存，用来判断「已经有」；缺省空。 */
  inventory?: Record<string, number>;
  /** 当前场景里的本方建筑（取料来源）；缺省空。 */
  buildings?: Building[];
}

function stockOf(ctx: HandcraftHintContext, itemId: string): number {
  return ctx.inventory?.[itemId] ?? 0;
}

/**
 * 缺口物品的提示：可手搓的沿 `handcraft_allowed` 配方递归展开到
 * 「不可手搓 / 背包或建筑里已有 / 达到层数上限」为止，最多 3 层。
 * 返回多行（首行无缩进，子行以 `↳ ` 开头）。
 */
export function fmtHandcraftHint(
  catalog: CatalogView,
  itemId: string,
  gap: number,
  ctx: HandcraftHintContext | ReadonlySet<string>,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): string[] {
  const options: HandcraftHintContext = ctx instanceof Set ? { completedTechs: ctx } : ctx as HandcraftHintContext;
  const completedTechs = options.completedTechs;
  const name = itemName(catalog, itemId);
  const sources = findBuildingSources(options.buildings ?? [], itemId);

  const recipe = handcraftRecipe(catalog, itemId);
  if (!recipe) {
    const from = sources.length > 0
      ? `从 ${sources.map((source) => `${source.id} ${buildingName(catalog, source.type)}(${source.quantity})`).join(' / ')} 取`
      : '需要生产建筑';
    return [`${name} ${gap}：不可手搓，${from}`];
  }
  const batches = batchesFor(recipe, itemId, gap);
  const locked = (recipe.tech_unlock ?? []).filter((tech) => !completedTechs.has(tech));
  const lockNote = locked.length > 0 ? `；未解锁科技 ${locked.join(',')}` : '';
  const inputTotal = (recipe.inputs ?? [])
    .map((input) => `${itemName(catalog, input.item_id)}×${input.quantity * batches}`)
    .join('+');
  const lines = [
    `${name} ${gap}（可手搓：${recipe.id}，${fmtRecipe(recipe, catalog)}；`
    + `需 ${batches} 批${inputTotal ? ` = ${inputTotal}` : ''}${lockNote}）`,
  ];

  const nextSeen = new Set([...seen, itemId]);
  if (depth + 1 >= MAX_HANDCRAFT_DEPTH) {
    return lines;
  }
  for (const input of recipe.inputs ?? []) {
    const needed = input.quantity * batches;
    if (nextSeen.has(input.item_id)) {
      lines.push(`  ↳ ${itemName(catalog, input.item_id)} ${needed}：（配方环，停止展开）`);
      continue;
    }
    // 背包或本方建筑里已经有足够库存的就不再往下追。
    const sourceQty = findBuildingSources(options.buildings ?? [], input.item_id, Number.MAX_SAFE_INTEGER)
      .reduce((sum, source) => sum + source.quantity, 0);
    if (stockOf(options, input.item_id) + sourceQty >= needed) {
      const where = stockOf(options, input.item_id) >= needed
        ? '背包已有'
        : findBuildingSources(options.buildings ?? [], input.item_id)
          .map((source) => `${source.id} ${buildingName(catalog, source.type)}(${source.quantity})`).join(' / ');
      lines.push(`  ↳ ${itemName(catalog, input.item_id)} ${needed}：${where}`);
      continue;
    }
    const childGap = needed - stockOf(options, input.item_id) - sourceQty;
    const child = fmtHandcraftHint(catalog, input.item_id, childGap, options, depth + 1, nextSeen);
    lines.push(`  ↳ ${child[0]}`);
    for (const extra of child.slice(1)) {
      lines.push(`  ${extra}`);
    }
  }
  return lines;
}

/** 把计划项解析成造价；未知建筑/找不到建筑直接抛错。 */
async function resolveCosts(
  items: PlanItem[],
  catalog: CatalogView,
  ctx: CommandContext,
  planetId: string,
  buildings: Map<string, BuildingCatalogEntry>,
): Promise<PlanCostLine[][]> {
  const costs: PlanCostLine[][] = [];
  for (const item of items) {
    if (item.kind === 'build') {
      const entry = buildings.get(item.buildingType);
      if (!entry) {
        throw new Error(`未知建筑类型：${item.buildingType}（用 catalog buildings <关键词> 查 id）`);
      }
      if (!entry.buildable) {
        throw new Error(`该建筑类型不可建造：${item.buildingType}`);
      }
      costs.push(entry.build_cost?.items ?? []);
      continue;
    }
    if (item.kind === 'craft') {
      const recipe = recipeFor(catalog, item.recipeId as string);
      if (!recipe) {
        throw new Error(`未知配方：${item.recipeId}（用 catalog recipes <关键词> 查 id）`);
      }
      if (!recipe.handcraft_allowed) {
        throw new Error(`该配方不可手搓：${item.recipeId}（只能由生产建筑制造）`);
      }
      costs.push(recipeInputs(recipe, item.batches as number));
      continue;
    }
    const view = await ctx.api.fetchPlanetInspect(planetId, {
      entityKind: 'building',
      entityId: item.buildingId as string,
    });
    const building = view.building;
    if (!building) {
      throw new Error(`找不到建筑：${item.buildingId}（星球 ${planetId}）`);
    }
    const entry = buildings.get(building.type);
    if (!entry) {
      throw new Error(`未知建筑类型：${building.type}`);
    }
    item.buildingType = building.type;
    item.label = `${item.buildingId} ${building.type}→L${building.level + 1}`;
    costs.push(upgradeCost(entry.build_cost?.items ?? [], building.level));
  }
  return costs;
}

function fmtCount(map: Map<string, number>, itemId: string): string {
  const value = map.get(itemId);
  return value === undefined ? '-' : String(value);
}

/**
 * `plan <build x y type | upgrade building_id>... [--planet <id>]` / `plan -`。
 *
 * 输出累计用料表：需要 / 背包 / 已下未落成任务占用 / 缺口；有缺口时结论行以
 * `✗ ` 开头，`scripts/sw` 据此返回非 0。
 */
export async function cmdPlan(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  if (hasFlag(parsed, 'help') || args.length === 0) {
    return 'Usage: plan <build x y type | upgrade building_id | craft_item recipe batches>... [--planet <id>] [--json]  |  plan -（stdin 每行一条）';
  }
  const planetArg = getStringOption(parsed, 'planet');
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}`);
  }
  // 位置参数里去掉 --planet 的值（parseArgs 已把它收进 options），其余按原文重拼。
  const rawParts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--planet' || arg === '--json' || arg === '--help') {
      if (arg === '--planet') i += 1;
      continue;
    }
    rawParts.push(arg);
  }
  const wantsJson = hasFlag(parsed, 'json');

  try {
    const text = rawParts.length === 1 && rawParts[0] === '-'
      ? await readPlanStdin()
      : rawParts.join(' ');
    const items = parsePlanItems(text);
    if (items.length === 0) {
      return fmtError('计划是空的：plan <build x y type | upgrade building_id | craft_item recipe batches>...');
    }

    const summary = await api.fetchSummary();
    const mecha = selectMyMecha(summary.players?.[api.getAuth().playerId], resolveIssuerId(ctx));
    const context = planetArg === undefined ? await fetchPlanetContext(api, resolveIssuerId(ctx)) : undefined;
    const planetId = planetArg ?? context!.planetId;
    if (!mecha) {
      return fmtError(`没有绑定的机甲：${NO_MECHA_HINT}`);
    }
    if (mecha.planet_id !== planetId) {
      return fmtError(`我的机甲 ${mecha.unit_id} 在 ${mecha.planet_id}，不在 ${planetId}（背包按机甲所在行星取）`);
    }

    const [catalog, runtime] = await Promise.all([api.fetchCatalog(), api.fetchPlanetRuntime(planetId)]);
    const buildings = new Map<string, BuildingCatalogEntry>(
      (catalog.buildings ?? []).map((entry) => [entry.id, entry]),
    );
    const costs = await resolveCosts(items, catalog, ctx, planetId, buildings);
    const occupied = occupiedByTasks(runtime.construction_tasks ?? [], mecha.unit_id);
    const { need, gaps } = computePlanCost(costs, mecha.inventory ?? {}, occupied);
    // 缺口递归提示要「从哪个建筑取」：读机甲周围场景里本方建筑的 storage。
    const scene = gaps.size > 0
      ? await api.fetchPlanetScene(planetId, centeredWindow(mecha, PLAN_SCENE_SIZE, summary.map_width, summary.map_height))
      : undefined;
    const ownBuildings = Object.values(scene?.buildings ?? {})
      .filter((building) => building.owner_id === api.getAuth().playerId);

    const itemIds = [...new Set([...need.keys(), ...occupied.keys()])].sort((a, b) => {
      const gapA = gaps.has(a) ? 1 : 0;
      const gapB = gaps.has(b) ? 1 : 0;
      return gapB - gapA || a.localeCompare(b);
    });
    const completedTechs = new Set(Object.keys(
      summary.players?.[api.getAuth().playerId]?.tech?.completed_techs ?? {},
    ));

    if (wantsJson) {
      return JSON.stringify({
        planet_id: planetId,
        mecha_id: mecha.unit_id,
        items: items.map((item) => ({ kind: item.kind, label: item.label, position: item.position })),
        need: Object.fromEntries(need),
        inventory: mecha.inventory ?? {},
        occupied: Object.fromEntries(occupied),
        gaps: Object.fromEntries(gaps),
        sources: Object.fromEntries([...gaps.keys()].map((itemId) => [itemId, findBuildingSources(ownBuildings, itemId)])),
      }, null, 2);
    }

    const lines: string[] = [
      `计划 ${items.length} 项（${items.map((item) => item.label).join(', ')}）`,
    ];
    if (itemIds.length === 0) {
      lines.push(chalk.dim('  这些建筑没有物品造价'));
    } else {
      lines.push(table(
        ['物品', '需要', '背包', '占用', '缺口'],
        itemIds.map((itemId) => [
          itemName(catalog, itemId),
          String(need.get(itemId) ?? 0),
          String(mecha.inventory?.[itemId] ?? 0),
          fmtCount(occupied, itemId),
          fmtCount(gaps, itemId),
        ]),
        (col, value) => (col === 4 && value.trim() !== '-' ? chalk.red(value) : value),
      ));
    }

    if (gaps.size === 0) {
      lines.push(chalk.green('结论：料齐了'));
    } else {
      const gapList = [...gaps.entries()].map(([itemId, gap]) => `${itemName(catalog, itemId)} ${gap}`).join('、');
      lines.push(chalk.red(`${FAILURE_MARKER}结论：缺 ${gapList}`));
      const hintContext: HandcraftHintContext = {
        completedTechs,
        inventory: mecha.inventory ?? {},
        buildings: ownBuildings,
      };
      for (const [itemId, gap] of gaps) {
        const hint = fmtHandcraftHint(catalog, itemId, gap, hintContext);
        lines.push(`  - ${hint[0]}`);
        for (const extra of hint.slice(1)) {
          lines.push(`    ${extra}`);
        }
      }
    }
    lines.push(chalk.dim(
      '缺口 = 需要 + 已下未落成任务占用 − 背包；占用只算本机甲 pending/in_progress/paused 且未扣料的任务'
      + '（不含进行中手搓作业已预留的原料）；craft_item 的原料计入「需要」，但不算占用',
    ));
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
}
