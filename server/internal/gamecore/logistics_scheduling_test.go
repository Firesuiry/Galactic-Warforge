package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestLogisticsDemandForecast(t *testing.T) {
	prev := model.CurrentLogisticsSchedulingConfig()
	cfg := prev
	cfg.DemandForecastMultiplier = 1.5
	cfg.OversupplyRatio = 0
	cfg.OversupplyMax = 0
	if err := model.SetLogisticsSchedulingConfig(cfg); err != nil {
		t.Fatalf("set config: %v", err)
	}
	defer func() {
		if err := model.SetLogisticsSchedulingConfig(prev); err != nil {
			t.Fatalf("restore config: %v", err)
		}
	}()

	ws := model.NewWorldState("planet-1", 2, 1)
	target := newPlanetaryStationBuilding("pl-1", model.Position{X: 0, Y: 0}, "p1")
	ws.Buildings[target.ID] = target
	model.RegisterLogisticsStation(ws, target)

	if err := target.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 10,
	}); err != nil {
		t.Fatalf("setting: %v", err)
	}
	target.LogisticsStation.SetInventory(model.ItemInventory{model.ItemHydrogen: 4})

	remaining, forecast := buildDemandRemaining(ws, map[string]*model.Building{target.ID: target})
	if remaining[target.ID][model.ItemHydrogen] != 9 {
		t.Fatalf("expected forecast demand 9, got %d", remaining[target.ID][model.ItemHydrogen])
	}
	entry := forecast[target.ID][model.ItemHydrogen]
	if entry.base != 6 || entry.forecast != 9 || entry.oversupply != 0 {
		t.Fatalf("unexpected forecast entry: %+v", entry)
	}
}

func TestLogisticsOversupplyAllowsExtra(t *testing.T) {
	prev := model.CurrentLogisticsSchedulingConfig()
	cfg := prev
	cfg.DemandForecastMultiplier = 1
	cfg.OversupplyRatio = 0.5
	cfg.OversupplyMax = 0
	if err := model.SetLogisticsSchedulingConfig(cfg); err != nil {
		t.Fatalf("set config: %v", err)
	}
	defer func() {
		if err := model.SetLogisticsSchedulingConfig(prev); err != nil {
			t.Fatalf("restore config: %v", err)
		}
	}()

	ws := model.NewWorldState("planet-1", 2, 1)
	target := newPlanetaryStationBuilding("pl-2", model.Position{X: 0, Y: 0}, "p1")
	ws.Buildings[target.ID] = target
	model.RegisterLogisticsStation(ws, target)

	if err := target.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 10,
	}); err != nil {
		t.Fatalf("setting: %v", err)
	}
	target.LogisticsStation.SetInventory(model.ItemInventory{model.ItemHydrogen: 10})

	remaining, forecast := buildDemandRemaining(ws, map[string]*model.Building{target.ID: target})
	if remaining[target.ID][model.ItemHydrogen] != 5 {
		t.Fatalf("expected oversupply demand 5, got %d", remaining[target.ID][model.ItemHydrogen])
	}
	entry := forecast[target.ID][model.ItemHydrogen]
	if entry.base != 0 || entry.forecast != 0 || entry.oversupply != 5 {
		t.Fatalf("unexpected oversupply entry: %+v", entry)
	}
}

func TestLogisticsLowestCostPrefersBiggerLoads(t *testing.T) {
	prev := model.CurrentLogisticsSchedulingConfig()
	cfg := prev
	cfg.DemandForecastMultiplier = 1
	cfg.OversupplyRatio = 0
	cfg.OversupplyMax = 0
	cfg.PlanetaryStrategy = model.LogisticsSchedulingStrategyShortestPath
	if err := model.SetLogisticsSchedulingConfig(cfg); err != nil {
		t.Fatalf("set config: %v", err)
	}
	defer func() {
		if err := model.SetLogisticsSchedulingConfig(prev); err != nil {
			t.Fatalf("restore config: %v", err)
		}
	}()

	ws := model.NewWorldState("planet-1", 12, 1)
	origin := newPlanetaryStationBuilding("pl-origin", model.Position{X: 0, Y: 0}, "p1")
	near := newPlanetaryStationBuilding("pl-near", model.Position{X: 2, Y: 0}, "p1")
	far := newPlanetaryStationBuilding("pl-far", model.Position{X: 10, Y: 0}, "p1")

	ws.Buildings[origin.ID] = origin
	ws.Buildings[near.ID] = near
	ws.Buildings[far.ID] = far
	model.RegisterLogisticsStation(ws, origin)
	model.RegisterLogisticsStation(ws, near)
	model.RegisterLogisticsStation(ws, far)

	if err := origin.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeSupply,
		LocalStorage: 0,
	}); err != nil {
		t.Fatalf("origin setting: %v", err)
	}
	origin.LogisticsStation.SetInventory(model.ItemInventory{model.ItemHydrogen: 100})

	if err := near.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 5,
	}); err != nil {
		t.Fatalf("near setting: %v", err)
	}
	if err := far.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{
		ItemID:       model.ItemHydrogen,
		Mode:         model.LogisticsStationModeDemand,
		LocalStorage: 50,
	}); err != nil {
		t.Fatalf("far setting: %v", err)
	}

	origin.LogisticsStation.RefreshCapacityCache()
	near.LogisticsStation.RefreshCapacityCache()
	far.LogisticsStation.RefreshCapacityCache()

	demandRemaining, _ := buildDemandRemaining(ws, map[string]*model.Building{
		origin.ID: origin,
		near.ID:   near,
		far.ID:    far,
	})

	drone := model.NewLogisticsDroneState("drone-1", origin.ID, origin.Position)
	candidate := selectDispatchCandidate(origin.ID, origin, origin.LogisticsStation, demandRemaining, map[string]*model.Building{
		origin.ID: origin,
		near.ID:   near,
		far.ID:    far,
	}, ws.LogisticsStations, drone)
	if candidate == nil || candidate.targetID != near.ID {
		t.Fatalf("expected shortest path to select near target, got %+v", candidate)
	}

	cfg.PlanetaryStrategy = model.LogisticsSchedulingStrategyLowestCost
	if err := model.SetLogisticsSchedulingConfig(cfg); err != nil {
		t.Fatalf("set config: %v", err)
	}

	demandRemaining, _ = buildDemandRemaining(ws, map[string]*model.Building{
		origin.ID: origin,
		near.ID:   near,
		far.ID:    far,
	})
	candidate = selectDispatchCandidate(origin.ID, origin, origin.LogisticsStation, demandRemaining, map[string]*model.Building{
		origin.ID: origin,
		near.ID:   near,
		far.ID:    far,
	}, ws.LogisticsStations, drone)
	if candidate == nil || candidate.targetID != far.ID {
		t.Fatalf("expected lowest cost to select far target, got %+v", candidate)
	}
}
