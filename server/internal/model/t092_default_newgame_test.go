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

func TestT092DefaultNewGameTechEntryIsClosedLoopFriendly(t *testing.T) {
	if !t092HasUnlock(t, "dyson_sphere_program", TechUnlockBuilding, string(BuildingTypeMatrixLab)) {
		t.Fatalf("dyson_sphere_program should unlock %s for fresh research entry", BuildingTypeMatrixLab)
	}
	if t092HasUnlock(t, "dyson_sphere_program", TechUnlockSpecial, "electromagnetic_matrix") {
		t.Fatal("dyson_sphere_program should not keep electromagnetic_matrix special semantics")
	}

	for _, buildingID := range []string{
		string(BuildingTypeWindTurbine),
		string(BuildingTypeTeslaTower),
		string(BuildingTypeMiningMachine),
	} {
		if !t092HasUnlock(t, "electromagnetism", TechUnlockBuilding, buildingID) {
			t.Fatalf("electromagnetism should still unlock %s", buildingID)
		}
	}

	if t092HasUnlock(t, "electromagnetic_matrix", TechUnlockBuilding, string(BuildingTypeMatrixLab)) {
		t.Fatalf("electromagnetic_matrix should no longer unlock %s", BuildingTypeMatrixLab)
	}
	if !t092HasUnlock(t, "electromagnetic_matrix", TechUnlockSpecial, "electromagnetic_matrix") {
		t.Fatal("electromagnetic_matrix should carry its own special semantics")
	}
}
