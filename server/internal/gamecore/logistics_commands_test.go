package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestExecConfigureLogisticsSlotWritesPlanetarySetting(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-slot", model.Position{X: 6, Y: 6})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          "supply",
			"local_storage": 24,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected executed, got %s (%s)", res.Status, res.Message)
	}
	if res.Code != model.CodeOK {
		t.Fatalf("expected OK, got %s", res.Code)
	}

	setting, ok := stationBuilding.LogisticsStation.SettingFor(model.ItemIronOre)
	if !ok {
		t.Fatalf("expected planetary setting for %s", model.ItemIronOre)
	}
	if setting.Mode != model.LogisticsStationModeSupply {
		t.Fatalf("expected mode supply, got %s", setting.Mode)
	}
	if setting.LocalStorage != 24 {
		t.Fatalf("expected local storage 24, got %d", setting.LocalStorage)
	}
}

func TestExecConfigureLogisticsStationRejectsInterstellarForPlanetaryStation(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-reject", model.Position{X: 7, Y: 7})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"interstellar": map[string]any{
				"enabled": true,
			},
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationExpandsDronesWhenCapacityRaised(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-drones", model.Position{X: 8, Y: 8})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	stationBuilding.LogisticsStation.DroneCapacity = 1
	stationBuilding.LogisticsStation.Normalize()

	existing := model.NewLogisticsDroneState("drone-existing", stationBuilding.ID, stationBuilding.Position)
	if err := model.RegisterLogisticsDrone(ws, existing); err != nil {
		t.Fatalf("register existing drone: %v", err)
	}

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"drone_capacity": 3,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected executed, got %s (%s)", res.Status, res.Message)
	}
	if res.Code != model.CodeOK {
		t.Fatalf("expected OK, got %s", res.Code)
	}
	if stationBuilding.LogisticsStation.DroneCapacityValue() != 3 {
		t.Fatalf("expected drone capacity 3, got %d", stationBuilding.LogisticsStation.DroneCapacityValue())
	}

	if got := model.StationDroneCount(ws, stationBuilding.ID); got != 3 {
		t.Fatalf("expected station to have 3 drones after expand, got %d", got)
	}
}

func TestExecConfigureLogisticsStationRejectsInterstellarForOrbitalCollector(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	profile := model.BuildingProfileFor(model.BuildingTypeOrbitalCollector, 1)
	collector := &model.Building{
		ID:          "station-cfg-orbital",
		Type:        model.BuildingTypeOrbitalCollector,
		OwnerID:     "p1",
		Position:    model.Position{X: 9, Y: 9},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingLogisticsStation(collector)
	attachBuilding(ws, collector)
	model.RegisterLogisticsStation(ws, collector)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: collector.ID},
		Payload: map[string]any{
			"interstellar": map[string]any{
				"enabled": true,
			},
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationRejectsNotOwner(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-owner", model.Position{X: 10, Y: 10})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsStation(ws, "p2", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"drone_capacity": 2,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeNotOwner {
		t.Fatalf("expected not owner, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationUpdatesPriorities(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-priority", model.Position{X: 11, Y: 11})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"input_priority":  3,
			"output_priority": 4,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected executed, got %s (%s)", res.Status, res.Message)
	}
	if stationBuilding.LogisticsStation.InputPriorityValue() != 3 {
		t.Fatalf("expected input priority 3, got %d", stationBuilding.LogisticsStation.InputPriorityValue())
	}
	if stationBuilding.LogisticsStation.OutputPriorityValue() != 4 {
		t.Fatalf("expected output priority 4, got %d", stationBuilding.LogisticsStation.OutputPriorityValue())
	}
}

func TestExecConfigureLogisticsStationAppliesInterstellarConfig(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newInterstellarLogisticsStationBuilding("station-cfg-interstellar", model.Position{X: 12, Y: 12})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"interstellar": map[string]any{
				"enabled":      true,
				"warp_enabled": true,
				"ship_slots":   6,
			},
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected executed, got %s (%s)", res.Status, res.Message)
	}
	if !stationBuilding.LogisticsStation.Interstellar.Enabled {
		t.Fatalf("expected interstellar enabled")
	}
	if !stationBuilding.LogisticsStation.Interstellar.WarpEnabled {
		t.Fatalf("expected warp enabled")
	}
	if stationBuilding.LogisticsStation.ShipSlotCapacityValue() != 6 {
		t.Fatalf("expected ship slots 6, got %d", stationBuilding.LogisticsStation.ShipSlotCapacityValue())
	}
}

func TestExecuteRequestDispatchesConfigureLogisticsSlot(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	ws.Players["p1"].SetPermissions([]string{"*"})

	stationBuilding := newLogisticsStationBuilding("station-cfg-dispatch", model.Position{X: 13, Y: 13})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	qr := &model.QueuedRequest{
		PlayerID: "p1",
		Request: model.CommandRequest{
			RequestID: "req-dispatch-logistics-slot",
			Commands: []model.Command{{
				Type:   model.CmdConfigureLogisticsSlot,
				Target: model.CommandTarget{EntityID: stationBuilding.ID},
				Payload: map[string]any{
					"scope":         "planetary",
					"item_id":       model.ItemCopperOre,
					"mode":          "demand",
					"local_storage": 15,
				},
			}},
		},
	}

	results, _ := core.executeRequest(qr)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Status != model.StatusExecuted {
		t.Fatalf("expected executed, got %s (%s)", results[0].Status, results[0].Message)
	}

	setting, ok := stationBuilding.LogisticsStation.SettingFor(model.ItemCopperOre)
	if !ok {
		t.Fatalf("expected copper ore setting via dispatch")
	}
	if setting.Mode != model.LogisticsStationModeDemand {
		t.Fatalf("expected demand mode, got %s", setting.Mode)
	}
}

func TestExecConfigureLogisticsStationRejectsNonBoolInterstellarEnabled(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newInterstellarLogisticsStationBuilding("station-cfg-type-bool", model.Position{X: 14, Y: 14})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"interstellar": map[string]any{
				"enabled": 1,
			},
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationRejectsFractionalInputPriority(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-type-int", model.Position{X: 15, Y: 15})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"input_priority": 1.9,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationRejectsOrbitalCollectorPriorityConfig(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	profile := model.BuildingProfileFor(model.BuildingTypeOrbitalCollector, 1)
	collector := &model.Building{
		ID:          "station-cfg-orbital-priority",
		Type:        model.BuildingTypeOrbitalCollector,
		OwnerID:     "p1",
		Position:    model.Position{X: 16, Y: 16},
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingLogisticsStation(collector)
	attachBuilding(ws, collector)
	model.RegisterLogisticsStation(ws, collector)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: collector.ID},
		Payload: map[string]any{
			"input_priority": 2,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationPriorityOnlyDoesNotExpandDrones(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-priority-no-drone-expand", model.Position{X: 17, Y: 17})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	stationBuilding.LogisticsStation.DroneCapacity = 3
	stationBuilding.LogisticsStation.Normalize()
	if got := model.StationDroneCount(ws, stationBuilding.ID); got != 0 {
		t.Fatalf("expected no drones before configure, got %d", got)
	}

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"input_priority":  5,
			"output_priority": 6,
		},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("expected executed, got %s (%s)", res.Status, res.Message)
	}
	if got := model.StationDroneCount(ws, stationBuilding.ID); got != 0 {
		t.Fatalf("expected no drone auto expansion on priority-only update, got %d", got)
	}
}

func TestExecConfigureLogisticsStationFailureIsAtomic(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newInterstellarLogisticsStationBuilding("station-cfg-atomic", model.Position{X: 18, Y: 18})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	stationBuilding.LogisticsStation.Priority.Input = 1
	stationBuilding.LogisticsStation.Interstellar.Enabled = false
	stationBuilding.LogisticsStation.Normalize()

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"input_priority": 4,
			"interstellar": map[string]any{
				"enabled":    true,
				"ship_slots": 1.9,
			},
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if stationBuilding.LogisticsStation.InputPriorityValue() != 1 {
		t.Fatalf("expected input priority unchanged at 1, got %d", stationBuilding.LogisticsStation.InputPriorityValue())
	}
	if stationBuilding.LogisticsStation.Interstellar.Enabled {
		t.Fatalf("expected interstellar enabled unchanged (false)")
	}
}

func TestExecConfigureLogisticsSlotRejectsFractionalLocalStorage(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-slot-fractional", model.Position{X: 19, Y: 19})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          "supply",
			"local_storage": 1.9,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsSlotRejectsNonStringMode(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-slot-mode-type", model.Position{X: 20, Y: 20})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          123,
			"local_storage": 10,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsSlotRejectsUnknownMode(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-slot-mode-unknown", model.Position{X: 21, Y: 21})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	res, _ := core.execConfigureLogisticsSlot(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsSlot,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"scope":         "planetary",
			"item_id":       model.ItemIronOre,
			"mode":          "invalid_mode",
			"local_storage": 10,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failed, got %s", res.Code)
	}
}

func TestExecConfigureLogisticsStationExpansionFailureRollsBackState(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	stationBuilding := newLogisticsStationBuilding("station-cfg-expand-rollback", model.Position{X: 22, Y: 22})
	attachBuilding(ws, stationBuilding)
	model.RegisterLogisticsStation(ws, stationBuilding)

	stationBuilding.LogisticsStation.DroneCapacity = 1
	stationBuilding.LogisticsStation.Priority.Input = 1
	stationBuilding.LogisticsStation.Normalize()

	baseline := model.NewLogisticsDroneState("drone-rollback-base", stationBuilding.ID, stationBuilding.Position)
	if err := model.RegisterLogisticsDrone(ws, baseline); err != nil {
		t.Fatalf("register baseline drone: %v", err)
	}
	baselineCount := model.StationDroneCount(ws, stationBuilding.ID)

	delete(ws.LogisticsStations, stationBuilding.ID)

	res, _ := core.execConfigureLogisticsStation(ws, "p1", model.Command{
		Type:   model.CmdConfigureLogisticsStation,
		Target: model.CommandTarget{EntityID: stationBuilding.ID},
		Payload: map[string]any{
			"drone_capacity": 3,
			"input_priority": 4,
		},
	})
	if res.Status != model.StatusFailed {
		t.Fatalf("expected failed, got %s", res.Status)
	}
	if stationBuilding.LogisticsStation.DroneCapacityValue() != 1 {
		t.Fatalf("expected drone capacity rollback to 1, got %d", stationBuilding.LogisticsStation.DroneCapacityValue())
	}
	if stationBuilding.LogisticsStation.InputPriorityValue() != 1 {
		t.Fatalf("expected input priority rollback to 1, got %d", stationBuilding.LogisticsStation.InputPriorityValue())
	}
	if got := model.StationDroneCount(ws, stationBuilding.ID); got != baselineCount {
		t.Fatalf("expected drone count rollback to %d, got %d", baselineCount, got)
	}
}
