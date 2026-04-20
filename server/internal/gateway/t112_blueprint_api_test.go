package gateway_test

import (
	"testing"
	"time"

	"siliconworld/internal/model"
)

func TestT112WarfareBlueprintEndpointsExposePlayerAndPresetDetail(t *testing.T) {
	srv, core := newTestServer(t)
	go core.Run()
	defer core.Stop()

	resp := postCommandRequest(t, srv, model.CommandRequest{
		RequestID:  "req-t112-blueprint-flow",
		IssuerType: "player",
		IssuerID:   "p1",
		Commands: []model.Command{
			{
				Type: model.CmdBlueprintCreate,
				Payload: map[string]any{
					"blueprint_id":  "raider_mk1",
					"name":          "Raider Mk1",
					"domain":        string(model.UnitDomainGround),
					"base_frame_id": "light_frame",
				},
			},
			{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": "raider_mk1", "slot_id": "power_core", "component_id": "micro_reactor"}},
			{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": "raider_mk1", "slot_id": "mobility", "component_id": "servo_drive"}},
			{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": "raider_mk1", "slot_id": "armor", "component_id": "reactive_armor"}},
			{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": "raider_mk1", "slot_id": "sensor", "component_id": "tactical_radar"}},
			{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": "raider_mk1", "slot_id": "weapon_primary", "component_id": "plasma_lance"}},
			{Type: model.CmdBlueprintValidate, Payload: map[string]any{"blueprint_id": "raider_mk1"}},
		},
	})
	if !resp.Accepted {
		t.Fatalf("expected command request to be accepted, got %+v", resp.Results)
	}

	waitForCondition(t, 2*time.Second, func() bool {
		ws := core.World()
		player := ws.Players["p1"]
		return player != nil &&
			player.WarBlueprints["raider_mk1"] != nil &&
			player.WarBlueprints["raider_mk1"].State == model.WarBlueprintStateValidated
	}, "blueprint lifecycle commands were not applied by tick loop")

	listBody := getAuthorizedJSON(t, srv, "/world/warfare/blueprints")
	blueprints, ok := listBody["blueprints"].([]any)
	if !ok || len(blueprints) != 1 {
		t.Fatalf("expected one player blueprint, got %v", listBody)
	}
	first, ok := blueprints[0].(map[string]any)
	if !ok {
		t.Fatalf("expected player blueprint object, got %T", blueprints[0])
	}
	if first["id"] != "raider_mk1" {
		t.Fatalf("expected list response to include created blueprint, got %+v", first)
	}
	validationBody, ok := first["validation"].(map[string]any)
	if !ok {
		t.Fatalf("expected list response to include validation, got %+v", first)
	}
	if valid, ok := validationBody["valid"].(bool); !ok || !valid {
		t.Fatalf("expected created blueprint validation to be true, got %+v", validationBody)
	}

	detailBody := getAuthorizedJSON(t, srv, "/world/warfare/blueprints/raider_mk1")
	if detailBody["parent_blueprint_id"] != nil {
		t.Fatalf("expected base blueprint to have no parent, got %+v", detailBody)
	}
	if detailBody["state"] != string(model.WarBlueprintStateValidated) {
		t.Fatalf("expected validated state in detail response, got %+v", detailBody)
	}

	presetBody := getAuthorizedJSON(t, srv, "/world/warfare/blueprints/prototype")
	if presetBody["source"] != string(model.WarBlueprintSourcePreset) {
		t.Fatalf("expected preset detail source, got %+v", presetBody)
	}
	if presetBody["state"] != string(model.WarBlueprintStateAdopted) {
		t.Fatalf("expected preset detail to expose adopted state, got %+v", presetBody)
	}
	presetValidation, ok := presetBody["validation"].(map[string]any)
	if !ok {
		t.Fatalf("expected preset detail to include validation, got %+v", presetBody)
	}
	if valid, ok := presetValidation["valid"].(bool); !ok || !valid {
		t.Fatalf("expected preset validation to be true, got %+v", presetValidation)
	}

	ws := core.World()
	if ws.Players["p1"] == nil || ws.Players["p1"].WarBlueprints["raider_mk1"] == nil {
		t.Fatalf("expected blueprint to be stored on player state, got %+v", ws.Players["p1"])
	}
}
