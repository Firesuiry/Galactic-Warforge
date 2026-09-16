package snapshot_test

import (
	"math"
	"strings"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func TestProductionProgressSnapshotValidationAndIsolation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		remaining int
		fraction  float64
		valid     bool
	}{
		{"quarter_tick", 12, .25, true}, {"zero", 0, 0, true}, {"negative", 12, -.1, false}, {"whole_tick", 12, 1, false},
		{"nan", 12, math.NaN(), false}, {"infinite", 12, math.Inf(1), false}, {"finished_with_credit", 0, .5, false}, {"negative_remaining", -1, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ws := model.NewWorldState("planet", 8)
			ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
			profile := model.BuildingProfileFor(model.BuildingTypeArcSmelter, 1)
			b := &model.Building{ID: "smelter", Type: model.BuildingTypeArcSmelter, OwnerID: "p1", Position: model.Position{X: 1, Y: 1}, HP: profile.MaxHP, MaxHP: profile.MaxHP, Level: 1, Runtime: profile.Runtime, Production: &model.ProductionState{RecipeID: "smelt_iron", RemainingTicks: tc.remaining, ProgressFraction: tc.fraction}}
			model.InitBuildingStorage(b)
			ws.Buildings[b.ID] = b
			if err := ws.IndexBuilding(b); err != nil {
				t.Fatal(err)
			}
			captured := snapshot.CaptureRuntime(map[string]*model.WorldState{ws.PlanetID: ws}, ws.PlanetID, nil, nil)
			b.Production.ProgressFraction = .875
			worlds, active, _, err := captured.RestoreRuntime()
			if !tc.valid {
				if err == nil || !strings.Contains(err.Error(), "invalid production") {
					t.Fatalf("invalid progress accepted: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			restored := worlds[active].Buildings[b.ID]
			if restored.Production.ProgressFraction != tc.fraction || restored.Production.RemainingTicks != tc.remaining {
				t.Fatalf("snapshot shared or discarded progress: %+v", restored.Production)
			}
		})
	}
}
