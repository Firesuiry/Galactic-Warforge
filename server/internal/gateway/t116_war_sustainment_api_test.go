package gateway_test

import (
	"testing"

	"siliconworld/internal/model"
)

func TestT116WarfareAndFleetEndpointsExposeSustainmentFields(t *testing.T) {
	srv, core := newTestServer(t)
	ws := core.World()

	hub := &model.Building{
		ID:          "hub-api-t116",
		Type:        model.BuildingTypeBattlefieldAnalysisBase,
		OwnerID:     "p1",
		Position:    model.Position{X: 6, Y: 6},
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 6,
		Runtime: model.BuildingRuntime{
			Params: model.BuildingRuntimeParams{Footprint: model.Footprint{Width: 1, Height: 1}},
			State:  model.BuildingWorkRunning,
		},
	}
	hub.Storage = &model.StorageState{Capacity: 64, Inventory: model.ItemInventory{}}
	if _, _, err := hub.Storage.Load(model.ItemAmmoBullet, 12); err != nil {
		t.Fatalf("load hub ammo: %v", err)
	}

	ws.Lock()
	ws.Buildings[hub.ID] = hub
	ws.Buildings["station-api-t116"] = &model.Building{
		ID:          "station-api-t116",
		Type:        model.BuildingTypeSupplyStation,
		OwnerID:     "p1",
		Storage:     &model.StorageState{Capacity: 64, Inventory: model.ItemInventory{model.ItemAmmoBullet: 8}},
		Position:    model.Position{X: 8, Y: 6},
		HP:          100,
		MaxHP:       100,
		Level:       1,
		VisionRange: 6,
		Runtime: model.BuildingRuntime{
			Params: model.BuildingRuntimeParams{Footprint: model.Footprint{Width: 1, Height: 1}},
			State:  model.BuildingWorkRunning,
		},
	}
	ws.Players["p1"].WarIndustry = &model.WarIndustryState{
		DeploymentHubs: map[string]*model.WarDeploymentHubState{
			hub.ID: {
				BuildingID:    hub.ID,
				Capacity:      8,
				ReadyPayloads: map[string]int{"prototype": 2},
			},
		},
	}
	ws.Unlock()

	systemID := core.Maps().PrimaryPlanet().SystemID
	core.SpaceRuntime().EnsurePlayerSystem("p1", systemID).Fleets["fleet-api-t116"] = &model.SpaceFleet{
		ID:        "fleet-api-t116",
		OwnerID:   "p1",
		SystemID:  systemID,
		Formation: model.FormationTypeLine,
		State:     model.FleetStateIdle,
		Units:     []model.FleetUnitStack{{BlueprintID: "corvette", Count: 1}},
		Weapon:    model.WeaponState{Type: model.WeaponTypeLaser, Damage: 12, FireRate: 10, Range: 20, AmmoCost: 1},
		Shield:    model.ShieldState{Level: 6, MaxLevel: 10, RechargeRate: 1, RechargeDelay: 8},
		Sustainment: model.WarSustainmentState{
			Current:            model.WarSupplyStock{Ammo: 2, Shells: 1},
			Capacity:           model.WarSupplyStock{Ammo: 6, Shells: 4},
			Condition:          model.WarSupplyConditionCritical,
			Cohesion:           0.32,
			RetreatRecommended: true,
			Shortages:          []string{"ammo_shortage", "shell_shortage"},
		},
	}

	industryBody := getAuthorizedJSON(t, srv, "/world/warfare/industry")
	supplyNodes, ok := industryBody["supply_nodes"].([]any)
	if !ok || len(supplyNodes) != 1 {
		t.Fatalf("expected only the supply station as a supply node (hub and logistics stations do not resupply), got %+v", industryBody)
	}
	if node, _ := supplyNodes[0].(map[string]any); node["source_type"] != string(model.WarSupplySourceSupplyStation) {
		t.Fatalf("expected supply_station source, got %+v", supplyNodes[0])
	}

	fleetBody := getAuthorizedJSON(t, srv, "/world/fleets/fleet-api-t116")
	sustainment, ok := fleetBody["sustainment"].(map[string]any)
	if !ok {
		t.Fatalf("expected sustainment in fleet endpoint, got %+v", fleetBody)
	}
	if sustainment["condition"] != string(model.WarSupplyConditionCritical) {
		t.Fatalf("expected critical sustainment condition, got %+v", sustainment)
	}
	if sustainment["retreat_recommended"] != true {
		t.Fatalf("expected retreat flag in fleet sustainment, got %+v", sustainment)
	}
	current, ok := sustainment["current"].(map[string]any)
	if !ok || current["ammo"] == nil || current["shells"] == nil {
		t.Fatalf("expected three-class ammunition stock in fleet sustainment, got %+v", sustainment)
	}
	for _, removed := range []string{"repair", "fuel", "spare_parts", "shield_cells", "repair_drones"} {
		if _, exists := sustainment[removed]; exists {
			t.Fatalf("sustainment must not expose %s, got %+v", removed, sustainment)
		}
		if _, exists := current[removed]; exists {
			t.Fatalf("sustainment stock must not expose %s, got %+v", removed, current)
		}
	}
}
