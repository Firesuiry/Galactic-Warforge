/**
 * 遭遇战新手引导：开局有物资包，直接按
 * 风机 → 电塔 → 采矿机 → 熔炉 → 弹药 → 出兵 → 补给 → 编军团进攻 推导当前步骤。
 * 纯函数，只看局势（己方建筑 / 单位 / 军团 / 玩家库存 / 黑雾敌对状态），不存进度。
 */

import type { Building, CombatSquad, ItemInventory, Unit } from '@shared/types';

export type WarGuideStepId = 'power' | 'grid' | 'mine' | 'smelt' | 'ammo' | 'army' | 'supply' | 'attack';

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

export interface WarGuideState {
  steps: WarGuideStep[];
  /** 当前步骤下标；全部完成为 -1。 */
  currentIndex: number;
  current: WarGuideStep | null;
  complete: boolean;
  notice: WarGuideNotice | null;
}

export interface WarGuideInput {
  playerId: string;
  buildings: readonly Building[];
  units: readonly Unit[];
  legions: readonly CombatSquad[];
  playerInventory?: ItemInventory;
  /** summary 玩家 dark_fog.hostile：黑雾正在报复该玩家。 */
  darkFogHostile?: boolean;
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

function hasAmmoStock(inventory: ItemInventory | undefined): boolean {
  return Object.entries(inventory ?? {}).some(([id, qty]) => AMMO_ITEMS.has(id) && qty > 0);
}

const STEPS: Array<Omit<WarGuideStep, 'done'>> = [
  { id: 'power', label: '风机', hint: '建造栏选「风力涡轮机」，点空地放置。开局物资够直接建。' },
  { id: 'grid', label: '电塔', hint: '在风机旁放「电感应塔」，把电送到矿区和工厂。' },
  { id: 'mine', label: '采矿', hint: '把「采矿机」放在铁矿/铜矿上（要在电塔覆盖内）。' },
  { id: 'smelt', label: '熔炼', hint: '放「电弧熔炉」，用传送带把矿送进去炼成铁块、铜块。' },
  { id: 'ammo', label: '弹药', hint: '放「制造台」选子弹配方（需先在科技页研究武器系统），保持有库存；没弹药的部队会停火。' },
  { id: 'army', label: '出兵', hint: '建「兵营」，选中它在详情里生产步兵。' },
  { id: 'supply', label: '补给', hint: '在前线附近建「补给站」并装入弹药，部队打空后回光环内补弹。' },
  { id: 'attack', label: '进攻', hint: 'Shift+拖动框选部队 →「编成军团」→ 军团「进攻」，目标点选敌方基地。' },
];

export function resolveWarGuide(input: WarGuideInput): WarGuideState {
  const ownBuildings = input.buildings.filter((b) => b.owner_id === input.playerId && b.hp > 0);
  const ownUnits = input.units.filter((u) => u.owner_id === input.playerId && u.hp > 0 && !u.mecha);
  const has = (types: Set<string>) => ownBuildings.some((b) => types.has(b.type));

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
  };
}
