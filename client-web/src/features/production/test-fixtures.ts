import type { Building, BuildingCatalogEntry, CatalogView, RecipeCatalogEntry } from '@shared/types';

export const ironRecipe: RecipeCatalogEntry = {
  id: 'iron_recipe', name: '铁板冶炼', inputs: [{ item_id: 'iron_ore', quantity: 2 }],
  outputs: [{ item_id: 'iron_plate', quantity: 1 }], byproducts: [{ item_id: 'slag', quantity: 1 }],
  duration: 3, energy_cost: 4, building_types: ['arc_smelter'], icon_key: 'iron', color: '#fff',
};
export const smelterCatalog: BuildingCatalogEntry = {
  id: 'arc_smelter', name: '电弧熔炉', category: 'production', subcategory: '', footprint: { width: 2, height: 2 },
  build_cost: { minerals: 10, energy: 10 }, buildable: true, unlock_tech: ['smelting'], icon_key: 'smelter', color: '#fff',
};
export const productionCatalog: CatalogView = { recipes: [ironRecipe], buildings: [smelterCatalog] } as CatalogView;
export function makeSmelter(overrides: Partial<Building> = {}): Building {
  return {
    id: 'smelter-1', type: 'arc_smelter', owner_id: 'player-1', position: { x: 12, y: 10, z: 0 },
    hp: 100, max_hp: 100, level: 1, vision_range: 10,
    runtime: {
      state: 'running', functions: { production: { throughput: 1, recipe_slots: 1 } },
      params: { energy_consume: 1, energy_generate: 0, capacity: 10, maintenance_cost: { minerals: 0, energy: 0 }, footprint: { width: 2, height: 2 } },
    },
    production: { recipe_id: ironRecipe.id }, storage: { inventory: { iron_ore: 1 }, input_buffer: { iron_ore: 1 } },
    ...overrides,
  };
}
