package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestMineExtractsFiniteResource(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Behavior:     "finite",
		MaxAmount:    10,
		Remaining:    10,
		BaseYield:    4,
		CurrentYield: 4,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Params: model.BuildingRuntimeParams{
				EnergyConsume: 0,
			},
			Functions: model.BuildingFunctionModules{
				Collect: &model.CollectModule{YieldPerTick: 5},
			},
		},
	}
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Resources["r1"].Remaining != 6 {
		t.Fatalf("expected remaining 6, got %d", ws.Resources["r1"].Remaining)
	}
	if ws.Players["p1"].Resources.Minerals != 4 {
		t.Fatalf("expected minerals 4, got %d", ws.Players["p1"].Resources.Minerals)
	}
}

func TestMineDecaysOilYield(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Behavior:     "decay",
		BaseYield:    5,
		CurrentYield: 5,
		MinYield:     2,
		DecayPerTick: 1,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Params: model.BuildingRuntimeParams{
				EnergyConsume: 0,
			},
			Functions: model.BuildingFunctionModules{
				Collect: &model.CollectModule{YieldPerTick: 4},
			},
		},
	}
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Resources["r1"].CurrentYield != 4 {
		t.Fatalf("expected current yield 4, got %d", ws.Resources["r1"].CurrentYield)
	}
	if ws.Players["p1"].Resources.Minerals != 4 {
		t.Fatalf("expected minerals 4, got %d", ws.Players["p1"].Resources.Minerals)
	}
}

func TestRenewableResourceRegens(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", Resources: model.Resources{}, IsAlive: true}
	ws.Resources["r1"] = &model.ResourceNodeState{
		ID:           "r1",
		Behavior:     "renewable",
		MaxAmount:    10,
		Remaining:    5,
		BaseYield:    3,
		CurrentYield: 3,
		RegenPerTick: 2,
	}
	ws.Grid[0][0].ResourceNodeID = "r1"
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Params: model.BuildingRuntimeParams{
				EnergyConsume: 0,
			},
			Functions: model.BuildingFunctionModules{
				Collect: &model.CollectModule{YieldPerTick: 2},
			},
		},
	}
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Resources["r1"].Remaining != 5 {
		t.Fatalf("expected remaining 5 after regen, got %d", ws.Resources["r1"].Remaining)
	}
	if ws.Players["p1"].Resources.Minerals != 2 {
		t.Fatalf("expected minerals 2, got %d", ws.Players["p1"].Resources.Minerals)
	}
}

func TestMaintenanceCostBlocksProduction(t *testing.T) {
	ws := model.NewWorldState("planet-1", 1, 1)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID:  "p1",
		Resources: model.Resources{Minerals: 1, Energy: 0},
		IsAlive:   true,
	}
	building := &model.Building{
		ID:       "b1",
		Type:     model.BuildingTypeMiningMachine,
		OwnerID:  "p1",
		Position: model.Position{X: 0, Y: 0},
		Runtime: model.BuildingRuntime{
			State: model.BuildingWorkRunning,
			Params: model.BuildingRuntimeParams{
				MaintenanceCost: model.MaintenanceCost{Minerals: 2},
			},
			Functions: model.BuildingFunctionModules{
				Collect: &model.CollectModule{YieldPerTick: 5},
			},
		},
	}
	model.InitBuildingStorage(building)
	ws.Buildings["b1"] = building

	settleResources(ws)

	if ws.Buildings["b1"].Runtime.State != model.BuildingWorkError {
		t.Fatalf("expected building state error, got %s", ws.Buildings["b1"].Runtime.State)
	}
	if ws.Players["p1"].Resources.Minerals != 1 {
		t.Fatalf("expected minerals 1, got %d", ws.Players["p1"].Resources.Minerals)
	}
}
