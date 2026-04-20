package model_test

import (
	"testing"

	"siliconworld/internal/model"
)

func TestValidateWarBlueprintReportsStructuredConstraintIssues(t *testing.T) {
	catalog := model.NewWarBlueprintCatalogIndex(
		[]model.WarBaseFrameCatalogEntry{
			{
				ID:               "test_frame",
				Name:             "Test Frame",
				SupportedDomains: []model.UnitDomain{model.UnitDomainGround},
				Budgets: model.WarBudgetProfile{
					PowerOutput:      80,
					SustainedDraw:    60,
					VolumeCapacity:   30,
					MassCapacity:     24,
					RigidityCapacity: 12,
					HeatCapacity:     10,
					MaintenanceLimit: 2,
					SignalCapacity:   4,
				},
				Slots: []model.WarSlotSpec{
					{ID: "power_core", Category: model.WarComponentCategoryPower, Required: true},
					{ID: "armor", Category: model.WarComponentCategoryDefense, Required: true},
					{ID: "weapon_primary", Category: model.WarComponentCategoryWeapon, Required: true},
					{ID: "utility", Category: model.WarComponentCategoryUtility},
				},
			},
		},
		nil,
		[]model.WarComponentCatalogEntry{
			{ID: "test_reactor", Name: "Test Reactor", Category: model.WarComponentCategoryPower, SupportedDomains: []model.UnitDomain{model.UnitDomainGround}, PowerOutput: 30, Volume: 8, Mass: 6, HeatLoad: 2, Maintenance: 1, SignalLoad: 1},
			{ID: "test_armor", Name: "Test Armor", Category: model.WarComponentCategoryDefense, SupportedDomains: []model.UnitDomain{model.UnitDomainGround}, PowerDraw: 40, Volume: 12, Mass: 14, RigidityLoad: 6, HeatLoad: 2, Maintenance: 1, SignalLoad: 1},
			{ID: "test_ecm", Name: "Test ECM", Category: model.WarComponentCategoryUtility, SupportedDomains: []model.UnitDomain{model.UnitDomainGround}, PowerDraw: 10, Volume: 8, Mass: 8, HeatLoad: 2, Maintenance: 1, SignalLoad: 3, StealthRating: 1},
			{ID: "test_cloak", Name: "Test Cloak", Category: model.WarComponentCategoryUtility, SupportedDomains: []model.UnitDomain{model.UnitDomainGround}, PowerDraw: 45, Volume: 14, Mass: 10, RigidityLoad: 12, HeatLoad: 20, Maintenance: 3, SignalLoad: 10, StealthRating: 1},
		},
		nil,
	)

	blueprint := model.WarBlueprint{
		ID:          "invalid-frame",
		OwnerID:     "p1",
		Name:        "Invalid Frame",
		Source:      model.WarBlueprintSourcePlayer,
		State:       model.WarBlueprintStateDraft,
		Domain:      model.UnitDomainGround,
		BaseFrameID: "test_frame",
		Components: []model.WarBlueprintComponentSlot{
			{SlotID: "power_core", ComponentID: "test_reactor"},
			{SlotID: "armor", ComponentID: "test_armor"},
			{SlotID: "weapon_primary", ComponentID: "test_ecm"},
			{SlotID: "utility", ComponentID: "test_cloak"},
		},
	}

	result := model.ValidateWarBlueprint(catalog, blueprint)
	if result.Valid {
		t.Fatalf("expected invalid blueprint, got %+v", result)
	}

	codes := map[model.WarBlueprintValidationIssueCode]struct{}{}
	for _, issue := range result.Issues {
		codes[issue.Code] = struct{}{}
	}

	for _, code := range []model.WarBlueprintValidationIssueCode{
		model.WarBlueprintIssuePowerBudgetExceeded,
		model.WarBlueprintIssueVolumeBudgetExceeded,
		model.WarBlueprintIssueMassBudgetExceeded,
		model.WarBlueprintIssueRigidityBudgetExceeded,
		model.WarBlueprintIssueHeatDissipationInsufficient,
		model.WarBlueprintIssueSignatureBudgetExceeded,
		model.WarBlueprintIssueMaintenanceBudgetExceeded,
		model.WarBlueprintIssueHardpointMismatch,
	} {
		if _, ok := codes[code]; !ok {
			t.Fatalf("expected issue %s, got %+v", code, result.Issues)
		}
	}
}

func TestPresetWarBlueprintsShareValidationSemantics(t *testing.T) {
	catalog := model.PublicWarBlueprintCatalogIndex()
	preset, ok := model.PresetWarBlueprintByID(model.ItemDestroyer)
	if !ok {
		t.Fatal("expected destroyer preset blueprint")
	}

	result := model.ValidateWarBlueprint(catalog, preset)
	if !result.Valid {
		t.Fatalf("expected preset blueprint to validate, got %+v", result)
	}
	if len(result.Issues) != 0 {
		t.Fatalf("expected preset blueprint to have no issues, got %+v", result.Issues)
	}
}
