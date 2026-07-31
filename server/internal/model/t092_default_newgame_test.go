package model

import "testing"

func t092HasUnlock(t *testing.T, techID string, unlockType TechUnlockType, unlockID string) bool {
	t.Helper()

	def, ok := TechDefinitionByID(techID)
	if !ok {
		t.Fatalf("tech %s not found", techID)
	}
	for _, unlock := range def.Unlocks {
		if unlock.Type == unlockType && unlock.ID == unlockID {
			return true
		}
	}
	return false
}

// TestT092DefaultNewGameTechEntryIsClosedLoopFriendly pins the DSP-style
// opening: the initial tech grants the full basic industry chain
// (power/mining/smelting/assembling plus entry logistics), while the first
// research (electromagnetism) must be fed with matrices produced by that
// chain.
func TestT092DefaultNewGameTechEntryIsClosedLoopFriendly(t *testing.T) {
	for _, buildingID := range []string{
		string(BuildingTypeMatrixLab),
		string(BuildingTypeWindTurbine),
		string(BuildingTypeMiningMachine),
		string(BuildingTypeArcSmelter),
		string(BuildingTypeTeslaTower),
		string(BuildingTypeConveyorBeltMk1),
		string(BuildingTypeSorterMk1),
		string(BuildingTypeAssemblingMachineMk1),
	} {
		if !t092HasUnlock(t, "dyson_sphere_program", TechUnlockBuilding, buildingID) {
			t.Fatalf("dyson_sphere_program should unlock %s for the fresh industry chain", buildingID)
		}
	}

	if !t092HasUnlock(t, "electromagnetism", TechUnlockBuilding, string(BuildingTypeDepotMk1)) {
		t.Fatalf("electromagnetism should unlock %s", BuildingTypeDepotMk1)
	}

	if _, ok := TechDefinitionByID("electromagnetic_matrix"); ok {
		t.Fatal("electromagnetic_matrix tech should be removed; the matrix recipe is available from the start")
	}
	if _, ok := TechDefinitionByID("improved_logistics"); ok {
		t.Fatal("improved_logistics tech should be removed; its unlocks moved to basic_logistics_system")
	}

	for _, buildingID := range []string{
		string(BuildingTypeSplitter),
		string(BuildingTypeSorterMk2),
		string(BuildingTypeTrafficMonitor),
	} {
		if !t092HasUnlock(t, "basic_logistics_system", TechUnlockBuilding, buildingID) {
			t.Fatalf("basic_logistics_system should unlock %s", buildingID)
		}
	}

	def, ok := TechDefinitionByID("electromagnetism")
	if !ok {
		t.Fatal("electromagnetism tech not found")
	}
	if len(def.Cost) != 1 || def.Cost[0].ItemID != ItemElectromagneticMatrix || def.Cost[0].Quantity != 10 {
		t.Fatalf("electromagnetism should cost 10 electromagnetic_matrix, got %+v", def.Cost)
	}
}

// TestT092MatrixChainRecipesFeedFirstResearch pins the matrix industry
// chain: iron ore -> magnet -> magnetic coil, copper ore -> copper ingot,
// coil + circuit board -> electromagnetic matrix, all usable without any
// research.
func TestT092MatrixChainRecipesFeedFirstResearch(t *testing.T) {
	magnetRecipe, ok := Recipe("smelt_magnet")
	if !ok {
		t.Fatal("expected smelt_magnet recipe")
	}
	if len(magnetRecipe.Inputs) != 1 || magnetRecipe.Inputs[0].ItemID != ItemIronOre {
		t.Fatalf("smelt_magnet should consume iron_ore, got %+v", magnetRecipe.Inputs)
	}
	if len(magnetRecipe.Outputs) != 1 || magnetRecipe.Outputs[0].ItemID != ItemMagnet {
		t.Fatalf("smelt_magnet should output magnet, got %+v", magnetRecipe.Outputs)
	}

	coilRecipe, ok := Recipe("magnetic_coil")
	if !ok {
		t.Fatal("expected magnetic_coil recipe")
	}
	inputs := map[string]int{}
	for _, input := range coilRecipe.Inputs {
		inputs[input.ItemID] = input.Quantity
	}
	if inputs[ItemMagnet] != 2 || inputs[ItemCopperIngot] != 1 {
		t.Fatalf("magnetic_coil should consume 2 magnet + 1 copper_ingot, got %+v", coilRecipe.Inputs)
	}
	if len(coilRecipe.Outputs) != 1 || coilRecipe.Outputs[0].ItemID != ItemMagneticCoil {
		t.Fatalf("magnetic_coil should output magnetic_coil, got %+v", coilRecipe.Outputs)
	}

	matrixRecipe, ok := Recipe("electromagnetic_matrix")
	if !ok {
		t.Fatal("expected electromagnetic_matrix recipe")
	}
	matrixInputs := map[string]int{}
	for _, input := range matrixRecipe.Inputs {
		matrixInputs[input.ItemID] = input.Quantity
	}
	if len(matrixInputs) != 2 || matrixInputs[ItemMagneticCoil] != 1 || matrixInputs[ItemCircuitBoard] != 1 {
		t.Fatalf("electromagnetic_matrix should consume 1 magnetic_coil + 1 circuit_board, got %+v", matrixRecipe.Inputs)
	}

	// None of the chain recipes may be gated behind a tech unlock.
	for _, recipeID := range []string{"smelt_iron", "smelt_copper", "smelt_magnet", "magnetic_coil", "circuit_board", "electromagnetic_matrix"} {
		for _, def := range AllTechDefinitions() {
			for _, unlock := range def.Unlocks {
				if unlock.Type == TechUnlockRecipe && unlock.ID == recipeID {
					t.Fatalf("chain recipe %s must stay research-free, but tech %s claims it", recipeID, def.ID)
				}
			}
		}
	}
}

// TestT092EveryBuildableBuildingIsReachable ensures every buildable
// building is unlocked by at least one tech on the public tree.
func TestT092EveryBuildableBuildingIsReachable(t *testing.T) {
	for _, def := range AllBuildingDefinitions() {
		if !def.Buildable {
			continue
		}
		if len(def.UnlockTech) == 0 {
			t.Fatalf("buildable building %s is not unlocked by any tech", def.ID)
		}
	}
}
