package gateway

import (
	"testing"

	"siliconworld/internal/model"
)

func hasIssueField(issues []model.CommandIssue, field string) bool {
	for _, issue := range issues {
		if issue.Field == field {
			return true
		}
	}
	return false
}

func TestValidateCommandStructureAllowsImplementedLifecycleCommands(t *testing.T) {
	cases := []model.Command{
		{Type: model.CmdStartResearch, Payload: map[string]any{"tech_id": "electromagnetism"}},
		{Type: model.CmdCancelResearch, Payload: map[string]any{"tech_id": "electromagnetism"}},
		{Type: model.CmdTransferItem, Payload: map[string]any{"building_id": "b-1", "item_id": model.ItemSolarSail, "quantity": 2}},
		{Type: model.CmdLaunchSolarSail, Payload: map[string]any{"building_id": "b-1"}},
		{Type: model.CmdLaunchRocket, Payload: map[string]any{"building_id": "b-1", "system_id": "sys-1"}},
		{Type: model.CmdCancelConstruction, Payload: map[string]any{"task_id": "c-1"}},
		{Type: model.CmdRestoreConstruction, Payload: map[string]any{"task_id": "c-1"}},
		{Type: model.CmdBuildDysonNode, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude": 10.0, "longitude": 20.0}},
		{Type: model.CmdBuildDysonFrame, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "node_a_id": "n-1", "node_b_id": "n-2"}},
		{Type: model.CmdBuildDysonShell, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude_min": -15.0, "latitude_max": 15.0, "coverage": 0.4}},
		{Type: model.CmdDemolishDyson, Payload: map[string]any{"system_id": "sys-1", "component_type": "shell", "component_id": "s-1"}},
	}

	for _, cmd := range cases {
		if issues := validateCommandStructure(cmd); len(issues) > 0 {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, issues)
		}
	}
}

func TestValidateCommandStructureAllowsPlanetAndRayReceiverCommands(t *testing.T) {
	cases := []model.Command{
		{Type: model.CmdSwitchActivePlanet, Payload: map[string]any{"planet_id": "planet-1-1"}},
		{Type: model.CmdSetRayReceiverMode, Payload: map[string]any{"building_id": "rr-1", "mode": "power"}},
	}

	for _, cmd := range cases {
		if issues := validateCommandStructure(cmd); len(issues) > 0 {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, issues)
		}
	}
}

func TestValidateCommandStructureRejectsIncompleteLaunchRocket(t *testing.T) {
	cases := []struct {
		cmd   model.Command
		field string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdLaunchRocket,
				Payload: map[string]any{"system_id": "sys-1"},
			},
			field: "payload.building_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdLaunchRocket,
				Payload: map[string]any{"building_id": "b-1"},
			},
			field: "payload.system_id",
		},
	}

	for _, cs := range cases {
		issues := validateCommandStructure(cs.cmd)
		if len(issues) == 0 {
			t.Fatalf("expected command %s to fail validation", cs.cmd.Type)
		}
		if !hasIssueField(issues, cs.field) {
			t.Fatalf("expected issue about %s, got %v", cs.field, issues)
		}
		if issues[0].Code != model.IssueMissingField {
			t.Fatalf("expected missing_field, got %s", issues[0].Code)
		}
	}
}

func TestValidateCommandStructureRejectsIncompleteTransferItem(t *testing.T) {
	cases := []struct {
		cmd   model.Command
		field string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdTransferItem,
				Payload: map[string]any{"item_id": model.ItemSolarSail, "quantity": 1},
			},
			field: "payload.building_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdTransferItem,
				Payload: map[string]any{"building_id": "b-1", "quantity": 1},
			},
			field: "payload.item_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdTransferItem,
				Payload: map[string]any{"building_id": "b-1", "item_id": model.ItemSolarSail},
			},
			field: "payload.quantity",
		},
	}

	for _, cs := range cases {
		issues := validateCommandStructure(cs.cmd)
		if len(issues) == 0 {
			t.Fatalf("expected command %s to fail validation", cs.cmd.Type)
		}
		if !hasIssueField(issues, cs.field) {
			t.Fatalf("expected issue about %s, got %v", cs.field, issues)
		}
	}
}

func TestValidateCommandStructureRejectsIncompletePlanetAndRayReceiverCommands(t *testing.T) {
	cases := []struct {
		cmd   model.Command
		field string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdSwitchActivePlanet,
				Payload: map[string]any{},
			},
			field: "payload.planet_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdSetRayReceiverMode,
				Payload: map[string]any{"mode": "power"},
			},
			field: "payload.building_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdSetRayReceiverMode,
				Payload: map[string]any{"building_id": "rr-1"},
			},
			field: "payload.mode",
		},
	}

	for _, cs := range cases {
		issues := validateCommandStructure(cs.cmd)
		if len(issues) == 0 {
			t.Fatalf("expected command %s to fail validation", cs.cmd.Type)
		}
		if !hasIssueField(issues, cs.field) {
			t.Fatalf("expected issue about %s, got %v", cs.field, issues)
		}
	}
}

func TestValidateCommandStructureAllowsLogisticsCommands(t *testing.T) {
	cases := []model.Command{
		{Type: model.CmdConfigureLogisticsStation, Target: model.CommandTarget{EntityID: "ls-1"}},
		{
			Type:   model.CmdConfigureLogisticsSlot,
			Target: model.CommandTarget{EntityID: "ls-1"},
			Payload: map[string]any{
				"scope":         "planetary",
				"item_id":       model.ItemIronOre,
				"mode":          string(model.LogisticsStationModeSupply),
				"local_storage": 120,
			},
		},
	}

	for _, cmd := range cases {
		if issues := validateCommandStructure(cmd); len(issues) > 0 {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, issues)
		}
	}
}

func TestValidateCommandStructureRejectsIncompleteLogisticsCommands(t *testing.T) {
	cases := []struct {
		cmd   model.Command
		field string
	}{
		{cmd: model.Command{Type: model.CmdConfigureLogisticsStation}, field: "target.entity_id"},
		{
			cmd: model.Command{
				Type:   model.CmdConfigureLogisticsSlot,
				Target: model.CommandTarget{},
				Payload: map[string]any{
					"scope":         "planetary",
					"item_id":       model.ItemIronOre,
					"mode":          string(model.LogisticsStationModeSupply),
					"local_storage": 120,
				},
			},
			field: "target.entity_id",
		},
		{
			cmd: model.Command{
				Type:   model.CmdConfigureLogisticsSlot,
				Target: model.CommandTarget{EntityID: "ls-1"},
				Payload: map[string]any{
					"item_id":       model.ItemIronOre,
					"mode":          string(model.LogisticsStationModeSupply),
					"local_storage": 120,
				},
			},
			field: "payload.scope",
		},
		{
			cmd: model.Command{
				Type:   model.CmdConfigureLogisticsSlot,
				Target: model.CommandTarget{EntityID: "ls-1"},
				Payload: map[string]any{
					"scope":         "planetary",
					"mode":          string(model.LogisticsStationModeSupply),
					"local_storage": 120,
				},
			},
			field: "payload.item_id",
		},
		{
			cmd: model.Command{
				Type:   model.CmdConfigureLogisticsSlot,
				Target: model.CommandTarget{EntityID: "ls-1"},
				Payload: map[string]any{
					"scope":         "planetary",
					"item_id":       model.ItemIronOre,
					"local_storage": 120,
				},
			},
			field: "payload.mode",
		},
		{
			cmd: model.Command{
				Type:   model.CmdConfigureLogisticsSlot,
				Target: model.CommandTarget{EntityID: "ls-1"},
				Payload: map[string]any{
					"scope":   "planetary",
					"item_id": model.ItemIronOre,
					"mode":    string(model.LogisticsStationModeSupply),
				},
			},
			field: "payload.local_storage",
		},
	}

	for _, cs := range cases {
		issues := validateCommandStructure(cs.cmd)
		if len(issues) == 0 {
			t.Fatalf("expected command %s to fail validation", cs.cmd.Type)
		}
		if !hasIssueField(issues, cs.field) {
			t.Fatalf("expected issue about %s, got %v", cs.field, issues)
		}
	}
}

func TestValidateCommandStructureUnknownCommand(t *testing.T) {
	issues := validateCommandStructure(model.Command{Type: "not_a_real_command"})
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %v", issues)
	}
	if issues[0].Code != model.IssueUnknownCommand {
		t.Fatalf("expected unknown_command, got %s", issues[0].Code)
	}
	if issues[0].Field != "type" {
		t.Fatalf("expected field=type, got %s", issues[0].Field)
	}
}
