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
	fractionation, ok := Recipe("oil_fractionation")
	if !ok || len(fractionation.Byproducts) == 0 {
		t.Fatalf("oil_fractionation should have byproducts")
	}
	fireIce, ok := Recipe("graphene_from_fire_ice")
	if !ok || len(fireIce.Byproducts) == 0 {
		t.Fatalf("graphene_from_fire_ice should have byproducts")
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

	graph := make(map[string][]string, len(recipeCatalog))
	for id, recipe := range recipeCatalog {
		for _, input := range recipe.Inputs {
			if _, ok := baseItems[input.ItemID]; ok {
				continue
			}
			for _, producer := range producers[input.ItemID] {
				if producer == id {
					continue
				}
				graph[id] = append(graph[id], producer)
			}
		}
	}

	visited := make(map[string]bool, len(recipeCatalog))
	stack := make(map[string]bool, len(recipeCatalog))
	var visit func(string) bool
	visit = func(id string) bool {
		if stack[id] {
			return true
		}
		if visited[id] {
			return false
		}
		visited[id] = true
		stack[id] = true
		for _, dep := range graph[id] {
			if visit(dep) {
				return true
			}
		}
		stack[id] = false
		return false
	}

	for id := range recipeCatalog {
		if visit(id) {
			t.Fatalf("recipe dependency cycle detected at %s", id)
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
