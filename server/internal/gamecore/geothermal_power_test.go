package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	modelpower "siliconworld/internal/model/power"
	"siliconworld/internal/terrain"
)

func geothermalTestEnv() mapmodel.PlanetEnvironment {
	return mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1}
}

func powerInputFor(ws *model.WorldState, buildingID string) *model.PowerInput {
	for i := range ws.PowerInputs {
		if ws.PowerInputs[i].BuildingID == buildingID {
			return &ws.PowerInputs[i]
		}
	}
	return nil
}

func TestGeothermalGeneratesWhenAdjacentToLava(t *testing.T) {
	ws := newPowerTestWorld()
	geo := addPowerTestBuilding(ws, "geo-1", model.BuildingTypeGeothermalPowerStation, model.Position{X: 2, Y: 2})
	ws.Grid[3][3].Terrain = terrain.TileLava

	settlePowerGeneration(ws, geothermalTestEnv())

	input := powerInputFor(ws, geo.ID)
	if input == nil {
		t.Fatalf("expected geothermal power input, got %+v", ws.PowerInputs)
	}
	if input.SourceKind != modelpower.PowerSourceGeothermal || input.Output != 30 {
		t.Fatalf("unexpected geothermal input: %+v", input)
	}
	if geo.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected running state, got %s", geo.Runtime.State)
	}
}

func TestGeothermalGeneratesWhenBuiltOnLava(t *testing.T) {
	ws := newPowerTestWorld()
	geo := addPowerTestBuilding(ws, "geo-1", model.BuildingTypeGeothermalPowerStation, model.Position{X: 2, Y: 2})
	ws.Grid[2][2].Terrain = terrain.TileLava

	settlePowerGeneration(ws, geothermalTestEnv())

	if input := powerInputFor(ws, geo.ID); input == nil || input.Output != 30 {
		t.Fatalf("expected on-lava generation, got %+v", ws.PowerInputs)
	}
}

func TestGeothermalStallsWithoutLavaAndRecovers(t *testing.T) {
	ws := newPowerTestWorld()
	geo := addPowerTestBuilding(ws, "geo-1", model.BuildingTypeGeothermalPowerStation, model.Position{X: 2, Y: 2})

	events := settlePowerGeneration(ws, geothermalTestEnv())
	if input := powerInputFor(ws, geo.ID); input != nil {
		t.Fatalf("expected no generation without lava, got %+v", input)
	}
	if geo.Runtime.State != model.BuildingWorkNoPower || geo.Runtime.StateReason != stateReasonNoLava {
		t.Fatalf("expected no_power/no_lava, got %s/%s", geo.Runtime.State, geo.Runtime.StateReason)
	}
	found := false
	for _, evt := range events {
		if evt.EventType == model.EvtBuildingStateChanged && evt.Payload["building_id"] == geo.ID && evt.Payload["reason"] == stateReasonNoLava {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected no_lava state event, got %+v", events)
	}

	// Steady state: no duplicate event while conditions are unchanged.
	events = settlePowerGeneration(ws, geothermalTestEnv())
	if len(events) != 0 {
		t.Fatalf("expected no repeated events, got %+v", events)
	}

	// Lava appears nearby: generation resumes.
	ws.Grid[1][2].Terrain = terrain.TileLava
	settlePowerGeneration(ws, geothermalTestEnv())
	if geo.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected recovery to running, got %s", geo.Runtime.State)
	}
	if input := powerInputFor(ws, geo.ID); input == nil || input.Output != 30 {
		t.Fatalf("expected generation after lava appears, got %+v", ws.PowerInputs)
	}
}

func TestGeothermalFeedsPowerGridSettlement(t *testing.T) {
	ws := newPowerTestWorld()
	geo := addPowerTestBuilding(ws, "geo-1", model.BuildingTypeGeothermalPowerStation, model.Position{X: 1, Y: 1})
	ws.Grid[1][2].Terrain = terrain.TileLava
	consumer := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1})
	addResourceNode(ws, "r-1", consumer.Position, 8)

	settlePowerGeneration(ws, geothermalTestEnv())
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	finalizePowerSettlement(ws, nil)
	settleResources(ws)

	if consumer.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected consumer running on geothermal power, got %s", consumer.Runtime.State)
	}
	if ws.PowerSnapshot == nil {
		t.Fatalf("expected power snapshot")
	}
	networkID := ws.PowerSnapshot.Networks.BuildingNetwork[geo.ID]
	network := ws.PowerSnapshot.Networks.Networks[networkID]
	if network == nil || network.Supply != 30 {
		t.Fatalf("expected network supply 30 from geothermal, got %+v", network)
	}
}
