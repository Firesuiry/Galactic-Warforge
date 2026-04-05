package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT099ArtificialStarWithoutFuelShowsNoPowerReasonAndZeroSupply(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	star := newFuelGeneratorForT099("star-no-fuel", model.BuildingTypeArtificialStar, model.Position{X: 6, Y: 6})
	placeBuilding(ws, star)
	model.RegisterPowerGridBuilding(ws, star)

	core.processTick()

	if star.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected artificial star state no_power, got %s", star.Runtime.State)
	}
	if star.Runtime.StateReason != stateReasonNoFuel {
		t.Fatalf("expected artificial star reason %s, got %s", stateReasonNoFuel, star.Runtime.StateReason)
	}

	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtBuildingStateChanged}, "", ws.Tick, 10)
	if !hasBuildingStateReasonEvent(events, star.ID, model.BuildingWorkRunning, model.BuildingWorkNoPower, "", stateReasonNoFuel) {
		t.Fatalf("expected running -> no_power/no_fuel event, got %+v", events)
	}

	networks := planetNetworksForT099(t, core, ws)
	if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, networks); supply != 0 {
		t.Fatalf("expected star network supply 0 without fuel, got %d", supply)
	}
	if output := powerInputOutputForBuildingT099(ws, star.ID); output != 0 {
		t.Fatalf("expected no power input recorded for star without fuel, got %d", output)
	}
}

func TestT099ArtificialStarRecoversAfterFuelIsLoaded(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	star := newFuelGeneratorForT099("star-recover", model.BuildingTypeArtificialStar, model.Position{X: 6, Y: 6})
	placeBuilding(ws, star)
	model.RegisterPowerGridBuilding(ws, star)

	core.processTick()
	beforeGeneration := ws.Players["p1"].Stats.EnergyStats.Generation
	if _, _, err := star.Storage.Load(model.ItemAntimatterFuelRod, 2); err != nil {
		t.Fatalf("load antimatter fuel rod: %v", err)
	}

	core.processTick()

	if star.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected artificial star running after refuel, got %s", star.Runtime.State)
	}
	if star.Runtime.StateReason != "" {
		t.Fatalf("expected running state reason cleared, got %s", star.Runtime.StateReason)
	}

	events, _, _, _ := core.EventHistory().Snapshot([]model.EventType{model.EvtBuildingStateChanged}, "", ws.Tick, 10)
	if !hasBuildingStateReasonEvent(events, star.ID, model.BuildingWorkNoPower, model.BuildingWorkRunning, stateReasonNoFuel, stateReasonStart) {
		t.Fatalf("expected no_power/no_fuel -> running event, got %+v", events)
	}

	networks := planetNetworksForT099(t, core, ws)
	if supply := powerNetworkSupplyForBuildingT099(t, ws, star.ID, networks); supply <= 0 {
		t.Fatalf("expected positive star network supply after refuel, got %d", supply)
	}
	if generation := ws.Players["p1"].Stats.EnergyStats.Generation; generation <= beforeGeneration {
		t.Fatalf("expected energy generation to increase after refuel, before=%d after=%d", beforeGeneration, generation)
	}
}

func TestT099ArtificialStarFallsBackToNoFuelAfterLastRodIsConsumed(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	star := newFuelGeneratorForT099("star-consume", model.BuildingTypeArtificialStar, model.Position{X: 6, Y: 6})
	if _, _, err := star.Storage.Load(model.ItemAntimatterFuelRod, 1); err != nil {
		t.Fatalf("load antimatter fuel rod: %v", err)
	}
	placeBuilding(ws, star)
	model.RegisterPowerGridBuilding(ws, star)

	core.processTick()

	if star.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected artificial star to fall back to no_power after consuming last rod, got %s", star.Runtime.State)
	}
	if star.Runtime.StateReason != stateReasonNoFuel {
		t.Fatalf("expected artificial star reason %s after fuel exhaustion, got %s", stateReasonNoFuel, star.Runtime.StateReason)
	}
	if remaining := star.Storage.OutputQuantity(model.ItemAntimatterFuelRod); remaining != 0 {
		t.Fatalf("expected antimatter fuel rod to be consumed, got %d remaining", remaining)
	}
}

func TestT099FuelGeneratorsShareNoFuelRule(t *testing.T) {
	tests := []struct {
		name  string
		btype model.BuildingType
	}{
		{name: "thermal", btype: model.BuildingTypeThermalPowerPlant},
		{name: "fusion", btype: model.BuildingTypeMiniFusionPowerPlant},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			core := newE2ETestCore(t)
			ws := core.World()

			generator := newFuelGeneratorForT099("gen-"+tc.name, tc.btype, model.Position{X: 6, Y: 6})
			placeBuilding(ws, generator)
			model.RegisterPowerGridBuilding(ws, generator)

			core.processTick()

			if generator.Runtime.State != model.BuildingWorkNoPower {
				t.Fatalf("expected %s to enter no_power without fuel, got %s", tc.btype, generator.Runtime.State)
			}
			if generator.Runtime.StateReason != stateReasonNoFuel {
				t.Fatalf("expected %s reason %s, got %s", tc.btype, stateReasonNoFuel, generator.Runtime.StateReason)
			}
		})
	}
}

func TestT099ProduceCorvetteStillRejected(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()

	producer := newBuilding("producer-t099", model.BuildingTypeAssemblingMachineMk1, "p1", model.Position{X: 8, Y: 8})
	producer.Runtime.State = model.BuildingWorkRunning
	producer.Runtime.Params.EnergyConsume = 0
	if producer.Runtime.Functions.Energy != nil {
		producer.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	placeBuilding(ws, producer)

	res, _ := core.execProduce(ws, "p1", model.Command{
		Type:   model.CmdProduce,
		Target: model.CommandTarget{EntityID: producer.ID},
		Payload: map[string]any{
			"unit_type": "corvette",
		},
	})
	if res.Code != model.CodeValidationFailed {
		t.Fatalf("expected validation failure for corvette, got %+v", res)
	}
	if res.Message != "unit corvette is not produced via produce; use commission_fleet" {
		t.Fatalf("expected authoritative unit catalog rejection, got %q", res.Message)
	}
}

func newFuelGeneratorForT099(id string, btype model.BuildingType, pos model.Position) *model.Building {
	building := newBuilding(id, btype, "p1", pos)
	building.Runtime.State = model.BuildingWorkRunning
	return building
}

func planetNetworksForT099(t *testing.T, core *GameCore, ws *model.WorldState) *query.PlanetNetworksView {
	t.Helper()
	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	view, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected planet networks view")
	}
	return view
}

func powerNetworkSupplyForBuildingT099(t *testing.T, ws *model.WorldState, buildingID string, view *query.PlanetNetworksView) int {
	t.Helper()
	snapshot := model.CurrentPowerSettlementSnapshot(ws)
	if snapshot == nil {
		t.Fatal("expected power settlement snapshot")
	}
	networkID := snapshot.Networks.BuildingNetwork[buildingID]
	if networkID == "" {
		return 0
	}
	for _, network := range view.PowerNetworks {
		if network.ID == networkID {
			return network.Supply
		}
	}
	t.Fatalf("expected network %s for building %s in %+v", networkID, buildingID, view.PowerNetworks)
	return 0
}

func powerInputOutputForBuildingT099(ws *model.WorldState, buildingID string) int {
	total := 0
	for _, input := range ws.PowerInputs {
		if input.BuildingID == buildingID {
			total += input.Output
		}
	}
	return total
}
