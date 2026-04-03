package gateway

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

func TestValidateCommandStructureAllowsImplementedLifecycleCommands(t *testing.T) {
	cases := []model.Command{
		{Type: model.CmdStartResearch, Payload: map[string]any{"tech_id": "electromagnetism"}},
		{Type: model.CmdCancelResearch, Payload: map[string]any{"tech_id": "electromagnetism"}},
		{Type: model.CmdLaunchSolarSail, Payload: map[string]any{"building_id": "b-1"}},
		{Type: model.CmdCancelConstruction, Payload: map[string]any{"task_id": "c-1"}},
		{Type: model.CmdRestoreConstruction, Payload: map[string]any{"task_id": "c-1"}},
		{Type: model.CmdBuildDysonNode, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude": 10.0, "longitude": 20.0}},
		{Type: model.CmdBuildDysonFrame, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "node_a_id": "n-1", "node_b_id": "n-2"}},
		{Type: model.CmdBuildDysonShell, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude_min": -15.0, "latitude_max": 15.0, "coverage": 0.4}},
		{Type: model.CmdDemolishDyson, Payload: map[string]any{"system_id": "sys-1", "component_type": "shell", "component_id": "s-1"}},
	}

	for _, cmd := range cases {
		if err := validateCommandStructure(cmd); err != nil {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, err)
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
		if err := validateCommandStructure(cmd); err != nil {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, err)
		}
	}
}

func TestValidateCommandStructureRejectsIncompleteLogisticsCommands(t *testing.T) {
	cases := []struct {
		cmd model.Command
		msg string
	}{
		{cmd: model.Command{Type: model.CmdConfigureLogisticsStation}, msg: "target.entity_id"},
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
			msg: "configure_logistics_slot requires target.entity_id",
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
			msg: "payload.scope",
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
			msg: "payload.item_id",
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
			msg: "payload.mode",
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
			msg: "payload.local_storage",
		},
	}

	for _, cs := range cases {
		err := validateCommandStructure(cs.cmd)
		if err == nil {
			t.Fatalf("expected command %s to fail validation", cs.cmd.Type)
		}
		if !strings.Contains(err.Error(), cs.msg) {
			t.Fatalf("expected error about %s, got %v", cs.msg, err)
		}
	}
}
