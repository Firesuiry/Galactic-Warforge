package model

import "testing"

func defaultTechDefinitionByID(t *testing.T, techID string) *TechDefinition {
	t.Helper()
	for i := range defaultTechDefinitions {
		if defaultTechDefinitions[i].ID == techID {
			return &defaultTechDefinitions[i]
		}
	}
	t.Fatalf("default tech %s not found", techID)
	return nil
}

func assertTechHasUnlock(t *testing.T, techID string, unlock TechUnlock) {
	t.Helper()
	def, ok := TechDefinitionByID(techID)
	if !ok {
		t.Fatalf("tech %s not found", techID)
	}
	for _, candidate := range def.Unlocks {
		if candidate.Type == unlock.Type && candidate.ID == unlock.ID {
			return
		}
	}
	t.Fatalf("tech %s missing unlock %s:%s", techID, unlock.Type, unlock.ID)
}

func assertTechLacksUnlockType(t *testing.T, techID string, unlockType TechUnlockType) {
	t.Helper()
	def, ok := TechDefinitionByID(techID)
	if !ok {
		t.Fatalf("tech %s not found", techID)
	}
	for _, unlock := range def.Unlocks {
		if unlock.Type == unlockType {
			t.Fatalf("expected tech %s to stop exposing %s unlocks, got %+v", techID, unlockType, def.Unlocks)
		}
	}
}

func TestT100FleetTechsExposePublicRecipesAndStayRuntimeBacked(t *testing.T) {
	cases := map[string]string{
		"prototype":       "prototype",
		"precision_drone": "precision_drone",
		"corvette":        "corvette",
		"destroyer":       "destroyer",
	}
	for techID, recipeID := range cases {
		def := defaultTechDefinitionByID(t, techID)
		if def.Hidden {
			t.Fatalf("expected raw tech %s to be visible after T100 cutover", techID)
		}
		foundRecipe := false
		for _, unlock := range def.Unlocks {
			if unlock.Type == TechUnlockUnit {
				t.Fatalf("expected raw tech %s to stay recipe-backed instead of unit-backed, got %+v", techID, def.Unlocks)
			}
			if unlock.Type == TechUnlockRecipe && unlock.ID == recipeID {
				foundRecipe = true
			}
		}
		if !foundRecipe {
			t.Fatalf("expected tech %s to unlock recipe %s, got %+v", techID, recipeID, def.Unlocks)
		}
	}
}

func TestTechUnlockReferencesAreAligned(t *testing.T) {
	for _, def := range AllTechDefinitions() {
		if def == nil {
			continue
		}
		for _, unlock := range def.Unlocks {
			switch unlock.Type {
			case TechUnlockBuilding:
				if _, ok := BuildingDefinitionByID(BuildingType(unlock.ID)); !ok {
					t.Fatalf("tech %s references unknown building unlock %s", def.ID, unlock.ID)
				}
			case TechUnlockRecipe:
				if _, ok := Recipe(unlock.ID); !ok {
					t.Fatalf("tech %s references unknown recipe unlock %s", def.ID, unlock.ID)
				}
			}
		}
	}
}

func TestKeyTechUnlocksMatchImplementedBuildings(t *testing.T) {
	assertTechHasUnlock(t, "basic_assembling_processes", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeAssemblingMachineMk1)})
	assertTechHasUnlock(t, "plane_filter_smelting", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypePlaneSmelter)})
	assertTechHasUnlock(t, "quantum_printing", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeNegentropySmelter)})
}

func TestMidLateTechUnlocksExposeRecipes(t *testing.T) {
	assertTechHasUnlock(t, "high_strength_crystal", TechUnlock{Type: TechUnlockRecipe, ID: "titanium_crystal"})
	assertTechHasUnlock(t, "titanium_alloy", TechUnlock{Type: TechUnlockRecipe, ID: "titanium_alloy"})
	assertTechHasUnlock(t, "lightweight_structure", TechUnlock{Type: TechUnlockRecipe, ID: "frame_material"})
	assertTechHasUnlock(t, "quantum_chip", TechUnlock{Type: TechUnlockRecipe, ID: "quantum_chip"})
	assertTechHasUnlock(t, "vertical_launching", TechUnlock{Type: TechUnlockRecipe, ID: "small_carrier_rocket"})
	assertTechHasUnlock(t, "signal_tower", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeJammerTower)})
	assertTechHasUnlock(t, "plasma_turret", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeSRPlasmaTurret)})
	assertTechHasUnlock(t, "planetary_shield", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypePlanetaryShieldGenerator)})
	assertTechHasUnlock(t, "self_evolution", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeSelfEvolutionLab)})
}

func TestT100EndgameTechUnlocksExposeOnlyRuntimeBackedTargets(t *testing.T) {
	assertTechHasUnlock(t, "mass_energy_storage", TechUnlock{Type: TechUnlockRecipe, ID: "antimatter_capsule"})
	assertTechHasUnlock(t, "gravity_missile", TechUnlock{Type: TechUnlockRecipe, ID: "gravity_missile"})
	assertTechHasUnlock(t, "distribution_logistics", TechUnlock{Type: TechUnlockUnit, ID: "logistics_drone"})
	assertTechHasUnlock(t, "planetary_logistics", TechUnlock{Type: TechUnlockUnit, ID: "logistics_ship"})

	assertTechLacksUnlockType(t, "engine", TechUnlockUnit)
	for _, techID := range []string{"prototype", "precision_drone", "corvette", "destroyer"} {
		assertTechLacksUnlockType(t, techID, TechUnlockUnit)
		def, ok := TechDefinitionByID(techID)
		if !ok {
			t.Fatalf("tech %s not found", techID)
		}
		if def.Hidden {
			t.Fatalf("expected %s to be visible after T100 cutover", techID)
		}
	}

	if def, ok := TechDefinitionByID("dark_fog_matrix"); !ok {
		t.Fatal("dark_fog_matrix tech not found")
	} else if !def.Hidden {
		t.Fatal("expected unrelated hidden tech dark_fog_matrix to remain hidden")
	}
}
