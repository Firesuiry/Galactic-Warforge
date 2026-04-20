package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestT112BlueprintLifecycleAndVariantClosure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	createRes, _ := core.execBlueprintCreate(ws, "p1", model.Command{
		Type: model.CmdBlueprintCreate,
		Payload: map[string]any{
			"blueprint_id":  "falcon_mk1",
			"name":          "Falcon Mk1",
			"domain":        string(model.UnitDomainGround),
			"base_frame_id": "light_frame",
		},
	})
	if createRes.Code != model.CodeOK {
		t.Fatalf("expected blueprint_create to succeed, got %s (%s)", createRes.Code, createRes.Message)
	}

	player := ws.Players["p1"]
	if player == nil || player.WarBlueprints["falcon_mk1"] == nil {
		t.Fatalf("expected player blueprint to be created, got %+v", player)
	}
	if player.WarBlueprints["falcon_mk1"].State != model.WarBlueprintStateDraft {
		t.Fatalf("expected draft state after create, got %+v", player.WarBlueprints["falcon_mk1"])
	}

	for _, payload := range []map[string]any{
		{"blueprint_id": "falcon_mk1", "slot_id": "power_core", "component_id": "micro_reactor"},
		{"blueprint_id": "falcon_mk1", "slot_id": "mobility", "component_id": "servo_drive"},
		{"blueprint_id": "falcon_mk1", "slot_id": "armor", "component_id": "reactive_armor"},
		{"blueprint_id": "falcon_mk1", "slot_id": "sensor", "component_id": "tactical_radar"},
		{"blueprint_id": "falcon_mk1", "slot_id": "weapon_primary", "component_id": "ecm_suite"},
	} {
		res, _ := core.execBlueprintSetComponent(ws, "p1", model.Command{Type: model.CmdBlueprintSetComponent, Payload: payload})
		if res.Code != model.CodeOK {
			t.Fatalf("expected set_component to accept draft edits, got %s (%s)", res.Code, res.Message)
		}
	}

	validateFailRes, _ := core.execBlueprintValidate(ws, "p1", model.Command{
		Type:    model.CmdBlueprintValidate,
		Payload: map[string]any{"blueprint_id": "falcon_mk1"},
	})
	if validateFailRes.Code != model.CodeValidationFailed {
		t.Fatalf("expected invalid validation result, got %s (%s)", validateFailRes.Code, validateFailRes.Message)
	}
	if validateFailRes.Validation == nil {
		t.Fatalf("expected structured validation payload, got %+v", validateFailRes)
	}
	issueCodes := map[model.WarBlueprintValidationIssueCode]struct{}{}
	for _, issue := range validateFailRes.Validation.Issues {
		issueCodes[issue.Code] = struct{}{}
	}
	if _, ok := issueCodes[model.WarBlueprintIssueHardpointMismatch]; !ok {
		t.Fatalf("expected hardpoint mismatch, got %+v", validateFailRes.Validation.Issues)
	}
	if player.WarBlueprints["falcon_mk1"].State != model.WarBlueprintStateDraft {
		t.Fatalf("expected invalid blueprint to stay draft, got %+v", player.WarBlueprints["falcon_mk1"])
	}

	for _, payload := range []map[string]any{
		{"blueprint_id": "falcon_mk1", "slot_id": "weapon_primary", "component_id": "plasma_lance"},
		{"blueprint_id": "falcon_mk1", "slot_id": "utility", "component_id": "field_repair_pack"},
	} {
		res, _ := core.execBlueprintSetComponent(ws, "p1", model.Command{Type: model.CmdBlueprintSetComponent, Payload: payload})
		if res.Code != model.CodeOK {
			t.Fatalf("expected set_component repair edit to succeed, got %s (%s)", res.Code, res.Message)
		}
	}

	validateOKRes, _ := core.execBlueprintValidate(ws, "p1", model.Command{
		Type:    model.CmdBlueprintValidate,
		Payload: map[string]any{"blueprint_id": "falcon_mk1"},
	})
	if validateOKRes.Code != model.CodeOK {
		t.Fatalf("expected valid blueprint after repair, got %s (%s)", validateOKRes.Code, validateOKRes.Message)
	}
	if player.WarBlueprints["falcon_mk1"].State != model.WarBlueprintStateValidated {
		t.Fatalf("expected validated state after validate, got %+v", player.WarBlueprints["falcon_mk1"])
	}

	finalizeRes, _ := core.execBlueprintFinalize(ws, "p1", model.Command{
		Type: model.CmdBlueprintFinalize,
		Payload: map[string]any{
			"blueprint_id":  "falcon_mk1",
			"target_state": "prototype",
		},
	})
	if finalizeRes.Code != model.CodeOK {
		t.Fatalf("expected finalize to prototype, got %s (%s)", finalizeRes.Code, finalizeRes.Message)
	}
	if player.WarBlueprints["falcon_mk1"].State != model.WarBlueprintStatePrototype {
		t.Fatalf("expected prototype state after finalize, got %+v", player.WarBlueprints["falcon_mk1"])
	}

	variantRes, _ := core.execBlueprintVariant(ws, "p1", model.Command{
		Type: model.CmdBlueprintVariant,
		Payload: map[string]any{
			"parent_blueprint_id": "falcon_mk1",
			"blueprint_id":        "falcon_mk1_ew",
			"name":                "Falcon Mk1 EW",
			"allowed_slot_ids":    []string{"utility"},
		},
	})
	if variantRes.Code != model.CodeOK {
		t.Fatalf("expected variant creation to succeed, got %s (%s)", variantRes.Code, variantRes.Message)
	}

	variant := player.WarBlueprints["falcon_mk1_ew"]
	if variant == nil {
		t.Fatal("expected derived player blueprint")
	}
	if variant.ParentBlueprintID != "falcon_mk1" {
		t.Fatalf("expected parent relation, got %+v", variant)
	}
	if variant.State != model.WarBlueprintStateDraft {
		t.Fatalf("expected variant to start as draft, got %+v", variant)
	}
	if len(variant.AllowedVariantSlots) != 1 || variant.AllowedVariantSlots[0] != "utility" {
		t.Fatalf("expected explicit variant slot restrictions, got %+v", variant.AllowedVariantSlots)
	}

	restrictedRes, _ := core.execBlueprintSetComponent(ws, "p1", model.Command{
		Type: model.CmdBlueprintSetComponent,
		Payload: map[string]any{
			"blueprint_id": "falcon_mk1_ew",
			"slot_id":      "weapon_primary",
			"component_id": "plasma_lance",
		},
	})
	if restrictedRes.Code != model.CodeValidationFailed {
		t.Fatalf("expected restricted variant slot edit to fail, got %s (%s)", restrictedRes.Code, restrictedRes.Message)
	}

	allowedRes, _ := core.execBlueprintSetComponent(ws, "p1", model.Command{
		Type: model.CmdBlueprintSetComponent,
		Payload: map[string]any{
			"blueprint_id": "falcon_mk1_ew",
			"slot_id":      "utility",
			"component_id": "field_repair_pack",
		},
	})
	if allowedRes.Code != model.CodeOK {
		t.Fatalf("expected allowed variant slot edit to succeed, got %s (%s)", allowedRes.Code, allowedRes.Message)
	}

	parent := player.WarBlueprints["falcon_mk1"]
	if parent == nil {
		t.Fatal("expected parent blueprint to remain present")
	}
	if parent.ComponentsBySlot()["utility"] != "field_repair_pack" {
		t.Fatalf("expected parent blueprint components to stay unchanged, got %+v", parent.Components)
	}
}
