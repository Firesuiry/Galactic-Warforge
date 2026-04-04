package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func TestOrbitalCollectorProducesOnGasGiant(t *testing.T) {
	maps := testUniverseWithPlanet(mapmodel.PlanetKindGasGiant)
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	collector := newOrbitalCollectorBuilding("oc-1", model.Position{X: 0, Y: 0}, "p1")
	collector.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[collector.ID] = collector
	model.RegisterLogisticsStation(ws, collector)

	settleOrbitalCollectors(ws, maps)

	if collector.LogisticsStation == nil {
		t.Fatalf("expected logistics station")
	}
	for _, output := range collector.Runtime.Functions.Orbital.Outputs {
		got := collector.LogisticsStation.Inventory[output.ItemID]
		if got != output.Quantity {
			t.Fatalf("expected %s=%d, got %d", output.ItemID, output.Quantity, got)
		}
	}
}

func TestOrbitalCollectorSkipsNonGasGiant(t *testing.T) {
	maps := testUniverseWithPlanet(mapmodel.PlanetKindRocky)
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	collector := newOrbitalCollectorBuilding("oc-1", model.Position{X: 0, Y: 0}, "p1")
	collector.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[collector.ID] = collector
	model.RegisterLogisticsStation(ws, collector)

	settleOrbitalCollectors(ws, maps)

	if collector.LogisticsStation != nil && len(collector.LogisticsStation.Inventory) != 0 {
		t.Fatalf("expected no orbital output on non-gas planet")
	}
}

func TestOrbitalCollectorDispatchesToPlanetaryStation(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6, 2)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newOrbitalCollectorBuilding("oc-1", model.Position{X: 0, Y: 0}, "p1")
	ws.Buildings[origin.ID] = origin
	model.RegisterLogisticsStation(ws, origin)

	target := newPlanetaryStationBuilding("pl-1", model.Position{X: 4, Y: 0}, "p1")
	ws.Buildings[target.ID] = target
	model.RegisterLogisticsStation(ws, target)

	if err := origin.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := target.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 20,
	}); err != nil {
		t.Fatalf("target setting: %v", err)
	}

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemHydrogen: 10})

	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	ws.LogisticsDrones[drone.ID] = drone

	settleLogisticsDispatch(ws)
	for i := 0; i < 5; i++ {
		settleLogisticsDrones(ws)
	}

	if got := target.LogisticsStation.Inventory[model.ItemHydrogen]; got == 0 {
		t.Fatalf("expected hydrogen delivered, got %d", got)
	}
}

func TestOrbitalCollectorDispatchesToInterstellarStation(t *testing.T) {
	ws := model.NewWorldState("planet-1", 6, 2)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}

	origin := newOrbitalCollectorBuilding("oc-1", model.Position{X: 0, Y: 0}, "p1")
	ws.Buildings[origin.ID] = origin
	model.RegisterLogisticsStation(ws, origin)

	target := newInterstellarStationBuilding("is-1", model.Position{X: 4, Y: 0}, "p1")
	ws.Buildings[target.ID] = target
	model.RegisterLogisticsStation(ws, target)

	if err := origin.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	if err := target.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 20,
	}); err != nil {
		t.Fatalf("target setting: %v", err)
	}

	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemHydrogen: 15})

	ship := model.NewLogisticsShipState("ship-1", origin.ID, origin.Position)
	if err := model.RegisterLogisticsShip(ws, ship); err != nil {
		t.Fatalf("register ship: %v", err)
	}

	settleInterstellarDispatch(map[string]*model.WorldState{ws.PlanetID: ws}, nil)
	for i := 0; i < 10; i++ {
		settleLogisticsShips(map[string]*model.WorldState{ws.PlanetID: ws})
	}

	if got := target.LogisticsStation.Inventory[model.ItemHydrogen]; got == 0 {
		t.Fatalf("expected hydrogen delivered, got %d", got)
	}
}

func testUniverseWithPlanet(kind mapmodel.PlanetKind) *mapmodel.Universe {
	planet := &mapmodel.Planet{
		ID:     "planet-1",
		Kind:   kind,
		Width:  1,
		Height: 1,
	}
	return &mapmodel.Universe{
		Planets: map[string]*mapmodel.Planet{"planet-1": planet},
	}
}

func newOrbitalCollectorBuilding(id string, pos model.Position, owner string) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeOrbitalCollector, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeOrbitalCollector,
		OwnerID:     owner,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingLogisticsStation(b)
	return b
}

func newPlanetaryStationBuilding(id string, pos model.Position, owner string) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypePlanetaryLogisticsStation, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypePlanetaryLogisticsStation,
		OwnerID:     owner,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingLogisticsStation(b)
	return b
}

func newInterstellarStationBuilding(id string, pos model.Position, owner string) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeInterstellarLogisticsStation, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeInterstellarLogisticsStation,
		OwnerID:     owner,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingLogisticsStation(b)
	return b
}
