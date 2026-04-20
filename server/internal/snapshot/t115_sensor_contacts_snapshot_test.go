package snapshot_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func TestT115SnapshotRoundTripPreservesSensorContacts(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8, 8)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID:  "p1",
		IsAlive:   true,
		Resources: model.Resources{Minerals: 100, Energy: 50},
	}
	ws.SensorContacts = map[string]*model.SensorContactState{
		"p1": {
			PlayerID:  "p1",
			ScopeType: model.SensorContactScopePlanet,
			ScopeID:   "planet-1",
			Contacts: map[string]*model.SensorContact{
				"enemy-1": {
					ID:              "enemy-1",
					ScopeType:       model.SensorContactScopePlanet,
					ScopeID:         "planet-1",
					ContactKind:     model.SensorContactKindEnemyForce,
					EntityID:        "enemy-1",
					EntityType:      "enemy_force",
					Level:           model.SensorContactLevelConfirmedType,
					Classification:  "ground_force",
					ConfirmedType:   "beacon",
					LastUpdatedTick: 42,
					SignalStrength:  9,
					LockQuality:     0.7,
					Sources: []model.SensorContactSource{
						{SourceType: model.SensorSourceActiveRadar, SourceID: "radar-1", SourceKind: "building", Strength: 6},
					},
				},
			},
		},
	}

	space := model.NewSpaceRuntimeState()
	space.EnsurePlayerSystem("p1", "sys-1").SensorContacts = map[string]*model.SensorContact{
		"fleet-enemy": {
			ID:               "fleet-enemy",
			ScopeType:        model.SensorContactScopeSystem,
			ScopeID:          "sys-1",
			ContactKind:      model.SensorContactKindFleet,
			EntityID:         "fleet-enemy",
			EntityType:       "fleet",
			Level:            model.SensorContactLevelClassifiedContact,
			Classification:   "space_fleet",
			LastUpdatedTick:  42,
			MissileDriftRisk: 0.4,
			JammingPenalty:   2,
			FalseContact:     true,
			Sources: []model.SensorContactSource{
				{SourceType: model.SensorSourcePassiveEM, SourceID: "fleet-p1", SourceKind: "fleet", Strength: 4},
			},
		},
	}

	snap := snapshot.CaptureRuntime(map[string]*model.WorldState{ws.PlanetID: ws}, ws.PlanetID, nil, space)
	data, err := snapshot.Encode(snap)
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	decoded, err := snapshot.Decode(data)
	if err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}

	worlds, activePlanetID, restoredSpace, err := decoded.RestoreRuntime()
	if err != nil {
		t.Fatalf("restore runtime: %v", err)
	}
	restoredWorld := worlds[activePlanetID]
	if restoredWorld == nil || restoredWorld.SensorContacts["p1"] == nil {
		t.Fatalf("expected restored world sensor contacts, got %+v", restoredWorld)
	}
	planetContact := restoredWorld.SensorContacts["p1"].Contacts["enemy-1"]
	if planetContact == nil || planetContact.Level != model.SensorContactLevelConfirmedType {
		t.Fatalf("expected restored planet contact, got %+v", planetContact)
	}
	if len(planetContact.Sources) != 1 || planetContact.Sources[0].SourceType != model.SensorSourceActiveRadar {
		t.Fatalf("expected restored planet contact sources, got %+v", planetContact)
	}

	systemRuntime := restoredSpace.PlayerSystem("p1", "sys-1")
	if systemRuntime == nil || systemRuntime.SensorContacts["fleet-enemy"] == nil {
		t.Fatalf("expected restored system contacts, got %+v", systemRuntime)
	}
	if !systemRuntime.SensorContacts["fleet-enemy"].FalseContact {
		t.Fatalf("expected false contact flag to roundtrip, got %+v", systemRuntime.SensorContacts["fleet-enemy"])
	}
}
