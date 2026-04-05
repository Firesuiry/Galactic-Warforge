package model

import "testing"

func hasTechUnlock(unlocks []TechUnlock, typ TechUnlockType, id string) bool {
	for _, unlock := range unlocks {
		if unlock.Type == typ && unlock.ID == id {
			return true
		}
	}
	return false
}

func hasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestT103TechAndBuildingCatalogDerivation(t *testing.T) {
	satellitePower, ok := TechDefinitionByID("satellite_power")
	if !ok {
		t.Fatal("expected satellite_power tech to exist")
	}
	if !hasTechUnlock(satellitePower.Unlocks, TechUnlockBuilding, string(BuildingTypeSatelliteSubstation)) {
		t.Fatalf("expected satellite_power to unlock %s, got %+v", BuildingTypeSatelliteSubstation, satellitePower.Unlocks)
	}

	for _, techID := range []string{
		"engine",
		"steel_smelting",
		"combustible_unit",
		"crystal_smelting",
		"polymer_chemical",
		"high_strength_glass",
		"particle_control",
		"thruster",
	} {
		def, ok := TechDefinitionByID(techID)
		if !ok {
			t.Fatalf("expected tech %s to exist", techID)
		}
		if def.Hidden {
			t.Fatalf("expected bridge tech %s to stay public", techID)
		}
	}

	for _, techID := range []string{
		"casimir_crystal",
		"crystal_explosive",
		"crystal_shell",
		"proliferator_mk2",
		"proliferator_mk3",
		"reformed_refinement",
		"super_magnetic",
		"supersonic_missile",
		"titanium_ammo",
		"wave_interference",
		"xray_cracking",
	} {
		def, ok := TechDefinitionByID(techID)
		if !ok {
			t.Fatalf("expected tech %s to exist", techID)
		}
		if !def.Hidden {
			t.Fatalf("expected dead-end tech %s to be hidden", techID)
		}
	}

	satelliteSubstation, ok := BuildingDefinitionByID(BuildingTypeSatelliteSubstation)
	if !ok {
		t.Fatal("expected satellite_substation building to exist")
	}
	if len(satelliteSubstation.UnlockTech) != 1 || satelliteSubstation.UnlockTech[0] != "satellite_power" {
		t.Fatalf("expected satellite_substation unlock_tech to be [satellite_power], got %+v", satelliteSubstation.UnlockTech)
	}

	automaticPiler, ok := BuildingDefinitionByID(BuildingTypeAutomaticPiler)
	if !ok {
		t.Fatal("expected automatic_piler building to exist")
	}
	if automaticPiler.Buildable {
		t.Fatalf("expected %s to be removed from public buildable buildings", BuildingTypeAutomaticPiler)
	}
	if hasString(automaticPiler.UnlockTech, "integrated_logistics") {
		t.Fatalf("expected %s to stay off the public tech tree, got unlock_tech=%+v", BuildingTypeAutomaticPiler, automaticPiler.UnlockTech)
	}
}
