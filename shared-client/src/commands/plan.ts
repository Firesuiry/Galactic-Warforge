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
  TechCatalogEntry,
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

export interface BuildingSourceSummary {
  /** 列出来的前 `limit` 个（按库存量降序）。 */
  listed: Array<{ id: string; type: string; quantity: number }>;
  /** 所有本方建筑里该物品的当前总量（inventory + output_buffer）。 */
  total: number;
  /** 有该物品的本方建筑数（可能大于 listed.length）。 */
  count: number;
}

/**
 * 本方建筑里该物品的**当前可取出数量**：`storage.inventory + storage.output_buffer`，
 * 按数量降序，只算数量 > 0 的建筑。`total` 是全部建筑之和（「够 / 不够」标记按它算），
 * `listed` 只取前 `limit` 个（展示用）。
 */
export function summarizeSources(buildings: Building[], itemId: string, limit = 2): BuildingSourceSummary {
  const all = buildings
    .map((building) => ({
      id: building.id,
      type: building.type,
      quantity: (building.storage?.inventory?.[itemId] ?? 0) + (building.storage?.output_buffer?.[itemId] ?? 0),
    }))
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.id.localeCompare(b.id));
  return {
    listed: all.slice(0, limit),
    total: all.reduce((sum, entry) => sum + entry.quantity, 0),
    count: all.length,
  };
}

/** 本方建筑里存有该物品的前 `limit` 个（按库存量降序）。 */
export function findBuildingSources(
  buildings: Building[],
  itemId: string,
  limit = 2,
): Array<{ id: string; type: string; quantity: number }> {
  return summarizeSources(buildings, itemId, limit).listed;
}

/** 本方建筑里该物品的合计库存（inventory + output_buffer）。 */
export function buildingStockTotal(buildings: Building[], itemId: string): number {
  return summarizeSources(buildings, itemId, 0).total;
}

/** 来源列表文案：`b-97 补给站(42)、b-55 电弧熔炉(2)`；超过 limit 处时补 `等 N 处`。 */
export function fmtSourceList(catalog: CatalogView, summary: BuildingSourceSummary): string {
  const list = summary.listed
    .map((source) => `${source.id} ${buildingName(catalog, source.type)}(${source.quantity})`)
    .join('、');
  return summary.count > summary.listed.length ? `${list} 等 ${summary.count} 处` : list;
}

/** 「够 / 不够」标记：`[够]` 或 `[不够，还差 N]`。 */
export function fmtStockMarker(available: number, need: number): string {
  return available >= need ? '[够]' : `[不够，还差 ${need - available}]`;
}

/** `plan need` 的最大展开层数（防止深链把输出撑爆；配方环另有检测）。 */
export const MAX_NEED_DEPTH = 6;

/** `plan need` 展开后的一层节点。 */
export interface NeedNode {
  itemId: string;
  /** 这一层需要多少（从父配方反推）。 */
  quantity: number;
  /** 选中该物品的配方；叶子（基础原料 / 库存已够 / 达到层数上限 / 配方环）没有。 */
  recipe?: RecipeCatalogEntry;
  /** 现有量（背包 + 本方建筑库存，与 plan 的取料来源同口径）。 */
  stock: number;
  /** 缺口 = 需要 − 已分到的现有量（同一物品在多分支出现时按遍历顺序分配库存）。 */
  gap: number;
  /** 叶子节点的原因。 */
  leafReason?: 'base' | 'stock' | 'depth' | 'cycle';
  children: NeedNode[];
}

/** 配方是否可用：`tech_unlock` 为空 = 无门槛；否则要求其中任一科技已完成。 */
export function recipeUnlocked(
  recipe: RecipeCatalogEntry,
  completedTechs: ReadonlySet<string>,
  techUnlocks?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const gates = new Set(recipe.tech_unlock ?? []);
  for (const techId of techUnlocks?.get(recipe.id) ?? []) {
    gates.add(techId);
  }
  if (gates.size === 0) {
    return true;
  }
  return [...gates].some((techId) => completedTechs.has(techId));
}

/**
 * 物品 → 可用的生产配方：`outputs` 含该物品、科技已满足，取**单批产出该物品最多**
 * 的一条（同产量按 id 排序，保证输出稳定）。`--from` 显式指定时直接用它（不校验科技）。
 */
export function pickRecipe(
  catalog: CatalogView,
  itemId: string,
  options: {
    recipeId?: string;
    completedTechs: ReadonlySet<string>;
    techUnlocks?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): RecipeCatalogEntry | undefined {
  if (options.recipeId !== undefined) {
    return recipeFor(catalog, options.recipeId);
  }
  const candidates = (catalog.recipes ?? [])
    .filter((recipe) => (recipe.outputs ?? []).some((output) => output.item_id === itemId))
    .filter((recipe) => recipeUnlocked(recipe, options.completedTechs, options.techUnlocks));
  candidates.sort((a, b) => {
    const qa = (a.outputs ?? []).find((output) => output.item_id === itemId)?.quantity ?? 0;
    const qb = (b.outputs ?? []).find((output) => output.item_id === itemId)?.quantity ?? 0;
    return qb - qa || a.id.localeCompare(b.id);
  });
  return candidates[0];
}

/** 配方 ID → 解锁它的科技集合（`techs[].unlocks` 里 type=recipe 的条目）。 */
export function techRecipeUnlocks(techs: TechCatalogEntry[] | undefined): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const tech of techs ?? []) {
    for (const unlock of tech.unlocks ?? []) {
      if (unlock.type !== 'recipe') {
        continue;
      }
      const set = index.get(unlock.id) ?? new Set<string>();
      set.add(tech.id);
      index.set(unlock.id, set);
    }
  }
  return index;
}

/**
 * `plan need` 的递归展开：给定物品与数量，按配方反推到基础原料。
 *
 * - 选中配方后，每批产出 `output.quantity` 个，批数 = ceil(缺口 / 每批产量)，
 *   原料 = ceil(批数 × inputs.quantity)（与服务端批处理口径一致）。
 * - 现有量先抵扣：每个节点的缺口 = 需要 − 分到的库存；库存够就不展开。
 *   同一物品在多个分支出现时按遍历顺序分配库存，不重复计算。
 * - 科技未满足的配方不会入选（`--from` 除外）；找不到配方就是叶子（基础矿石/原料）。
 * - 最多展开 `MAX_NEED_DEPTH` 层；链上重复出现同一物品判配方环，停止展开。
 */
export function expandNeed(
  catalog: CatalogView,
  itemId: string,
  quantity: number,
  options: {
    recipeId?: string;
    completedTechs: ReadonlySet<string>;
    techUnlocks?: ReadonlyMap<string, ReadonlySet<string>>;
    stockOf: (itemId: string) => number;
    depth?: number;
    seen?: ReadonlySet<string>;
    /** 库存分配表（同一物品在多分支间共享）；根调用不传。 */
    remaining?: Map<string, number>;
  },
): NeedNode {
  const stock = options.stockOf(itemId);
  const remaining = options.remaining ?? new Map<string, number>();
  const available = remaining.get(itemId) ?? stock;
  const used = Math.min(available, quantity);
  remaining.set(itemId, available - used);
  const gap = quantity - used;
  const node: NeedNode = { itemId, quantity, stock, gap, children: [] };
  if (gap <= 0) {
    node.leafReason = 'stock';
    return node;
  }
  const recipe = pickRecipe(catalog, itemId, {
    recipeId: options.recipeId,
    completedTechs: options.completedTechs,
    techUnlocks: options.techUnlocks,
  });
  if (!recipe) {
    node.leafReason = 'base';
    return node;
  }
  node.recipe = recipe;
  const depth = options.depth ?? 0;
  const seen = options.seen ?? new Set<string>();
  if (depth >= MAX_NEED_DEPTH) {
    node.leafReason = 'depth';
    return node;
  }
  if (seen.has(itemId)) {
    node.leafReason = 'cycle';
    return node;
  }
  const batches = batchesFor(recipe, itemId, gap);
  const nextSeen = new Set([...seen, itemId]);
  for (const input of recipe.inputs ?? []) {
    const needed = Math.ceil(input.quantity * batches);
    node.children.push(expandNeed(catalog, input.item_id, needed, {
      completedTechs: options.completedTechs,
      techUnlocks: options.techUnlocks,
      stockOf: options.stockOf,
      depth: depth + 1,
      seen: nextSeen,
      remaining,
    }));
  }
  return node;
}

/** 树里所有「叶子」按物品合计（基础原料汇总）。 */
export function leafTotals(root: NeedNode): Map<string, number> {
  const totals = new Map<string, number>();
  const walk = (node: NeedNode): void => {
    if (node.children.length === 0) {
      totals.set(node.itemId, (totals.get(node.itemId) ?? 0) + node.quantity);
      return;
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);
  return totals;
}

/** 树里每个物品的总需要量（同一物品在不同分支出现时累加）。 */
export function needTotals(root: NeedNode): Map<string, number> {
  const totals = new Map<string, number>();
  const walk = (node: NeedNode): void => {
    totals.set(node.itemId, (totals.get(node.itemId) ?? 0) + node.quantity);
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(root);
  return totals;
}

/** 配方的生产建筑名（`building_types` 的中文名，缺省写「制造台」）。 */
function recipeBuildingLabel(catalog: CatalogView, recipe: RecipeCatalogEntry): string {
  const types = recipe.building_types ?? [];
  if (types.length === 0) {
    return '制造台';
  }
  const names = types
    .map((type) => buildingName(catalog, type))
    .filter((name) => name !== '');
  return names[0] ?? '制造台';
}

/** 把展开树渲染成缩进文本（首行不带缩进）。 */
export function fmtNeedTree(catalog: CatalogView, node: NeedNode, depth = 0): string[] {
  const name = itemName(catalog, node.itemId);
  // 叶子原因优先于配方：环 / 层数上限的节点虽然选到了配方，但没继续展开。
  let head: string;
  if (node.leafReason === 'cycle') {
    head = `${name} ${node.quantity}（配方环，停止展开）`;
  } else if (node.leafReason === 'stock') {
    head = `${name} ${node.quantity}（现有 ${node.stock}，够）`;
  } else if (node.leafReason === 'depth') {
    head = `${name} ${node.quantity}（展开到 ${MAX_NEED_DEPTH} 层上限，不再展开）`;
  } else if (node.recipe) {
    head = `${name} ${node.quantity} ← ${node.recipe.id}（${recipeBuildingLabel(catalog, node.recipe)}）`;
    if (node.stock > 0) {
      head += `（现有 ${node.stock}）`;
    }
  } else {
    head = `${name} ${node.quantity}（基础）`;
  }
  const lines = [`${'  '.repeat(depth)}${head}`];
  for (const child of node.children) {
    lines.push(...fmtNeedTree(catalog, child, depth + 1));
  }
  return lines;
}

export interface NeedSummaryLine {
  itemId: string;
  /** 基础原料总需要量（同一原料在不同分支出现时累加）。 */
  need: number;
  /** 现有量（背包 + 本方建筑库存，与 plan 取料来源同口径）。 */
  stock: number;
  /** 缺口 = max(0, 需要 − 现有)。 */
  gap: number;
}

/**
 * 叶子汇总（基础原料）：按物品累加需要量，现有量按物品去重。
 * 中间产物都要现做，不列进「要备多少料」的汇总；它们的现有量写在树的对应行上。
 * 按物品中文名排序，输出稳定。
 */
export function summarizeNeed(catalog: CatalogView, root: NeedNode): NeedSummaryLine[] {
  const need = leafTotals(root);
  const stock = new Map<string, number>();
  const collect = (node: NeedNode): void => {
    if (node.children.length === 0 && !stock.has(node.itemId)) {
      stock.set(node.itemId, node.stock);
    }
    for (const child of node.children) {
      collect(child);
    }
  };
  collect(root);
  return [...need.entries()]
    .map(([itemId, quantity]) => {
      const available = stock.get(itemId) ?? 0;
      return { itemId, need: quantity, stock: available, gap: Math.max(0, quantity - available) };
    })
    .sort((a, b) => itemName(catalog, a.itemId).localeCompare(itemName(catalog, b.itemId)));
}

/**
 * `plan need <物品ID> <数量> [--from <配方ID>] [--planet <id>] [--json]`。
 *
 * 递归展开到基础原料，回答「造 N 个 X 要备多少料」：按配方反推中间产物，
 * 每样物品同时给现有量（背包 + 本方建筑库存，与 plan 取料来源同口径）与缺口。
 * 最多展开 6 层，配方环停止展开；有缺口时结论行以 `✗ ` 开头（`scripts/sw` 非 0）。
 */
export async function cmdPlanNeed(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  const positionals = parsed.positionals.slice(1);
  if (hasFlag(parsed, 'help') || positionals.length < 2) {
    return 'Usage: plan need <物品ID> <数量> [--from <配方ID>] [--planet <id>] [--json]';
  }
  const itemId = positionals[0];
  const quantity = parseIntegerArg(positionals[1]);
  if (quantity === undefined || quantity <= 0) {
    return fmtError(`数量必须是正整数（收到 ${positionals[1]}）`);
  }
  const fromRecipe = getStringOption(parsed, 'from');
  const planetArg = getStringOption(parsed, 'planet');
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}`);
  }
  const wantsJson = hasFlag(parsed, 'json');

  try {
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
    const catalog = await api.fetchCatalog();
    if (!(catalog.items ?? []).some((item) => item.id === itemId)) {
      return fmtError(`未知物品：${itemId}（用 catalog items <关键词> 查 id）`);
    }
    if (fromRecipe !== undefined) {
      const recipe = recipeFor(catalog, fromRecipe);
      if (!recipe) {
        return fmtError(`未知配方：${fromRecipe}（用 catalog recipes <关键词> 查 id）`);
      }
      if (!(recipe.outputs ?? []).some((output) => output.item_id === itemId)) {
        return fmtError(`配方 ${fromRecipe} 不产出「${itemName(catalog, itemId)}」（${itemId}）`);
      }
    }
    // 现有量：背包 + 机甲周围场景里本方建筑（inventory + output_buffer），与 plan 取料来源同口径。
    const scene = await api.fetchPlanetScene(
      planetId,
      centeredWindow(mecha, PLAN_SCENE_SIZE, summary.map_width, summary.map_height),
    );
    const ownBuildings = Object.values(scene.buildings ?? {})
      .filter((building) => building.owner_id === api.getAuth().playerId);
    const inventory = mecha.inventory ?? {};
    const stockOf = (id: string): number =>
      (inventory[id] ?? 0) + buildingStockTotal(ownBuildings, id);
    const completedTechs = new Set(Object.keys(
      summary.players?.[api.getAuth().playerId]?.tech?.completed_techs ?? {},
    ));
    const root = expandNeed(catalog, itemId, quantity, {
      recipeId: fromRecipe,
      completedTechs,
      techUnlocks: techRecipeUnlocks(catalog.techs),
      stockOf,
    });
    const rows = summarizeNeed(catalog, root);
    const totalGap = rows.reduce((sum, row) => sum + row.gap, 0);

    if (wantsJson) {
      const tree = (node: NeedNode): Record<string, unknown> => ({
        item_id: node.itemId,
        quantity: node.quantity,
        stock: node.stock,
        gap: node.gap,
        ...(node.recipe ? { recipe_id: node.recipe.id } : {}),
        ...(node.leafReason ? { leaf_reason: node.leafReason } : {}),
        children: node.children.map(tree),
      });
      return JSON.stringify({
        planet_id: planetId,
        mecha_id: mecha.unit_id,
        item_id: itemId,
        quantity,
        tree: tree(root),
        summary: rows.map((row) => ({
          item_id: row.itemId,
          name: itemName(catalog, row.itemId),
          need: row.need,
          stock: row.stock,
          gap: row.gap,
        })),
        gap_total: totalGap,
      }, null, 2);
    }

    const lines: string[] = [`需要 ${itemName(catalog, itemId)} ${quantity}`];
    lines.push(...fmtNeedTree(catalog, root).map((line) => `  ${line}`));
    lines.push('');
    lines.push('汇总（基础原料）：');
    lines.push(table(
      ['物品', '需要', '现有', '缺口'],
      rows.map((row) => [
        itemName(catalog, row.itemId),
        String(row.need),
        String(row.stock),
        row.gap > 0 ? String(row.gap) : '-',
      ]),
      (col, value) => (col === 3 && value.trim() !== '-' ? chalk.red(value) : value),
    ));
    const shortItems = rows.filter((row) => row.gap > 0);
    if (shortItems.length === 0) {
      lines.push(chalk.green('结论：现有量够'));
    } else {
      lines.push(chalk.red(
        `${FAILURE_MARKER}结论：还缺 ${shortItems.map((row) => `${itemName(catalog, row.itemId)} ${row.gap}`).join('、')}`,
      ));
    }
    lines.push(chalk.dim(
      '现有 = 背包 + 机甲周围 48×48 场景里本方建筑的 inventory + output_buffer；'
      + `配方按「产出该物品数量最大且科技已解锁」选，--from 可指定；最多展开 ${MAX_NEED_DEPTH} 层，配方环停止`,
    ));
    return lines.join('\n');
  } catch (e) {
    return fmtError(e instanceof Error ? e.message : String(e));
  }
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
 * 取料来源列写建筑里该物品的**当前可取出数量**（inventory + output_buffer），
 * 并在行尾标 `[够]` / `[不够，还差 N]`（够不够按全部来源合计判断）。
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
  const sources = summarizeSources(options.buildings ?? [], itemId);

  const recipe = handcraftRecipe(catalog, itemId);
  if (!recipe) {
    // 来源列写**当前可取出数量**（inventory + output_buffer），并标出够不够，
    // 避免看起来像「去这里拿就有」。
    const from = sources.count > 0
      ? `从 ${fmtSourceList(catalog, sources)} 取   ${fmtStockMarker(sources.total, gap)}`
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
    const childSources = summarizeSources(options.buildings ?? [], input.item_id);
    const stock = stockOf(options, input.item_id);
    if (stock + childSources.total >= needed) {
      const where = stock >= needed ? '背包已有' : fmtSourceList(catalog, childSources);
      lines.push(`  ↳ ${itemName(catalog, input.item_id)} ${needed}：${where}   ${fmtStockMarker(stock + childSources.total, needed)}`);
      continue;
    }
    const childGap = needed - stock - childSources.total;
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

export const PLAN_USAGE = 'Usage: plan <build x y type | upgrade building_id | craft_item recipe batches>... [--planet <id>] [--json]  |  plan -（stdin 每行一条）  |  plan need <物品ID> <数量> [--from <配方ID>] [--planet <id>] [--json]';

/**
 * `plan <build x y type | upgrade building_id>... [--planet <id>]` / `plan -` /
 * `plan need <物品ID> <数量> [--from <配方ID>]`。
 *
 * 输出累计用料表：需要 / 背包 / 已下未落成任务占用 / 缺口；有缺口时结论行以
 * `✗ ` 开头，`scripts/sw` 据此返回非 0。
 */
export async function cmdPlan(args: string[], ctx: CommandContext): Promise<string> {
  const { api } = ctx;
  const parsed = parseArgs(args);
  if (hasFlag(parsed, 'help') || args.length === 0) {
    return PLAN_USAGE;
  }
  const planetArg = getStringOption(parsed, 'planet');
  if (planetArg !== undefined && !planetArg.startsWith('planet-')) {
    return fmtError(`planet 参数看起来不是星球 id：${planetArg}`);
  }
  if (parsed.positionals[0] === 'need') {
    return cmdPlanNeed(args, ctx);
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
        // 每项都带上自己的 id / 坐标 / 配方与批数，脚本不用再从 label 里抠。
        items: items.map((item) => ({
          kind: item.kind,
          label: item.label,
          ...(item.kind === 'build' ? { building_type: item.buildingType, position: item.position } : {}),
          ...(item.kind === 'upgrade' ? { building_id: item.buildingId, building_type: item.buildingType } : {}),
          ...(item.kind === 'craft' ? { recipe_id: item.recipeId, batches: item.batches } : {}),
        })),
        need: Object.fromEntries(need),
        inventory: mecha.inventory ?? {},
        occupied: Object.fromEntries(occupied),
        gaps: Object.fromEntries(gaps),
        // 来源带当前可取出数量：building 是 inventory + output_buffer 的合计，
        // 只列数量 > 0 的建筑（按数量降序）；available/total 用来判断够不够。
        sources: Object.fromEntries([...gaps.keys()].map((itemId) => {
          const summary = summarizeSources(ownBuildings, itemId);
          return [itemId, {
            buildings: summary.listed,
            available: summary.total,
            gap: gaps.get(itemId) ?? 0,
            enough: summary.total >= (gaps.get(itemId) ?? 0),
          }];
        })),
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
