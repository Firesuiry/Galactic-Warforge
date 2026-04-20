package model

import (
	"testing"
)

func TestT112PresetAndPlayerBlueprintsShareValidationSemantics(t *testing.T) {
	preset, ok := PublicWarBlueprintDefinitionByID(ItemPrototype)
	if !ok {
		t.Fatalf("expected preset blueprint %s", ItemPrototype)
	}
	presetValidation := ValidateWarBlueprint(preset)
	if !presetValidation.Valid {
		t.Fatalf("expected preset blueprint to validate, got %+v", presetValidation)
	}

	playerBlueprint, err := NewPlayerWarBlueprintDraft("p1", "bp-prototype-copy", "Prototype Copy", "light_frame")
	if err != nil {
		t.Fatalf("create player blueprint: %v", err)
	}
	for slotID, componentID := range preset.SlotAssignments {
		if err := playerBlueprint.ApplyComponent(slotID, componentID); err != nil {
			t.Fatalf("apply preset component %s=%s: %v", slotID, componentID, err)
		}
	}

	playerValidation := ValidateWarBlueprint(*playerBlueprint)
	if !playerValidation.Valid {
		t.Fatalf("expected player blueprint to validate, got %+v", playerValidation)
	}
	if presetValidation.Usage != playerValidation.Usage {
		t.Fatalf("expected preset and player blueprint usage to match, preset=%+v player=%+v", presetValidation.Usage, playerValidation.Usage)
	}
}

func TestT112ValidateWarBlueprintReturnsStructuredIssues(t *testing.T) {
	blueprint, err := NewPlayerWarBlueprintDraft("p1", "bp-invalid-space", "Broken Corvette", "corvette_hull")
	if err != nil {
		t.Fatalf("create player blueprint: %v", err)
	}
	for slotID, componentID := range map[string]string{
		"power":          "compact_reactor",
		"engine":         "servo_actuator_pack",
		"defense":        "deflector_shield_array",
		"sensor":         "deep_space_radar",
		"primary_weapon": "coilgun_battery",
		"utility":        "repair_drone_bay",
	} {
		if err := blueprint.ApplyComponent(slotID, componentID); err != nil {
			t.Fatalf("apply component %s=%s: %v", slotID, componentID, err)
		}
	}

	validation := ValidateWarBlueprint(*blueprint)
	if validation.Valid {
		t.Fatalf("expected invalid blueprint, got %+v", validation)
	}
	if !hasWarBlueprintIssueCode(validation.Issues, WarBlueprintIssueHardpointMismatch) {
		t.Fatalf("expected hardpoint mismatch issue, got %+v", validation.Issues)
	}
	if !hasWarBlueprintIssueCode(validation.Issues, WarBlueprintIssuePowerBudgetExceeded) {
		t.Fatalf("expected power budget issue, got %+v", validation.Issues)
	}
}

func TestT112VariantCreationLocksCoreSlotsAndDoesNotMutateParent(t *testing.T) {
	parent, ok := PublicWarBlueprintDefinitionByID(ItemCorvette)
	if !ok {
		t.Fatalf("expected preset blueprint %s", ItemCorvette)
	}

	variant, err := CreateWarBlueprintVariant("p1", "bp-corvette-refit", "Corvette Refit", parent)
	if err != nil {
		t.Fatalf("create variant: %v", err)
	}
	if variant.ParentBlueprintID != parent.ID || variant.ParentSource != WarBlueprintSourcePreset {
		t.Fatalf("expected preset parent linkage, got %+v", variant)
	}
	if !containsStringValue(variant.ModifiableSlots, "primary_weapon") {
		t.Fatalf("expected variant to expose primary_weapon as modifiable, got %+v", variant.ModifiableSlots)
	}
	if containsStringValue(variant.ModifiableSlots, "engine") {
		t.Fatalf("expected engine to stay locked in variant, got %+v", variant.ModifiableSlots)
	}

	if err := variant.ApplyComponent("primary_weapon", "coilgun_battery"); err != nil {
		t.Fatalf("swap variant weapon: %v", err)
	}
	if parent.SlotAssignments["primary_weapon"] != "pulse_laser_mount" {
		t.Fatalf("expected parent blueprint to remain unchanged, got %+v", parent.SlotAssignments)
	}
	if err := variant.ApplyComponent("engine", "ion_drive_cluster"); err == nil {
		t.Fatal("expected locked core slot to reject variant edit")
	}
}

func hasWarBlueprintIssueCode(issues []WarBlueprintValidationIssue, target WarBlueprintIssueCode) bool {
	for _, issue := range issues {
		if issue.Code == target {
			return true
		}
	}
	return false
}

func containsStringValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
