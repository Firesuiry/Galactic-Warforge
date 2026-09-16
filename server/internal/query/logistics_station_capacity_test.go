package query

import (
	"encoding/json"
	"siliconworld/internal/model"
	"testing"
)

func TestLogisticsRuntimeShowsSoleStationInventoryPortsAndEnergy(t *testing.T) {
	ql, ws, planetID := newQueryTestContext(t)
	b := makeTestBuilding("station", "p1", model.Position{X: 3, Y: 3}, model.BuildingTypeInterstellarLogisticsStation, model.BuildingProfileFor(model.BuildingTypeInterstellarLogisticsStation, 1).Runtime)
	model.InitBuildingLogisticsStation(b)
	s := b.LogisticsStation
	s.UpsertSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeDemand, LocalStorage: 100})
	s.ReceiveItem(model.ItemIronOre, 42)
	s.Energy = 350
	s.BeltPorts = map[model.ConveyorDirection]model.LogisticsBeltPort{model.ConveyorEast: {Mode: "output", ItemID: model.ItemIronOre}}
	ws.Buildings[b.ID] = b
	model.RegisterLogisticsStation(ws, b)
	view, ok := ql.PlanetRuntime(ws, "p1", planetID, planetID)
	if !ok || len(view.LogisticsStations) != 1 {
		t.Fatal("station runtime missing")
	}
	encoded, err := json.Marshal(view.LogisticsStations[0])
	if err != nil {
		t.Fatal(err)
	}
	var decoded LogisticsStationView
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.State.Energy != 350 || decoded.State.EnergyCapacity != 10000 || decoded.State.Inventory[model.ItemIronOre] != 42 || decoded.State.ItemCapacity != 500 || decoded.State.SlotCapacity != 5 || decoded.State.BeltPorts[model.ConveyorEast].Mode != "output" {
		t.Fatalf("incomplete station runtime JSON: %s", encoded)
	}
	view.LogisticsStations[0].State.Inventory[model.ItemIronOre] = 1
	view.LogisticsStations[0].State.BeltPorts[model.ConveyorEast] = model.LogisticsBeltPort{Mode: "input", ItemID: model.ItemIronOre}
	if s.Inventory[model.ItemIronOre] != 42 || s.BeltPorts[model.ConveyorEast].Mode != "output" {
		t.Fatal("runtime read aliases authoritative station")
	}
	enemy, ok := ql.PlanetRuntime(ws, "p2", planetID, planetID)
	if !ok || len(enemy.LogisticsStations) != 0 {
		t.Fatal("foreign station inventory leaked")
	}
}
