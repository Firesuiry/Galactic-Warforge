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
