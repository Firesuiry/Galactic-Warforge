package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestLogisticsDispatchMatching(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	target := newLogisticsStationBuilding("station-b", model.Position{X: 4, Y: 0})

	attachBuilding(ws, origin)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, target)

	if err := origin.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 20,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := target.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 50,
	}); err != nil {
		t.Fatalf("target setting: %v", err)
	}
	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 100})
	target.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 0})

	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	drone.Capacity = 30
	if err := model.RegisterLogisticsDrone(ws, drone); err != nil {
		t.Fatalf("register drone: %v", err)
	}

	settleLogisticsDispatch(ws)

	if drone.Status != model.LogisticsDroneTakeoff {
		t.Fatalf("expected takeoff status, got %s", drone.Status)
	}
	if drone.TargetStationID != target.ID {
		t.Fatalf("expected target %s, got %s", target.ID, drone.TargetStationID)
	}
	if got := drone.Cargo[model.ItemIronOre]; got != 30 {
		t.Fatalf("expected cargo 30, got %d", got)
	}
	if got := origin.LogisticsStation.Inventory[model.ItemIronOre]; got != 70 {
		t.Fatalf("expected origin inventory 70, got %d", got)
	}
	if got := target.LogisticsStation.Inventory[model.ItemIronOre]; got != 0 {
		t.Fatalf("expected target inventory 0 before arrival, got %d", got)
	}
}

func TestLogisticsDispatchPriority(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6, 6)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	targetLow := newLogisticsStationBuilding("station-b", model.Position{X: 2, Y: 0})
	targetHigh := newLogisticsStationBuilding("station-c", model.Position{X: 0, Y: 2})

	attachBuilding(ws, origin)
	attachBuilding(ws, targetLow)
	attachBuilding(ws, targetHigh)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, targetLow)
	model.RegisterLogisticsStation(ws, targetHigh)

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 80})
	if err := origin.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	targetLow.LogisticsStation.Priority = model.LogisticsStationPriority{Input: 1, Output: 1}
	targetHigh.LogisticsStation.Priority = model.LogisticsStationPriority{Input: 5, Output: 1}
	if err := targetLow.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 40,
	}); err != nil {
		t.Fatalf("target low setting: %v", err)
	}
	if err := targetHigh.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 40,
	}); err != nil {
		t.Fatalf("target high setting: %v", err)
	}
	targetLow.LogisticsStation.SetInventory(model.ItemInventory{})
	targetHigh.LogisticsStation.SetInventory(model.ItemInventory{})

	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	if err := model.RegisterLogisticsDrone(ws, drone); err != nil {
		t.Fatalf("register drone: %v", err)
	}

	settleLogisticsDispatch(ws)

	if drone.TargetStationID != targetHigh.ID {
		t.Fatalf("expected high priority target %s, got %s", targetHigh.ID, drone.TargetStationID)
	}
}

func TestLogisticsDispatchShortestDistance(t *testing.T) {
	ws := model.NewWorldState("planet-1", 10, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	targetNear := newLogisticsStationBuilding("station-b", model.Position{X: 2, Y: 0})
	targetFar := newLogisticsStationBuilding("station-c", model.Position{X: 6, Y: 0})

	attachBuilding(ws, origin)
	attachBuilding(ws, targetNear)
	attachBuilding(ws, targetFar)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, targetNear)
	model.RegisterLogisticsStation(ws, targetFar)

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 60})
	if err := origin.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := targetNear.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 30,
	}); err != nil {
		t.Fatalf("target near setting: %v", err)
	}
	if err := targetFar.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 30,
	}); err != nil {
		t.Fatalf("target far setting: %v", err)
	}
	targetNear.LogisticsStation.SetInventory(model.ItemInventory{})
	targetFar.LogisticsStation.SetInventory(model.ItemInventory{})

	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	if err := model.RegisterLogisticsDrone(ws, drone); err != nil {
		t.Fatalf("register drone: %v", err)
	}

	settleLogisticsDispatch(ws)

	if drone.TargetStationID != targetNear.ID {
		t.Fatalf("expected nearest target %s, got %s", targetNear.ID, drone.TargetStationID)
	}
}

func TestLogisticsDispatchDelivery(t *testing.T) {
	ws := model.NewWorldState("planet-1", 4, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	target := newLogisticsStationBuilding("station-b", model.Position{X: 1, Y: 0})

	attachBuilding(ws, origin)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, target)

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 40})
	if err := origin.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := target.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 20,
	}); err != nil {
		t.Fatalf("target setting: %v", err)
	}
	target.LogisticsStation.SetInventory(model.ItemInventory{})

	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	drone.Speed = 4
	if err := model.RegisterLogisticsDrone(ws, drone); err != nil {
		t.Fatalf("register drone: %v", err)
	}

	settleLogisticsDispatch(ws)
	settleLogisticsDrones(ws)
	settleLogisticsDrones(ws)
	settleLogisticsDrones(ws)

	if drone.CargoQty() != 0 {
		t.Fatalf("expected cargo cleared after delivery, got %d", drone.CargoQty())
	}
	if got := target.LogisticsStation.Inventory[model.ItemIronOre]; got == 0 {
		t.Fatalf("expected target inventory increased, got %d", got)
	}
}
