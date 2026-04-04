package model

import "testing"

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
	assertUnlock := func(t *testing.T, techID string, unlock TechUnlock) {
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

	assertUnlock(t, "basic_assembling_processes", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeAssemblingMachineMk1)})
	assertUnlock(t, "plane_filter_smelting", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypePlaneSmelter)})
	assertUnlock(t, "quantum_printing", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeNegentropySmelter)})
}

func TestMidLateTechUnlocksExposeRecipes(t *testing.T) {
	assertUnlock := func(techID string, unlock TechUnlock) {
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

	assertUnlock("high_strength_crystal", TechUnlock{Type: TechUnlockRecipe, ID: "titanium_crystal"})
	assertUnlock("titanium_alloy", TechUnlock{Type: TechUnlockRecipe, ID: "titanium_alloy"})
	assertUnlock("lightweight_structure", TechUnlock{Type: TechUnlockRecipe, ID: "frame_material"})
	assertUnlock("quantum_chip", TechUnlock{Type: TechUnlockRecipe, ID: "quantum_chip"})
	assertUnlock("vertical_launching", TechUnlock{Type: TechUnlockRecipe, ID: "small_carrier_rocket"})
	assertUnlock("signal_tower", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeJammerTower)})
	assertUnlock("plasma_turret", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeSRPlasmaTurret)})
	assertUnlock("planetary_shield", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypePlanetaryShieldGenerator)})
	assertUnlock("self_evolution", TechUnlock{Type: TechUnlockBuilding, ID: string(BuildingTypeSelfEvolutionLab)})
}
