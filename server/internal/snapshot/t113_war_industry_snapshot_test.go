package snapshot_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func TestT113SnapshotRoundTripPreservesWarIndustryState(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8, 8)
	player := &model.PlayerState{
		PlayerID:  "p1",
		IsAlive:   true,
		Resources: model.Resources{Minerals: 100, Energy: 50},
		WarIndustry: &model.WarIndustryState{
			NextOrderSeq: 3,
			ProductionOrders: map[string]*model.WarProductionOrder{
				"war-prod-1": {
					ID:                  "war-prod-1",
					FactoryBuildingID:   "factory-1",
					DeploymentHubID:     "hub-1",
					BlueprintID:         "prototype",
					Domain:              model.UnitDomainGround,
					Count:               2,
					CompletedCount:      1,
					Status:              model.WarOrderStatusInProgress,
					Stage:               model.WarProductionStageAssembly,
					StageRemainingTicks: 12,
					StageTotalTicks:     24,
					ComponentTicks:      16,
					AssemblyTicks:       24,
					RepeatBonusPercent:  5,
				},
			},
			RefitOrders: map[string]*model.WarRefitOrder{
				"war-refit-2": {
					ID:                "war-refit-2",
					BuildingID:        "factory-1",
					UnitID:            "squad-1",
					UnitKind:          model.WarRefitUnitKindSquad,
					SourcePlanetID:    "planet-1",
					SourceBlueprintID: "prototype",
					TargetBlueprintID: "support_mk1",
					Status:            model.WarOrderStatusInProgress,
					RemainingTicks:    9,
					TotalTicks:        18,
				},
			},
			ProductionLines: map[string]*model.WarProductionLineState{
				"factory-1": {
					BuildingID:      "factory-1",
					LastBlueprintID: "prototype",
					ConsecutiveRuns: 2,
					ActiveOrderID:   "war-prod-1",
				},
			},
			DeploymentHubs: map[string]*model.WarDeploymentHubState{
				"hub-1": {
					BuildingID:    "hub-1",
					Capacity:      10,
					ReadyPayloads: map[string]int{"prototype": 3},
				},
			},
		},
	}
	ws.Players[player.PlayerID] = player

	snap := snapshot.CaptureRuntime(map[string]*model.WorldState{ws.PlanetID: ws}, ws.PlanetID, nil, nil)
	data, err := snapshot.Encode(snap)
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	decoded, err := snapshot.Decode(data)
	if err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}

	worlds, activePlanetID, _, err := decoded.RestoreRuntime()
	if err != nil {
		t.Fatalf("restore runtime: %v", err)
	}
	restored := worlds[activePlanetID]
	if restored == nil || restored.Players["p1"] == nil {
		t.Fatalf("expected restored player state, got %+v", restored)
	}
	industry := restored.Players["p1"].WarIndustry
	if industry == nil {
		t.Fatalf("expected war industry to roundtrip, got %+v", restored.Players["p1"])
	}
	if industry.NextOrderSeq != 3 {
		t.Fatalf("expected next order seq 3, got %+v", industry)
	}
	if industry.ProductionOrders["war-prod-1"] == nil || industry.ProductionOrders["war-prod-1"].Stage != model.WarProductionStageAssembly {
		t.Fatalf("expected production order to roundtrip, got %+v", industry.ProductionOrders)
	}
	if industry.RefitOrders["war-refit-2"] == nil || industry.RefitOrders["war-refit-2"].TargetBlueprintID != "support_mk1" {
		t.Fatalf("expected refit order to roundtrip, got %+v", industry.RefitOrders)
	}
	if industry.ProductionLines["factory-1"] == nil || industry.ProductionLines["factory-1"].ConsecutiveRuns != 2 {
		t.Fatalf("expected production line state to roundtrip, got %+v", industry.ProductionLines)
	}
	if industry.DeploymentHubs["hub-1"] == nil || industry.DeploymentHubs["hub-1"].ReadyPayloads["prototype"] != 3 {
		t.Fatalf("expected deployment hub stock to roundtrip, got %+v", industry.DeploymentHubs)
	}
}
