package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT115TickSettlementBuildsPlanetAndSystemSensorContacts(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	radar := newBuilding("radar-t115", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	radar.Runtime.State = model.BuildingWorkRunning
	radar.Runtime.Params.EnergyConsume = 0
	if radar.Runtime.Functions.Energy != nil {
		radar.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, radar)

	signal := newBuilding("signal-t115", model.BuildingTypeSignalTower, "p1", model.Position{X: 8, Y: 6})
	signal.Runtime.State = model.BuildingWorkRunning
	signal.Runtime.Params.EnergyConsume = 0
	if signal.Runtime.Functions.Energy != nil {
		signal.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, signal)

	power := newBuilding("power-t115", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	ws.EnemyForces = &model.EnemyForceState{
		SystemID: systemID,
		Forces: []model.EnemyForce{{
			ID:           "enemy-beacon",
			Type:         model.EnemyForceTypeBeacon,
			Position:     model.Position{X: 11, Y: 10},
			Strength:     90,
			SpreadRadius: 2,
			TargetPlayer: "p1",
			SpawnTick:    ws.Tick,
		}},
	}

	p1System := core.SpaceRuntime().EnsurePlayerSystem("p1", systemID)
	p1Fleet := &model.SpaceFleet{
		ID:             "fleet-p1",
		OwnerID:        "p1",
		SystemID:       systemID,
		AnchorPlanetID: ws.PlanetID,
		Formation:      model.FormationTypeLine,
		State:          model.FleetStateIdle,
		Units: []model.FleetUnitStack{
			{BlueprintID: model.ItemDestroyer, Count: 1},
		},
	}
	rebuildFleetStats(ws, "p1", p1Fleet)
	p1System.Fleets[p1Fleet.ID] = p1Fleet

	p2System := core.SpaceRuntime().EnsurePlayerSystem("p2", systemID)
	p2Fleet := &model.SpaceFleet{
		ID:             "fleet-p2",
		OwnerID:        "p2",
		SystemID:       systemID,
		AnchorPlanetID: ws.PlanetID,
		Formation:      model.FormationTypeLine,
		State:          model.FleetStateIdle,
		Units: []model.FleetUnitStack{
			{BlueprintID: model.ItemCorvette, Count: 1},
		},
	}
	rebuildFleetStats(ws, "p2", p2Fleet)
	p2System.Fleets[p2Fleet.ID] = p2Fleet

	core.processTick()

	if ws.SensorContacts == nil || ws.SensorContacts["p1"] == nil || len(ws.SensorContacts["p1"].Contacts) == 0 {
		t.Fatalf("expected planet sensor contacts after tick, got %+v", ws.SensorContacts)
	}
	if len(core.SpaceRuntime().PlayerSystem("p1", systemID).SensorContacts) == 0 {
		t.Fatalf("expected system sensor contacts after tick, got %+v", core.SpaceRuntime().PlayerSystem("p1", systemID))
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	planetView, ok := ql.PlanetRuntime(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected planet runtime view")
	}
	if len(planetView.Contacts) == 0 {
		t.Fatalf("expected planet runtime contacts, got %+v", planetView)
	}

	systemView, ok := ql.SystemRuntime("p1", systemID, ws.PlanetID, ws, core.SpaceRuntime())
	if !ok {
		t.Fatal("expected system runtime view")
	}
	if len(systemView.Contacts) == 0 {
		t.Fatalf("expected system runtime contacts, got %+v", systemView)
	}

	foundGhost := false
	foundSignalSource := false
	for _, contact := range systemView.Contacts {
		if contact.FalseContact {
			foundGhost = true
		}
		for _, source := range contact.Sources {
			if source.SourceType == model.SensorSourceSignalTower || source.SourceType == model.SensorSourcePassiveEM {
				foundSignalSource = true
			}
		}
	}
	if !foundGhost {
		t.Fatalf("expected ECM target to create a false contact, got %+v", systemView.Contacts)
	}
	if !foundSignalSource {
		t.Fatalf("expected system contact sources to record signal/passive sensors, got %+v", systemView.Contacts)
	}
}
