import { describe, expect, it } from 'vitest';
import { ironRecipe, makeSmelter, productionCatalog, smelterCatalog } from './test-fixtures';
import { diagnoseProduction, planRecipe, recipeBuildOptions, recipeInputs } from './model';

describe('production diagnosis', () => {
  it('counts local inventory and input buffer but does not count output cargo as usable ingredients', () => {
    expect(recipeInputs(makeSmelter(), ironRecipe)[0]).toMatchObject({ available: 2, missing: 0 });
    const building = makeSmelter({ storage: { inventory: { iron_ore: 1 }, output_buffer: { iron_ore: 99 } } });
    expect(recipeInputs(building, ironRecipe)[0]).toMatchObject({ available: 1, missing: 1 });
  });
  it('does not report a working cycle as starved after the server has consumed its ingredients', () => {
    const building = makeSmelter({ storage: {}, production: { recipe_id: ironRecipe.id, remaining_ticks: 2 } });
    const [diagnosis] = diagnoseProduction({ a: building }, productionCatalog, 'player-1');
    expect(diagnosis.state).toBe('processing');
    expect(diagnosis.inputs[0].missing).toBe(2);
  });
  it('prioritizes offline machines and ignores enemy buildings and research mode labs', () => {
    const working = makeSmelter();
    const offline = makeSmelter({ id: 'offline', runtime: { ...working.runtime, state: 'no_power' } });
    const enemy = makeSmelter({ id: 'enemy', owner_id: 'enemy' });
    const research = makeSmelter({ id: 'lab', production: {}, runtime: { ...working.runtime, functions: { ...working.runtime.functions, research: { research_per_tick: 1 } } } });
    expect(diagnoseProduction({ working, offline, enemy, research }, productionCatalog, 'player-1').map((row) => [row.building.id, row.state]))
      .toEqual([['offline', 'offline'], ['smelter-1', 'ready']]);
  });
});

describe('recipe planning', () => {
  it('scales materials and byproducts together and bounds invalid batches', () => {
    expect(planRecipe(ironRecipe, 5)).toMatchObject({
      inputs: [{ item_id: 'iron_ore', quantity: 10 }], outputs: [{ item_id: 'iron_plate', quantity: 5 }],
      byproducts: [{ item_id: 'slag', quantity: 5 }], baseTicks: 15,
    });
    expect(planRecipe(ironRecipe, Number.NaN).batches).toBe(1);
    expect(planRecipe(ironRecipe, -10).batches).toBe(1);
    expect(planRecipe(ironRecipe, 1e9).batches).toBe(9999);
  });
  it('requires every building technology but only one alternative recipe technology', () => {
    const recipe = { ...ironRecipe, tech_unlock: ['basic', 'advanced'] };
    const catalog = { ...productionCatalog, recipes: [recipe], buildings: [{ ...smelterCatalog, unlock_tech: ['smelting', 'power'] }] };
    const [locked] = recipeBuildOptions(recipe, catalog, ['basic', 'smelting']);
    expect(locked.missingTechs).toEqual(['power']);
    expect(locked.recipeTechOptions).toEqual([]);
    const [unlocked] = recipeBuildOptions(recipe, catalog, ['advanced', 'smelting', 'power']);
    expect(unlocked.missingTechs).toEqual([]);
    expect(unlocked.recipeTechOptions).toEqual([]);
    expect(recipeBuildOptions(recipe, catalog, ['smelting', 'power'])[0].recipeTechOptions).toEqual(['basic', 'advanced']);
  });
  it('does not offer debug-only or unrelated facilities', () => {
    const catalog = { ...productionCatalog, buildings: [{ ...smelterCatalog, unlock_tech: [] }, { ...smelterCatalog, id: 'other' }] };
    expect(recipeBuildOptions(ironRecipe, catalog, ['smelting'])).toEqual([]);
  });
});
