package gateway_test

import (
	"testing"

	"siliconworld/internal/model"
)

func TestT113WarIndustryEndpointExposesProductionRefitAndHubState(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()

	var hubID string
	for _, building := range ws.Buildings {
		if building != nil && building.OwnerID == "p1" {
			hubID = building.ID
			break
		}
	}
	if hubID == "" {
		t.Fatal("expected one owned building for p1")
	}

	player := ws.Players["p1"]
	player.WarIndustry = &model.WarIndustryState{
		ProductionOrders: map[string]*model.WarProductionOrder{
			"war-prod-1": {
				ID:                  "war-prod-1",
				FactoryBuildingID:   hubID,
				DeploymentHubID:     hubID,
				BlueprintID:         "prototype",
				Count:               2,
				CompletedCount:      1,
				Status:              model.WarOrderStatusInProgress,
				Stage:               model.WarProductionStageAssembly,
				StageRemainingTicks: 12,
			},
		},
		RefitOrders: map[string]*model.WarRefitOrder{
			"war-refit-2": {
				ID:                "war-refit-2",
				BuildingID:        hubID,
				UnitID:            "squad-9",
				UnitKind:          model.WarRefitUnitKindSquad,
				SourceBlueprintID: "prototype",
				TargetBlueprintID: "support_mk1",
				Status:            model.WarOrderStatusInProgress,
				RemainingTicks:    9,
			},
		},
		DeploymentHubs: map[string]*model.WarDeploymentHubState{
			hubID: {
				BuildingID:    hubID,
				Capacity:      12,
				ReadyPayloads: map[string]int{"prototype": 3},
			},
		},
	}

	body := getAuthorizedJSON(t, srv, "/world/warfare/industry")

	productionOrders, ok := body["production_orders"].([]any)
	if !ok || len(productionOrders) != 1 {
		t.Fatalf("expected one production order, got %+v", body)
	}
	order, ok := productionOrders[0].(map[string]any)
	if !ok || order["blueprint_id"] != "prototype" {
		t.Fatalf("expected prototype production order, got %+v", productionOrders[0])
	}

	refitOrders, ok := body["refit_orders"].([]any)
	if !ok || len(refitOrders) != 1 {
		t.Fatalf("expected one refit order, got %+v", body)
	}
	refit, ok := refitOrders[0].(map[string]any)
	if !ok || refit["target_blueprint_id"] != "support_mk1" {
		t.Fatalf("expected support_mk1 refit order, got %+v", refitOrders[0])
	}

	deploymentHubs, ok := body["deployment_hubs"].([]any)
	if !ok || len(deploymentHubs) != 1 {
		t.Fatalf("expected one deployment hub entry, got %+v", body)
	}
	hub, ok := deploymentHubs[0].(map[string]any)
	if !ok || hub["building_id"] != hubID {
		t.Fatalf("expected deployment hub %s, got %+v", hubID, deploymentHubs[0])
	}
	readyPayloads, ok := hub["ready_payloads"].(map[string]any)
	if !ok {
		t.Fatalf("expected ready_payloads map, got %+v", hub)
	}
	if readyPayloads["prototype"] != float64(3) {
		t.Fatalf("expected 3 prototype payloads, got %+v", readyPayloads)
	}
}
