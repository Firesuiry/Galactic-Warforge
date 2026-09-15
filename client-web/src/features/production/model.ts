import type { Building, CatalogView, ItemAmount, RecipeCatalogEntry } from '@shared/types';
import { listBuildingRecipes } from '@/features/planet-map/build-workflow';
import { normalizeCompletedTechIds } from '@/features/planet-map/research-workflow';

export interface InputRequirement extends ItemAmount {
  available: number;
  missing: number;
}

export interface ProductionDiagnosis {
  building: Building;
  recipe?: RecipeCatalogEntry;
  state: 'offline' | 'unconfigured' | 'processing' | 'shortage' | 'ready';
  inputs: InputRequirement[];
}

/** The settlement consumes the input buffer and local inventory, never the output buffer. */
export function recipeInputs(building: Building, recipe: RecipeCatalogEntry): InputRequirement[] {
  return recipe.inputs.map((input) => {
    const available = (building.storage?.input_buffer?.[input.item_id] ?? 0)
      + (building.storage?.inventory?.[input.item_id] ?? 0);
    return { ...input, available, missing: Math.max(0, input.quantity - available) };
  });
}

export function diagnoseProduction(
  buildings: Record<string, Building> | undefined,
  catalog: CatalogView | undefined,
  playerId: string,
): ProductionDiagnosis[] {
  const recipes = new Map(catalog?.recipes?.map((recipe) => [recipe.id, recipe]));
  const priorities = { offline: 0, unconfigured: 1, shortage: 2, processing: 3, ready: 4 };
  return Object.values(buildings ?? {}).filter((building) => {
    const modules = building.runtime.functions;
    return building.owner_id === playerId && Boolean(modules?.production || modules?.collect)
      && !(modules?.research && !building.production?.recipe_id);
  }).map((building): ProductionDiagnosis => {
    const recipe = recipes.get(building.production?.recipe_id ?? '');
    const inputs = recipe ? recipeInputs(building, recipe) : [];
    let state: ProductionDiagnosis['state'] = 'ready';
    if (building.runtime.state !== 'running') state = 'offline';
    else if (building.runtime.functions?.production && !building.production?.recipe_id) state = 'unconfigured';
    else if ((building.production?.remaining_ticks ?? 0) > 0) state = 'processing';
    else if (inputs.some((input) => input.missing > 0)) state = 'shortage';
    return { building, recipe, state, inputs };
  }).sort((a, b) => priorities[a.state] - priorities[b.state] || a.building.id.localeCompare(b.building.id));
}

export function normalizeBatchCount(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(9999, Math.floor(value))) : 1;
}

export function planRecipe(recipe: RecipeCatalogEntry, batches: number) {
  const count = normalizeBatchCount(batches);
  const scale = (items: ItemAmount[]) => items.map((item) => ({ ...item, quantity: item.quantity * count }));
  return {
    batches: count,
    inputs: scale(recipe.inputs),
    outputs: scale(recipe.outputs),
    byproducts: scale(recipe.byproducts ?? []),
    baseTicks: recipe.duration * count,
  };
}

export function recipeBuildOptions(recipe: RecipeCatalogEntry, catalog: CatalogView | undefined, completedTechs: string[]) {
  const completed = new Set(normalizeCompletedTechIds({ completed_techs: completedTechs }));
  return (catalog?.buildings ?? []).filter((building) =>
    building.buildable && Boolean(building.unlock_tech?.filter(Boolean).length) && recipe.building_types?.includes(building.id),
  ).map((building) => ({
    building,
    missingTechs: (building.unlock_tech ?? []).filter((tech) => tech && !completed.has(tech)),
    recipeTechOptions: listBuildingRecipes(catalog, building.id, completed).some((entry) => entry.id === recipe.id)
      ? [] : recipe.tech_unlock?.filter(Boolean) ?? [],
  }));
}
