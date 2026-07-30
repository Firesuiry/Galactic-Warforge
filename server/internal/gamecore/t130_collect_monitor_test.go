package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func newCollectorTestWorld(t *testing.T, btype model.BuildingType) (*model.WorldState, *model.Building) {
	t.Helper()
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	b := &model.Building{
		ID:       "collector-1",
		Type:     btype,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(btype, 1).Runtime,
	}
	model.InitBuildingStorage(b)
	b.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[b.ID] = b
	return ws, b
}

func fillStorage(inv, inBuf, outBuf int, itemID string, b *model.Building) {
	if inv > 0 {
		b.Storage.Inventory = model.ItemInventory{itemID: inv}
	}
	if inBuf > 0 {
		b.Storage.InputBuffer = model.ItemInventory{itemID: inBuf}
	}
	if outBuf > 0 {
		b.Storage.OutputBuffer = model.ItemInventory{itemID: outBuf}
	}
}

func alertTypes(alerts []*model.ProductionAlert) map[model.ProductionAlertType]bool {
	out := make(map[model.ProductionAlertType]bool, len(alerts))
	for _, alert := range alerts {
		out[alert.AlertType] = true
	}
	return out
}

// A collector whose local storage is completely full stalls silently in the
// resource settlement; the production monitor must surface it as an
// output_blocked alert so the player can react.
func TestCollectorMonitoringRaisesOutputBlockedWhenStorageFull(t *testing.T) {
	ws, pump := newCollectorTestWorld(t, model.BuildingTypeWaterPump)
	// water_pump: capacity 60, buffer 20 (in 6 / out 14).
	fillStorage(60, 6, 14, model.ItemWater, pump)

	pm := newProductionMonitor(newTestMonitorConfig())
	events, alerts := pm.settleProductionMonitoring(ws, 25)
	if len(alerts) == 0 {
		t.Fatal("expected output_blocked alert for jammed collector, got none")
	}
	types := alertTypes(alerts)
	if !types[model.AlertTypeOutputBlocked] {
		t.Fatalf("expected output_blocked alert, got %v", types)
	}
	// Collectors have no recipe inputs: backlog / input_shortage /
	// throughput_drop must not fire even though buffers hold items.
	for _, unwanted := range []model.ProductionAlertType{model.AlertTypeBacklog, model.AlertTypeInputShortage, model.AlertTypeThroughputDrop} {
		if types[unwanted] {
			t.Fatalf("collector must not raise %s, got %v", unwanted, types)
		}
	}
	if len(events) != len(alerts) {
		t.Fatalf("expected one event per alert, got %d events for %d alerts", len(events), len(alerts))
	}
	for _, alert := range alerts {
		if alert.BuildingID != pump.ID || alert.PlayerID != "p1" || alert.BuildingType != model.BuildingTypeWaterPump {
			t.Fatalf("alert bound to wrong building: %+v", alert)
		}
	}
}

// A full mining machine (inventory 48/48 + output buffer 8/8) matches the
// exact state observed in the playtest and must alert as well.
func TestMiningMachineMonitoringRaisesOutputBlockedWhenStorageFull(t *testing.T) {
	ws, miner := newCollectorTestWorld(t, model.BuildingTypeMiningMachine)
	// mining_machine: capacity 48, buffer 12 (in 4 / out 8).
	fillStorage(48, 4, 8, model.ItemSiliconOre, miner)

	pm := newProductionMonitor(newTestMonitorConfig())
	_, alerts := pm.settleProductionMonitoring(ws, 25)
	if !alertTypes(alerts)[model.AlertTypeOutputBlocked] {
		t.Fatalf("expected output_blocked alert for jammed miner, got %v", alertTypes(alerts))
	}
}

// Partial blockage must not alert: while the output buffer still drains (or
// the inventory still has room), mining continues.
func TestCollectorMonitoringStaysQuietWhileOutputDrains(t *testing.T) {
	cases := []struct {
		name         string
		inv, in, out int
	}{
		{"output buffer draining", 48, 4, 0},
		{"inventory not full", 40, 0, 8},
		{"empty storage", 0, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ws, miner := newCollectorTestWorld(t, model.BuildingTypeMiningMachine)
			fillStorage(tc.inv, tc.in, tc.out, model.ItemSiliconOre, miner)

			pm := newProductionMonitor(newTestMonitorConfig())
			_, alerts := pm.settleProductionMonitoring(ws, 25)
			if len(alerts) != 0 {
				t.Fatalf("expected no alerts, got %v", alertTypes(alerts))
			}
		})
	}
}

// Cooldown gates repeat occurrences per (building, alert type): a persistent
// blockage re-raises at most once per cooldown window.
func TestCollectorMonitoringRespectsAlertCooldown(t *testing.T) {
	ws, miner := newCollectorTestWorld(t, model.BuildingTypeMiningMachine)
	fillStorage(48, 4, 8, model.ItemSiliconOre, miner)

	pm := newProductionMonitor(newTestMonitorConfig())
	if _, alerts := pm.settleProductionMonitoring(ws, 25); len(alerts) != 1 {
		t.Fatalf("expected first alert at tick 25, got %d", len(alerts))
	}
	if _, alerts := pm.settleProductionMonitoring(ws, 30); len(alerts) != 0 {
		t.Fatalf("expected cooldown to suppress repeat at tick 30, got %d", len(alerts))
	}
	if _, alerts := pm.settleProductionMonitoring(ws, 45); len(alerts) != 1 {
		t.Fatalf("expected repeat after cooldown at tick 45, got %d", len(alerts))
	}
}

// A collector without power still raises power_shortage.
func TestCollectorMonitoringRaisesPowerShortage(t *testing.T) {
	ws, pump := newCollectorTestWorld(t, model.BuildingTypeWaterPump)
	pump.Runtime.State = model.BuildingWorkNoPower

	pm := newProductionMonitor(newTestMonitorConfig())
	_, alerts := pm.settleProductionMonitoring(ws, 25)
	if !alertTypes(alerts)[model.AlertTypePowerShortage] {
		t.Fatalf("expected power_shortage alert, got %v", alertTypes(alerts))
	}
}

// Production buildings must keep their existing alert behavior.
func TestProductionBuildingMonitoringUnaffected(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	smelter := &model.Building{
		ID:       "smelter-1",
		Type:     model.BuildingTypeArcSmelter,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime:  model.BuildingProfileFor(model.BuildingTypeArcSmelter, 1).Runtime,
	}
	model.InitBuildingStorage(smelter)
	smelter.Runtime.State = model.BuildingWorkNoPower
	ws.Buildings[smelter.ID] = smelter

	pm := newProductionMonitor(newTestMonitorConfig())
	_, alerts := pm.settleProductionMonitoring(ws, 25)
	if !alertTypes(alerts)[model.AlertTypePowerShortage] {
		t.Fatalf("expected power_shortage alert for production building, got %v", alertTypes(alerts))
	}
}
