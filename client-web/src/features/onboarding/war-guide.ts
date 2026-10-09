/**
 * 遭遇战新手引导：开局有物资包，直接按
 * 风机 → 电塔 → 采矿机 → 熔炉 → 弹药 → 出兵 → 研究 → 补给 → 编军团进攻 推导当前步骤。
 * 纯函数，只看局势（己方建筑 / 单位 / 军团 / 玩家库存 / 玩家科技 / 黑雾敌对状态），不存进度。
 */

import type { Building, CombatSquad, ItemInventory, TechState, Unit } from '@shared/types';

import { normalizeCompletedTechIds } from '@/features/planet-map/research-workflow';

export type WarGuideStepId = 'power' | 'grid' | 'mine' | 'smelt' | 'ammo' | 'army' | 'research' | 'supply' | 'attack';

export interface WarGuideStep {
  id: WarGuideStepId;
  label: string;
  hint: string;
  done: boolean;
}

/** 黑雾相关的附加提示：中立说明 / 正在被报复。 */
export interface WarGuideNotice {
  tone: 'info' | 'danger';
  text: string;
}

/** 当前步骤缺料时，每个缺口物品的一句来源说明（从目录推导，不硬编码配方数字）。 */
export interface WarGuideShortageSource {
  itemId: string;
  itemName: string;
  /** 还差多少。 */
  missing: number;
  /** 「电弧熔炉或机甲手搓：石矿 ×2」；目录里查不到产线时为空串。 */
  source: string;
}

/** 当前步骤的缺料兜底：一句话汇总 + 逐项来源。 */
export interface WarGuideShortage {
  text: string;
  sources: WarGuideShortageSource[];
}

export interface WarGuideState {
  steps: WarGuideStep[];
  /** 当前步骤下标；全部完成为 -1。 */
  currentIndex: number;
  current: WarGuideStep | null;
  complete: boolean;
  notice: WarGuideNotice | null;
  /** 当前步骤的关键建筑买不起时的缺料兜底（无缺口为 null）。 */
  shortage: WarGuideShortage | null;
}

export interface WarGuideInput {
  playerId: string;
  buildings: readonly Building[];
  units: readonly Unit[];
  legions: readonly CombatSquad[];
  playerInventory?: ItemInventory;
  /** 玩家科技状态：研究步骤的完成条件（已完成电磁学 / 正在研究）。 */
  tech?: TechState | null;
  /** summary 玩家 dark_fog.hostile：黑雾正在报复该玩家。 */
  darkFogHostile?: boolean;
  /**
   * 目录：建造造价 / 配方 / 手搓许可。缺省时面板不显示缺料兜底（纯逻辑调用方不受影响）。
   */
  catalog?: WarGuideCatalog | null;
}

/**
 * 引导只需要目录的这三类数据（结构化最小面，避免把 CatalogView 全量拖进纯函数）。
 * 与 @shared/types 的 CatalogView 兼容，调用处可直接传整个 catalog。
 */
export interface WarGuideCatalog {
  buildings?: ReadonlyArray<{
    id: string;
    name?: string;
    build_cost?: { items?: ReadonlyArray<{ item_id: string; quantity: number }> };
  }>;
  items?: ReadonlyArray<{ id: string; name?: string }>;
  recipes?: ReadonlyArray<{
    id: string;
    name?: string;
    handcraft_allowed?: boolean;
    inputs: ReadonlyArray<{ item_id: string; quantity: number }>;
    outputs: ReadonlyArray<{ item_id: string; quantity: number }>;
    building_types?: string[];
  }>;
}

const POWER_TYPES = new Set(['wind_turbine', 'thermal_power_plant', 'solar_panel']);
const GRID_TYPES = new Set(['tesla_tower', 'wireless_power_tower', 'satellite_substation']);
const MINER_TYPES = new Set(['mining_machine', 'advanced_mining_machine']);
const SMELTER_TYPES = new Set(['arc_smelter', 'plane_smelter', 'negentropy_smelter']);
export const AMMO_ITEM_IDS = [
  'ammo_bullet', 'titanium_ammo', 'shell_set', 'crystal_shell_set',
  'ammo_missile', 'supersonic_missile_set', 'gravity_missile',
];
const AMMO_ITEMS = new Set(AMMO_ITEM_IDS);
const NON_ARMY_UNITS = new Set(['worker', 'executor', 'mecha', 'dark_fog', 'supply_truck', 'repair_vehicle']);
const DARK_FOG_OWNER_ID = 'dark_fog';

/** 研究步骤要完成的科技：电磁学（服务端 techs.yaml 的开局主线第一项）。 */
export const RESEARCH_TECH_ID = 'electromagnetism';

function hasAmmoStock(inventory: ItemInventory | undefined): boolean {
  return Object.entries(inventory ?? {}).some(([id, qty]) => AMMO_ITEMS.has(id) && qty > 0);
}

/**
 * 每步的关键建筑（缺料兜底用）：买不起时面板列出「还差什么、从哪来」。
 * attack 没有对应建筑（编军团不花建筑造价）。
 */
const STEP_BUILDING_TYPE: Partial<Record<WarGuideStepId, string>> = {
  power: 'wind_turbine',
  grid: 'tesla_tower',
  mine: 'mining_machine',
  smelt: 'arc_smelter',
  ammo: 'assembling_machine_mk1',
  army: 'barracks',
  research: 'matrix_lab',
  supply: 'supply_station',
};

const STEPS: Array<Omit<WarGuideStep, 'done'>> = [
  { id: 'power', label: '风机', hint: '建造栏选「风力涡轮机」，点空地放置。开局物资够直接建。' },
  { id: 'grid', label: '电塔', hint: '在风机旁放「电感应塔」，把电送到矿区和工厂。' },
  { id: 'mine', label: '采矿', hint: '把「采矿机」放在铁矿/铜矿上（要在电塔覆盖内）。' },
  { id: 'smelt', label: '熔炼', hint: '放「电弧熔炉」，用传送带把矿送进去炼成铁块、铜块。' },
  { id: 'ammo', label: '弹药', hint: '放「制造台 Mk.I」选子弹配方（子弹 = 铁块 ×1 → 5 发，开局即可用，不必先研究武器系统），保持有库存；没弹药的部队会停火。' },
  { id: 'army', label: '出兵', hint: '建「兵营」（开局可建），选中它在详情里生产步兵（步兵 = 铁块 ×2 + 电路板 ×1）。' },
  { id: 'research', label: '研究', hint: '建「矩阵研究站」（电磁矩阵 = 磁线圈 ×1 + 电路板 ×1，可由制造台或研究站生产），在科技页研究「电磁学」；之后经「自动化冶金」研究「武器系统」解锁高斯炮塔。' },
  { id: 'supply', label: '补给', hint: '在前线附近建「补给站」并装入弹药，部队打空后回光环内补弹。' },
  { id: 'attack', label: '进攻', hint: 'Shift+拖动框选部队 →「编成军团」→ 军团「进攻」，目标点选敌方基地。' },
];

/**
 * 缺料兜底：当前步骤的关键建筑按目录造价逐项对照背包，
 * 每个缺的物品再给一句来源（谁能产它、输入是什么、能不能手搓）。
 * 全部从 catalog 推导，不硬编码配方数字。
 */
export function resolveWarGuideShortage(
  step: WarGuideStepId,
  catalog: WarGuideCatalog | null | undefined,
  inventory: ItemInventory | undefined,
): WarGuideShortage | null {
  const buildingType = STEP_BUILDING_TYPE[step];
  if (!catalog || !buildingType) {
    return null;
  }
  const building = catalog.buildings?.find((entry) => entry.id === buildingType);
  const costs = building?.build_cost?.items ?? [];
  const missing = costs
    .map((cost) => ({ ...cost, missing: cost.quantity - (inventory?.[cost.item_id] ?? 0) }))
    .filter((cost) => cost.missing > 0);
  if (missing.length === 0) {
    return null;
  }
  const itemName = (itemId: string) => catalog.items?.find((item) => item.id === itemId)?.name ?? itemId;
  const buildingName = (id: string) => catalog.buildings?.find((entry) => entry.id === id)?.name ?? id;
  const sources = missing.map((cost) => ({
    itemId: cost.item_id,
    itemName: itemName(cost.item_id),
    missing: cost.missing,
    source: describeItemSource(cost.item_id, catalog, buildingName, itemName),
  }));
  return {
    text: `还差：${sources.map((source) => `${source.itemName} ×${source.missing}`).join('、')}`,
    sources,
  };
}

/** 物品来源一句话：「电弧熔炉或机甲手搓：石矿 ×2」。目录里没有产线（如矿物）时返回空串。 */
function describeItemSource(
  itemId: string,
  catalog: WarGuideCatalog,
  buildingName: (id: string) => string,
  itemName: (id: string) => string,
): string {
  const recipe = catalog.recipes?.find((entry) => entry.outputs.some((output) => output.item_id === itemId));
  if (!recipe) {
    return '';
  }
  // 只报入门那一档产线（目录按 Mk.I→Mk.III 排序）：新手此时只造得出第一档，
  // 把三档全列出来只会让一行提示挤成三行。
  const entry = recipe.building_types?.[0];
  const producer = entry ? buildingName(entry) : '';
  const inputs = recipe.inputs.map((input) => `${itemName(input.item_id)} ×${input.quantity}`).join(' + ');
  const maker = recipe.handcraft_allowed ? (producer ? `${producer}或机甲手搓` : '机甲手搓') : producer;
  if (!maker) {
    return inputs;
  }
  return inputs ? `${maker}：${inputs}` : maker;
}

export function resolveWarGuide(input: WarGuideInput): WarGuideState {
  const ownBuildings = input.buildings.filter((b) => b.owner_id === input.playerId && b.hp > 0);
  const ownUnits = input.units.filter((u) => u.owner_id === input.playerId && u.hp > 0 && !u.mecha);
  const has = (types: Set<string>) => ownBuildings.some((b) => types.has(b.type));
  // summary 里 completed_techs 是服务端的 {tech_id: level} 映射（类型声明写的是数组），统一走归一化。
  const completedTechs = new Set(normalizeCompletedTechIds(input.tech));
  const researching = Boolean(input.tech?.current_research?.tech_id);

  const done: Record<WarGuideStepId, boolean> = {
    power: has(POWER_TYPES),
    grid: has(GRID_TYPES),
    mine: has(MINER_TYPES),
    smelt: has(SMELTER_TYPES),
    ammo:
      hasAmmoStock(input.playerInventory)
      || ownBuildings.some((b) =>
        AMMO_ITEMS.has(b.production?.recipe_id ?? '')
        || hasAmmoStock(b.storage?.inventory)
        || hasAmmoStock(b.storage?.output_buffer)),
    army: ownUnits.some((u) => !NON_ARMY_UNITS.has(u.type)),
    // 已完成电磁学，或已有研究站且当前有研究在进行（研究站建出来 = 玩家已经打通了矩阵链）。
    research:
      completedTechs.has(RESEARCH_TECH_ID)
      || (ownBuildings.some((b) => b.type === 'matrix_lab') && researching),
    supply:
      ownBuildings.some((b) => b.type === 'supply_station')
      || ownUnits.some((u) => u.type === 'supply_truck'),
    attack: input.legions.some((l) => l.owner_id === input.playerId && l.state !== 'destroyed' && l.order === 'attack'),
  };

  const steps = STEPS.map((step) => ({ ...step, done: done[step.id] }));
  const currentIndex = steps.findIndex((step) => !step.done);

  // 黑雾说明：被激怒时优先提示防守；平时在出兵阶段起（或地图上已见黑雾）说明它是中立的。
  const fogSeen = input.units.some((u) => u.owner_id === DARK_FOG_OWNER_ID && u.hp > 0);
  const armyStage = currentIndex < 0 || currentIndex >= steps.findIndex((step) => step.id === 'army');
  const notice: WarGuideNotice | null = input.darkFogHostile
    ? { tone: 'danger', text: '黑雾正在报复你：先回防基地。停止攻击黑雾一段时间后，它会恢复中立。' }
    : fogSeen || armyStage
      ? { tone: 'info', text: '黑雾是中立的，不惹它就不会来打你；攻击它会激怒它并招来报复。' }
      : null;

  return {
    steps,
    currentIndex,
    current: currentIndex >= 0 ? steps[currentIndex] : null,
    complete: currentIndex < 0,
    notice,
    shortage: currentIndex >= 0
      ? resolveWarGuideShortage(steps[currentIndex].id, input.catalog, input.playerInventory)
      : null,
  };
}
