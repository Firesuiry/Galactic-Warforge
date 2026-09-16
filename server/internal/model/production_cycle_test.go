package model

import "testing"

func TestResolveProductionCycleSpeed(t *testing.T) {
	recipe, ok := Recipe("smelt_iron")
	if !ok {
		t.Fatalf("missing recipe smelt_iron")
	}
	profile := BuildingProfileFor(BuildingTypeArcSmelter, 1)
	inputs := []ItemStack{
		{ItemID: ItemIronOre, Quantity: 1, Spray: &SprayState{Level: 1, RemainingUses: 2}},
	}
	res, err := ResolveProductionCycle(ProductionCycleRequest{
		Recipe:       recipe,
		BuildingType: BuildingTypeArcSmelter,
		Runtime:      profile.Runtime,
		Mode:         BonusModeSpeed,
		Inputs:       inputs,
	})
	if err != nil {
		t.Fatalf("resolve cycle: %v", err)
	}
	if !res.Bonus.Applied {
		t.Fatalf("expected bonus applied, got reason=%s", res.Bonus.Reason)
	}
	if res.Bonus.Duration != 48 {
		t.Fatalf("expected duration 48, got %d", res.Bonus.Duration)
	}
	if res.Inputs[0].Spray == nil || res.Inputs[0].Spray.RemainingUses != 1 {
		t.Fatalf("expected remaining uses 1, got %+v", res.Inputs[0].Spray)
	}
	if res.EnergyConsumeTotal != (profile.Runtime.Params.EnergyConsume+recipe.EnergyCost)*res.Bonus.Duration {
		t.Fatalf("unexpected energy consume total %d", res.EnergyConsumeTotal)
	}
}

func TestAssemblyTierRecipeRestrictionsRemainScoped(t *testing.T) {
	prototype, _ := Recipe("prototype")
	if _, err := ResolveProductionCycle(ProductionCycleRequest{Recipe: prototype, BuildingType: BuildingTypeAssemblingMachineMk2}); err != nil {
		t.Fatalf("Mk2 should accept prototype: %v", err)
	}
	if _, err := ResolveProductionCycle(ProductionCycleRequest{Recipe: prototype, BuildingType: BuildingTypeAssemblingMachineMk3}); err != nil {
		t.Fatalf("Mk3 should inherit prototype: %v", err)
	}
	drone, _ := Recipe("precision_drone")
	if _, err := ResolveProductionCycle(ProductionCycleRequest{Recipe: drone, BuildingType: BuildingTypeAssemblingMachineMk3}); err != nil {
		t.Fatalf("Mk3 should accept precision drone: %v", err)
	}
}

func TestResolveProductionCyclePriorityHighest(t *testing.T) {
	recipe, ok := Recipe("smelt_iron")
	if !ok {
		t.Fatalf("missing recipe smelt_iron")
	}
	profile := BuildingProfileFor(BuildingTypeArcSmelter, 1)
	inputs := []ItemStack{
		{ItemID: ItemIronOre, Quantity: 1, Spray: &SprayState{Level: 2, RemainingUses: 1}},
		{ItemID: ItemIronOre, Quantity: 1, Spray: &SprayState{Level: 1, RemainingUses: 5}},
	}
	res, err := ResolveProductionCycle(ProductionCycleRequest{
		Recipe:       recipe,
		BuildingType: BuildingTypeArcSmelter,
		Runtime:      profile.Runtime,
		Mode:         BonusModeSpeed,
		Inputs:       inputs,
	})
	if err != nil {
		t.Fatalf("resolve cycle: %v", err)
	}
	if !res.Bonus.Applied || res.Bonus.Level != 2 {
		t.Fatalf("expected level 2 bonus applied, got %+v", res.Bonus)
	}
	if res.Bonus.Duration != 40 {
		t.Fatalf("expected duration 40, got %d", res.Bonus.Duration)
	}
	if res.Inputs[0].Spray != nil {
		t.Fatalf("expected level 2 spray consumed, got %+v", res.Inputs[0].Spray)
	}
	if res.Inputs[1].Spray == nil || res.Inputs[1].Spray.RemainingUses != 5 {
		t.Fatalf("expected level 1 spray untouched, got %+v", res.Inputs[1].Spray)
	}
}

func TestResolveProductionCycleInsufficientSpray(t *testing.T) {
	prev := CurrentProductionBonusConfig()
	cfg := prev
	cfg.UsesPerCycle = 2
	if err := SetProductionBonusConfig(cfg); err != nil {
		t.Fatalf("set bonus config: %v", err)
	}
	defer func() {
		if err := SetProductionBonusConfig(prev); err != nil {
			t.Fatalf("restore bonus config: %v", err)
		}
	}()

	recipe, ok := Recipe("smelt_iron")
	if !ok {
		t.Fatalf("missing recipe smelt_iron")
	}
	profile := BuildingProfileFor(BuildingTypeArcSmelter, 1)
	inputs := []ItemStack{
		{ItemID: ItemIronOre, Quantity: 1, Spray: &SprayState{Level: 1, RemainingUses: 1}},
	}
	res, err := ResolveProductionCycle(ProductionCycleRequest{
		Recipe:       recipe,
		BuildingType: BuildingTypeArcSmelter,
		Runtime:      profile.Runtime,
		Mode:         BonusModeSpeed,
		Inputs:       inputs,
	})
	if err != nil {
		t.Fatalf("resolve cycle: %v", err)
	}
	if res.Bonus.Applied || res.Bonus.Reason != BonusFailureInsufficientSpray {
		t.Fatalf("expected insufficient spray, got %+v", res.Bonus)
	}
	if res.Bonus.Duration != recipe.Duration {
		t.Fatalf("expected base duration, got %d", res.Bonus.Duration)
	}
	if res.Inputs[0].Spray == nil || res.Inputs[0].Spray.RemainingUses != 1 {
		t.Fatalf("expected spray unchanged, got %+v", res.Inputs[0].Spray)
	}
}

func TestResolveProductionCycleIgnoresNonRecipeSpray(t *testing.T) {
	recipe, ok := Recipe("smelt_iron")
	if !ok {
		t.Fatalf("missing recipe smelt_iron")
	}
	profile := BuildingProfileFor(BuildingTypeArcSmelter, 1)
	inputs := []ItemStack{
		{ItemID: ItemCopperOre, Quantity: 1, Spray: &SprayState{Level: 1, RemainingUses: 3}},
	}
	res, err := ResolveProductionCycle(ProductionCycleRequest{
		Recipe:       recipe,
		BuildingType: BuildingTypeArcSmelter,
		Runtime:      profile.Runtime,
		Mode:         BonusModeSpeed,
		Inputs:       inputs,
	})
	if err != nil {
		t.Fatalf("resolve cycle: %v", err)
	}
	if res.Bonus.Applied || res.Bonus.Reason != BonusFailureNoSpray {
		t.Fatalf("expected no spray applied, got %+v", res.Bonus)
	}
}

func TestAssemblyTierRecipesInheritWithoutUnlockingHigherTier(t *testing.T) {
	for _, recipe := range AllRecipes() {
		if recipeAllowsBuilding(recipe, BuildingTypeAssemblingMachineMk1) {
			for _, kind := range []BuildingType{BuildingTypeAssemblingMachineMk2, BuildingTypeAssemblingMachineMk3} {
				if !recipeAllowsBuilding(recipe, kind) {
					t.Fatalf("%s must inherit %s", kind, recipe.ID)
				}
			}
		}
	}
	drone, _ := Recipe("precision_drone")
	prototype, _ := Recipe("prototype")
	for _, tc := range []struct {
		kind   BuildingType
		recipe RecipeDefinition
	}{
		{BuildingTypeAssemblingMachineMk1, prototype},
		{BuildingTypeAssemblingMachineMk1, drone},
		{BuildingTypeAssemblingMachineMk2, drone},
	} {
		if _, err := ResolveProductionCycle(ProductionCycleRequest{Recipe: tc.recipe, BuildingType: tc.kind}); err == nil {
			t.Fatalf("%s incorrectly accepted %s", tc.kind, tc.recipe.ID)
		}
	}
}

func TestProductionCycleSpeedRoundsUpAndCombinesSprayOnce(t *testing.T) {
	recipe, _ := Recipe("gear")
	for _, tc := range []struct {
		speed, expected int
		spray           bool
	}{
		{-1, 20, false}, {0, 20, false}, {1, 20, false}, {2, 10, false}, {3, 7, false}, {100, 1, false}, {2, 8, true},
	} {
		runtime := BuildingProfileFor(BuildingTypeAssemblingMachineMk3, 1).Runtime
		runtime.Functions.Production.Throughput = tc.speed
		inputs := []ItemStack{{ItemID: ItemIronIngot, Quantity: 1}}
		if tc.spray {
			inputs[0].Spray = &SprayState{Level: 1, RemainingUses: 1}
		}
		result, err := ResolveProductionCycle(ProductionCycleRequest{Recipe: recipe, BuildingType: BuildingTypeAssemblingMachineMk3, Runtime: runtime, Mode: BonusModeSpeed, Inputs: inputs})
		if err != nil {
			t.Fatal(err)
		}
		if result.Bonus.Duration != tc.expected || result.EffectiveThroughput != float64(recipe.Duration)/float64(tc.expected) || result.Bonus.Outputs[0].Quantity != 1 {
			t.Fatalf("speed=%d spray=%v incorrect cycle %+v", tc.speed, tc.spray, result)
		}
		if result.EnergyConsumeTotal != (runtime.Params.EnergyConsume+recipe.EnergyCost)*tc.expected {
			t.Fatalf("cycle power incorrectly scaled: %+v", result)
		}
	}
}
