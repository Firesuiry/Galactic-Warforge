/**
 * C9 新手引导：按「采矿 → 产线 → 弹药 → 出兵 → 补给 → 进攻」推导当前步骤。
 * 纯函数，只看局势（己方建筑 / 单位 / 军团 / 玩家库存），不读文档、不存进度。
 */

import type { Building, CombatSquad, ItemInventory, Unit } from '@shared/types';

export type WarGuideStepId = 'mine' | 'line' | 'ammo' | 'army' | 'supply' | 'attack';

export interface WarGuideStep {
  id: WarGuideStepId;
  label: string;
  hint: string;
  done: boolean;
}

export interface WarGuideState {
  steps: WarGuideStep[];
  /** 当前步骤下标；全部完成为 -1。 */
  currentIndex: number;
  current: WarGuideStep | null;
  complete: boolean;
}

export interface WarGuideInput {
  playerId: string;
  buildings: readonly Building[];
  units: readonly Unit[];
  legions: readonly CombatSquad[];
  playerInventory?: ItemInventory;
}

const MINER_TYPES = new Set(['mining_machine', 'advanced_mining_machine']);
const LINE_TYPES = new Set([
  'arc_smelter', 'plane_smelter', 'negentropy_smelter',
  'assembling_machine_mk1', 'assembling_machine_mk2', 'assembling_machine_mk3',
]);
export const AMMO_ITEM_IDS = [
  'ammo_bullet', 'titanium_ammo', 'shell_set', 'crystal_shell_set',
  'ammo_missile', 'supersonic_missile_set', 'gravity_missile',
];
const AMMO_ITEMS = new Set(AMMO_ITEM_IDS);
const NON_ARMY_UNITS = new Set(['worker', 'executor', 'mecha', 'dark_fog', 'supply_truck', 'repair_vehicle']);

function hasAmmoStock(inventory: ItemInventory | undefined): boolean {
  return Object.entries(inventory ?? {}).some(([id, qty]) => AMMO_ITEMS.has(id) && qty > 0);
}

export function resolveWarGuide(input: WarGuideInput): WarGuideState {
  const ownBuildings = input.buildings.filter((b) => b.owner_id === input.playerId && b.hp > 0);
  const ownUnits = input.units.filter((u) => u.owner_id === input.playerId && u.hp > 0 && !u.mecha);

  const done: Record<WarGuideStepId, boolean> = {
    mine: ownBuildings.some((b) => MINER_TYPES.has(b.type)),
    line: ownBuildings.some((b) => LINE_TYPES.has(b.type)),
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

  const steps: WarGuideStep[] = [
    { id: 'mine', label: '采矿', hint: '在矿点建造采矿机，先把铁矿采起来。' },
    { id: 'line', label: '产线', hint: '建冶炼炉/组装机，把矿石加工成钢材、电路板等零件。' },
    { id: 'ammo', label: '弹药', hint: '设置弹药配方（如 ammo_bullet）并保证有库存，没弹药的部队会停火。' },
    { id: 'army', label: '出兵', hint: '建兵营/战车工厂，用零件生产步兵等战斗单位。' },
    { id: 'supply', label: '补给', hint: '在前线附近建补给站或造补给车，让部队打空后能补弹。' },
    { id: 'attack', label: '进攻', hint: '选中部队「编成军团」，再对军团下「进攻」指令并点选目标点。' },
  ].map((step) => ({ ...step, id: step.id as WarGuideStepId, done: done[step.id as WarGuideStepId] }));

  const currentIndex = steps.findIndex((step) => !step.done);
  return {
    steps,
    currentIndex,
    current: currentIndex >= 0 ? steps[currentIndex] : null,
    complete: currentIndex < 0,
  };
}
