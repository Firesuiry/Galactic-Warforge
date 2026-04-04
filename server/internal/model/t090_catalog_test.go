package model

import (
	"reflect"
	"testing"
)

func techUnlocksBuilding(t *testing.T, techID string, btype BuildingType) bool {
	t.Helper()
	def, ok := TechDefinitionByID(techID)
	if !ok {
		return false
	}
	for _, unlock := range def.Unlocks {
		if unlock.Type == TechUnlockBuilding && unlock.ID == string(btype) {
			return true
		}
	}
	return false
}

func runtimeHasPowerConnection(rt BuildingRuntimeDefinition) bool {
	for _, point := range rt.Params.ConnectionPoints {
		if point.Kind == ConnectionPower {
			return true
		}
	}
	return false
}

func TestCanonicalMatrixItemsAndLateRecipesExist(t *testing.T) {
	canonical := []string{
		"electromagnetic_matrix",
		"energy_matrix",
		"structure_matrix",
		"information_matrix",
		"gravity_matrix",
		"universe_matrix",
	}
	for _, itemID := range canonical {
		if _, ok := Item(itemID); !ok {
			t.Fatalf("expected canonical matrix item %s to exist", itemID)
		}
	}

	legacy := []string{"matrix_blue", "matrix_red", "matrix_yellow", "matrix_universe"}
	for _, itemID := range legacy {
		if _, ok := Item(itemID); ok {
			t.Fatalf("expected legacy matrix alias %s to be removed from main item catalog", itemID)
		}
	}

	infoRecipe, ok := Recipe("information_matrix")
	if !ok {
		t.Fatalf("expected information_matrix recipe to exist")
	}
	gravityRecipe, ok := Recipe("gravity_matrix")
	if !ok {
		t.Fatalf("expected gravity_matrix recipe to exist")
	}
	universeRecipe, ok := Recipe("universe_matrix")
	if !ok {
		t.Fatalf("expected universe_matrix recipe to exist")
	}

	if len(infoRecipe.Outputs) == 0 || infoRecipe.Outputs[0].ItemID != "information_matrix" {
		t.Fatalf("expected information_matrix recipe output, got %+v", infoRecipe.Outputs)
	}
	if len(gravityRecipe.Outputs) == 0 || gravityRecipe.Outputs[0].ItemID != "gravity_matrix" {
		t.Fatalf("expected gravity_matrix recipe output, got %+v", gravityRecipe.Outputs)
	}
	expectedUniverseInputs := map[string]bool{
		"electromagnetic_matrix": false,
		"energy_matrix":          false,
		"structure_matrix":       false,
		"information_matrix":     false,
		"gravity_matrix":         false,
		"antimatter":             false,
	}
	for _, input := range universeRecipe.Inputs {
		if _, ok := expectedUniverseInputs[input.ItemID]; ok {
			expectedUniverseInputs[input.ItemID] = true
		}
	}
	for itemID, seen := range expectedUniverseInputs {
		if !seen {
			t.Fatalf("expected universe_matrix recipe to require %s, got %+v", itemID, universeRecipe.Inputs)
		}
	}
}

func TestT090BuildingsAreBuildableAndRuntimeBacked(t *testing.T) {
	cases := []struct {
		btype             BuildingType
		techID            string
		wantCollect       bool
		wantSorter        bool
		wantProduction    bool
		wantEnergyStorage bool
	}{
		{btype: BuildingTypeAdvancedMiningMachine, techID: "photon_mining", wantCollect: true},
		{btype: BuildingTypePileSorter, techID: "integrated_logistics", wantSorter: true},
		{btype: BuildingTypeRecomposingAssembler, techID: "annihilation", wantProduction: true},
		{btype: BuildingTypeEnergyExchanger, techID: "interstellar_power", wantEnergyStorage: true},
	}

	for _, tc := range cases {
		def, ok := BuildingDefinitionByID(tc.btype)
		if !ok {
			t.Fatalf("expected building definition for %s", tc.btype)
		}
		if !def.Buildable {
			t.Fatalf("expected %s to be buildable", tc.btype)
		}
		if !techUnlocksBuilding(t, tc.techID, tc.btype) {
			t.Fatalf("expected tech %s to unlock %s", tc.techID, tc.btype)
		}

		rt, ok := BuildingRuntimeDefinitionByID(tc.btype)
		if !ok {
			t.Fatalf("expected runtime definition for %s", tc.btype)
		}
		if tc.wantCollect && (rt.Functions.Collect == nil || rt.Functions.Storage == nil || rt.Functions.Energy == nil || !runtimeHasPowerConnection(rt)) {
			t.Fatalf("expected %s to have collect+storage+energy runtime, got %+v", tc.btype, rt.Functions)
		}
		if tc.wantSorter && rt.Functions.Sorter == nil {
			t.Fatalf("expected %s to have sorter runtime", tc.btype)
		}
		if tc.wantProduction && (rt.Functions.Production == nil || rt.Functions.Storage == nil || rt.Functions.Energy == nil || !runtimeHasPowerConnection(rt)) {
			t.Fatalf("expected %s to have production+storage+energy runtime, got %+v", tc.btype, rt.Functions)
		}
		if tc.wantEnergyStorage && rt.Functions.EnergyStorage == nil {
			t.Fatalf("expected %s to have energy storage runtime, got %+v", tc.btype, rt.Functions)
		}
	}
}

func TestT091BuildingsAreBuildableAndRuntimeBacked(t *testing.T) {
	cases := []struct {
		btype     BuildingType
		techID    string
		buildCost BuildCost
	}{
		{btype: BuildingTypeJammerTower, techID: "signal_tower", buildCost: BuildCost{Minerals: 120, Energy: 60}},
		{btype: BuildingTypeSRPlasmaTurret, techID: "plasma_turret", buildCost: BuildCost{Minerals: 300, Energy: 150}},
		{btype: BuildingTypePlanetaryShieldGenerator, techID: "planetary_shield", buildCost: BuildCost{Minerals: 500, Energy: 250}},
		{btype: BuildingTypeSelfEvolutionLab, techID: "self_evolution", buildCost: BuildCost{Minerals: 400, Energy: 200}},
	}

	for _, tc := range cases {
		def, ok := BuildingDefinitionByID(tc.btype)
		if !ok {
			t.Fatalf("expected building definition for %s", tc.btype)
		}
		if !def.Buildable {
			t.Fatalf("expected %s to be buildable", tc.btype)
		}
		if def.BuildCost.Minerals != tc.buildCost.Minerals || def.BuildCost.Energy != tc.buildCost.Energy {
			t.Fatalf("expected %s build cost %+v, got %+v", tc.btype, tc.buildCost, def.BuildCost)
		}
		if !techUnlocksBuilding(t, tc.techID, tc.btype) {
			t.Fatalf("expected tech %s to unlock %s", tc.techID, tc.btype)
		}

		rt, ok := BuildingRuntimeDefinitionByID(tc.btype)
		if !ok {
			t.Fatalf("expected runtime definition for %s", tc.btype)
		}
		if !runtimeHasPowerConnection(rt) {
			t.Fatalf("expected %s to expose a power connection", tc.btype)
		}

		switch tc.btype {
		case BuildingTypeJammerTower:
			if rt.Functions.Combat == nil || rt.Functions.Combat.Range <= 0 {
				t.Fatalf("expected %s to have combat range for slow-field lookup, got %+v", tc.btype, rt.Functions.Combat)
			}
			if rt.Functions.Energy == nil || rt.Functions.Energy.ConsumePerTick <= 0 {
				t.Fatalf("expected %s to consume power, got %+v", tc.btype, rt.Functions.Energy)
			}
		case BuildingTypeSRPlasmaTurret:
			if rt.Functions.Combat == nil || rt.Functions.Combat.Attack <= 0 || rt.Functions.Combat.Range <= 0 {
				t.Fatalf("expected %s to have turret combat runtime, got %+v", tc.btype, rt.Functions.Combat)
			}
			if rt.Functions.Energy == nil || rt.Functions.Energy.ConsumePerTick <= 0 {
				t.Fatalf("expected %s to consume power, got %+v", tc.btype, rt.Functions.Energy)
			}
		case BuildingTypePlanetaryShieldGenerator:
			if rt.Functions.Energy == nil || rt.Functions.Energy.ConsumePerTick <= 0 {
				t.Fatalf("expected %s to consume power, got %+v", tc.btype, rt.Functions.Energy)
			}
		case BuildingTypeSelfEvolutionLab:
			if rt.Functions.Production == nil || rt.Functions.Research == nil || rt.Functions.Storage == nil || rt.Functions.Energy == nil {
				t.Fatalf("expected %s to expose production+research+storage+energy, got %+v", tc.btype, rt.Functions)
			}
		}
	}

	if _, ok := Item("dark_fog_matrix"); !ok {
		t.Fatalf("expected dark_fog_matrix to exist in runtime item catalog")
	}

	functionsType := reflect.TypeOf(BuildingFunctionModules{})
	if _, ok := functionsType.FieldByName("Shield"); !ok {
		t.Fatalf("expected BuildingFunctionModules to expose Shield field")
	}

	rt, ok := BuildingRuntimeDefinitionByID(BuildingTypePlanetaryShieldGenerator)
	if !ok {
		t.Fatalf("expected runtime definition for %s", BuildingTypePlanetaryShieldGenerator)
	}
	shieldField := reflect.ValueOf(rt.Functions).FieldByName("Shield")
	if !shieldField.IsValid() || shieldField.IsNil() {
		t.Fatalf("expected %s runtime to include Shield module", BuildingTypePlanetaryShieldGenerator)
	}
	module := shieldField.Elem()
	if module.FieldByName("Capacity").Int() <= 0 || module.FieldByName("ChargePerTick").Int() <= 0 {
		t.Fatalf("expected shield module to expose positive capacity and charge, got %+v", module.Interface())
	}
}

func TestAnnihilationRecipesUseCanonicalTechID(t *testing.T) {
	recipeIDs := []string{
		"annihilation_constraint_sphere",
		"antimatter_fuel_rod",
	}
	for _, recipeID := range recipeIDs {
		recipe, ok := Recipe(recipeID)
		if !ok {
			t.Fatalf("expected recipe %s to exist", recipeID)
		}
		for _, techID := range recipe.TechUnlock {
			if techID == "controlled_annihilation" {
				t.Fatalf("expected recipe %s to stop referencing controlled_annihilation", recipeID)
			}
		}
		found := false
		for _, techID := range recipe.TechUnlock {
			if techID == "annihilation" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected recipe %s to reference annihilation, got %+v", recipeID, recipe.TechUnlock)
		}
	}
}
