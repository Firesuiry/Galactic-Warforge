package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT112BlueprintCommandsCreateValidateFinalizeAndVariant(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})
	grantTechs(ws, "p1", "prototype", "precision_drone", "corvette", "destroyer")

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintCreate,
		Payload: map[string]any{
			"blueprint_id":  "bp-prototype-1",
			"name":          "Prototype Mk1",
			"base_frame_id": "light_frame",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blueprint_create failed: %s (%s)", res.Code, res.Message)
	}

	for slotID, componentID := range map[string]string{
		"power":          "compact_reactor",
		"mobility":       "servo_actuator_pack",
		"defense":        "composite_armor_plating",
		"sensor":         "battlefield_sensor_suite",
		"primary_weapon": "pulse_laser_mount",
		"utility":        "command_uplink",
	} {
		if res := issueInternalCommand(core, "p1", model.Command{
			Type: model.CmdBlueprintSetComponent,
			Payload: map[string]any{
				"blueprint_id": "bp-prototype-1",
				"slot_id":      slotID,
				"component_id": componentID,
			},
		}); res.Code != model.CodeOK {
			t.Fatalf("blueprint_set_component %s failed: %s (%s)", slotID, res.Code, res.Message)
		}
	}

	validateRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintValidate,
		Payload: map[string]any{
			"blueprint_id": "bp-prototype-1",
		},
	})
	if validateRes.Code != model.CodeOK {
		t.Fatalf("blueprint_validate failed: %+v", validateRes)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintFinalize,
		Payload: map[string]any{
			"blueprint_id": "bp-prototype-1",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blueprint_finalize failed: %s (%s)", res.Code, res.Message)
	}

	for _, status := range []model.WarBlueprintStatus{
		model.WarBlueprintStatusFieldTested,
		model.WarBlueprintStatusAdopted,
	} {
		if res := issueInternalCommand(core, "p1", model.Command{
			Type: model.CmdBlueprintSetStatus,
			Payload: map[string]any{
				"blueprint_id": "bp-prototype-1",
				"status":       string(status),
			},
		}); res.Code != model.CodeOK {
			t.Fatalf("blueprint_set_status %s failed: %s (%s)", status, res.Code, res.Message)
		}
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintVariant,
		Payload: map[string]any{
			"parent_blueprint_id": model.ItemCorvette,
			"blueprint_id":        "bp-corvette-refit",
			"name":                "Corvette Refit",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("blueprint_variant failed: %s (%s)", res.Code, res.Message)
	}

	lockedRes := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintSetComponent,
		Payload: map[string]any{
			"blueprint_id": "bp-corvette-refit",
			"slot_id":      "engine",
			"component_id": "ion_drive_cluster",
		},
	})
	if lockedRes.Code != model.CodeValidationFailed {
		t.Fatalf("expected locked variant slot to fail, got %+v", lockedRes)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintSetComponent,
		Payload: map[string]any{
			"blueprint_id": "bp-corvette-refit",
			"slot_id":      "primary_weapon",
			"component_id": "coilgun_battery",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("variant weapon swap failed: %s (%s)", res.Code, res.Message)
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdBlueprintValidate,
		Payload: map[string]any{
			"blueprint_id": "bp-corvette-refit",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("variant validate failed: %s (%s)", res.Code, res.Message)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	listView := ql.WarBlueprints(ws, "p1")
	if len(listView.Blueprints) != 2 {
		t.Fatalf("expected two player blueprints, got %+v", listView.Blueprints)
	}
	detailView, ok := ql.WarBlueprint(ws, "p1", "bp-corvette-refit")
	if !ok {
		t.Fatal("expected blueprint detail view")
	}
	if detailView.ParentBlueprintID != model.ItemCorvette || detailView.ParentSource != model.WarBlueprintSourcePreset {
		t.Fatalf("expected preset parent linkage, got %+v", detailView)
	}
	if detailView.LastValidation == nil || !detailView.LastValidation.Valid {
		t.Fatalf("expected variant validation details, got %+v", detailView.LastValidation)
	}
	if detailView.SlotAssignments["primary_weapon"] != "coilgun_battery" {
		t.Fatalf("expected swapped weapon in detail view, got %+v", detailView.SlotAssignments)
	}
}
