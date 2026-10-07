import type { ItemInventory } from '@shared/types';

interface MineralDefinition {
  id: string;
  label: string;
}

const mineralDefinitions: MineralDefinition[] = [
  { id: 'iron_ore', label: '铁矿' },
  { id: 'copper_ore', label: '铜矿' },
  { id: 'stone_ore', label: '石矿' },
  { id: 'silicon_ore', label: '硅矿' },
  { id: 'titanium_ore', label: '钛矿' },
  { id: 'coal', label: '煤矿' },
  { id: 'fire_ice', label: '可燃冰' },
  { id: 'fractal_silicon', label: '分形硅石' },
  { id: 'grating_crystal', label: '光栅石' },
  { id: 'monopole_magnet', label: '单极磁石' },
];

export function formatMineralInventory(inventory?: ItemInventory) {
  const entries = mineralDefinitions
    .map((definition) => ({
      ...definition,
      quantity: inventory?.[definition.id] ?? 0,
    }))
    .filter((entry) => entry.quantity > 0);

  if (entries.length === 0) {
    return '暂无矿石库存';
  }

  return entries.map((entry) => `${entry.label} ${entry.quantity}`).join(' · ');
}

/** 顶栏关键库存优先级：弹药 > 前期核心零件 > 冶炼产物 > 燃料。 */
export const KEY_ITEM_PRIORITY = [
  'ammo_bullet', 'shell_set', 'ammo_missile',
  'circuit_board', 'iron_ingot', 'gear', 'magnetic_coil', 'copper_ingot',
  'steel', 'electric_motor', 'processor', 'titanium_ingot', 'coal',
] as const;

/** 当前最相关的几项库存（按优先级取持有量 > 0 的前 limit 项）。 */
export function pickKeyItems(inventory: ItemInventory | undefined, limit = 4) {
  return KEY_ITEM_PRIORITY
    .map((id) => ({ id, quantity: inventory?.[id] ?? 0 }))
    .filter((entry) => entry.quantity > 0)
    .slice(0, limit);
}

/** 完整库存（数量降序）。 */
export function sortedInventory(inventory: ItemInventory | undefined) {
  return Object.entries(inventory ?? {})
    .filter(([, quantity]) => quantity > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, quantity]) => ({ id, quantity }));
}
