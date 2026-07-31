package model_test

import (
	"testing"

	"siliconworld/internal/model"
)

func TestBuildCommandCatalogCoversAllCommandTypesExactlyOnce(t *testing.T) {
	catalog := model.BuildCommandCatalog()
	if catalog.Version != 1 {
		t.Fatalf("expected version 1, got %d", catalog.Version)
	}

	all := model.AllCommandTypes()
	if len(catalog.Commands) != len(all) {
		t.Fatalf("expected %d commands, got %d", len(all), len(catalog.Commands))
	}

	seen := make(map[string]int, len(catalog.Commands))
	for _, entry := range catalog.Commands {
		seen[entry.Type]++
		if entry.Schema == nil {
			t.Fatalf("command %s missing schema", entry.Type)
		}
		if entry.RequiredTargetFields == nil {
			t.Fatalf("command %s required_target_fields must be non-nil slice (may be empty)", entry.Type)
		}
		if entry.RequiredPayloadFields == nil {
			t.Fatalf("command %s required_payload_fields must be non-nil slice (may be empty)", entry.Type)
		}
	}
	for _, cmdType := range all {
		if seen[string(cmdType)] != 1 {
			t.Fatalf("command type %s appears %d times, want 1", cmdType, seen[string(cmdType)])
		}
	}
	if catalog.CommandSchema == nil {
		t.Fatal("expected command_schema oneOf aggregate")
	}
	oneOf, ok := catalog.CommandSchema["oneOf"].([]any)
	if !ok || len(oneOf) != len(all) {
		t.Fatalf("expected command_schema.oneOf length %d, got %T %v", len(all), catalog.CommandSchema["oneOf"], catalog.CommandSchema["oneOf"])
	}
}

func TestCommandCatalogSpotCheckRequiredFields(t *testing.T) {
	byType := map[string]model.CommandCatalogEntry{}
	for _, entry := range model.BuildCommandCatalog().Commands {
		byType[entry.Type] = entry
	}

	assertFields := func(cmdType string, target, payload []string) {
		t.Helper()
		entry, ok := byType[cmdType]
		if !ok {
			t.Fatalf("missing catalog entry %s", cmdType)
		}
		if !sameStringSet(entry.RequiredTargetFields, target) {
			t.Fatalf("%s required_target_fields = %v, want %v", cmdType, entry.RequiredTargetFields, target)
		}
		if !sameStringSet(entry.RequiredPayloadFields, payload) {
			t.Fatalf("%s required_payload_fields = %v, want %v", cmdType, entry.RequiredPayloadFields, payload)
		}
	}

	assertFields("build", []string{"position"}, []string{"building_type"})
	assertFields("transfer_item", nil, []string{"building_id", "item_id", "quantity"})
	assertFields("fleet_move", nil, []string{"fleet_id", "target_system_id"})
	assertFields("queue_military_production", nil, []string{"building_id", "deployment_hub_id", "blueprint_id", "count"})

	bp := byType["blueprint_create"]
	if !containsString(bp.Constraints, "exactly one of base_frame_id or base_hull_id") {
		t.Fatalf("blueprint_create missing XOR constraint, got %v", bp.Constraints)
	}
	if !sameStringSet(bp.RequiredPayloadFields, []string{"blueprint_id", "domain"}) {
		t.Fatalf("blueprint_create required payload mismatch: %v", bp.RequiredPayloadFields)
	}
}

func TestValidateCommandStructureUsesSharedRegistry(t *testing.T) {
	if issues := model.ValidateCommandStructure(model.Command{
		Type: model.CmdBuild,
		Target: model.CommandTarget{
			Position: &model.Position{X: 1, Y: 2},
		},
		Payload: map[string]any{"building_type": "mining_machine"},
	}); len(issues) != 0 {
		t.Fatalf("expected valid build, got %v", issues)
	}

	issues := model.ValidateCommandStructure(model.Command{
		Type:    model.CmdTransferItem,
		Payload: map[string]any{"item_id": "iron_ore", "quantity": 1},
	})
	if len(issues) == 0 {
		t.Fatal("expected incomplete transfer_item to fail")
	}
	found := false
	for _, issue := range issues {
		if issue.Field == "payload.building_id" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected missing payload.building_id, got %v", issues)
	}

	xorIssues := model.ValidateCommandStructure(model.Command{
		Type: model.CmdBlueprintCreate,
		Payload: map[string]any{
			"blueprint_id":  "bp-1",
			"domain":        "ground",
			"base_frame_id": "light_frame",
			"base_hull_id":  "corvette_hull",
		},
	})
	if len(xorIssues) == 0 {
		t.Fatal("expected blueprint_create XOR failure")
	}

	unknown := model.ValidateCommandStructure(model.Command{Type: "not_a_real_command"})
	if len(unknown) != 1 || unknown[0].Code != model.IssueUnknownCommand {
		t.Fatalf("expected unknown_command, got %v", unknown)
	}
}

func sameStringSet(got, want []string) bool {
	if len(got) == 0 && len(want) == 0 {
		return true
	}
	if len(got) != len(want) {
		return false
	}
	counts := map[string]int{}
	for _, v := range got {
		counts[v]++
	}
	for _, v := range want {
		counts[v]--
		if counts[v] < 0 {
			return false
		}
	}
	for _, n := range counts {
		if n != 0 {
			return false
		}
	}
	return true
}

func containsString(values []string, target string) bool {
	for _, v := range values {
		if v == target {
			return true
		}
	}
	return false
}
