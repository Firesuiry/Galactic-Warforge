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
	if _, _, err := hub.Storage.Load(model.ItemHydrogenFuelRod, 4); err != nil {
		t.Fatalf("load hub fuel: %v", err)
	}

	ws.Lock()
	ws.Buildings[hub.ID] = hub
	ws.LogisticsStations["station-api-t116"] = &model.LogisticsStationState{
		Inventory: model.ItemInventory{
			model.ItemAmmoBullet:     8,
			model.ItemPrecisionDrone: 1,
		},
	}
	ws.Buildings["station-api-t116"] = &model.Building{
		ID:          "station-api-t116",
		Type:        model.BuildingTypePlanetaryLogisticsStation,
		OwnerID:     "p1",
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
			Current:            model.WarSupplyStock{Ammo: 2, Fuel: 1, SpareParts: 1, RepairDrones: 1},
			Capacity:           model.WarSupplyStock{Ammo: 6, Fuel: 4, SpareParts: 3, RepairDrones: 2},
			Condition:          model.WarSupplyConditionCritical,
			Cohesion:           0.32,
			MobilityPenalty:    1,
			RetreatRecommended: true,
			Shortages:          []string{"fuel_starved", "repair_stalled"},
			Repair: model.WarRepairState{
				Tier:           model.WarRepairTierField,
				BlockedReason:  "repair_supply_exhausted",
				RemainingTicks: 3,
			},
		},
	}

	industryBody := getAuthorizedJSON(t, srv, "/world/warfare/industry")
	supplyNodes, ok := industryBody["supply_nodes"].([]any)
	if !ok || len(supplyNodes) < 2 {
		t.Fatalf("expected supply_nodes in warfare industry endpoint, got %+v", industryBody)
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
	if _, ok := sustainment["repair"].(map[string]any); !ok {
		t.Fatalf("expected nested repair state in fleet sustainment, got %+v", sustainment)
	}
}
