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
		{Type: model.CmdTransferItem, Payload: map[string]any{"building_id": "b-1", "item_id": model.ItemSolarSail, "quantity": 2}},
		{Type: model.CmdLaunchSolarSail, Payload: map[string]any{"building_id": "b-1"}},
		{Type: model.CmdLaunchRocket, Payload: map[string]any{"building_id": "b-1", "system_id": "sys-1"}},
		{Type: model.CmdCancelConstruction, Payload: map[string]any{"task_id": "c-1"}},
		{Type: model.CmdRestoreConstruction, Payload: map[string]any{"task_id": "c-1"}},
		{Type: model.CmdBuildDysonNode, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude": 10.0, "longitude": 20.0}},
		{Type: model.CmdBuildDysonFrame, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "node_a_id": "n-1", "node_b_id": "n-2"}},
		{Type: model.CmdBuildDysonShell, Payload: map[string]any{"system_id": "sys-1", "layer_index": 0, "latitude_min": -15.0, "latitude_max": 15.0, "coverage": 0.4}},
		{Type: model.CmdDemolishDyson, Payload: map[string]any{"system_id": "sys-1", "component_type": "shell", "component_id": "s-1"}},
		{Type: model.CmdBlueprintCreate, Payload: map[string]any{"blueprint_id": "bp-1", "name": "Prototype", "base_frame_id": "light_frame"}},
		{Type: model.CmdBlueprintSetComponent, Payload: map[string]any{"blueprint_id": "bp-1", "slot_id": "power", "component_id": "compact_reactor"}},
		{Type: model.CmdBlueprintValidate, Payload: map[string]any{"blueprint_id": "bp-1"}},
		{Type: model.CmdBlueprintFinalize, Payload: map[string]any{"blueprint_id": "bp-1"}},
		{Type: model.CmdBlueprintVariant, Payload: map[string]any{"parent_blueprint_id": "corvette", "blueprint_id": "bp-2"}},
		{Type: model.CmdBlueprintSetStatus, Payload: map[string]any{"blueprint_id": "bp-1", "status": string(model.WarBlueprintStatusFieldTested)}},
		{Type: model.CommandType("queue_military_production"), Payload: map[string]any{"building_id": "b-1", "blueprint_id": "bp-1", "count": 1}},
		{Type: model.CommandType("refit_unit"), Payload: map[string]any{"building_id": "b-1", "unit_id": "squad-1", "target_blueprint_id": "prototype"}},
	}

	for _, cmd := range cases {
		if err := validateCommandStructure(cmd); err != nil {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, err)
		}
	}
}

func TestValidateCommandStructureAllowsPlanetAndRayReceiverCommands(t *testing.T) {
	cases := []model.Command{
		{Type: model.CmdSwitchActivePlanet, Payload: map[string]any{"planet_id": "planet-1-1"}},
		{Type: model.CmdSetRayReceiverMode, Payload: map[string]any{"building_id": "rr-1", "mode": "power"}},
	}

	for _, cmd := range cases {
		if err := validateCommandStructure(cmd); err != nil {
			t.Fatalf("expected command %s to pass validation, got %v", cmd.Type, err)
		}
	}
}

func TestValidateCommandStructureRejectsIncompleteLaunchRocket(t *testing.T) {
	cases := []struct {
		cmd model.Command
		msg string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdLaunchRocket,
				Payload: map[string]any{"system_id": "sys-1"},
			},
			msg: "payload.building_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdLaunchRocket,
				Payload: map[string]any{"building_id": "b-1"},
			},
			msg: "payload.system_id",
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

func TestValidateCommandStructureRejectsIncompleteTransferItem(t *testing.T) {
	cases := []struct {
		cmd model.Command
		msg string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdTransferItem,
				Payload: map[string]any{"item_id": model.ItemSolarSail, "quantity": 1},
			},
			msg: "payload.building_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdTransferItem,
				Payload: map[string]any{"building_id": "b-1", "quantity": 1},
			},
			msg: "payload.item_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdTransferItem,
				Payload: map[string]any{"building_id": "b-1", "item_id": model.ItemSolarSail},
			},
			msg: "payload.quantity",
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

func TestValidateCommandStructureRejectsIncompletePlanetAndRayReceiverCommands(t *testing.T) {
	cases := []struct {
		cmd model.Command
		msg string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdSwitchActivePlanet,
				Payload: map[string]any{},
			},
			msg: "payload.planet_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdSetRayReceiverMode,
				Payload: map[string]any{"mode": "power"},
			},
			msg: "payload.building_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdSetRayReceiverMode,
				Payload: map[string]any{"building_id": "rr-1"},
			},
			msg: "payload.mode",
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

func TestValidateCommandStructureRejectsIncompleteBlueprintCommands(t *testing.T) {
	cases := []struct {
		cmd model.Command
		msg string
	}{
		{
			cmd: model.Command{
				Type:    model.CmdBlueprintCreate,
				Payload: map[string]any{"name": "Prototype", "base_frame_id": "light_frame"},
			},
			msg: "payload.blueprint_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdBlueprintSetComponent,
				Payload: map[string]any{"blueprint_id": "bp-1", "component_id": "compact_reactor"},
			},
			msg: "payload.slot_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdBlueprintValidate,
				Payload: map[string]any{},
			},
			msg: "payload.blueprint_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdBlueprintVariant,
				Payload: map[string]any{"blueprint_id": "bp-2"},
			},
			msg: "payload.parent_blueprint_id",
		},
		{
			cmd: model.Command{
				Type:    model.CmdBlueprintSetStatus,
				Payload: map[string]any{"blueprint_id": "bp-1"},
			},
			msg: "payload.status",
		},
		{
			cmd: model.Command{
				Type:    model.CommandType("queue_military_production"),
				Payload: map[string]any{"building_id": "b-1", "count": 1},
			},
			msg: "payload.blueprint_id",
		},
		{
			cmd: model.Command{
				Type:    model.CommandType("refit_unit"),
				Payload: map[string]any{"building_id": "b-1", "unit_id": "squad-1"},
			},
			msg: "payload.target_blueprint_id",
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
