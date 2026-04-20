package snapshot_test

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func TestT112SnapshotRoundTripPreservesPlayerWarBlueprints(t *testing.T) {
	ws := model.NewWorldState("planet-1", 8, 8)
	player := &model.PlayerState{
		PlayerID:  "p1",
		IsAlive:   true,
		Resources: model.Resources{Minerals: 100, Energy: 50},
		WarBlueprints: map[string]*model.WarBlueprint{
			"falcon_mk1": {
				ID:                "falcon_mk1",
				OwnerID:           "p1",
				Name:              "Falcon Mk1",
				Source:            model.WarBlueprintSourcePlayer,
				State:             model.WarBlueprintStatePrototype,
				Domain:            model.UnitDomainGround,
				BaseFrameID:       "light_frame",
				ParentBlueprintID: "prototype",
				AllowedVariantSlots: []string{
					"utility",
				},
				Components: []model.WarBlueprintComponentSlot{
					{SlotID: "power_core", ComponentID: "micro_reactor"},
					{SlotID: "mobility", ComponentID: "servo_drive"},
				},
				Validation: &model.WarBlueprintValidationResult{
					Valid: true,
					Usage: model.WarBlueprintBudgetUsage{
						PowerOutput: 140,
						PowerDraw:   28,
					},
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
	blueprint := restored.Players["p1"].WarBlueprints["falcon_mk1"]
	if blueprint == nil {
		t.Fatalf("expected restored player blueprint, got %+v", restored.Players["p1"])
	}
	if blueprint.ParentBlueprintID != "prototype" {
		t.Fatalf("expected parent blueprint id to roundtrip, got %+v", blueprint)
	}
	if blueprint.State != model.WarBlueprintStatePrototype {
		t.Fatalf("expected blueprint state to roundtrip, got %+v", blueprint)
	}
	if blueprint.Validation == nil || !blueprint.Validation.Valid {
		t.Fatalf("expected validation payload to roundtrip, got %+v", blueprint)
	}
	if len(blueprint.Components) != 2 {
		t.Fatalf("expected components to roundtrip, got %+v", blueprint.Components)
	}
}
