package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestInterstellarDispatchWarpEnergyCost(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newInterstellarLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	target := newInterstellarLogisticsStationBuilding("station-b", model.Position{X: 6, Y: 0})

	attachBuilding(ws, origin)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, target)

	origin.LogisticsStation.Interstellar.WarpEnabled = true
	origin.LogisticsStation.Interstellar.WarpDistance = 1
	origin.LogisticsStation.Interstellar.EnergyPerDistance = 1
	origin.LogisticsStation.Interstellar.WarpEnergyMultiplier = 1
	origin.LogisticsStation.Interstellar.ShipCapacity = 30
	origin.LogisticsStation.Interstellar.ShipSpeed = 2
	origin.LogisticsStation.Interstellar.WarpSpeed = 8
	origin.LogisticsStation.Normalize()

	if err := origin.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := target.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 50,
	}); err != nil {
		t.Fatalf("target setting: %v", err)
	}

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 100, model.ItemSpaceWarper: 2})
	target.LogisticsStation.SetInventory(model.ItemInventory{})

	ship := model.NewLogisticsShipState("ship-1", origin.ID, origin.Position)
	if err := model.RegisterLogisticsShip(ws, ship); err != nil {
		t.Fatalf("register ship: %v", err)
	}

	settleInterstellarDispatch(map[string]*model.WorldState{ws.PlanetID: ws}, nil)

	if ship.Status != model.LogisticsShipTakeoff {
		t.Fatalf("expected takeoff status, got %s", ship.Status)
	}
	if ship.TargetStationID != target.ID {
		t.Fatalf("expected target %s, got %s", target.ID, ship.TargetStationID)
	}
	if !ship.Warped {
		t.Fatalf("expected ship to warp")
	}
	if ship.WarpItemSpent != origin.LogisticsStation.WarpItemCostValue() {
		t.Fatalf("expected warp item spent %d, got %d", origin.LogisticsStation.WarpItemCostValue(), ship.WarpItemSpent)
	}
	if got := origin.LogisticsStation.Inventory[model.ItemSpaceWarper]; got != 1 {
		t.Fatalf("expected warp items 1, got %d", got)
	}
	if got := origin.LogisticsStation.Inventory[model.ItemIronOre]; got != 70 {
		t.Fatalf("expected origin inventory 70, got %d", got)
	}
	distance := model.ManhattanDist(origin.Position, target.Position)
	expectedEnergy := model.LogisticsShipEnergyCost(distance, origin.LogisticsStation.EnergyPerDistanceValue(), origin.LogisticsStation.WarpEnergyMultiplierValue(), true)
	if ship.EnergyCost != expectedEnergy {
		t.Fatalf("expected energy cost %d, got %d", expectedEnergy, ship.EnergyCost)
	}
}

func TestInterstellarShipDelivery(t *testing.T) {
	ws := model.NewWorldState("planet-1", 4, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newInterstellarLogisticsStationBuilding("station-a", model.Position{X: 0, Y: 0})
	target := newInterstellarLogisticsStationBuilding("station-b", model.Position{X: 2, Y: 0})

	attachBuilding(ws, origin)
	attachBuilding(ws, target)
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, target)

	origin.LogisticsStation.Interstellar.ShipCapacity = 20
	origin.LogisticsStation.Interstellar.ShipSpeed = 4
	origin.LogisticsStation.Normalize()

	if err := origin.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := target.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemIronOre,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 10,
	}); err != nil {
		t.Fatalf("target setting: %v", err)
	}

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemIronOre: 40})
	target.LogisticsStation.SetInventory(model.ItemInventory{})

	ship := model.NewLogisticsShipState("ship-1", origin.ID, origin.Position)
	if err := model.RegisterLogisticsShip(ws, ship); err != nil {
		t.Fatalf("register ship: %v", err)
	}

	settleInterstellarDispatch(map[string]*model.WorldState{ws.PlanetID: ws}, nil)

	for i := 0; i < 10; i++ {
		settleLogisticsShips(map[string]*model.WorldState{ws.PlanetID: ws})
	}

	if ship.Status != model.LogisticsShipIdle {
		t.Fatalf("expected ship idle, got %s", ship.Status)
	}
	if ship.CargoQty() != 0 {
		t.Fatalf("expected ship cargo cleared, got %d", ship.CargoQty())
	}
	if got := target.LogisticsStation.Inventory[model.ItemIronOre]; got == 0 {
		t.Fatalf("expected target inventory increased, got %d", got)
	}
}

func newInterstellarLogisticsStationBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeInterstellarLogisticsStation, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeInterstellarLogisticsStation,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingLogisticsStation(b)
	return b
}
