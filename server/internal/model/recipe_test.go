package model

import (
	"strings"
	"testing"
)

func TestRecipesReferenceItems(t *testing.T) {
	if len(recipeCatalog) == 0 {
		t.Fatalf("recipe catalog should not be empty")
	}
	for id, recipe := range recipeCatalog {
		if recipe.ID != id {
			t.Fatalf("recipe id mismatch: key=%s def=%s", id, recipe.ID)
		}
		if recipe.Name == "" {
			t.Fatalf("recipe %s missing name", id)
		}
		if recipe.Duration <= 0 {
			t.Fatalf("recipe %s invalid duration %d", id, recipe.Duration)
		}
		if recipe.EnergyCost < 0 {
			t.Fatalf("recipe %s has negative energy cost %d", id, recipe.EnergyCost)
		}
		if len(recipe.BuildingTypes) == 0 {
			t.Fatalf("recipe %s missing building types", id)
		}
		if len(recipe.Outputs) == 0 && len(recipe.Byproducts) == 0 {
			t.Fatalf("recipe %s has no outputs", id)
		}
		for _, input := range recipe.Inputs {
			if input.Quantity <= 0 {
				t.Fatalf("recipe %s has invalid input quantity", id)
			}
			if _, ok := Item(input.ItemID); !ok {
				t.Fatalf("recipe %s references unknown input %s", id, input.ItemID)
			}
		}
		for _, output := range recipe.AllOutputs() {
			if output.Quantity <= 0 {
				t.Fatalf("recipe %s has invalid output quantity", id)
			}
			if _, ok := Item(output.ItemID); !ok {
				t.Fatalf("recipe %s references unknown output %s", id, output.ItemID)
			}
		}
	}
}

func TestByproductRecipes(t *testing.T) {
	fireIce, ok := Recipe("graphene_from_fire_ice")
	if !ok || len(fireIce.Byproducts) == 0 {
		t.Fatalf("graphene_from_fire_ice should have byproducts")
	}
}

func TestOilRefineryRecipes(t *testing.T) {
	for _, id := range []string{"oil_fractionation", "xray_cracking", "reformed_refinement"} {
		recipe, ok := Recipe(id)
		if !ok || len(recipe.BuildingTypes) != 1 || recipe.BuildingTypes[0] != BuildingTypeOilRefinery {
			t.Fatalf("%s must run in oil refinery: %+v", id, recipe)
		}
		if len(recipe.TechUnlock) == 0 {
			t.Fatalf("%s missing research gate", id)
		}
		for _, techID := range recipe.TechUnlock {
			tech, exists := TechDefinitionByID(techID)
			if !exists || tech.Hidden {
				t.Fatalf("%s has unreachable tech %s", id, techID)
			}
		}
	}
	recipe, _ := Recipe("oil_fractionation")
	if len(recipe.Outputs) != 1 || recipe.Outputs[0] != (ItemAmount{ItemID: ItemRefinedOil, Quantity: 2}) || len(recipe.Byproducts) != 1 || recipe.Byproducts[0] != (ItemAmount{ItemID: ItemHydrogen, Quantity: 1}) {
		t.Fatalf("incorrect plasma refining outputs: %+v", recipe)
	}
}

func TestRecipeDependencies(t *testing.T) {
	baseItems := map[string]struct{}{
		ItemIronOre:        {},
		ItemCopperOre:      {},
		ItemStoneOre:       {},
		ItemSiliconOre:     {},
		ItemTitaniumOre:    {},
		ItemCoal:           {},
		ItemFireIce:        {},
		ItemFractalSilicon: {},
		ItemGratingCrystal: {},
		ItemMonopoleMagnet: {},
		ItemCrudeOil:       {},
		ItemWater:          {},
		ItemDeuterium:      {},
		ItemCriticalPhoton: {},
	}

	producers := make(map[string][]string, len(recipeCatalog))
	for id, recipe := range recipeCatalog {
		if isRecyclingRecipe(recipe) {
			continue
		}
		for _, output := range recipe.AllOutputs() {
			producers[output.ItemID] = append(producers[output.ItemID], id)
		}
	}

	for id, recipe := range recipeCatalog {
		for _, input := range recipe.Inputs {
			if _, ok := baseItems[input.ItemID]; ok {
				continue
			}
			if _, ok := producers[input.ItemID]; !ok {
				t.Fatalf("recipe %s input %s has no producer", id, input.ItemID)
			}
		}
	}

	// Alternative and catalytic recipes may contain cycles. Every recipe must
	// still have a route from mined/collected resources to all of its seed inputs.
	reachable := make(map[string]bool)
	for item := range baseItems {
		reachable[item] = true
	}
	pending := make(map[string]RecipeDefinition)
	for id, recipe := range recipeCatalog {
		pending[id] = recipe
	}
	for {
		progressed := false
		for id, recipe := range pending {
			ready := true
			for _, input := range recipe.Inputs {
				if !reachable[input.ItemID] {
					ready = false
					break
				}
			}
			if !ready {
				continue
			}
			for _, output := range recipe.AllOutputs() {
				reachable[output.ItemID] = true
			}
			delete(pending, id)
			progressed = true
		}
		if !progressed {
			break
		}
	}
	if len(pending) > 0 {
		t.Fatalf("recipes with no reachable seed inputs: %+v", pending)
	}

}

func TestMidLateRecipesPresent(t *testing.T) {
	cases := []struct {
		recipeID       string
		buildingType   BuildingType
		outputItemID   string
		outputQuantity int
	}{
		{recipeID: "titanium_crystal", buildingType: BuildingTypeAssemblingMachineMk1, outputItemID: ItemTitaniumCrystal, outputQuantity: 1},
		{recipeID: "titanium_alloy", buildingType: BuildingTypeArcSmelter, outputItemID: ItemTitaniumAlloy, outputQuantity: 2},
		{recipeID: "frame_material", buildingType: BuildingTypeAssemblingMachineMk1, outputItemID: ItemFrameMaterial, outputQuantity: 1},
		{recipeID: "quantum_chip", buildingType: BuildingTypeAssemblingMachineMk1, outputItemID: ItemQuantumChip, outputQuantity: 1},
		{recipeID: "small_carrier_rocket", buildingType: BuildingTypeVerticalLaunchingSilo, outputItemID: ItemSmallCarrierRocket, outputQuantity: 1},
	}

	for _, tc := range cases {
		recipe, ok := Recipe(tc.recipeID)
		if !ok {
			t.Fatalf("missing recipe %s", tc.recipeID)
		}
		if len(recipe.Outputs) != 1 {
			t.Fatalf("recipe %s should have exactly one primary output, got %+v", tc.recipeID, recipe.Outputs)
		}
		if recipe.Outputs[0].ItemID != tc.outputItemID || recipe.Outputs[0].Quantity != tc.outputQuantity {
			t.Fatalf("recipe %s output mismatch: got %+v", tc.recipeID, recipe.Outputs[0])
		}
		supported := false
		for _, candidate := range recipe.BuildingTypes {
			if candidate == tc.buildingType {
				supported = true
				break
			}
		}
		if !supported {
			t.Fatalf("recipe %s should support %s", tc.recipeID, tc.buildingType)
		}
	}
}

func TestSelfEvolutionLabSupportsCanonicalMatrixRecipes(t *testing.T) {
	recipeIDs := []string{
		"electromagnetic_matrix",
		"energy_matrix",
		"structure_matrix",
		"information_matrix",
		"gravity_matrix",
		"universe_matrix",
	}

	for _, recipeID := range recipeIDs {
		recipe, ok := Recipe(recipeID)
		if !ok {
			t.Fatalf("expected recipe %s to exist", recipeID)
		}
		supported := false
		for _, btype := range recipe.BuildingTypes {
			if btype == BuildingTypeSelfEvolutionLab {
				supported = true
				break
			}
		}
		if !supported {
			t.Fatalf("expected recipe %s to support %s, got %+v", recipeID, BuildingTypeSelfEvolutionLab, recipe.BuildingTypes)
		}
	}
}

func isRecyclingRecipe(recipe RecipeDefinition) bool {
	if strings.Contains(recipe.ID, "recycling") {
		return true
	}
	for _, tech := range recipe.TechUnlock {
		if tech == "recycling" {
			return true
		}
	}
	return false
}
